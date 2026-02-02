import { Project } from "../types";

// Name of the IndexedDB database
const DB_NAME = 'VibeVideoDB';
const DB_VERSION = 1;
const STORE_NAME = 'projects';

/**
 * Open (and initialize if needed) the IndexedDB database.
 */
const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    // Check if indexedDB is supported
    if (!('indexedDB' in window)) {
        reject(new Error("This browser doesn't support IndexedDB"));
        return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        // Create object store with 'id' as the key path
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = (event) => {
      resolve((event.target as IDBOpenDBRequest).result);
    };

    request.onerror = (event) => {
      reject((event.target as IDBOpenDBRequest).error);
    };
  });
};

export const saveProjectToDB = async (project: Project): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(project);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

export const getAllProjectsFromDB = async (): Promise<Project[]> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
        const projects = request.result as Project[];
        // Sort by created_at desc (newest first)
        projects.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        resolve(projects);
    };
    request.onerror = () => reject(request.error);
  });
};

export const getProjectFromDB = async (id: string): Promise<Project | undefined> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(id);

    request.onsuccess = () => resolve(request.result as Project | undefined);
    request.onerror = () => reject(request.error);
  });
};

export const deleteProjectFromDB = async (id: string): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(id);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};
