import { db, storage } from "./firebaseConfig";
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
  getDoc, 
  getDocs, 
  query, 
  where, 
  orderBy,
  limit,
  startAfter,
  deleteDoc,
  serverTimestamp,
  runTransaction,
  DocumentSnapshot,
  QueryDocumentSnapshot
} from "firebase/firestore";
import { Project, ProjectStatus, Scene } from "../types";

const PROJECTS_COLLECTION = 'projects';
const PAGE_SIZE = 20;

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

const getLocalProjects = (userId: string): Project[] => {
  const projects: Project[] = [];
  try {
    const indexStr = localStorage.getItem(`vibe_project_index_${userId}`);
    if (indexStr) {
      const index: string[] = JSON.parse(indexStr);
      for (const id of index) {
        const val = localStorage.getItem(`vibe_video_backup_${id}`);
        if (!val) continue;
        const p = JSON.parse(val);
        if (p && p.user_id === userId) projects.push(p);
      }
    } else {
      const localKeys = Object.keys(localStorage).filter(k => k.startsWith('vibe_video_backup_') && !k.includes('emergency'));
      for (const key of localKeys) {
        const val = localStorage.getItem(key);
        if (!val) continue;
        const p = JSON.parse(val);
        if (p && p.user_id === userId) projects.push(p);
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
    
    await withTimeout(uploadBytes(storageRef, blob, metadata), 30000, '파일 업로드');
    return await withTimeout(getDownloadURL(storageRef), 10000, '다운로드 URL 조회');
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

export const saveProjectToCloud = async (project: Project): Promise<void> => {
  if (!project.id) return;
  
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
    if (project.user_id) updateProjectIndex(project.user_id, project.id, 'add');
  } catch (e) {
    console.warn("[Database Save] localStorage 저장 실패 (용량 초과)");
  }

  if (!db) {
    console.warn("[Database] Cloud service unavailable, saved to Local Storage only.");
    return;
  }

  try {
    const projectRef = doc(db, PROJECTS_COLLECTION, project.id);
    const sanitizedScenes = project.saved_scenes 
      ? sanitizeScenesForFirestore(project.saved_scenes.slice(0, MAX_DOC_SCENES))
      : undefined;
    
    const sceneCount = project.saved_scenes?.length || 0;
    const totalDuration = project.saved_scenes?.reduce((sum, s) => sum + (s.audio_duration || 0), 0) || 0;
    
    const dataToSave = removeUndefined({
      ...project,
      saved_scenes: sanitizedScenes,
      scene_count: sceneCount,
      total_duration: Math.round(totalDuration * 10) / 10,
      updated_at: new Date().toISOString(),
      server_updated_at: serverTimestamp(),
      version: (project as any).version ? (project as any).version + 1 : 1,
    });
    
    delete dataToSave.saved_scenes;
    if (sanitizedScenes) {
      dataToSave.saved_scenes = sanitizedScenes;
    }

    await withTimeout(setDoc(projectRef, dataToSave, { merge: true }), 10000, '프로젝트 저장');
    console.log(`[Database] Project Saved Successfully: ${project.id}`);
  } catch (error: any) {
    console.warn("[Database Save] 클라우드 저장 실패, 로컬에 백업됨:", error?.message);
    try { localStorage.setItem(`vibe_video_backup_emergency_${project.id}`, JSON.stringify(project)); } catch(e) {}
  }
};

export const saveProjectWithConflictCheck = async (project: Project): Promise<{ saved: boolean; conflict: boolean }> => {
  if (!project.id || !db) {
    await saveProjectToCloud(project);
    return { saved: true, conflict: false };
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
        ? sanitizeScenesForFirestore(project.saved_scenes.slice(0, MAX_DOC_SCENES))
        : undefined;
      
      const sceneCount = project.saved_scenes?.length || 0;
      const totalDuration = project.saved_scenes?.reduce((sum, s) => sum + (s.audio_duration || 0), 0) || 0;
      
      const dataToSave = removeUndefined({
        ...project,
        saved_scenes: sanitizedScenes,
        scene_count: sceneCount,
        total_duration: Math.round(totalDuration * 10) / 10,
        updated_at: new Date().toISOString(),
        server_updated_at: serverTimestamp(),
        version: (project as any).version ? (project as any).version + 1 : 1,
      });
      
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
      const docSnap = await withTimeout(getDoc(projectRef), 8000, '프로젝트 조회');
      if (docSnap.exists()) {
        const project = docSnap.data() as Project;
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

export interface PaginatedResult {
  projects: Project[];
  lastDoc: QueryDocumentSnapshot | null;
  hasMore: boolean;
  fromCloud: boolean;
}

export const getProjectsPage = async (
  userId: string, 
  lastDocument?: QueryDocumentSnapshot | null,
  pageSize: number = PAGE_SIZE
): Promise<PaginatedResult> => {
  if (!userId || !db) {
    const local = getLocalProjectsList(userId);
    return { projects: local, lastDoc: null, hasMore: false, fromCloud: false };
  }

  try {
    let q;
    if (lastDocument) {
      q = query(
        collection(db, PROJECTS_COLLECTION), 
        where("user_id", "==", userId),
        orderBy("updated_at", "desc"),
        startAfter(lastDocument),
        limit(pageSize)
      );
    } else {
      q = query(
        collection(db, PROJECTS_COLLECTION), 
        where("user_id", "==", userId),
        orderBy("updated_at", "desc"),
        limit(pageSize)
      );
    }

    const querySnapshot = await withTimeout(getDocs(q), 10000, '프로젝트 목록 조회');
    const projects: Project[] = [];
    let lastDoc: QueryDocumentSnapshot | null = null;

    querySnapshot.forEach((docSnap) => {
      projects.push(docSnap.data() as Project);
      lastDoc = docSnap as QueryDocumentSnapshot;
    });

    projects.forEach(p => {
      try {
        const lightProject = { ...p };
        if (lightProject.saved_scenes) {
          lightProject.saved_scenes = lightProject.saved_scenes.map(s => {
            const c = { ...s };
            if (isDataUrl(c.audio_path) || isBase64Only(c.audio_path)) c.audio_path = undefined;
            if (isDataUrl(c.image_path) || isBase64Only(c.image_path)) c.image_path = undefined;
            return c;
          });
        }
        localStorage.setItem(`vibe_video_backup_${p.id}`, JSON.stringify(lightProject));
        if (userId) updateProjectIndex(userId, p.id, 'add');
      } catch(e) {}
    });

    console.log(`[Database] 페이지 조회: ${projects.length}개 프로젝트 로드`);
    return { 
      projects, 
      lastDoc, 
      hasMore: querySnapshot.size === pageSize,
      fromCloud: true 
    };
  } catch (error: any) {
    console.warn("[Database] 페이지 조회 실패:", error?.message);
    const local = getLocalProjectsList(userId);
    return { projects: local, lastDoc: null, hasMore: false, fromCloud: false };
  }
};

export const syncProjectsFromCloud = async (userId: string, localProjects: Project[]): Promise<{ projects: Project[], fromCloud: boolean }> => {
  if (!userId || !db) return { projects: localProjects, fromCloud: false };

  const projectMap = new Map<string, Project>();
  localProjects.forEach(p => projectMap.set(p.id, p));

  try {
    const q = query(
      collection(db, PROJECTS_COLLECTION), 
      where("user_id", "==", userId),
      orderBy("updated_at", "desc"),
      limit(PAGE_SIZE)
    );
    const querySnapshot = await withTimeout(getDocs(q), 10000, '프로젝트 목록 조회');
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
      try {
        const lightProject = { ...p };
        if (lightProject.saved_scenes) {
          lightProject.saved_scenes = lightProject.saved_scenes.map(s => {
            const c = { ...s };
            if (isDataUrl(c.audio_path) || isBase64Only(c.audio_path)) c.audio_path = undefined;
            if (isDataUrl(c.image_path) || isBase64Only(c.image_path)) c.image_path = undefined;
            return c;
          });
        }
        localStorage.setItem(`vibe_video_backup_${p.id}`, JSON.stringify(lightProject));
        if (userId) updateProjectIndex(userId, p.id, 'add');
      } catch(e) {}
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
