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

const withTimeout = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} 시간 초과 (${ms / 1000}초)`)), ms);
    promise.then(
      val => { clearTimeout(timer); resolve(val); },
      err => { clearTimeout(timer); reject(err); }
    );
  });
};

const getLocalProjects = (userId: string): Project[] => {
  const projects: Project[] = [];
  try {
    const localKeys = Object.keys(localStorage).filter(k => k.startsWith('vibe_video_backup_') && !k.includes('emergency'));
    for (const key of localKeys) {
      const val = localStorage.getItem(key);
      if (!val) continue;
      const p = JSON.parse(val);
      if (p && p.user_id === userId) projects.push(p);
    }
  } catch (e) {}
  return projects;
};

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
      await withTimeout(uploadString(storageRef, cleanData, 'base64', { contentType }), 15000, '파일 업로드');
    } else {
      await withTimeout(uploadBytes(storageRef, data as Blob, { contentType }), 15000, '파일 업로드');
    }
    const url = await withTimeout(getDownloadURL(storageRef), 8000, '다운로드 URL 조회');
    console.log(`[Storage] Success: ${path}`);
    return url;
  } catch (error: any) {
    console.warn(`[Storage] 업로드 실패 (${path}):`, error?.message);
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
    await withTimeout(setDoc(projectRef, dataToSave, { merge: true }), 10000, '프로젝트 저장');
    console.log(`[Database] Project Saved Successfully: ${project.id}`);
  } catch (error: any) {
    console.warn("[Database Save] 클라우드 저장 실패, 로컬에 백업됨:", error?.message);
    localStorage.setItem(`vibe_video_backup_emergency_${project.id}`, JSON.stringify(project));
  }
};

/**
 * Retrieves a single project from Firestore or Local Storage.
 * Firestore call has 8s timeout; falls back to localStorage on failure.
 */
export const getProjectFromCloud = async (id: string): Promise<Project | undefined> => {
  if (!id) return undefined;
  
  if (db) {
    try {
      const projectRef = doc(db, PROJECTS_COLLECTION, id);
      const docSnap = await withTimeout(getDoc(projectRef), 8000, '프로젝트 조회');
      if (docSnap.exists()) {
        const project = docSnap.data() as Project;
        localStorage.setItem(`vibe_video_backup_${id}`, JSON.stringify(project));
        return project;
      }
    } catch (error: any) {
      console.warn("[Database] 클라우드 조회 실패, 로컬 데이터 사용:", error?.message);
    }
  }

  const local = localStorage.getItem(`vibe_video_backup_${id}`);
  if (local) {
    console.log("[Database] 로컬 백업에서 프로젝트 복원:", id);
    return JSON.parse(local);
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

export const syncProjectsFromCloud = async (userId: string, localProjects: Project[]): Promise<{ projects: Project[], fromCloud: boolean }> => {
  if (!userId || !db) return { projects: localProjects, fromCloud: false };

  const projectMap = new Map<string, Project>();
  localProjects.forEach(p => projectMap.set(p.id, p));

  try {
    const q = query(collection(db, PROJECTS_COLLECTION), where("user_id", "==", userId));
    const querySnapshot = await withTimeout(getDocs(q), 8000, '프로젝트 목록 조회');
    querySnapshot.forEach((docSnap) => {
      const cloudProject = docSnap.data() as Project;
      const localVersion = projectMap.get(cloudProject.id);
      if (localVersion) {
        const cloudDate = new Date(cloudProject.updated_at || cloudProject.created_at).getTime();
        const localDate = new Date(localVersion.updated_at || localVersion.created_at).getTime();
        if (cloudDate >= localDate) {
          projectMap.set(cloudProject.id, cloudProject);
        }
      } else {
        projectMap.set(cloudProject.id, cloudProject);
      }
    });
    const merged = sortProjects(Array.from(projectMap.values()));
    merged.forEach(p => {
      try { localStorage.setItem(`vibe_video_backup_${p.id}`, JSON.stringify(p)); } catch(e) {}
    });
    console.log(`[Database] 클라우드에서 ${querySnapshot.size}개 프로젝트 동기화 완료`);
    return { projects: merged, fromCloud: true };
  } catch (error: any) {
    console.warn("[Database] 클라우드 동기화 실패:", error?.message);
    return { projects: localProjects, fromCloud: false };
  }
};

export const getAllProjectsFromCloud = async (userId: string): Promise<Project[]> => {
  if (!userId) return [];
  const local = getLocalProjectsList(userId);
  const { projects } = await syncProjectsFromCloud(userId, local);
  return projects;
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