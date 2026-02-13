import { db, storage } from "./firebaseConfig";
import { 
  ref, 
  uploadString, 
  uploadBytes, 
  getDownloadURL,
  deleteObject,
  listAll
} from "firebase/storage";
import { 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs, 
  query, 
  where, 
  deleteDoc,
  serverTimestamp
} from "firebase/firestore";
import { Project, ProjectStatus, Scene } from "../types";

const PROJECTS_COLLECTION = 'projects';

const isDataUrl = (s?: string): boolean => !!s && s.startsWith('data:');
const isBase64Only = (s?: string): boolean => !!s && !s.startsWith('data:') && !s.startsWith('http') && !s.startsWith('blob:') && s.length > 200;

const isBlobUrl = (s?: string): boolean => !!s && s.startsWith('blob:');

const removeUndefined = (obj: Record<string, any>): Record<string, any> => {
  const cleaned: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue;
    if (value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      cleaned[key] = removeUndefined(value);
    } else if (Array.isArray(value)) {
      cleaned[key] = value.map(item =>
        item !== null && typeof item === 'object' && !Array.isArray(item) ? removeUndefined(item) : item
      );
    } else {
      cleaned[key] = value;
    }
  }
  return cleaned;
};

const sanitizeScenesForFirestore = (scenes: Partial<Scene>[]): Record<string, any>[] => {
  return scenes.map(s => {
    const cleaned: Record<string, any> = { ...s };
    if (isDataUrl(s.audio_path) || isBase64Only(s.audio_path)) delete cleaned.audio_path;
    if (isDataUrl(s.image_path) || isBase64Only(s.image_path)) delete cleaned.image_path;
    if (isDataUrl(s.video_path) || isBlobUrl(s.video_path)) delete cleaned.video_path;
    return removeUndefined(cleaned);
  });
};

/**
 * Permanently stores AI-generated media using Firebase Modular Storage.
 */
export const uploadFileToCloud = async (path: string, data: string | Blob, format: 'base64' | 'blob' = 'base64'): Promise<string> => {
  let contentType = 'application/octet-stream';
  if (path.endsWith('.wav')) contentType = 'audio/wav';
  else if (path.endsWith('.jpg') || path.endsWith('.jpeg')) contentType = 'image/jpeg';
  else if (path.endsWith('.mp4')) contentType = 'video/mp4';

  if (!storage) {
    console.warn("[Storage] Cloud service unavailable, using local simulation.");
    if (typeof data === 'string') {
      return data.startsWith('data:') ? data : `data:${contentType};base64,${data}`;
    }
    return URL.createObjectURL(data as Blob);
  }

  const storageRef = ref(storage, path);
  
  try {
    if (format === 'base64') {
      const cleanData = typeof data === 'string' ? data.replace(/^data:.*?;base64,/, "") : "";
      await uploadString(storageRef, cleanData, 'base64', { contentType });
    } else {
      await uploadBytes(storageRef, data as Blob, { contentType });
    }
    const url = await getDownloadURL(storageRef);
    console.log(`[Storage] Success: ${path}`);
    return url;
  } catch (error: any) {
    console.error(`[Storage Error] Path: ${path}`, error.code || error.message);
    if (typeof data === 'string') {
       return data.startsWith('data:') ? data : `data:${contentType};base64,${data}`;
    }
    throw error;
  }
};

/**
 * Saves project metadata using Firebase Modular Firestore.
 */
export const saveProjectToCloud = async (project: Project): Promise<void> => {
  if (!project.id) return;
  
  localStorage.setItem(`vibe_video_backup_${project.id}`, JSON.stringify(project));

  if (!db) {
    console.warn("[Database] Cloud service unavailable, saved to Local Storage only.");
    return;
  }
  
  try {
    const projectRef = doc(db, PROJECTS_COLLECTION, project.id);
    const sanitizedScenes = project.saved_scenes 
      ? sanitizeScenesForFirestore(project.saved_scenes)
      : undefined;
    const dataToSave = removeUndefined({
      ...project,
      saved_scenes: sanitizedScenes,
      updated_at: new Date().toISOString(),
      server_updated_at: serverTimestamp() 
    });
    await setDoc(projectRef, dataToSave, { merge: true });
    console.log(`[Database] Project Saved Successfully: ${project.id}`);
  } catch (error: any) {
    console.error("[Database Save Error]", error.code || error.message);
    localStorage.setItem(`vibe_video_backup_emergency_${project.id}`, JSON.stringify(project));
    throw error;
  }
};

/**
 * Retrieves a single project from Firestore or Local Storage.
 */
export const getProjectFromCloud = async (id: string): Promise<Project | undefined> => {
  if (!id) return undefined;
  
  if (db) {
    try {
      const projectRef = doc(db, PROJECTS_COLLECTION, id);
      const docSnap = await getDoc(projectRef);
      if (docSnap.exists()) {
        return docSnap.data() as Project;
      }
    } catch (error) {
      console.error("Firestore Get Project Failed:", error);
    }
  }

  const local = localStorage.getItem(`vibe_video_backup_${id}`);
  if (local) return JSON.parse(local);
  
  return undefined;
};

/**
 * Lists all projects for a user, combining cloud and local storage.
 */
export const getAllProjectsFromCloud = async (userId: string): Promise<Project[]> => {
  if (!userId) return [];
  const projects: Project[] = [];

  if (db) {
    try {
      const q = query(collection(db, PROJECTS_COLLECTION), where("user_id", "==", userId));
      const querySnapshot = await getDocs(q);
      querySnapshot.forEach((doc) => {
        projects.push(doc.data() as Project);
      });
    } catch (error: any) {
      console.error("Firestore Fetch Failed:", error.message);
    }
  }
    
  const localKeys = Object.keys(localStorage).filter(k => k.startsWith('vibe_video_backup_'));
  localKeys.forEach(key => {
    try {
      const val = localStorage.getItem(key);
      if (!val) return;
      const localProj = JSON.parse(val);
      if (localProj && localProj.user_id === userId && !projects.find(p => p.id === localProj.id)) {
        projects.push(localProj);
      }
    } catch (e) {}
  });

  return projects.sort((a, b) => {
    const dateA = new Date(a.updated_at || a.created_at).getTime();
    const dateB = new Date(b.updated_at || b.created_at).getTime();
    return dateB - dateA;
  });
};

/**
 * Deletes a project from the cloud (Firestore + Storage) and local storage.
 */
export const deleteProjectFromCloud = async (id: string): Promise<void> => {
  const localData = localStorage.getItem(`vibe_video_backup_${id}`);
  localStorage.removeItem(`vibe_video_backup_${id}`);
  localStorage.removeItem(`vibe_video_backup_emergency_${id}`);

  if (db) {
    try {
      const projectRef = doc(db, PROJECTS_COLLECTION, id);
      await deleteDoc(projectRef);
      
      // Cleanup attempt for Storage files
      if (localData && storage) {
        try {
          const proj = JSON.parse(localData) as Project;
          console.log(`[Storage] Folder users/${proj.user_id}/projects/${id}/ requires manual cleanup or Cloud Functions.`);
        } catch (e) {}
      }
      console.log(`[Database] Project ${id} deleted.`);
    } catch (error) {
      console.error("Firestore Delete Failed:", error);
      throw error;
    }
  }
};

/**
 * Duplicates a project entry.
 */
export const duplicateProjectInCloud = async (id: string): Promise<Project | null> => {
  try {
    const original = await getProjectFromCloud(id);
    if (!original) return null;
    const newId = `proj-${Date.now()}`;
    const newProject: Project = {
      ...original,
      id: newId,
      title: `${original.title} (Copy)`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      status: ProjectStatus.DRAFT
    };
    await saveProjectToCloud(newProject);
    return newProject;
  } catch (error) {
    console.error("Duplicate Failed:", error);
    throw error;
  }
};