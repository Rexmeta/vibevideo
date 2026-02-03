
import { 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs, 
  deleteDoc, 
  query, 
  orderBy, 
  where 
} from "firebase/firestore";
import { 
  ref, 
  uploadString, 
  uploadBytes, 
  getDownloadURL 
} from "firebase/storage";
import { db, storage } from "./firebaseConfig";
import { Project, ProjectStatus } from "../types";

const PROJECTS_COLLECTION = 'projects';

/**
 * Uploads a base64 or blob file to Cloud Storage and returns the permanent URL.
 */
export const uploadFileToCloud = async (path: string, data: string | Blob, format: 'base64' | 'blob' = 'base64'): Promise<string> => {
  try {
    const storageRef = ref(storage, path);
    if (format === 'base64') {
      // Remove data:image/jpeg;base64, prefix if present
      const cleanData = typeof data === 'string' ? data.replace(/^data:.*?;base64,/, "") : "";
      await uploadString(storageRef, cleanData, 'base64');
    } else {
      await uploadBytes(storageRef, data as Blob);
    }
    return await getDownloadURL(storageRef);
  } catch (error) {
    console.error("Cloud Storage Upload Failed:", error);
    throw error;
  }
};

/**
 * Saves project metadata to Firestore.
 */
export const saveProjectToCloud = async (project: Project): Promise<void> => {
  try {
    const projectRef = doc(db, PROJECTS_COLLECTION, project.id);
    await setDoc(projectRef, {
      ...project,
      updated_at: new Date().toISOString()
    }, { merge: true });
  } catch (error) {
    console.error("Firestore Save Failed:", error);
    throw error;
  }
};

/**
 * Fetches all projects for a specific user.
 */
export const getAllProjectsFromCloud = async (userId: string = 'u1'): Promise<Project[]> => {
  try {
    const q = query(
      collection(db, PROJECTS_COLLECTION), 
      where("user_id", "==", userId),
      orderBy("created_at", "desc")
    );
    const querySnapshot = await getDocs(q);
    const projects: Project[] = [];
    querySnapshot.forEach((doc) => {
      projects.push(doc.data() as Project);
    });
    return projects;
  } catch (error) {
    console.error("Firestore Fetch Failed:", error);
    return [];
  }
};

/**
 * Fetches a single project by ID.
 */
export const getProjectFromCloud = async (id: string): Promise<Project | undefined> => {
  try {
    const projectRef = doc(db, PROJECTS_COLLECTION, id);
    const docSnap = await getDoc(projectRef);
    return docSnap.exists() ? (docSnap.data() as Project) : undefined;
  } catch (error) {
    console.error("Firestore Get Project Failed:", error);
    return undefined;
  }
};

/**
 * Deletes a project from the cloud.
 */
export const deleteProjectFromCloud = async (id: string): Promise<void> => {
  try {
    await deleteDoc(doc(db, PROJECTS_COLLECTION, id));
  } catch (error) {
    console.error("Firestore Delete Failed:", error);
    throw error;
  }
};

/**
 * Duplicates a project in the cloud (Version Control).
 */
export const duplicateProjectInCloud = async (id: string): Promise<Project | null> => {
  try {
    const original = await getProjectFromCloud(id);
    if (!original) return null;

    const newId = `copy-${Date.now()}`;
    const newProject: Project = {
      ...original,
      id: newId,
      title: `${original.title} (New Version)`,
      created_at: new Date().toISOString(),
      status: ProjectStatus.DRAFT,
      saved_step: original.saved_step // Keep progress
    };

    await saveProjectToCloud(newProject);
    return newProject;
  } catch (error) {
    console.error("Cloud Duplicate Failed:", error);
    throw error;
  }
};
