import { describe, it, expect, vi } from 'vitest';
import { backfillLocalProjectsToCloud, sceneHasOnlyLocalMedia } from '../services/storageService';
import { Project, ProjectStatus, Scene } from '../types';

const baseProject = (over: Partial<Project>): Project => ({
  id: 'p1',
  user_id: 'u1',
  title: 't',
  aspect_ratio: '16:9',
  style_template: 'default',
  status: ProjectStatus.DRAFT,
  created_at: '2026-01-01',
  ...over,
});

const seedLocal = (userId: string, project: Project) => {
  localStorage.setItem(`vibe_project_index_${userId}`, JSON.stringify([project.id]));
  localStorage.setItem(`vibe_video_card_${project.id}`, JSON.stringify({
    id: project.id, user_id: project.user_id, title: project.title,
    aspect_ratio: project.aspect_ratio, style_template: project.style_template,
    status: project.status, created_at: project.created_at,
  }));
  localStorage.setItem(`vibe_video_backup_${project.id}`, JSON.stringify(project));
};

describe('sceneHasOnlyLocalMedia', () => {
  it('returns false for a scene with no media paths', () => {
    expect(sceneHasOnlyLocalMedia({ scene_number: 1, visual_prompt: 'a' } as Partial<Scene>)).toBe(false);
  });

  it('returns false when at least one path is a cloud URL', () => {
    expect(sceneHasOnlyLocalMedia({
      image_path: 'https://cdn/img.jpg',
      audio_path: '[local-audio]',
    } as Partial<Scene>)).toBe(false);
  });

  it('returns true when all media paths are local sentinels', () => {
    expect(sceneHasOnlyLocalMedia({
      image_path: '[local-image]',
      audio_path: '[local-audio]',
    } as Partial<Scene>)).toBe(true);
  });

  it('returns true for a data: URL image with no other media', () => {
    expect(sceneHasOnlyLocalMedia({
      image_path: 'data:image/png;base64,abc',
    } as Partial<Scene>)).toBe(true);
  });
});

describe('backfillLocalProjectsToCloud', () => {
  it('skips when cloud has higher progress score than local', async () => {
    const userId = 'user-skip-' + Math.random().toString(36).slice(2);
    const projectId = 'proj-skip';
    const local = baseProject({
      id: projectId, user_id: userId,
      saved_step: 2, saved_max_step: 2,
      saved_scenes: [{ scene_number: 1, visual_prompt: 'a' } as any],
    });
    seedLocal(userId, local);

    const richCloud = baseProject({
      id: projectId, user_id: userId,
      saved_step: 6, saved_max_step: 6,
      saved_scenes: Array.from({ length: 5 }, (_, i) => ({
        scene_number: i + 1,
        visual_prompt: 'x',
        image_path: 'https://cdn/img' + i,
        video_path: 'https://cdn/vid' + i,
      })) as any,
    });

    const save = vi.fn().mockResolvedValue(undefined);
    const getCloud = vi.fn().mockResolvedValue(richCloud);

    const result = await backfillLocalProjectsToCloud(userId, {}, {
      getCloud, save, ignoreDb: true, resetGuard: true,
    });

    expect(result.pushed).toBe(0);
    expect(result.localOnlySceneCount).toBe(0);
    expect(save).not.toHaveBeenCalled();
    expect(getCloud).toHaveBeenCalledWith(projectId);
  });

  it('pushes when local has higher progress than cloud', async () => {
    const userId = 'user-push-' + Math.random().toString(36).slice(2);
    const projectId = 'proj-push';
    const local = baseProject({
      id: projectId, user_id: userId,
      saved_step: 5, saved_max_step: 5,
      saved_scenes: Array.from({ length: 4 }, (_, i) => ({
        scene_number: i + 1,
        visual_prompt: 'x',
        image_path: 'https://cdn/img' + i,
      })) as any,
    });
    seedLocal(userId, local);

    const save = vi.fn().mockResolvedValue(undefined);
    const getCloud = vi.fn().mockResolvedValue(undefined);

    const result = await backfillLocalProjectsToCloud(userId, {}, {
      getCloud, save, ignoreDb: true, resetGuard: true,
    });

    expect(result.pushed).toBe(1);
    expect(result.localOnlySceneCount).toBe(0);
    expect(save).toHaveBeenCalledTimes(1);
    const [pushedProj, skipLocal] = save.mock.calls[0];
    expect(skipLocal).toBe(true);
    expect(pushedProj.id).toBe(projectId);
    expect(pushedProj.saved_max_step).toBe(5);
  });

  it('reports local-only scene count and strips sentinel paths from pushed project', async () => {
    const userId = 'user-mixed-' + Math.random().toString(36).slice(2);
    const projectId = 'proj-mixed';
    // Mixed project: 2 scenes with cloud media, 2 scenes with only local sentinels.
    const local = baseProject({
      id: projectId, user_id: userId,
      saved_step: 4, saved_max_step: 4,
      saved_scenes: [
        { scene_number: 1, visual_prompt: 'a', image_path: 'https://cdn/img1', audio_path: 'https://cdn/aud1' },
        { scene_number: 2, visual_prompt: 'b', image_path: '[local-image]', audio_path: '[local-audio]' },
        { scene_number: 3, visual_prompt: 'c', image_path: 'https://cdn/img3' },
        { scene_number: 4, visual_prompt: 'd', audio_path: '[local-audio]' },
      ] as any,
    });
    seedLocal(userId, local);

    const save = vi.fn().mockResolvedValue(undefined);
    const getCloud = vi.fn().mockResolvedValue(undefined);

    const result = await backfillLocalProjectsToCloud(userId, {}, {
      getCloud, save, ignoreDb: true, resetGuard: true,
    });

    expect(result.pushed).toBe(1);
    // Scenes 2 and 4 have only local media paths.
    expect(result.localOnlySceneCount).toBe(2);

    // The project actually saved to the cloud must have local paths stripped.
    expect(save).toHaveBeenCalledTimes(1);
    const [pushedProj] = save.mock.calls[0];
    const scenes: Partial<Scene>[] = pushedProj.saved_scenes;

    // Scene 1: cloud paths preserved.
    expect(scenes[0].image_path).toBe('https://cdn/img1');
    expect(scenes[0].audio_path).toBe('https://cdn/aud1');

    // Scene 2: local sentinels stripped to undefined.
    expect(scenes[1].image_path).toBeUndefined();
    expect(scenes[1].audio_path).toBeUndefined();

    // Scene 3: cloud path preserved.
    expect(scenes[2].image_path).toBe('https://cdn/img3');

    // Scene 4: local sentinel stripped.
    expect(scenes[3].audio_path).toBeUndefined();
  });
});
