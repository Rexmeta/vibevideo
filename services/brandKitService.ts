/**
 * Brand Kit service — CRUD for the per-user brandKit document in Firestore.
 *
 * Firestore path: users/{uid}/brandKit  (a single document under the user's
 * own sub-collection so rules can be scoped to `request.auth.uid == uid`).
 *
 * When cloud sync is disabled, all data is kept in localStorage under
 * `vibe_brand_kit_{uid}`.
 */

import { db, storage } from './firebaseConfig';
import { doc, getDoc, setDoc, type Firestore } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import type { BrandKit } from '../types';
import { isCloudSyncEnabled } from './cloudSyncSettings';

const brandKitRef = (uid: string) => doc(db as Firestore, 'users', uid, 'brandKit', 'default');

const LOCAL_BRAND_KIT_KEY = (uid: string) => `vibe_brand_kit_${uid}`;

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

const loadLocalBrandKit = (uid: string): BrandKit => {
  try {
    const raw = localStorage.getItem(LOCAL_BRAND_KIT_KEY(uid));
    if (!raw) return { ...DEFAULT_BRAND_KIT };
    const data = JSON.parse(raw) as Partial<BrandKit>;
    return {
      ...DEFAULT_BRAND_KIT,
      ...data,
      palette: { ...DEFAULT_BRAND_KIT.palette, ...(data.palette || {}) },
    };
  } catch {
    return { ...DEFAULT_BRAND_KIT };
  }
};

const saveLocalBrandKit = (uid: string, kit: BrandKit): void => {
  try {
    localStorage.setItem(LOCAL_BRAND_KIT_KEY(uid), JSON.stringify(kit));
  } catch {}
};

/**
 * Load the user's brand kit.  Returns DEFAULT_BRAND_KIT when nothing is saved yet.
 */
export const loadBrandKit = async (uid: string): Promise<BrandKit> => {
  if (!isCloudSyncEnabled() || !db) return loadLocalBrandKit(uid);
  try {
    const snap = await getDoc(brandKitRef(uid));
    if (!snap.exists()) return loadLocalBrandKit(uid);
    const data = snap.data() as Partial<BrandKit>;
    return {
      ...DEFAULT_BRAND_KIT,
      ...data,
      palette: { ...DEFAULT_BRAND_KIT.palette, ...(data.palette || {}) },
    };
  } catch (e) {
    console.warn('[BrandKit] load failed, falling back to local:', e);
    return loadLocalBrandKit(uid);
  }
};

/**
 * Persist the brand kit. When cloud sync is off, saves to localStorage only.
 */
export const saveBrandKit = async (uid: string, kit: BrandKit): Promise<void> => {
  // Always keep a local copy so UI is instant.
  saveLocalBrandKit(uid, kit);

  if (!isCloudSyncEnabled() || !db) return;
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
 * Upload a logo file. When cloud sync is off, stores as a data-URL in
 * localStorage.
 */
export const uploadLogo = async (
  uid: string,
  file: File,
  oldPath?: string,
): Promise<{ url: string; storagePath: string }> => {
  if (!isCloudSyncEnabled() || !storage) {
    // Local fallback: convert to data-URL and persist in the brand kit.
    // Return a non-empty marker path so the delete button remains reachable
    // (BrandKitSettings gates deletion on `!!kit.logoStoragePath`).
    const url = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    return { url, storagePath: 'local:logo' };
  }

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
 * Delete the logo. When cloud sync is off, only clears localStorage.
 */
export const deleteLogo = async (uid: string, storagePath: string): Promise<void> => {
  // Clear local copy regardless.
  try {
    const local = loadLocalBrandKit(uid);
    saveLocalBrandKit(uid, { ...local, logoUrl: undefined, logoStoragePath: undefined });
  } catch {}

  if (!isCloudSyncEnabled()) return;

  if (storage && storagePath) {
    try {
      await deleteObject(ref(storage, storagePath));
    } catch {
      // Ignore
    }
  }
  if (!db) return;
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
