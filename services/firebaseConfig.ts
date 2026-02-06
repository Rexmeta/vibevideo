import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getFirestore, Firestore } from 'firebase/firestore';
import { getStorage, FirebaseStorage } from 'firebase/storage';
import { getAuth, Auth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "AIzaSyAHYPoDJyVd7xV1IGb8tVKLLddPjxZi1RU",
  authDomain: "gen-lang-client-0706056777.firebaseapp.com",
  projectId: "gen-lang-client-0706056777",
  storageBucket: "gen-lang-client-0706056777.firebasestorage.app",
  messagingSenderId: "155555459795",
  appId: "1:155555459795:web:a7e4c35a89fb1d3eb99a26",
  measurementId: "G-YWLW1701CS"
};

// Initialize Firebase singleton carefully
let app: FirebaseApp;
try {
  app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
} catch (e) {
  console.error("[Firebase] App initialization failed:", e);
  throw e;
}

// Initialize and export services with explicit instances
const db: Firestore = getFirestore(app);
const storage: FirebaseStorage = getStorage(app);
const auth: Auth = getAuth(app);

console.log("[Firebase] All services (Firestore, Storage, Auth) linked to version 11.1.0 correctly.");

export { db, storage, auth };