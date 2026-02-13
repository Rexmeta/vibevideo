import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { initializeFirestore, getFirestore, Firestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';
import { getStorage, FirebaseStorage } from 'firebase/storage';
import { getAuth, Auth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY || '',
  authDomain: process.env.FIREBASE_AUTH_DOMAIN || '',
  projectId: process.env.FIREBASE_PROJECT_ID || '',
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '',
  appId: process.env.FIREBASE_APP_ID || '',
  measurementId: process.env.FIREBASE_MEASUREMENT_ID || '',
};

const isFirebaseConfigured = (): boolean => {
  return !!(firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId && firebaseConfig.appId);
};

let app: FirebaseApp | null = null;
let db: Firestore | null = null;
let storage: FirebaseStorage | null = null;
let auth: Auth | null = null;
if (isFirebaseConfigured()) {
  try {
    app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
    try {
      db = initializeFirestore(app, {
        localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
      });
    } catch (firestoreErr: any) {
      if (firestoreErr.code === 'failed-precondition') {
        db = getFirestore(app);
        console.warn("[Firebase] 오프라인 캐시: 이미 초기화됨, 기본 모드 사용");
      } else {
        throw firestoreErr;
      }
    }
    storage = getStorage(app);
    auth = getAuth(app);
    console.log("[Firebase] 서비스가 정상적으로 초기화되었습니다.");
  } catch (e) {
    console.error("[Firebase] 초기화 실패:", e);
  }
} else {
  console.warn("[Firebase] 환경 변수가 설정되지 않았습니다. Firebase Console에서 프로젝트를 생성하고 환경 변수를 설정해주세요.");
}

export { db, storage, auth, isFirebaseConfigured };
