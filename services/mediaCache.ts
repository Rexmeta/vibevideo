const DB_NAME = 'vibe_video_media';
const DB_VERSION = 2;
const STORE_NAME = 'media';
const PROJECT_STORE = 'projects';

let dbPromise: Promise<IDBDatabase> | null = null;

const openDB = (): Promise<IDBDatabase> => {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
      if (!db.objectStoreNames.contains(PROJECT_STORE)) {
        db.createObjectStore(PROJECT_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };
  });
  return dbPromise;
};

const mediaKey = (projectId: string, sceneIdx: number, type: 'audio' | 'image' | 'video') =>
  `${projectId}__s${sceneIdx}__${type}`;

export const saveMedia = async (projectId: string, sceneIdx: number, type: 'audio' | 'image' | 'video', data: string): Promise<void> => {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(data, mediaKey(projectId, sceneIdx, type));
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.warn('[MediaCache] save failed:', e);
  }
};

export const getMedia = async (projectId: string, sceneIdx: number, type: 'audio' | 'image' | 'video'): Promise<string | null> => {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(mediaKey(projectId, sceneIdx, type));
    return await new Promise<string | null>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } catch (e) {
    console.warn('[MediaCache] get failed:', e);
    return null;
  }
};

export const deleteProjectMedia = async (projectId: string): Promise<void> => {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.openCursor();
    const prefix = `${projectId}__`;
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        if (typeof cursor.key === 'string' && cursor.key.startsWith(prefix)) {
          cursor.delete();
        }
        cursor.continue();
      }
    };
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.warn('[MediaCache] deleteProject failed:', e);
  }
};

export const saveProjectMeta = async (projectId: string, data: any): Promise<void> => {
  try {
    const db = await openDB();
    const tx = db.transaction(PROJECT_STORE, 'readwrite');
    tx.objectStore(PROJECT_STORE).put(data, projectId);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.warn('[MediaCache] saveProjectMeta failed:', e);
  }
};

export const getProjectMeta = async (projectId: string): Promise<any | null> => {
  try {
    const db = await openDB();
    const tx = db.transaction(PROJECT_STORE, 'readonly');
    const request = tx.objectStore(PROJECT_STORE).get(projectId);
    return await new Promise<any | null>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } catch (e) {
    console.warn('[MediaCache] getProjectMeta failed:', e);
    return null;
  }
};

export const getAllProjectMetas = async (): Promise<any[]> => {
  try {
    const db = await openDB();
    const tx = db.transaction(PROJECT_STORE, 'readonly');
    const request = tx.objectStore(PROJECT_STORE).getAll();
    return await new Promise<any[]>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  } catch (e) {
    console.warn('[MediaCache] getAllProjectMetas failed:', e);
    return [];
  }
};

/**
 * Returns the (sceneIdx, type) pairs cached in IndexedDB for this project.
 * Used by the restore flow to synthesize empty scene slots when the cloud
 * document lost its `saved_scenes` (e.g. earlier Firestore 403 outage)
 * but the locally-generated media is still recoverable.
 */
export const listProjectMediaIndices = async (
  projectId: string,
): Promise<{ idx: number; type: 'audio' | 'image' | 'video' }[]> => {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).getAllKeys();
    return await new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const keys = (request.result || []) as IDBValidKey[];
        const prefix = `${projectId}__s`;
        const out: { idx: number; type: 'audio' | 'image' | 'video' }[] = [];
        for (const k of keys) {
          if (typeof k !== 'string' || !k.startsWith(prefix)) continue;
          const m = k.match(/__s(\d+)__(audio|image|video)$/);
          if (m) out.push({ idx: parseInt(m[1], 10), type: m[2] as 'audio' | 'image' | 'video' });
        }
        resolve(out);
      };
      request.onerror = () => reject(request.error);
    });
  } catch (e) {
    console.warn('[MediaCache] listProjectMediaIndices failed:', e);
    return [];
  }
};

export const saveBatchMedia = async (projectId: string, scenes: { idx: number; type: 'audio' | 'image' | 'video'; data: string }[]): Promise<void> => {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    for (const { idx, type, data } of scenes) {
      store.put(data, mediaKey(projectId, idx, type));
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.warn('[MediaCache] saveBatch failed:', e);
  }
};
