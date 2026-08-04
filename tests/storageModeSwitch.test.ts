/**
 * Task #153 — Storage mode-switch safety tests
 *
 * Verifies that video generation data is saved and restored correctly when
 * toggling between local-only and cloud-sync modes:
 *   1. Full project round-trip in local-only mode (save → reload → all scenes intact)
 *   2. Enabling cloud sync uploads an existing local project via backfill
 *   3. Disabling cloud sync mid-wizard does not corrupt the local backup
 *   4. duplicateProjectInCloud local fallback path
 *   5. deleteProjectFromCloud local fallback path
 *   6. uploadFileToCloud local fallback path
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Hoist mocks ----

vi.mock('../services/cloudSyncSettings', () => ({
  isCloudSyncEnabled: vi.fn().mockReturnValue(false),
  CLOUD_SYNC_KEY: 'vibe_cloud_sync_enabled',
  CLOUD_SYNC_CHANGE_EVENT: 'vibe-cloud-sync-change',
  setCloudSyncEnabled: vi.fn(),
}));

vi.mock('../services/firebaseConfig', () => ({
  db: null,
  storage: null,
  auth: null,
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  setDoc: vi.fn().mockResolvedValue(undefined),
  getDoc: vi.fn(),
  updateDoc: vi.fn().mockResolvedValue(undefined),
  deleteDoc: vi.fn().mockResolvedValue(undefined),
  serverTimestamp: vi.fn(() => ({ _type: 'serverTimestamp' })),
  increment: vi.fn((n: number) => ({ _type: 'increment', n })),
  deleteField: vi.fn(() => ({ _type: 'deleteField' })),
  collection: vi.fn(),
  getDocs: vi.fn(),
  getDocsFromCache: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  startAfter: vi.fn(),
  runTransaction: vi.fn(),
  onSnapshot: vi.fn(),
  documentId: vi.fn(),
}));

vi.mock('firebase/storage', () => ({
  ref: vi.fn(),
  uploadBytes: vi.fn().mockResolvedValue(undefined),
  getDownloadURL: vi.fn().mockResolvedValue('https://storage.example/file'),
  deleteObject: vi.fn().mockResolvedValue(undefined),
  listAll: vi.fn().mockResolvedValue({ items: [], prefixes: [] }),
}));

// ---- Import after mocks ----

import {
  saveProjectToCloud,
  getProjectFromCloud,
  duplicateProjectInCloud,
  deleteProjectFromCloud,
  uploadFileToCloud,
  backfillLocalProjectsToCloud,
} from '../services/storageService';
import { isCloudSyncEnabled } from '../services/cloudSyncSettings';
import { Project, ProjectStatus } from '../types';

const mockCloudEnabled = isCloudSyncEnabled as ReturnType<typeof vi.fn>;

// ---- Helpers ----

const HTTPS_SCENES = [
  {
    scene_number: 1,
    visual_prompt: 'mountains at dusk',
    image_path: 'https://cdn.example/img1.jpg',
    video_path: 'https://cdn.example/vid1.mp4',
    audio_path: 'https://cdn.example/aud1.wav',
    audio_duration: 5,
  },
  {
    scene_number: 2,
    visual_prompt: 'city skyline',
    image_path: 'https://cdn.example/img2.jpg',
    video_path: 'https://cdn.example/vid2.mp4',
    audio_path: 'https://cdn.example/aud2.wav',
    audio_duration: 4,
  },
] as any;

const makeProject = (over: Partial<Project> = {}): Project => ({
  id: 'proj-mode-test',
  user_id: 'user-mode-test',
  title: 'Mode Switch Test',
  aspect_ratio: '16:9',
  style_template: 'cinematic',
  status: ProjectStatus.DRAFT,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  saved_step: 5,
  saved_max_step: 5,
  saved_scenes: HTTPS_SCENES,
  ...over,
});

// ---- Tests ----

describe('storageService mode-switch safety', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mockCloudEnabled.mockReturnValue(false);
  });

  // ---------------------------------------------------------------
  // 1. Local-only round-trip
  // ---------------------------------------------------------------
  describe('1. local-only round-trip (cloud sync OFF)', () => {
    it('saves project to localStorage and all scene data is intact', async () => {
      const project = makeProject();

      await saveProjectToCloud(project);

      const raw = localStorage.getItem(`vibe_video_backup_${project.id}`);
      expect(raw, 'localStorage backup must exist').toBeTruthy();
      const stored = JSON.parse(raw!);

      expect(stored.id).toBe(project.id);
      expect(stored.saved_step).toBe(5);
      expect(stored.saved_max_step).toBe(5);
      expect(stored.saved_scenes).toHaveLength(2);
      expect(stored.saved_scenes[0].scene_number).toBe(1);
    });

    it('restores all scenes including media paths via getProjectFromCloud (local fallback)', async () => {
      const project = makeProject();
      localStorage.setItem(`vibe_video_backup_${project.id}`, JSON.stringify(project));

      const restored = await getProjectFromCloud(project.id);

      expect(restored, 'must return a project').toBeDefined();
      expect(restored!.id).toBe(project.id);
      expect(restored!.saved_scenes).toHaveLength(2);
      // All https media paths must be preserved exactly
      for (const scene of restored!.saved_scenes!) {
        expect((scene as any).image_path).toMatch(/^https:\/\//);
        expect((scene as any).video_path).toMatch(/^https:\/\//);
        expect((scene as any).audio_path).toMatch(/^https:\/\//);
      }
    });

    it('full round-trip: save → reload preserves step, max_step, scenes, and media paths', async () => {
      const project = makeProject({ saved_step: 5, saved_max_step: 5 });

      await saveProjectToCloud(project);
      const restored = await getProjectFromCloud(project.id);

      expect(restored).toBeDefined();
      expect(restored!.saved_step).toBe(5);
      expect(restored!.saved_max_step).toBe(5);
      expect(restored!.saved_scenes).toHaveLength(2);
      expect((restored!.saved_scenes![0] as any).video_path).toBe('https://cdn.example/vid1.mp4');
      expect((restored!.saved_scenes![1] as any).video_path).toBe('https://cdn.example/vid2.mp4');
    });

    it('falls back to emergency backup key when primary key is absent', async () => {
      const project = makeProject({ saved_step: 4 });
      // Only write the emergency key
      localStorage.setItem(`vibe_video_backup_emergency_${project.id}`, JSON.stringify(project));

      const restored = await getProjectFromCloud(project.id);

      expect(restored).toBeDefined();
      expect(restored!.saved_step).toBe(4);
    });

    it('project index is updated when saving locally', async () => {
      const project = makeProject();

      await saveProjectToCloud(project);

      const idx = JSON.parse(
        localStorage.getItem(`vibe_project_index_${project.user_id}`) || '[]',
      );
      expect(idx).toContain(project.id);
    });
  });

  // ---------------------------------------------------------------
  // 2. Enabling cloud sync uploads existing local project
  // ---------------------------------------------------------------
  describe('2. backfill uploads local project when cloud sync is enabled', () => {
    it('pushes a local-only project to cloud when the cloud copy is absent', async () => {
      const userId = 'user-backfill-switch';
      const project = makeProject({ user_id: userId, saved_step: 5, saved_max_step: 5 });

      // Seed local storage as if the user had been working offline
      localStorage.setItem(`vibe_project_index_${userId}`, JSON.stringify([project.id]));
      localStorage.setItem(`vibe_video_backup_${project.id}`, JSON.stringify(project));

      const save = vi.fn().mockResolvedValue(undefined);
      const getCloud = vi.fn().mockResolvedValue(undefined); // nothing in cloud yet

      const result = await backfillLocalProjectsToCloud(userId, {}, {
        getCloud,
        save,
        ignoreDb: true,
        resetGuard: true,
      });

      expect(result.pushed).toBe(1);
      expect(save).toHaveBeenCalledTimes(1);
      const [pushedProj, skipLocal] = save.mock.calls[0];
      expect(pushedProj.id).toBe(project.id);
      // All scenes (including video/audio paths) must be present in the pushed copy
      expect(pushedProj.saved_scenes).toHaveLength(2);
      expect((pushedProj.saved_scenes[0] as any).video_path).toBe('https://cdn.example/vid1.mp4');
      expect(skipLocal).toBe(true);
    });

    it('does NOT overwrite a richer cloud copy with a lower-progress local copy', async () => {
      const userId = 'user-backfill-skip';
      const localProject = makeProject({
        user_id: userId,
        id: 'proj-backfill-skip',
        saved_step: 2,
        saved_max_step: 2,
        saved_scenes: [{ scene_number: 1, visual_prompt: 'x' } as any],
      });

      localStorage.setItem(`vibe_project_index_${userId}`, JSON.stringify([localProject.id]));
      localStorage.setItem(`vibe_video_backup_${localProject.id}`, JSON.stringify(localProject));

      const richCloud = makeProject({
        user_id: userId,
        id: localProject.id,
        saved_step: 6,
        saved_max_step: 6,
        saved_scenes: Array.from({ length: 5 }, (_, i) => ({
          scene_number: i + 1,
          visual_prompt: 'cloud scene',
          image_path: `https://cdn.example/img${i}.jpg`,
          video_path: `https://cdn.example/vid${i}.mp4`,
        })) as any,
      });

      const save = vi.fn().mockResolvedValue(undefined);
      const getCloud = vi.fn().mockResolvedValue(richCloud);

      const result = await backfillLocalProjectsToCloud(userId, {}, {
        getCloud,
        save,
        ignoreDb: true,
        resetGuard: true,
      });

      expect(result.pushed).toBe(0);
      expect(save).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------
  // 3. Disabling cloud sync mid-wizard does not corrupt local backup
  // ---------------------------------------------------------------
  describe('3. toggling cloud sync off mid-wizard preserves local backup', () => {
    it('local backup remains intact after cloud is turned off and re-saved', async () => {
      // Initial save with cloud "on" (db is null so it stays local, but flag is true)
      mockCloudEnabled.mockReturnValue(true);
      const project = makeProject({ saved_step: 3 });
      await saveProjectToCloud(project);

      const rawBefore = localStorage.getItem(`vibe_video_backup_${project.id}`);
      expect(rawBefore).toBeTruthy();

      // Simulate toggling cloud OFF mid-wizard and continuing work
      mockCloudEnabled.mockReturnValue(false);
      const updatedProject = makeProject({
        saved_step: 4,
        saved_scenes: [
          ...HTTPS_SCENES,
          {
            scene_number: 3,
            visual_prompt: 'new scene',
            audio_path: 'https://cdn.example/aud3.wav',
            audio_duration: 6,
          } as any,
        ],
      });
      await saveProjectToCloud(updatedProject);

      const rawAfter = localStorage.getItem(`vibe_video_backup_${project.id}`);
      expect(rawAfter, 'local backup must still exist after cloud-off toggle').toBeTruthy();
      const storedAfter = JSON.parse(rawAfter!);

      // Must reflect the updated state, not corrupted
      expect(storedAfter.saved_step).toBe(4);
      expect(storedAfter.saved_scenes).toHaveLength(3);
      // Original https paths must be intact
      expect(storedAfter.saved_scenes[0].video_path).toBe('https://cdn.example/vid1.mp4');
      expect(storedAfter.saved_scenes[1].video_path).toBe('https://cdn.example/vid2.mp4');
    });

    it('local backup written after cloud-on save can still be loaded in local mode', async () => {
      mockCloudEnabled.mockReturnValue(true);
      const project = makeProject({ saved_step: 5 });
      await saveProjectToCloud(project);

      // Now switch off and restore
      mockCloudEnabled.mockReturnValue(false);
      const restored = await getProjectFromCloud(project.id);

      expect(restored).toBeDefined();
      expect(restored!.saved_step).toBe(5);
      expect(restored!.saved_scenes).toHaveLength(2);
    });

    it('local data: URLs are stripped to undefined in localStorage (not stored as raw binary)', async () => {
      mockCloudEnabled.mockReturnValue(false);
      const projectWithLocalMedia = makeProject({
        saved_scenes: [
          {
            scene_number: 1,
            visual_prompt: 'local media scene',
            image_path: 'data:image/png;base64,AAABBBCCC',
            video_path: 'blob:http://localhost/vid-1',
            audio_path: 'data:audio/wav;base64,XXXYYYZZZ',
            audio_duration: 3,
          } as any,
          {
            scene_number: 2,
            visual_prompt: 'cloud media scene',
            image_path: 'https://cdn.example/img2.jpg',
            video_path: 'https://cdn.example/vid2.mp4',
            audio_path: 'https://cdn.example/aud2.wav',
            audio_duration: 4,
          } as any,
        ],
      });

      await saveProjectToCloud(projectWithLocalMedia);

      const raw = localStorage.getItem(`vibe_video_backup_${projectWithLocalMedia.id}`);
      const stored = JSON.parse(raw!);

      // data: / blob: payloads must be stripped — not stored in localStorage
      expect(stored.saved_scenes[0].audio_path).toBeUndefined();
      expect(stored.saved_scenes[0].image_path).toBeUndefined();
      expect(stored.saved_scenes[0].video_path).toBeUndefined();

      // https paths from the second scene must survive unchanged
      expect(stored.saved_scenes[1].image_path).toBe('https://cdn.example/img2.jpg');
      expect(stored.saved_scenes[1].video_path).toBe('https://cdn.example/vid2.mp4');
      expect(stored.saved_scenes[1].audio_path).toBe('https://cdn.example/aud2.wav');
    });
  });

  // ---------------------------------------------------------------
  // 4. duplicateProjectInCloud local fallback
  // ---------------------------------------------------------------
  describe('4. duplicateProjectInCloud local fallback (cloud sync OFF)', () => {
    it('duplicates from localStorage and gives the copy a new id and title suffix', async () => {
      const project = makeProject();
      localStorage.setItem(`vibe_video_backup_${project.id}`, JSON.stringify(project));

      const copy = await duplicateProjectInCloud(project.id);

      expect(copy, 'copy must not be null').not.toBeNull();
      expect(copy!.id).not.toBe(project.id);
      expect(copy!.title).toBe(`${project.title} (Copy)`);
    });

    it('preserves all scenes in the duplicated copy', async () => {
      const project = makeProject();
      localStorage.setItem(`vibe_video_backup_${project.id}`, JSON.stringify(project));

      const copy = await duplicateProjectInCloud(project.id);

      expect(copy!.saved_scenes).toHaveLength(2);
      expect((copy!.saved_scenes![0] as any).video_path).toBe('https://cdn.example/vid1.mp4');
      expect((copy!.saved_scenes![1] as any).video_path).toBe('https://cdn.example/vid2.mp4');
    });

    it('persists the copy to localStorage so it survives a reload', async () => {
      const project = makeProject();
      localStorage.setItem(`vibe_video_backup_${project.id}`, JSON.stringify(project));

      const copy = await duplicateProjectInCloud(project.id);

      const raw = localStorage.getItem(`vibe_video_backup_${copy!.id}`);
      expect(raw, 'copy must be in localStorage').toBeTruthy();
      const stored = JSON.parse(raw!);
      expect(stored.saved_scenes).toHaveLength(2);
    });

    it('resets version to 1 on the copy', async () => {
      const project = makeProject();
      (project as any).version = 7;
      localStorage.setItem(`vibe_video_backup_${project.id}`, JSON.stringify(project));

      const copy = await duplicateProjectInCloud(project.id);

      expect((copy as any).version).toBe(1);
    });

    it('returns null when the source project is not found locally', async () => {
      const copy = await duplicateProjectInCloud('nonexistent-project-id');
      expect(copy).toBeNull();
    });
  });

  // ---------------------------------------------------------------
  // 5. deleteProjectFromCloud local fallback
  // ---------------------------------------------------------------
  describe('5. deleteProjectFromCloud local fallback (cloud sync OFF)', () => {
    it('removes primary and emergency backup keys from localStorage', async () => {
      const project = makeProject();
      localStorage.setItem(`vibe_video_backup_${project.id}`, JSON.stringify(project));
      localStorage.setItem(`vibe_video_backup_emergency_${project.id}`, JSON.stringify(project));

      await deleteProjectFromCloud(project.id, project.user_id);

      expect(localStorage.getItem(`vibe_video_backup_${project.id}`)).toBeNull();
      expect(localStorage.getItem(`vibe_video_backup_emergency_${project.id}`)).toBeNull();
    });

    it('removes project id from the project index', async () => {
      const project = makeProject();
      localStorage.setItem(`vibe_video_backup_${project.id}`, JSON.stringify(project));
      localStorage.setItem(
        `vibe_project_index_${project.user_id}`,
        JSON.stringify([project.id, 'proj-other']),
      );

      await deleteProjectFromCloud(project.id, project.user_id);

      const idx = JSON.parse(
        localStorage.getItem(`vibe_project_index_${project.user_id}`) || '[]',
      );
      expect(idx).not.toContain(project.id);
      expect(idx).toContain('proj-other');
    });

    it('resolves userId from the local backup when not explicitly passed', async () => {
      const project = makeProject();
      localStorage.setItem(`vibe_video_backup_${project.id}`, JSON.stringify(project));
      localStorage.setItem(
        `vibe_project_index_${project.user_id}`,
        JSON.stringify([project.id]),
      );

      // No explicit userId — must be resolved from backup data
      await deleteProjectFromCloud(project.id);

      expect(localStorage.getItem(`vibe_video_backup_${project.id}`)).toBeNull();
      const idx = JSON.parse(
        localStorage.getItem(`vibe_project_index_${project.user_id}`) || '[]',
      );
      expect(idx).not.toContain(project.id);
    });

    it('does not throw when the project does not exist locally', async () => {
      await expect(
        deleteProjectFromCloud('nonexistent-id', 'some-user'),
      ).resolves.not.toThrow();
    });
  });

  // ---------------------------------------------------------------
  // 6. uploadFileToCloud local fallback
  // ---------------------------------------------------------------
  describe('6. uploadFileToCloud local fallback (cloud sync OFF)', () => {
    it('returns the original data URL unchanged when input is already a data URL', async () => {
      const dataUrl = 'data:image/png;base64,ABCDEF0123456789';
      const result = await uploadFileToCloud('users/u1/proj1/img.png', dataUrl, 'base64');
      expect(result).toBe(dataUrl);
    });

    it('wraps a plain base64 string in a data URL with the correct MIME type', async () => {
      const base64 = 'ABCDEF0123456789012345678901234567890';
      const result = await uploadFileToCloud('users/u1/proj1/img.png', base64, 'base64');
      expect(result).toMatch(/^data:image\/png;base64,/);
    });

    it('returns a blob: URL for Blob input', async () => {
      // URL.createObjectURL is not implemented in jsdom — stub it for this test.
      const original = URL.createObjectURL;
      URL.createObjectURL = vi.fn().mockReturnValue('blob:http://localhost/fake-uuid');
      try {
        const blob = new Blob(['binary audio data'], { type: 'audio/wav' });
        const result = await uploadFileToCloud('users/u1/proj1/audio.wav', blob, 'blob');
        expect(result).toMatch(/^blob:/);
      } finally {
        URL.createObjectURL = original;
      }
    });

    it('infers image/jpeg MIME type for .jpg path', async () => {
      const base64 = 'ABCDEF0123456789012345678901234567890';
      const result = await uploadFileToCloud('users/u1/proj1/frame.jpg', base64, 'base64');
      expect(result).toMatch(/^data:image\/jpeg;base64,/);
    });

    it('infers audio/wav MIME type for .wav path', async () => {
      const base64 = 'ABCDEF0123456789012345678901234567890';
      const result = await uploadFileToCloud('users/u1/proj1/narration.wav', base64, 'base64');
      expect(result).toMatch(/^data:audio\/wav;base64,/);
    });

    it('infers video/mp4 MIME type for .mp4 path', async () => {
      const base64 = 'ABCDEF0123456789012345678901234567890';
      const result = await uploadFileToCloud('users/u1/proj1/clip.mp4', base64, 'base64');
      expect(result).toMatch(/^data:video\/mp4;base64,/);
    });
  });
});
