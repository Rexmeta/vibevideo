
import { db } from "./firebaseConfig";
import { collection, doc, getDoc, getDocs, setDoc, deleteDoc } from "firebase/firestore";
import { Project } from "../types";

const COLLECTION_NAME = 'projects';

export const saveProjectToDB = async (project: Project): Promise<void> => {
  try {
    // We use the project.id as the document ID in Firestore for easy retrieval
    const projectRef = doc(db, COLLECTION_NAME, project.id);
    await setDoc(projectRef, project, { merge: true });
    console.log(`Project ${project.id} saved to Firestore.`);
  } catch (error) {
    console.error("Error saving project to Firestore:", error);
    throw error;
  }
};

export const getAllProjectsFromDB = async (): Promise<Project[]> => {
  try {
    const projectsCol = collection(db, COLLECTION_NAME);
    const projectSnapshot = await getDocs(projectsCol);
    const projectList = projectSnapshot.docs.map(doc => doc.data() as Project);
    
    // Sort by created_at desc (newest first)
    projectList.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    
    return projectList;
  } catch (error) {
    console.error("Error fetching projects from Firestore:", error);
    // Return empty array on error to prevent app crash, or rethrow if you want to handle it in UI
    return [];
  }
};

export const getProjectFromDB = async (id: string): Promise<Project | undefined> => {
  try {
    const projectRef = doc(db, COLLECTION_NAME, id);
    const projectSnap = await getDoc(projectRef);

    if (projectSnap.exists()) {
      return projectSnap.data() as Project;
    } else {
      console.warn(`No project found with ID: ${id}`);
      return undefined;
    }
  } catch (error) {
    console.error("Error fetching project from Firestore:", error);
    return undefined;
  }
};

export const deleteProjectFromDB = async (id: string): Promise<void> => {
  try {
    const projectRef = doc(db, COLLECTION_NAME, id);
    await deleteDoc(projectRef);
    console.log(`Project ${id} deleted from Firestore.`);
  } catch (error) {
    console.error("Error deleting project from Firestore:", error);
    throw error;
  }
};
