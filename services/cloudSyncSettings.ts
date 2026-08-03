/**
 * Cloud sync opt-in flag.
 *
 * Default is FALSE — all cloud (Firestore / Firebase Storage) calls are
 * gated on this flag so the app works perfectly without deploying Firebase
 * security rules. Users who want multi-device sync can turn it on in
 * Settings > Preferences.
 */

export const CLOUD_SYNC_KEY = 'vibe_cloud_sync_enabled';
export const CLOUD_SYNC_CHANGE_EVENT = 'vibe-cloud-sync-change';

/** Returns true only when the user has explicitly enabled cloud sync. */
export const isCloudSyncEnabled = (): boolean => {
  try {
    return localStorage.getItem(CLOUD_SYNC_KEY) === 'true';
  } catch {
    return false;
  }
};

/** Persist the choice and broadcast a change event for listening components. */
export const setCloudSyncEnabled = (enabled: boolean): void => {
  try {
    localStorage.setItem(CLOUD_SYNC_KEY, enabled ? 'true' : 'false');
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event(CLOUD_SYNC_CHANGE_EVENT));
    }
  } catch {}
};
