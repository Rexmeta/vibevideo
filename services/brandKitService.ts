/**
 * Brand Kit service — CRUD for the per-user brandKit document in Firestore.
 *
 * Firestore path: users/{uid}/brandKit  (a single document under the user's
 * own sub-collection so rules can be scoped to `request.auth.uid == uid`).
 */

import { db, storage } from './firebaseConfig';
import { doc, getDoc, setDoc, type Firestore } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import type { BrandKit } from '../types';

const brandKitRef = (uid: string) => doc(db as Firestore, 'users', uid, 'brandKit', 'default');

export const DEFAULT_BRAND_KIT: BrandKit = {
  logoUrl: undefined,
  logoStoragePath: undefined,
  logoPosition: 'bottom-right',
  logoOpacity: 0.8,
  introConfig: undefined,
  outroConfig: undefined,
  palette: {
    primary: '#6366f1',
    secondary: '#22d3ee',
    accent: '#f59e0b',
  },
};

/**
 * Load the user's brand kit.  Returns DEFAULT_BRAND_KIT when nothing is saved yet.
 */
export const loadBrandKit = async (uid: string): Promise<BrandKit> => {
  if (!db) return { ...DEFAULT_BRAND_KIT };
  try {
    const snap = await getDoc(brandKitRef(uid));
    if (!snap.exists()) return { ...DEFAULT_BRAND_KIT };
    const data = snap.data() as Partial<BrandKit>;
    return {
      ...DEFAULT_BRAND_KIT,
      ...data,
      palette: { ...DEFAULT_BRAND_KIT.palette, ...(data.palette || {}) },
    };
  } catch (e) {
    console.warn('[BrandKit] load failed:', e);
    return { ...DEFAULT_BRAND_KIT };
  }
};

/**
 * Persist the brand kit to Firestore.
 */
export const saveBrandKit = async (uid: string, kit: BrandKit): Promise<void> => {
  if (!db) return;
  try {
    const payload: Record<string, unknown> = {
      logoPosition: kit.logoPosition,
      logoOpacity: kit.logoOpacity,
      palette: kit.palette,
      updatedAt: new Date().toISOString(),
    };
    if (kit.logoUrl !== undefined) payload.logoUrl = kit.logoUrl;
    if (kit.logoStoragePath !== undefined) payload.logoStoragePath = kit.logoStoragePath;
    if (kit.introConfig) payload.introConfig = kit.introConfig;
    else payload.introConfig = null;
    if (kit.outroConfig) payload.outroConfig = kit.outroConfig;
    else payload.outroConfig = null;

    await setDoc(brandKitRef(uid), payload, { merge: true });
  } catch (e) {
    console.error('[BrandKit] save failed:', e);
    throw e;
  }
};

/**
 * Upload a logo file to Firebase Storage and return its download URL.
 * Deletes any previous logo at the given oldPath before uploading.
 */
export const uploadLogo = async (
  uid: string,
  file: File,
  oldPath?: string,
): Promise<{ url: string; storagePath: string }> => {
  if (!storage) throw new Error('Firebase Storage가 초기화되지 않았습니다.');

  // Delete previous logo if present
  if (oldPath) {
    try {
      await deleteObject(ref(storage, oldPath));
    } catch {
      // Ignore — old file may not exist
    }
  }

  const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
  const storagePath = `users/${uid}/brand_kit/logo.${ext}`;
  const storageRef = ref(storage, storagePath);
  const snapshot = await uploadBytes(storageRef, file);
  const url = await getDownloadURL(snapshot.ref);
  return { url, storagePath };
};

/**
 * Delete the logo from Storage and clear logo fields in the saved brand kit.
 */
export const deleteLogo = async (uid: string, storagePath: string): Promise<void> => {
  if (!storage) return;
  try {
    await deleteObject(ref(storage, storagePath));
  } catch {
    // Ignore
  }
  if (!db) return;
  // Clear logo fields by writing empty values
  try {
    await setDoc(
      brandKitRef(uid),
      { logoUrl: null, logoStoragePath: null, updatedAt: new Date().toISOString() },
      { merge: true }
    );
  } catch (e) {
    console.warn('[BrandKit] deleteLogo Firestore update failed:', e);
  }
};
