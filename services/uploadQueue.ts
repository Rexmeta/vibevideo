// Durable upload queue for Veo-generated video clips. (Task #83)
//
// When Veo finishes a clip we have an mp4 blob in memory. The Firebase
// Storage upload that follows can still fail (network drop, auth blip,
// CORS hiccup, browser quota). Before this module existed we showed a
// blob: URL to the user and dropped the bytes on tab close, forcing a
// 5-minute regeneration.
//
// uploadQueue persists pending uploads (the mp4 blob + destination path)
// in IndexedDB and replays them on startup with exponential backoff. A
// subscriber model lets the JobManager react when an upload finally
// succeeds (so it can flip the persisted scene from blob URL to https).

import { uploadFileToCloud, updateProjectFields } from './storageService';

const DB_NAME = 'vibe_upload_queue';
const DB_VERSION = 1;
const STORE_NAME = 'pending';

export type UploadEntryStatus = 'queued' | 'uploading' | 'failed' | 'done';

export interface UploadEntry {
  id: string;            // queue id (uuid-ish)
  projectId: string;
  userId: string;
  sceneIdx: number;
  destPath: string;
  blob: Blob;
  attempts: number;
  lastError?: string;
  enqueuedAt: number;
  nextAttemptAt: number;
  status: UploadEntryStatus;
}

export interface UploadEvent {
  id: string;
  projectId: string;
  sceneIdx: number;
  status: UploadEntryStatus;
  attempts: number;
  finalUrl?: string;
  error?: string;
}

let dbPromise: Promise<IDBDatabase> | null = null;

const openDB = (): Promise<IDBDatabase> => {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
};

const putEntry = async (entry: UploadEntry) => {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

const deleteEntry = async (id: string) => {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

const listEntries = async (): Promise<UploadEntry[]> => {
  try {
    const db = await openDB();
    return await new Promise<UploadEntry[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => resolve((req.result as UploadEntry[]) || []);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
};

// Backoff for upload retries: 5s, 15s, 45s, 2m, 5m, then capped at 5m.
const BACKOFFS_MS = [5_000, 15_000, 45_000, 120_000, 300_000];

const computeBackoff = (attempts: number): number =>
  BACKOFFS_MS[Math.min(attempts, BACKOFFS_MS.length - 1)];

type Listener = (e: UploadEvent) => void;

class UploadQueue {
  private listeners: Set<Listener> = new Set();
  private active: Map<string, AbortController> = new Map();
  private timers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  // Hot snapshot so the dock can show pending counts without an IDB round-trip.
  private snapshot: Map<string, UploadEntry> = new Map();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: UploadEvent) {
    this.listeners.forEach(l => {
      try { l(e); } catch (err) { console.warn('[UploadQueue] listener err:', err); }
    });
  }

  /** Hot snapshot of pending entries (for dock summaries). */
  pending(): UploadEntry[] {
    return Array.from(this.snapshot.values()).filter(e => e.status !== 'done');
  }

  pendingForProject(projectId: string): UploadEntry[] {
    return this.pending().filter(e => e.projectId === projectId);
  }

  /**
   * Enqueue a new upload. Persists immediately and starts attempt #1.
   * Returns the queue id so the caller can correlate later events.
   */
  async enqueue(opts: {
    projectId: string;
    userId: string;
    sceneIdx: number;
    destPath: string;
    blob: Blob;
  }): Promise<string> {
    const id = `up-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const entry: UploadEntry = {
      id,
      projectId: opts.projectId,
      userId: opts.userId,
      sceneIdx: opts.sceneIdx,
      destPath: opts.destPath,
      blob: opts.blob,
      attempts: 0,
      enqueuedAt: Date.now(),
      nextAttemptAt: Date.now(),
      status: 'queued',
    };
    try {
      await putEntry(entry);
    } catch (e) {
      console.warn('[UploadQueue] persist failed (memory-only):', e);
    }
    this.snapshot.set(id, entry);
    this.scheduleAttempt(entry, 0);
    return id;
  }

  /** Force-retry every pending entry for a project (e.g. user clicked "지금 다시 업로드" on the project card). */
  retryProjectNow(projectId: string) {
    for (const e of this.pendingForProject(projectId)) {
      this.retryNow(e.id);
    }
  }

  /** User-triggered "지금 다시 업로드" — fires immediately. */
  retryNow(id: string) {
    const entry = this.snapshot.get(id);
    if (!entry || entry.status === 'done') return;
    const t = this.timers.get(id);
    if (t) {
      clearTimeout(t);
      this.timers.delete(id);
    }
    entry.nextAttemptAt = Date.now();
    this.snapshot.set(id, entry);
    this.scheduleAttempt(entry, 0);
  }

  /** User-triggered "추적 중단": permanently drop the entry. */
  async abandon(id: string) {
    const t = this.timers.get(id);
    if (t) { clearTimeout(t); this.timers.delete(id); }
    const ctrl = this.active.get(id);
    if (ctrl) ctrl.abort();
    const entry = this.snapshot.get(id);
    this.snapshot.delete(id);
    try { await deleteEntry(id); } catch {}
    if (entry) {
      this.emit({
        id, projectId: entry.projectId, sceneIdx: entry.sceneIdx,
        status: 'failed', attempts: entry.attempts, error: '사용자 취소',
      });
    }
  }

  /**
   * Replay every persisted entry on app start. Idempotent — safe to call
   * more than once; entries already in `active`/`timers` are skipped.
   */
  async resumeAll(): Promise<void> {
    const entries = await listEntries();
    for (const e of entries) {
      if (this.snapshot.has(e.id)) continue;
      this.snapshot.set(e.id, e);
      // Emit a synthetic 'failed' (pending-retry) event right away so
      // any subscriber (e.g. StudioDock badges) can surface "업로드
      // 재시도 중" without waiting for the next backoff to fire.
      // Task #83: state visibility on session restore.
      this.emit({
        id: e.id,
        projectId: e.projectId,
        sceneIdx: e.sceneIdx,
        status: 'failed',
        attempts: e.attempts,
        error: e.lastError,
      });
      const wait = Math.max(0, e.nextAttemptAt - Date.now());
      this.scheduleAttempt(e, wait);
    }
  }

  private scheduleAttempt(entry: UploadEntry, delayMs: number) {
    if (this.timers.has(entry.id) || this.active.has(entry.id)) return;
    const t = setTimeout(() => {
      this.timers.delete(entry.id);
      this.attempt(entry).catch(err => {
        console.warn('[UploadQueue] attempt loop err:', err);
      });
    }, delayMs);
    this.timers.set(entry.id, t);
  }

  private async attempt(entry: UploadEntry) {
    const ctrl = new AbortController();
    this.active.set(entry.id, ctrl);
    entry.status = 'uploading';
    entry.attempts += 1;
    this.snapshot.set(entry.id, entry);
    this.emit({
      id: entry.id, projectId: entry.projectId, sceneIdx: entry.sceneIdx,
      status: 'uploading', attempts: entry.attempts,
    });
    try {
      const finalUrl = await uploadFileToCloud(entry.destPath, entry.blob, 'blob');
      // Verify it's a real http URL (uploadFileToCloud falls back to a
      // data: URL on hard failure, which we don't want to persist as
      // "uploaded" — a data: URL means the upload actually failed).
      if (!finalUrl || !finalUrl.startsWith('http')) {
        throw new Error('Storage upload returned non-http URL');
      }
      entry.status = 'done';
      entry.lastError = undefined;
      this.snapshot.set(entry.id, entry);
      this.active.delete(entry.id);
      try { await deleteEntry(entry.id); } catch {}
      // Best-effort: patch the project doc so the persisted scene flips
      // from blob: URL to the http one. The JobManager listener below
      // also patches via persistSceneUpdate so this is a safety net for
      // resumed uploads where no in-tab JobManager is active.
      try {
        await updateProjectFields(entry.projectId, {
          [`saved_scenes_map.${String(entry.sceneIdx).padStart(2, '0')}.video_path`]: finalUrl,
          [`saved_scenes_map.${String(entry.sceneIdx).padStart(2, '0')}.video_meta.uploadStatus`]: 'ok',
          [`saved_scenes_map.${String(entry.sceneIdx).padStart(2, '0')}.video_meta.uploadAttempts`]: entry.attempts,
        });
      } catch (e) {
        console.warn('[UploadQueue] project patch failed:', e);
      }
      this.emit({
        id: entry.id, projectId: entry.projectId, sceneIdx: entry.sceneIdx,
        status: 'done', attempts: entry.attempts, finalUrl,
      });
    } catch (err: any) {
      const msg = err?.message || String(err);
      entry.status = 'failed';
      entry.lastError = msg;
      entry.nextAttemptAt = Date.now() + computeBackoff(entry.attempts);
      this.snapshot.set(entry.id, entry);
      this.active.delete(entry.id);
      try { await putEntry(entry); } catch {}
      // Mirror retry telemetry into Firestore so other devices/sessions
      // can see "업로드 재시도 중" without booting an in-memory queue.
      try {
        const k = String(entry.sceneIdx).padStart(2, '0');
        await updateProjectFields(entry.projectId, {
          [`saved_scenes_map.${k}.video_meta.uploadStatus`]: 'pending-upload',
          [`saved_scenes_map.${k}.video_meta.uploadAttempts`]: entry.attempts,
          [`saved_scenes_map.${k}.video_meta.uploadNextAttemptAt`]: entry.nextAttemptAt,
          [`saved_scenes_map.${k}.video_meta.uploadLastError`]: msg.slice(0, 500),
        });
      } catch (e) {
        console.warn('[UploadQueue] retry-state patch failed:', e);
      }
      this.emit({
        id: entry.id, projectId: entry.projectId, sceneIdx: entry.sceneIdx,
        status: 'failed', attempts: entry.attempts, error: msg,
      });
      // Hard cap at 12 attempts (~hours of retry). After that we keep the
      // entry in IDB but stop scheduling — user can hit "지금 다시 업로드".
      if (entry.attempts < 12) {
        this.scheduleAttempt(entry, computeBackoff(entry.attempts));
      } else {
        console.warn(`[UploadQueue] gave up scheduling ${entry.id} after ${entry.attempts} attempts`);
      }
    }
  }
}

export const uploadQueue = new UploadQueue();
