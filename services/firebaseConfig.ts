
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

/**
 * [중요] Google Cloud Console 또는 Firebase Console에서 발급받은 
 * 프로젝트 설정값으로 아래 내용을 채워주세요.
 * API KEY는 환경변수 process.env.API_KEY와 별개의 Firebase용 키입니다.
 */
const firebaseConfig = {
  apiKey: "YOUR_FIREBASE_API_KEY", // 실제 키로 교체 필요
  authDomain: "your-project-id.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project-id.appspot.com",
  messagingSenderId: "00000000000",
  appId: "1:00000000000:web:00000000000000"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Cloud Services
export const db = getFirestore(app);
export const storage = getStorage(app);
