import { describe, it, expect, vi } from 'vitest';
import { backfillLocalProjectsToCloud } from '../services/storageService';
import { Project, ProjectStatus } from '../types';

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

    const pushed = await backfillLocalProjectsToCloud(userId, {}, {
      getCloud, save, ignoreDb: true, resetGuard: true,
    });

    expect(pushed).toBe(0);
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

    const pushed = await backfillLocalProjectsToCloud(userId, {}, {
      getCloud, save, ignoreDb: true, resetGuard: true,
    });

    expect(pushed).toBe(1);
    expect(save).toHaveBeenCalledTimes(1);
    const [pushedProj, skipLocal] = save.mock.calls[0];
    expect(skipLocal).toBe(true);
    expect(pushedProj.id).toBe(projectId);
    expect(pushedProj.saved_max_step).toBe(5);
  });
});
