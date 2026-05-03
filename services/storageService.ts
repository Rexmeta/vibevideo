import { db, storage, auth } from "./firebaseConfig";
import { 
  ref, 
  uploadBytes, 
  getDownloadURL,
  deleteObject,
  listAll
} from "firebase/storage";
import { 
  collection, 
  doc, 
  setDoc, 
  updateDoc,
  getDoc, 
  getDocs, 
  getDocsFromCache,
  onSnapshot,
  query, 
  where, 
  orderBy,
  limit,
  startAfter,
  deleteDoc,
  deleteField,
  documentId,
  serverTimestamp,
  increment,
  runTransaction,
  DocumentSnapshot,
  QueryDocumentSnapshot
} from "firebase/firestore";
import { GenerationRun, Project, ProjectStatus, Scene } from "../types";

const PROJECTS_COLLECTION = 'projects';
const PAGE_SIZE = 20;

const CARD_KEY = (id: string) => `vibe_video_card_${id}`;

type IdleScheduler = (cb: () => void, opts?: { timeout: number }) => number;
type WithIdle = { requestIdleCallback?: IdleScheduler };

const runIdle = (cb: () => void, timeout: number = 2000) => {
  const ric = (globalThis as WithIdle).requestIdleCallback;
  if (typeof ric === 'function') {
    try { ric(cb, { timeout }); return; } catch {}
  }
  setTimeout(cb, 0);
};

const withTimeout = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} 시간 초과 (${ms / 1000}초)`)), ms);
    promise.then(
      val => { clearTimeout(timer); resolve(val); },
      err => { clearTimeout(timer); reject(err); }
    );
  });
};

export const generateProjectId = (): string => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `proj-${crypto.randomUUID()}`;
  }
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 10);
  return `proj-${ts}-${rand}`;
};

type ProjectCard = Pick<Project,
  'id' | 'user_id' | 'title' | 'aspect_ratio' | 'style_template' | 'status' |
  'thumbnail' | 'saved_step' | 'saved_max_step' | 'saved_mode' | 'saved_topic' |
  'saved_duration' | 'scene_count' | 'total_duration' | 'created_at' | 'updated_at' | 'version'
>;

const CARD_FIELD_PATHS: ReadonlyArray<keyof ProjectCard> = [
  'user_id', 'title', 'aspect_ratio', 'style_template', 'status', 'thumbnail',
  'saved_step', 'saved_max_step', 'saved_mode', 'saved_topic', 'saved_duration',
  'scene_count', 'total_duration', 'created_at', 'updated_at', 'version',
];

const stripScenes = (p: Project): Project => {
  const { saved_scenes: _omit, ...rest } = p;
  return rest as Project;
};

const toCard = (p: Project): Project => {
  const card: Partial<ProjectCard> & { id: string } = { id: p.id };
  for (const k of CARD_FIELD_PATHS) {
    const value = p[k];
    if (value !== undefined) (card as Record<string, unknown>)[k] = value;
  }
  return card as Project;
};

const writeCardCache = (p: Project): boolean => {
  try {
    localStorage.setItem(CARD_KEY(p.id), JSON.stringify(toCard(p)));
    return true;
  } catch (e) {
    const err = e as { name?: string; message?: string };
    if (err?.name !== 'QuotaExceededError') {
      console.warn('[Database] card cache write failed:', err?.message);
    }
    return false;
  }
};

const getLocalProjects = (userId: string): Project[] => {
  const projects: Project[] = [];
  try {
    const indexStr = localStorage.getItem(`vibe_project_index_${userId}`);
    if (indexStr) {
      const index: string[] = JSON.parse(indexStr);
      for (const id of index) {
        const cardStr = localStorage.getItem(CARD_KEY(id));
        if (cardStr) {
          try {
            const card = JSON.parse(cardStr) as Project;
            if (card && card.user_id === userId) {
              projects.push(card);
              continue;
            }
          } catch {}
        }
        const val = localStorage.getItem(`vibe_video_backup_${id}`);
        if (!val) continue;
        try {
          const p = JSON.parse(val) as Project;
          if (p && p.user_id === userId) projects.push(stripScenes(p));
        } catch {}
      }
    } else {
      const localKeys = Object.keys(localStorage).filter(k => k.startsWith('vibe_video_backup_') && !k.includes('emergency'));
      for (const key of localKeys) {
        const val = localStorage.getItem(key);
        if (!val) continue;
        try {
          const p = JSON.parse(val) as Project;
          if (p && p.user_id === userId) projects.push(stripScenes(p));
        } catch {}
      }
    }
  } catch (e) {}
  return projects;
};

const updateProjectIndex = (userId: string, projectId: string, action: 'add' | 'remove') => {
  try {
    const indexStr = localStorage.getItem(`vibe_project_index_${userId}`);
    const index: string[] = indexStr ? JSON.parse(indexStr) : [];
    if (action === 'add') {
      if (!index.includes(projectId)) index.unshift(projectId);
      if (index.length > 50) index.length = 50;
    } else {
      const idx = index.indexOf(projectId);
      if (idx !== -1) index.splice(idx, 1);
    }
    localStorage.setItem(`vibe_project_index_${userId}`, JSON.stringify(index));
  } catch (e) {}
};

const batchAddToProjectIndex = (userId: string, ids: string[]): void => {
  if (!userId || !ids.length) return;
  try {
    const indexStr = localStorage.getItem(`vibe_project_index_${userId}`);
    const existing: string[] = indexStr ? JSON.parse(indexStr) : [];
    const seen = new Set(existing);
    let changed = false;
    for (let i = ids.length - 1; i >= 0; i--) {
      const id = ids[i];
      if (!id || seen.has(id)) continue;
      existing.unshift(id);
      seen.add(id);
      changed = true;
    }
    if (existing.length > 50) existing.length = 50;
    if (changed) {
      localStorage.setItem(`vibe_project_index_${userId}`, JSON.stringify(existing));
    }
  } catch {}
};

const isDataUrl = (s?: string): boolean => !!s && s.startsWith('data:');
const isBase64Only = (s?: string): boolean => !!s && !s.startsWith('data:') && !s.startsWith('http') && !s.startsWith('blob:') && s.length > 200;
const isBlobUrl = (s?: string): boolean => !!s && s.startsWith('blob:');

const isFirestoreSentinel = (v: unknown): boolean => {
  if (!v || typeof v !== 'object') return false;
  const ctor = (v as { constructor?: { name?: string } }).constructor?.name || '';
  return ctor.endsWith('FieldValueImpl') || ctor === 'FieldValue' || ctor.endsWith('FieldValue');
};

const removeUndefined = (obj: Record<string, any>): Record<string, any> => {
  const cleaned: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue;
    if (isFirestoreSentinel(value)) {
      cleaned[key] = value;
    } else if (value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      cleaned[key] = removeUndefined(value);
    } else if (Array.isArray(value)) {
      cleaned[key] = value.map(item =>
        item !== null && typeof item === 'object' && !Array.isArray(item) && !isFirestoreSentinel(item)
          ? removeUndefined(item)
          : item
      );
    } else {
      cleaned[key] = value;
    }
  }
  return cleaned;
};

/**
 * Returns the cloud-storable form of a scene field value.
 * - Drops local-only payloads (data: URLs, base64 blobs, blob: URLs).
 * - Returns `undefined` to signal "do not write this field".
 */
export const sanitizeSceneFieldForFirestore = (field: string, value: unknown): unknown => {
  if (value === undefined) return undefined;
  if (typeof value === 'string') {
    if (field === 'audio_path' && (isDataUrl(value) || isBase64Only(value))) return undefined;
    if (field === 'image_path' && (isDataUrl(value) || isBase64Only(value))) return undefined;
    if (field === 'video_path' && (isDataUrl(value) || isBlobUrl(value))) return undefined;
  }
  return value;
};

/** Cloud-storable form of a single scene (drops local-only paths, undefineds). */
export const sanitizeSceneForFirestore = (s: Partial<Scene>): Record<string, any> => {
  const cleaned: Record<string, any> = {};
  for (const [k, v] of Object.entries(s)) {
    const sv = sanitizeSceneFieldForFirestore(k, v);
    if (sv !== undefined) cleaned[k] = sv;
  }
  return removeUndefined(cleaned);
};

const sanitizeScenesForFirestore = (scenes: Partial<Scene>[]): Record<string, any>[] => {
  return scenes.map(s => sanitizeSceneForFirestore(s));
};

/** Zero-padded 2-digit index used as the map key for `saved_scenes_map`. */
export const sceneMapKey = (idx: number): string => idx.toString().padStart(2, '0');

/**
 * Convert an ordered array of scenes into the Firestore map representation
 * (`saved_scenes_map`). Map keys preserve the original index ordering when
 * sorted lexically (we always pad to 2 digits).
 */
export const scenesArrayToMap = (scenes: Array<Record<string, any>>): Record<string, any> => {
  const map: Record<string, any> = {};
  scenes.forEach((s, i) => {
    map[sceneMapKey(i)] = s;
  });
  return map;
};

/** Reverse of `scenesArrayToMap`: rebuild an ordered array from the map. */
export const scenesMapToArray = (map: Record<string, any>): Array<Record<string, any>> => {
  if (!map || typeof map !== 'object') return [];
  return Object.keys(map)
    .sort()
    .map(k => map[k])
    .filter(v => v && typeof v === 'object');
};

const base64ToBlob = (base64: string, contentType: string): Blob => {
  const cleanBase64 = base64.replace(/^data:.*?;base64,/, "");
  const byteCharacters = atob(cleanBase64);
  const byteNumbers = new Uint8Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  return new Blob([byteNumbers], { type: contentType });
};

export const uploadFileToCloud = async (path: string, data: string | Blob, format: 'base64' | 'blob' = 'base64'): Promise<string> => {
  let contentType = 'application/octet-stream';
  if (path.endsWith('.wav')) contentType = 'audio/wav';
  else if (path.endsWith('.jpg') || path.endsWith('.jpeg')) contentType = 'image/jpeg';
  else if (path.endsWith('.png')) contentType = 'image/png';
  else if (path.endsWith('.mp4')) contentType = 'video/mp4';

  if (!storage) {
    console.warn("[Storage] Cloud service unavailable, using local simulation.");
    if (typeof data === 'string') {
      return data.startsWith('data:') ? data : `data:${contentType};base64,${data}`;
    }
    return URL.createObjectURL(data as Blob);
  }

  const storageRef = ref(storage, path);
  const metadata = {
    contentType,
    cacheControl: 'public, max-age=31536000',
  };
  
  const doUpload = async () => {
    let blob: Blob;
    if (format === 'base64' && typeof data === 'string') {
      blob = base64ToBlob(data, contentType);
    } else if (data instanceof Blob) {
      blob = data;
    } else {
      throw new Error('Invalid upload data format');
    }
    
    await withTimeout(uploadBytes(storageRef, blob, metadata), 60000, '파일 업로드');
    return await withTimeout(getDownloadURL(storageRef), 15000, '다운로드 URL 조회');
  };

  try {
    const url = await doUpload();
    console.log(`[Storage] Success: ${path}`);
    return url;
  } catch (firstError: any) {
    console.warn(`[Storage] 1차 업로드 실패 (${path}):`, firstError?.message, '- 재시도 중...');
    try {
      await new Promise(r => setTimeout(r, 1000));
      const url = await doUpload();
      console.log(`[Storage] 재시도 성공: ${path}`);
      return url;
    } catch (retryError: any) {
      console.warn(`[Storage] 재시도 실패 (${path}):`, retryError?.message);
      if (typeof data === 'string') {
        return data.startsWith('data:') ? data : `data:${contentType};base64,${data}`;
      }
      throw retryError;
    }
  }
};

const MAX_DOC_SCENES = 50;

/**
 * Narrow Firestore update that only writes the supplied fields, no derived
 * counters and no version bump. Used by the background JobManager to
 * persist `generation_run` state without touching project metadata
 * (aspect ratio, style, scene count, etc.).
 */
export const updateProjectFields = async (
  projectId: string,
  fields: Record<string, any>
): Promise<void> => {
  if (!projectId) return;
  const sanitized = removeUndefined({
    ...fields,
    updated_at: new Date().toISOString(),
  });
  // Local mirror — only patch the keys we know, never overwrite the rest.
  try {
    const raw = localStorage.getItem(`vibe_video_backup_${projectId}`);
    if (raw) {
      const existing = JSON.parse(raw);
      localStorage.setItem(
        `vibe_video_backup_${projectId}`,
        JSON.stringify({ ...existing, ...sanitized })
      );
    }
  } catch {}
  if (!db) return;
  try {
    const projectRef = doc(db, PROJECTS_COLLECTION, projectId);
    await withTimeout(
      updateDoc(projectRef, sanitized),
      10000,
      '프로젝트 부분 저장'
    );
  } catch (e: any) {
    // updateDoc fails if the document does not exist yet; in that case we
    // skip silently — persistRun is purely advisory.
    if (e?.code !== 'not-found') {
      console.warn('[Storage] updateProjectFields 실패:', e?.message || e);
    }
  }
};

export const updateProjectGenerationRun = async (
  projectId: string,
  run: GenerationRun | null
): Promise<void> => {
  return updateProjectFields(projectId, {
    generation_run: run === null ? deleteField() : run,
  });
};

const scenesBlobPath = (userId: string, projectId: string): string =>
  `users/${userId}/projects/${projectId}/scenes.json`;

const uploadScenesBlob = async (
  userId: string,
  projectId: string,
  scenes: Record<string, any>[]
): Promise<{ url: string; path: string } | null> => {
  if (!storage || !userId || !projectId) return null;
  const path = scenesBlobPath(userId, projectId);
  try {
    const storageRef = ref(storage, path);
    const blob = new Blob([JSON.stringify(scenes)], { type: 'application/json' });
    await withTimeout(
      uploadBytes(storageRef, blob, {
        contentType: 'application/json',
        cacheControl: 'private, max-age=3600',
      }),
      30000,
      '씬 업로드'
    );
    const url = await withTimeout(getDownloadURL(storageRef), 15000, '씬 URL 조회');
    return { url, path };
  } catch (e: any) {
    console.warn('[Database] scenes blob upload 실패:', e?.message);
    return null;
  }
};

const fetchScenesBlob = async (url: string): Promise<Partial<Scene>[] | null> => {
  try {
    const resp = await withTimeout(fetch(url), 15000, '씬 다운로드');
    if (!resp.ok) return null;
    const data = await resp.json();
    return Array.isArray(data) ? (data as Partial<Scene>[]) : null;
  } catch (e: any) {
    console.warn('[Database] scenes blob 다운로드 실패:', e?.message);
    return null;
  }
};

export const saveProjectToCloud = async (project: Project, skipLocalSave: boolean = false): Promise<void> => {
  if (!project.id) return;
  
  if (!skipLocalSave) {
    try {
      const lightProject = { ...project };
      if (lightProject.saved_scenes && lightProject.saved_scenes.length > 0) {
        lightProject.saved_scenes = lightProject.saved_scenes.map(s => {
          const c = { ...s };
          if (isDataUrl(c.audio_path) || isBase64Only(c.audio_path)) c.audio_path = undefined;
          if (isDataUrl(c.image_path) || isBase64Only(c.image_path)) c.image_path = undefined;
          if (isDataUrl(c.video_path) || isBlobUrl(c.video_path)) c.video_path = undefined;
          return c;
        });
      }
      localStorage.setItem(`vibe_video_backup_${project.id}`, JSON.stringify(lightProject));
    } catch (e) {
      console.warn("[Database Save] localStorage 저장 실패 (용량 초과)");
    }
  }
  if (project.user_id) {
    try { updateProjectIndex(project.user_id, project.id, 'add'); } catch (e) {}
  }

  if (!db) {
    console.warn("[Database] Cloud service unavailable, saved to Local Storage only.");
    return;
  }

  try {
    const projectRef = doc(db, PROJECTS_COLLECTION, project.id);
    const sanitizedScenes = project.saved_scenes
      ? sanitizeScenesForFirestore(project.saved_scenes)
      : undefined;

    const sceneCount = project.saved_scenes?.length || 0;
    const totalDuration = project.saved_scenes?.reduce((sum, s) => sum + (s.audio_duration || 0), 0) || 0;

    let blobInfo: { url: string; path: string } | null = null;
    if (sanitizedScenes && sanitizedScenes.length > 0 && project.user_id) {
      blobInfo = await uploadScenesBlob(project.user_id, project.id, sanitizedScenes);
    }

    const dataToSave = removeUndefined({
      ...project,
      saved_scenes: undefined,
      scenes_blob_url: undefined,
      scenes_blob_path: undefined,
      scenes_blob_updated_at: undefined,
      scene_count: sceneCount,
      total_duration: Math.round(totalDuration * 10) / 10,
      updated_at: new Date().toISOString(),
      server_updated_at: serverTimestamp(),
      version: (project as any).version ? (project as any).version + 1 : 1,
    });

    if (blobInfo) {
      dataToSave.scenes_blob_url = blobInfo.url;
      dataToSave.scenes_blob_path = blobInfo.path;
      dataToSave.scenes_blob_updated_at = new Date().toISOString();
      dataToSave.saved_scenes = deleteField();
      // Scenes are stored out-of-doc; clear any stale map mirror so reads
      // don't pick up an outdated per-scene snapshot. Wizard partial-save
      // path will not be used for projects that fall back to blob storage.
      dataToSave.saved_scenes_map = deleteField();
    } else if (sanitizedScenes) {
      dataToSave.saved_scenes = sanitizedScenes.slice(0, MAX_DOC_SCENES);
      // Mirror as a map so partial per-scene patches via dotted paths
      // (`saved_scenes_map.<idx>.<field>`) can target individual scenes.
      dataToSave.saved_scenes_map = scenesArrayToMap(sanitizedScenes.slice(0, MAX_DOC_SCENES));
      dataToSave.scenes_blob_url = deleteField();
      dataToSave.scenes_blob_path = deleteField();
      dataToSave.scenes_blob_updated_at = deleteField();
    }

    const refImg = (project as any).character_reference_image;
    if (refImg === null || refImg === '' || (typeof refImg === 'string' && !refImg.startsWith('http'))) {
      dataToSave.character_reference_image = deleteField();
    }

    await withTimeout(setDoc(projectRef, dataToSave, { merge: true }), 20000, '프로젝트 저장');
    console.log(`[Database] Project Saved Successfully: ${project.id}${blobInfo ? ' (scenes in blob)' : ''}`);
  } catch (error: any) {
    console.warn("[Database Save] 클라우드 저장 실패, 로컬에 백업됨:", error?.message);
    try {
      const emergencyData = { ...project, saved_scenes: project.saved_scenes?.map(s => {
        const c = { ...s };
        if (c.audio_path && !c.audio_path.startsWith('http')) c.audio_path = '[local-audio]';
        if (c.image_path && !c.image_path.startsWith('http')) c.image_path = '[local-image]';
        if (c.video_path && !c.video_path.startsWith('http')) c.video_path = '[local-video]';
        return c;
      }) };
      localStorage.setItem(`vibe_video_backup_emergency_${project.id}`, JSON.stringify(emergencyData));
    } catch(e) {}
  }
};

/**
 * Partial save: writes only the supplied keys to the project doc using
 * `updateDoc`, which interprets dotted keys as nested field paths.
 *
 * Callers may pass:
 *   - top-level scalar fields (e.g. `saved_step`, `title`)
 *   - dotted scene-level paths (e.g. `saved_scenes_map.05.image_path`,
 *     `saved_scenes_map.07`) for true per-scene patches
 *   - Firestore sentinels (`deleteField()`, etc.) as values
 *
 * The function:
 *   - Strips top-level `undefined` values (Firestore rejects them).
 *   - Always bumps `version` via atomic `increment(1)`.
 *   - Always refreshes `updated_at` / `server_updated_at`.
 *   - Honors the `character_reference_image` deletion rule.
 *
 * Requires the document to exist (callers gate this on a prior successful
 * full save). Throws on failure so callers can fall back.
 */
export const saveProjectFieldsToCloud = async (
  projectId: string,
  fields: Record<string, any>,
): Promise<void> => {
  if (!projectId || !db) return;
  if (!fields || Object.keys(fields).length === 0) return;

  const data: Record<string, any> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue; // updateDoc rejects undefined
    data[k] = v;
  }

  if ('character_reference_image' in data) {
    const refImg = data.character_reference_image;
    if (
      refImg === null ||
      refImg === '' ||
      (typeof refImg === 'string' && !refImg.startsWith('http'))
    ) {
      data.character_reference_image = deleteField();
    }
  }

  data.updated_at = new Date().toISOString();
  data.server_updated_at = serverTimestamp();
  data.version = increment(1);

  const projectRef = doc(db, PROJECTS_COLLECTION, projectId);
  await withTimeout(updateDoc(projectRef, data), 20000, '프로젝트 부분 저장');
  const keyCount = Object.keys(fields).length;
  console.log(
    `[Database] Partial save: ${projectId} (${keyCount} field${keyCount === 1 ? '' : 's'})`,
  );
};

export const saveProjectWithConflictCheck = async (project: Project): Promise<{ saved: boolean; conflict: boolean }> => {
  if (!project.id || !db) {
    await saveProjectToCloud(project);
    return { saved: true, conflict: false };
  }

  let precomputedBlob: { url: string; path: string } | null = null;
  if (project.saved_scenes && project.saved_scenes.length > 0 && project.user_id) {
    const sanitized = sanitizeScenesForFirestore(project.saved_scenes);
    precomputedBlob = await uploadScenesBlob(project.user_id, project.id, sanitized);
  }

  try {
    const result = await runTransaction(db, async (transaction) => {
      const projectRef = doc(db!, PROJECTS_COLLECTION, project.id);
      const docSnap = await transaction.get(projectRef);
      
      if (docSnap.exists()) {
        const existing = docSnap.data();
        const existingVersion = existing.version || 0;
        const localVersion = (project as any).version || 0;
        
        if (existingVersion > localVersion) {
          return { conflict: true };
        }
      }
      
      const sanitizedScenes = project.saved_scenes
        ? sanitizeScenesForFirestore(project.saved_scenes)
        : undefined;

      const sceneCount = project.saved_scenes?.length || 0;
      const totalDuration = project.saved_scenes?.reduce((sum, s) => sum + (s.audio_duration || 0), 0) || 0;

      const dataToSave = removeUndefined({
        ...project,
        saved_scenes: undefined,
        scenes_blob_url: undefined,
        scenes_blob_path: undefined,
        scenes_blob_updated_at: undefined,
        scene_count: sceneCount,
        total_duration: Math.round(totalDuration * 10) / 10,
        updated_at: new Date().toISOString(),
        server_updated_at: serverTimestamp(),
        version: (project as any).version ? (project as any).version + 1 : 1,
      });

      if (precomputedBlob) {
        dataToSave.scenes_blob_url = precomputedBlob.url;
        dataToSave.scenes_blob_path = precomputedBlob.path;
        dataToSave.scenes_blob_updated_at = new Date().toISOString();
        dataToSave.saved_scenes = deleteField();
        dataToSave.saved_scenes_map = deleteField();
      } else if (sanitizedScenes) {
        dataToSave.saved_scenes = sanitizedScenes.slice(0, MAX_DOC_SCENES);
        dataToSave.saved_scenes_map = scenesArrayToMap(sanitizedScenes.slice(0, MAX_DOC_SCENES));
        dataToSave.scenes_blob_url = deleteField();
        dataToSave.scenes_blob_path = deleteField();
        dataToSave.scenes_blob_updated_at = deleteField();
      }

      transaction.set(projectRef, dataToSave, { merge: true });
      return { conflict: false };
    });
    
    return { saved: !result.conflict, conflict: result.conflict };
  } catch (error: any) {
    console.warn("[Database] 트랜잭션 저장 실패, 일반 저장으로 대체:", error?.message);
    await saveProjectToCloud(project);
    return { saved: true, conflict: false };
  }
};

export const getProjectFromCloud = async (id: string): Promise<Project | undefined> => {
  if (!id) return undefined;
  
  if (db) {
    try {
      const projectRef = doc(db, PROJECTS_COLLECTION, id);
      const docSnap = await withTimeout(getDoc(projectRef), 15000, '프로젝트 조회');
      if (docSnap.exists()) {
        const raw = docSnap.data() as Project & { saved_scenes_map?: Record<string, any> };
        const project: Project = { ...raw };
        // Resolution order for scenes:
        //   1. scenes_blob_url / scenes_blob_path  (large projects offloaded
        //      to Firebase Storage by the full-save path).
        //   2. saved_scenes_map  (source of truth when the wizard has been
        //      doing per-scene partial updates via dotted paths).
        //   3. saved_scenes inline array  (legacy / small-project full saves).
        if (project.scenes_blob_url || project.scenes_blob_path) {
          let blobScenes: Partial<Scene>[] | null = null;
          if (project.scenes_blob_url) {
            blobScenes = await fetchScenesBlob(project.scenes_blob_url);
          }
          if (!blobScenes && project.scenes_blob_path && storage) {
            try {
              const freshUrl = await withTimeout(
                getDownloadURL(ref(storage, project.scenes_blob_path)),
                15000,
                '씬 URL 재조회'
              );
              blobScenes = await fetchScenesBlob(freshUrl);
            } catch (e: any) {
              console.warn('[Database] scenes blob path 재조회 실패:', e?.message);
            }
          }
          if (blobScenes && blobScenes.length > 0) {
            project.saved_scenes = blobScenes as Scene[];
          }
        } else if (raw.saved_scenes_map && typeof raw.saved_scenes_map === 'object') {
          project.saved_scenes = scenesMapToArray(raw.saved_scenes_map) as Scene[];
        }
        delete (project as any).saved_scenes_map;
        try { 
          const lightProject = { ...project };
          if (lightProject.saved_scenes) {
            lightProject.saved_scenes = lightProject.saved_scenes.map(s => {
              const c = { ...s };
              if (isDataUrl(c.audio_path) || isBase64Only(c.audio_path)) c.audio_path = undefined;
              if (isDataUrl(c.image_path) || isBase64Only(c.image_path)) c.image_path = undefined;
              return c;
            });
          }
          localStorage.setItem(`vibe_video_backup_${id}`, JSON.stringify(lightProject)); 
        } catch(e) {}
        return project;
      }
    } catch (error: any) {
      console.warn("[Database] 클라우드 조회 실패, 로컬 데이터 사용:", error?.message);
    }
  }

  const local = localStorage.getItem(`vibe_video_backup_${id}`) || localStorage.getItem(`vibe_video_backup_emergency_${id}`);
  if (local) {
    console.log("[Database] 로컬 백업에서 프로젝트 복원:", id);
    try { return JSON.parse(local); } catch {}
  }
  
  return undefined;
};

const sortProjects = (projects: Project[]): Project[] => {
  return projects.sort((a, b) => {
    const dateA = new Date(a.updated_at || a.created_at).getTime();
    const dateB = new Date(b.updated_at || b.created_at).getTime();
    return dateB - dateA;
  });
};

export const getLocalProjectsList = (userId: string): Project[] => {
  if (!userId) return [];
  return sortProjects(getLocalProjects(userId));
};

export interface PaginatedResult {
  projects: Project[];
  cursor: string | null;
  hasMore: boolean;
  fromCloud: boolean;
}

const persistCardsIdle = (userId: string, projects: Project[]): void => {
  if (!userId || projects.length === 0) return;
  const slim = projects.map(toCard);
  runIdle(() => {
    let written = 0;
    for (const p of slim) {
      if (writeCardCache(p)) written++;
    }
    batchAddToProjectIndex(userId, slim.map(p => p.id));
    if (written > 0) {
      console.log(`[Database] card cache: ${written}/${slim.length} 저장 (idle)`);
    }
  });
};

type RestValue = {
  stringValue?: string;
  integerValue?: string;
  doubleValue?: number;
  booleanValue?: boolean;
  nullValue?: null;
  timestampValue?: string;
};

type RestDocument = {
  name: string;
  fields?: Record<string, RestValue>;
};

const fromRestValue = (v: RestValue | undefined): unknown => {
  if (!v) return undefined;
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.integerValue !== undefined) return Number(v.integerValue);
  if (v.doubleValue !== undefined) return Number(v.doubleValue);
  if (v.booleanValue !== undefined) return v.booleanValue;
  if (v.nullValue !== undefined) return null;
  if (v.timestampValue !== undefined) return v.timestampValue;
  return undefined;
};

const restDocToProject = (doc: RestDocument): Project => {
  const id = doc.name.split('/').pop() || '';
  const out: Record<string, unknown> = { id };
  const fields = doc.fields || {};
  for (const k of CARD_FIELD_PATHS) {
    const value = fromRestValue(fields[k]);
    if (value !== undefined) out[k] = value;
  }
  return out as unknown as Project;
};

const getFirebaseProjectId = (): string | null => {
  const opts = auth?.app?.options as { projectId?: string } | undefined;
  return opts?.projectId || null;
};

type SlimPageResult = {
  projects: Project[];
  cursor: string | null;
  hasMore: boolean;
};

const fetchSlimPageViaRest = async (
  userId: string,
  pageSize: number,
  startAfterUpdatedAt?: string | null,
): Promise<SlimPageResult> => {
  const projectId = getFirebaseProjectId();
  const user = auth?.currentUser;
  if (!projectId || !user) throw new Error('Firebase auth not ready');

  const token = await user.getIdToken();
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`;

  const structuredQuery: Record<string, unknown> = {
    from: [{ collectionId: PROJECTS_COLLECTION }],
    where: {
      fieldFilter: {
        field: { fieldPath: 'user_id' },
        op: 'EQUAL',
        value: { stringValue: userId },
      },
    },
    orderBy: [{ field: { fieldPath: 'updated_at' }, direction: 'DESCENDING' }],
    limit: pageSize,
    select: { fields: CARD_FIELD_PATHS.map(fieldPath => ({ fieldPath })) },
  };
  if (startAfterUpdatedAt) {
    structuredQuery.startAt = {
      values: [{ stringValue: startAfterUpdatedAt }],
      before: false,
    };
  }

  const resp = await withTimeout(
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ structuredQuery }),
    }),
    15000,
    '프로젝트 목록 조회',
  );

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Firestore REST ${resp.status}: ${text.slice(0, 200)}`);
  }

  const json = (await resp.json()) as Array<{ document?: RestDocument }>;
  const projects: Project[] = [];
  let cursor: string | null = null;
  for (const entry of json) {
    if (!entry?.document) continue;
    const card = restDocToProject(entry.document);
    projects.push(card);
    if (typeof card.updated_at === 'string') cursor = card.updated_at;
  }
  return { projects, cursor, hasMore: projects.length === pageSize };
};

export const getProjectsPage = async (
  userId: string,
  cursor?: string | null,
  pageSize: number = PAGE_SIZE,
): Promise<PaginatedResult> => {
  if (!userId || !db) {
    const local = getLocalProjectsList(userId);
    return { projects: local, cursor: null, hasMore: false, fromCloud: false };
  }

  try {
    const slim = await fetchSlimPageViaRest(userId, pageSize, cursor);
    persistCardsIdle(userId, slim.projects);
    console.log(`[Database] 페이지 조회: ${slim.projects.length}개 (REST slim)`);
    return { projects: slim.projects, cursor: slim.cursor, hasMore: slim.hasMore, fromCloud: true };
  } catch (restError) {
    const msg = (restError as Error)?.message;
    console.warn('[Database] REST slim 실패, SDK로 재시도:', msg);
  }

  const trySdk = async (useCompoundIndex: boolean): Promise<PaginatedResult> => {
    let q;
    if (useCompoundIndex) {
      q = cursor
        ? query(
            collection(db!, PROJECTS_COLLECTION),
            where('user_id', '==', userId),
            orderBy('updated_at', 'desc'),
            startAfter(cursor),
            limit(pageSize),
          )
        : query(
            collection(db!, PROJECTS_COLLECTION),
            where('user_id', '==', userId),
            orderBy('updated_at', 'desc'),
            limit(pageSize),
          );
    } else {
      q = query(
        collection(db!, PROJECTS_COLLECTION),
        where('user_id', '==', userId),
        limit(100),
      );
    }

    const querySnapshot = await withTimeout(getDocs(q), 15000, '프로젝트 목록 조회');
    const projects: Project[] = [];
    let lastUpdated: string | null = null;
    querySnapshot.forEach((docSnap) => {
      const slim = stripScenes(docSnap.data() as Project);
      projects.push(slim);
      if (typeof slim.updated_at === 'string') lastUpdated = slim.updated_at;
    });
    if (!useCompoundIndex) {
      projects.sort((a, b) => {
        const dateA = new Date(a.updated_at || a.created_at).getTime();
        const dateB = new Date(b.updated_at || b.created_at).getTime();
        return dateB - dateA;
      });
      lastUpdated = projects[projects.length - 1]?.updated_at || null;
    }
    persistCardsIdle(userId, projects);
    if (useCompoundIndex) {
      console.log(`[Database] 페이지 조회: ${projects.length}개 (SDK compound fallback)`);
    } else {
      console.warn(`[Database] 페이지 조회: ${projects.length}개 — SDK simple fallback. 컴포지트 인덱스를 배포하세요.`);
    }
    return {
      projects,
      cursor: useCompoundIndex ? lastUpdated : null,
      hasMore: useCompoundIndex ? querySnapshot.size === pageSize : false,
      fromCloud: true,
    };
  };

  try {
    return await trySdk(true);
  } catch (error) {
    const msg = (error as Error)?.message;
    console.warn('[Database] SDK compound 실패, simple로 재시도:', msg);
    try {
      return await trySdk(false);
    } catch (fallbackError) {
      console.warn('[Database] 페이지 조회 실패:', (fallbackError as Error)?.message);
      const local = getLocalProjectsList(userId);
      return { projects: local, cursor: null, hasMore: false, fromCloud: false };
    }
  }
};

export const getProjectsPageFromCache = async (
  userId: string,
  pageSize: number = PAGE_SIZE,
): Promise<PaginatedResult> => {
  if (!userId || !db) {
    return { projects: [], cursor: null, hasMore: false, fromCloud: false };
  }
  try {
    const q = query(
      collection(db, PROJECTS_COLLECTION),
      where('user_id', '==', userId),
      orderBy('updated_at', 'desc'),
      limit(pageSize),
    );
    const snap = await getDocsFromCache(q);
    const projects: Project[] = [];
    let cursor: string | null = null;
    snap.forEach((docSnap) => {
      const slim = stripScenes(docSnap.data() as Project);
      projects.push(slim);
      if (typeof slim.updated_at === 'string') cursor = slim.updated_at;
    });
    if (projects.length > 0) {
      console.log(`[Database] cache 페이지 조회: ${projects.length}개`);
    }
    return {
      projects,
      cursor,
      hasMore: snap.size === pageSize,
      fromCloud: true,
    };
  } catch {
    return { projects: [], cursor: null, hasMore: false, fromCloud: false };
  }
};

export interface ProjectsListSubscription {
  unsubscribe: () => void;
}

export const subscribeToProjectsList = (
  userId: string,
  onChange: (projects: Project[]) => void,
  onError?: (err: Error) => void,
  pageSize: number = PAGE_SIZE,
): ProjectsListSubscription => {
  if (!userId || !db) {
    return { unsubscribe: () => {} };
  }

  let cancelled = false;
  let unsub: (() => void) | null = null;

  try {
    const q = query(
      collection(db, PROJECTS_COLLECTION),
      where('user_id', '==', userId),
      orderBy('updated_at', 'desc'),
      limit(pageSize),
    );

    unsub = onSnapshot(
      q,
      (snap) => {
        if (cancelled) return;
        const projects: Project[] = [];
        snap.forEach((docSnap) => {
          projects.push(stripScenes(docSnap.data() as Project));
        });
        if (snap.metadata.hasPendingWrites) {
          // Local optimistic write echo — surface anyway, downstream merges by id.
        }
        persistCardsIdle(userId, projects);
        try { onChange(projects); } catch (e) {
          console.warn('[Database] subscribeToProjectsList onChange threw:', (e as Error)?.message);
        }
      },
      (err) => {
        if (cancelled) return;
        console.warn('[Database] projects 실시간 구독 오류:', err?.message);
        if (onError) {
          try { onError(err); } catch {}
        }
      },
    );
  } catch (e) {
    console.warn('[Database] projects 실시간 구독 시작 실패:', (e as Error)?.message);
    if (onError) {
      try { onError(e as Error); } catch {}
    }
  }

  return {
    unsubscribe: () => {
      cancelled = true;
      if (unsub) {
        try { unsub(); } catch {}
        unsub = null;
      }
    },
  };
};

export const syncProjectsFromCloud = async (userId: string, localProjects: Project[]): Promise<{ projects: Project[], fromCloud: boolean }> => {
  if (!userId || !db) return { projects: localProjects, fromCloud: false };

  const projectMap = new Map<string, Project>();
  localProjects.forEach(p => projectMap.set(p.id, stripScenes(p)));

  const mergeFresh = (fresh: Project[]) => {
    fresh.forEach(cloudProject => {
      const localVersion = projectMap.get(cloudProject.id);
      if (localVersion) {
        const cloudDate = new Date(cloudProject.updated_at || cloudProject.created_at).getTime();
        const localDate = new Date(localVersion.updated_at || localVersion.created_at).getTime();
        if (cloudDate >= localDate) projectMap.set(cloudProject.id, cloudProject);
      } else {
        projectMap.set(cloudProject.id, cloudProject);
      }
    });
  };

  try {
    const slim = await fetchSlimPageViaRest(userId, PAGE_SIZE);
    mergeFresh(slim.projects);
    persistCardsIdle(userId, slim.projects);
    console.log(`[Database] 클라우드 동기화: ${slim.projects.length}개 (REST slim)`);
    return { projects: sortProjects(Array.from(projectMap.values())), fromCloud: true };
  } catch (restError) {
    console.warn('[Database] REST slim sync 실패, SDK로 재시도:', (restError as Error)?.message);
  }

  const doSdkSync = async (useCompound: boolean) => {
    const q = useCompound
      ? query(collection(db!, PROJECTS_COLLECTION), where('user_id', '==', userId), orderBy('updated_at', 'desc'), limit(PAGE_SIZE))
      : query(collection(db!, PROJECTS_COLLECTION), where('user_id', '==', userId), limit(100));
    const querySnapshot = await withTimeout(getDocs(q), 15000, '프로젝트 동기화');
    const fresh: Project[] = [];
    querySnapshot.forEach((docSnap) => {
      fresh.push(stripScenes(docSnap.data() as Project));
    });
    mergeFresh(fresh);
    persistCardsIdle(userId, fresh);
    if (useCompound) {
      console.log(`[Database] 클라우드 동기화: ${querySnapshot.size}개 (SDK compound fallback)`);
    } else {
      console.warn(`[Database] 클라우드 동기화: ${querySnapshot.size}개 — SDK simple fallback. 컴포지트 인덱스 배포 필요.`);
    }
    return { projects: sortProjects(Array.from(projectMap.values())), fromCloud: true };
  };

  try {
    return await doSdkSync(true);
  } catch (error) {
    console.warn('[Database] SDK compound sync 실패, simple로 재시도:', (error as Error)?.message);
    try {
      return await doSdkSync(false);
    } catch (fallbackError) {
      console.warn('[Database] 클라우드 동기화 실패:', (fallbackError as Error)?.message);
      return { projects: localProjects, fromCloud: false };
    }
  }
};

export const getAllProjectsFromCloud = async (userId: string): Promise<Project[]> => {
  if (!userId) return [];
  const local = getLocalProjectsList(userId);
  const { projects } = await syncProjectsFromCloud(userId, local);
  return projects;
};

/**
 * Fetch the full set of project ids belonging to `userId` from Firestore.
 * Both the primary (ordered by `updated_at`) and fallback (ordered by
 * document id) paths cursor-paginate exhaustively, so the returned set is
 * always authoritative on success. Throws if Firestore is unreachable or
 * any page fails; callers must treat a rejected promise as "do not trust"
 * and skip destructive cleanup.
 */
export const getAllProjectIdsFromCloud = async (userId: string): Promise<Set<string>> => {
  if (!userId || !db) throw new Error('Firestore unavailable');

  const pageSize = 200;

  const runPaginated = async (mode: 'updated_at' | 'doc_id'): Promise<Set<string>> => {
    const collected = new Set<string>();
    let cursor: QueryDocumentSnapshot | null = null;
    while (true) {
      const orderClause =
        mode === 'updated_at'
          ? orderBy('updated_at', 'desc')
          : orderBy(documentId());
      const q = cursor
        ? query(
            collection(db!, PROJECTS_COLLECTION),
            where('user_id', '==', userId),
            orderClause,
            startAfter(cursor),
            limit(pageSize)
          )
        : query(
            collection(db!, PROJECTS_COLLECTION),
            where('user_id', '==', userId),
            orderClause,
            limit(pageSize)
          );

      const snap = await withTimeout(getDocs(q), 15000, '프로젝트 ID 조회');
      let last: QueryDocumentSnapshot | null = null;
      snap.forEach(docSnap => {
        collected.add(docSnap.id);
        last = docSnap as QueryDocumentSnapshot;
      });

      if (snap.size < pageSize) return collected;
      if (!last) return collected;
      cursor = last;
    }
  };

  try {
    return await runPaginated('updated_at');
  } catch (error: any) {
    console.warn('[Database] updated_at id-scan 실패, document id로 재시도:', error?.message);
    return await runPaginated('doc_id');
  }
};

const deleteStorageFolder = async (folderPath: string): Promise<void> => {
  if (!storage) return;
  try {
    const folderRef = ref(storage, folderPath);
    const list = await listAll(folderRef);
    const deletePromises = list.items.map(item => deleteObject(item).catch(() => {}));
    const subfolderPromises = list.prefixes.map(prefix => deleteStorageFolder(prefix.fullPath));
    await Promise.all([...deletePromises, ...subfolderPromises]);
    console.log(`[Storage] 폴더 삭제 완료: ${folderPath}`);
  } catch (e: any) {
    console.warn(`[Storage] 폴더 삭제 실패 (${folderPath}):`, e?.message);
  }
};

export const deleteProjectFromCloud = async (id: string, userId?: string): Promise<void> => {
  const localData = localStorage.getItem(`vibe_video_backup_${id}`);
  localStorage.removeItem(`vibe_video_backup_${id}`);
  localStorage.removeItem(`vibe_video_backup_emergency_${id}`);
  localStorage.removeItem(CARD_KEY(id));

  let resolvedUserId = userId;
  if (!resolvedUserId && localData) {
    try { resolvedUserId = JSON.parse(localData).user_id; } catch (e) {}
  }

  if (resolvedUserId) {
    updateProjectIndex(resolvedUserId, id, 'remove');
  }

  if (db) {
    try {
      const projectRef = doc(db, PROJECTS_COLLECTION, id);
      await deleteDoc(projectRef);
      console.log(`[Database] Project ${id} deleted.`);
    } catch (error) {
      console.error("Firestore Delete Failed:", error);
      throw error;
    }
  }

  if (resolvedUserId && storage) {
    deleteStorageFolder(`users/${resolvedUserId}/projects/${id}`).catch(() => {});
  }
};

export const duplicateProjectInCloud = async (id: string): Promise<Project | null> => {
  try {
    const original = await getProjectFromCloud(id);
    if (!original) return null;
    const newId = generateProjectId();
    const newProject: Project = {
      ...original,
      id: newId,
      title: `${original.title} (Copy)`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      status: ProjectStatus.DRAFT
    };
    (newProject as any).version = 1;
    await saveProjectToCloud(newProject);
    return newProject;
  } catch (error) {
    console.error("Duplicate Failed:", error);
    throw error;
  }
};
