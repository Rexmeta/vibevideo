import { db } from './firebaseConfig';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  query,
  where,
  serverTimestamp,
} from 'firebase/firestore';
import { ContextPack, Project } from '../types';

const PROJECTS_COLLECTION = 'projects';

const PACK_LS_KEY = (userId: string) => `vibe_context_packs_${userId}`;

const subcol = (userId: string) => collection(db!, 'users', userId, 'context_packs');

const removeUndefined = (obj: Record<string, any>): Record<string, any> => {
  const cleaned: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    if (v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
      cleaned[k] = removeUndefined(v);
    } else {
      cleaned[k] = v;
    }
  }
  return cleaned;
};

export const generatePackId = (): string => {
  const c =
    typeof crypto !== 'undefined'
      ? (crypto as Crypto & { randomUUID?: () => string })
      : undefined;
  if (c?.randomUUID) {
    return `pack-${c.randomUUID()}`;
  }
  return `pack-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
};

const readLocal = (userId: string): ContextPack[] => {
  try {
    const raw = localStorage.getItem(PACK_LS_KEY(userId));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
};

const writeLocal = (userId: string, packs: ContextPack[]) => {
  try {
    localStorage.setItem(PACK_LS_KEY(userId), JSON.stringify(packs));
  } catch (e) {
    console.warn('[ContextPack] localStorage write failed:', e);
  }
};

const upsertLocal = (userId: string, pack: ContextPack) => {
  const list = readLocal(userId);
  const idx = list.findIndex(p => p.id === pack.id);
  if (idx >= 0) list[idx] = pack;
  else list.unshift(pack);
  writeLocal(userId, list);
};

const removeLocal = (userId: string, packId: string) => {
  writeLocal(
    userId,
    readLocal(userId).filter(p => p.id !== packId)
  );
};

const CLOUD_TIMEOUT_MS = 8000;

const withTimeout = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} 시간 초과 (${ms / 1000}초)`)),
      ms
    );
    promise.then(
      val => { clearTimeout(timer); resolve(val); },
      err => { clearTimeout(timer); reject(err); }
    );
  });
};

const sortPacks = (list: ContextPack[]): ContextPack[] =>
  [...list].sort(
    (a, b) =>
      new Date(b.updated_at || b.created_at).getTime() -
      new Date(a.updated_at || a.created_at).getTime()
  );

export type PackListSource = 'cloud' | 'cache' | 'empty';

export interface ListPacksResult {
  packs: ContextPack[];
  source: PackListSource;
}

export const listPacksWithSource = async (
  userId: string
): Promise<ListPacksResult> => {
  if (!userId) return { packs: [], source: 'empty' };
  const local = readLocal(userId);
  const fallback = (): ListPacksResult => ({
    packs: sortPacks(local),
    source: local.length > 0 ? 'cache' : 'empty',
  });
  if (!db) return fallback();
  try {
    const snap = await withTimeout(getDocs(subcol(userId)), CLOUD_TIMEOUT_MS, '컨텍스트 팩 목록 조회');
    const cloud: ContextPack[] = [];
    snap.forEach(d => cloud.push(d.data() as ContextPack));
    writeLocal(userId, cloud);
    return { packs: sortPacks(cloud), source: 'cloud' };
  } catch (e) {
    console.warn('[ContextPack] cloud list failed, using local:', e);
    return fallback();
  }
};

export const listPacks = async (userId: string): Promise<ContextPack[]> => {
  const { packs } = await listPacksWithSource(userId);
  return packs;
};

export const getPack = async (
  userId: string,
  packId: string
): Promise<ContextPack | null> => {
  if (!userId || !packId) return null;
  const local = readLocal(userId).find(p => p.id === packId);
  if (!db) return local || null;
  try {
    const d = await withTimeout(
      getDoc(doc(subcol(userId), packId)),
      CLOUD_TIMEOUT_MS,
      '컨텍스트 팩 조회'
    );
    if (d.exists()) {
      const pack = d.data() as ContextPack;
      upsertLocal(userId, pack);
      return pack;
    }
    return local || null;
  } catch (e) {
    console.warn('[ContextPack] cloud get failed, using local:', e);
    return local || null;
  }
};

export const savePack = async (pack: ContextPack): Promise<ContextPack> => {
  if (!pack.user_id || !pack.id) throw new Error('user_id and id required');
  const next: ContextPack = {
    ...pack,
    updated_at: new Date().toISOString(),
    version: (pack.version || 0) + 1,
  };
  upsertLocal(pack.user_id, next);
  if (db) {
    try {
      await setDoc(
        doc(subcol(pack.user_id), pack.id),
        removeUndefined({ ...next, server_updated_at: serverTimestamp() }),
        { merge: true }
      );
    } catch (e) {
      console.warn('[ContextPack] cloud save failed (kept locally):', e);
    }
  }
  return next;
};

export const deletePack = async (userId: string, packId: string): Promise<void> => {
  removeLocal(userId, packId);
  if (db) {
    try {
      await deleteDoc(doc(subcol(userId), packId));
    } catch (e) {
      console.warn('[ContextPack] cloud delete failed:', e);
    }
  }
};

/**
 * Apply a ContextPack's inheritable fields onto a partial Project shape.
 */
export const applyPackToProjectFields = (
  pack: ContextPack,
  base: Partial<Project> = {}
): Partial<Project> => {
  const out: Partial<Project> = { ...base };
  if (pack.character_profile !== undefined)
    out.character_profile = pack.character_profile;
  if (pack.character_reference_image !== undefined)
    out.character_reference_image = pack.character_reference_image;
  if (pack.character_references !== undefined)
    out.character_references = pack.character_references;
  if (pack.style_sheet !== undefined) out.style_sheet = pack.style_sheet;
  if (pack.video_style !== undefined) out.style_template = pack.video_style;
  if (pack.aspect_ratio !== undefined) out.aspect_ratio = pack.aspect_ratio;
  if (pack.selected_image_model !== undefined)
    out.selected_image_model = pack.selected_image_model;
  if (pack.selected_video_model !== undefined)
    out.selected_video_model = pack.selected_video_model;
  if (pack.use_veo_audio !== undefined) out.use_veo_audio = pack.use_veo_audio;
  if (pack.caption_style !== undefined) out.caption_style = pack.caption_style;
  if (pack.video_mode !== undefined) out.video_mode = pack.video_mode;
  if (pack.negative_prompt !== undefined) out.negative_prompt = pack.negative_prompt;
  if (pack.vision_critic_enabled !== undefined)
    out.vision_critic_enabled = pack.vision_critic_enabled;
  if (pack.quality_threshold !== undefined)
    out.quality_threshold = pack.quality_threshold;
  if (pack.genre !== undefined) out.genre = pack.genre;
  if (pack.platform !== undefined) out.platform = pack.platform;
  out.linked_context_pack_id = pack.id;
  out.context_pack_version = pack.version;
  out.context_pack_dirty = false;
  return out;
};

/** Find projects linked to `packId` (cloud-first, falls back to local index). */
export const findLinkedProjects = async (
  userId: string,
  packId: string
): Promise<Project[]> => {
  if (!userId || !packId) return [];
  const out: Project[] = [];
  if (db) {
    try {
      const q = query(
        collection(db, PROJECTS_COLLECTION),
        where('user_id', '==', userId),
        where('linked_context_pack_id', '==', packId)
      );
      const snap = await withTimeout(getDocs(q), CLOUD_TIMEOUT_MS, '연결 프로젝트 조회');
      snap.forEach(d => out.push(d.data() as Project));
      return out;
    } catch (e) {
      console.warn('[ContextPack] cloud findLinked failed, using local:', e);
    }
  }
  // Local fallback: scan localStorage.
  try {
    const indexStr = localStorage.getItem(`vibe_project_index_${userId}`);
    const ids: string[] = indexStr ? JSON.parse(indexStr) : [];
    for (const id of ids) {
      const raw = localStorage.getItem(`vibe_video_backup_${id}`);
      if (!raw) continue;
      try {
        const p = JSON.parse(raw) as Project;
        if (p.linked_context_pack_id === packId) out.push(p);
      } catch {}
    }
  } catch {}
  return out;
};

/** Mark every project linked to `packId` as dirty (Firestore + localStorage). */
export const markLinkedProjectsDirty = async (
  userId: string,
  packId: string,
  newVersion: number
): Promise<number> => {
  const linked = await findLinkedProjects(userId, packId);
  let count = 0;
  for (const p of linked) {
    if (p.context_pack_version === newVersion) continue;
    if (db) {
      try {
        await setDoc(
          doc(db, PROJECTS_COLLECTION, p.id),
          { context_pack_dirty: true, updated_at: new Date().toISOString() },
          { merge: true }
        );
      } catch (e) {
        console.warn(`[ContextPack] failed to mark project ${p.id} dirty:`, e);
      }
    }
    try {
      const raw = localStorage.getItem(`vibe_video_backup_${p.id}`);
      if (raw) {
        const obj = JSON.parse(raw);
        obj.context_pack_dirty = true;
        localStorage.setItem(`vibe_video_backup_${p.id}`, JSON.stringify(obj));
      }
    } catch {}
    count++;
  }
  return count;
};
