import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sceneFixture } from './fixtures/regression';

const { generateScript, segmentScriptIntoScenes, generateStyleSheet } = vi.hoisted(() => ({
  generateScript: vi.fn(),
  segmentScriptIntoScenes: vi.fn(),
  generateStyleSheet: vi.fn(),
}));

vi.mock('../services/geminiService', () => ({
  generateScript,
  segmentScriptIntoScenes,
  generateStyleSheet,
}));

import { runQuickPipeline } from '../components/wizard/runQuickPipeline';

const makeContext = (overrides: Record<string, unknown> = {}) => {
  const scenesRef = { current: [] as any[] };
  const setScenes = vi.fn((scenes: any[]) => { scenesRef.current = scenes; });
  return {
    setTopic: vi.fn(),
    videoStyle: 'cinematic',
    duration: 30,
    targetSceneCount: 2,
    genre: undefined,
    platform: undefined,
    aspectRatio: '16:9',
    characterProfile: '',
    characterReferences: [],
    creativeBrief: {},
    setScript: vi.fn(),
    setScenes,
    setStyleSheet: vi.fn(),
    styleSheet: undefined,
    setStep: vi.fn(),
    setMaxStep: vi.fn(),
    sync: vi.fn(),
    handleBatchAudio: vi.fn(async () => {
      scenesRef.current = scenesRef.current.map(s => ({ ...s, audio_path: 'https://audio' }));
    }),
    handleBatchImages: vi.fn(async () => {
      scenesRef.current = scenesRef.current.map(s => ({ ...s, image_path: 'https://image' }));
    }),
    handleBatchVideos: vi.fn(async () => {
      scenesRef.current = scenesRef.current.map(s => ({ ...s, video_path: 'https://video' }));
    }),
    useVeoAudio: false,
    isPresentationMode: false,
    scenesRef,
    ...overrides,
  } as any;
};

describe('Quick pipeline characterization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generateScript.mockResolvedValue('script');
    segmentScriptIntoScenes.mockResolvedValue([sceneFixture(), sceneFixture({ scene_number: 2 })]);
    generateStyleSheet.mockResolvedValue({ palette: ['#000'] });
  });

  it('runs script, audio, image and video stages and hands a completed project to Pro preview', async () => {
    const ctx = makeContext();
    const progress = vi.fn();
    const result = await runQuickPipeline(ctx, 'topic', progress);

    expect(result).toEqual({ success: true });
    expect(ctx.setStep.mock.calls.map((c: any[]) => c[0])).toEqual([3, 4, 5, 6]);
    expect(ctx.sync).toHaveBeenLastCalledWith(6);
    expect(progress.mock.calls.at(-1)?.[0]).toMatchObject({ stage: 'done', percent: 100, totalScenes: 2 });
  });

  it('reports the script boundary and does not start paid media work when script generation fails', async () => {
    generateScript.mockRejectedValueOnce(new Error('provider unavailable'));
    const ctx = makeContext();
    const result = await runQuickPipeline(ctx, 'topic', vi.fn());

    expect(result).toEqual({ success: false, failedStep: 2, error: 'provider unavailable' });
    expect(ctx.handleBatchAudio).not.toHaveBeenCalled();
    expect(ctx.handleBatchImages).not.toHaveBeenCalled();
    expect(ctx.handleBatchVideos).not.toHaveBeenCalled();
  });

  it('pauses for missing image retries and continues only after the scene is repaired', async () => {
    const ctx = makeContext({
      handleBatchImages: vi.fn(async () => {
        ctx.scenesRef.current = ctx.scenesRef.current.map((s: any, i: number) =>
          i === 0 ? { ...s, image_path: 'https://image/0' } : s);
      }),
    });
    const awaitRetries = vi.fn(async (stage: string, indices: number[]) => {
      expect(stage).toBe('images');
      expect(indices).toEqual([1]);
      ctx.scenesRef.current[1] = { ...ctx.scenesRef.current[1], image_path: 'https://image/1' };
      return true;
    });

    const result = await runQuickPipeline(ctx, 'topic', vi.fn(), awaitRetries);
    expect(result.success).toBe(true);
    expect(awaitRetries).toHaveBeenCalledOnce();
    expect(ctx.handleBatchVideos).toHaveBeenCalledOnce();
  });

  it('keeps the observed failure separate from the desired retry policy when repair is declined', async () => {
    const ctx = makeContext({
      handleBatchImages: vi.fn(),
      isPresentationMode: true,
    });
    const result = await runQuickPipeline(ctx, 'topic', vi.fn(), vi.fn().mockResolvedValue(false));
    expect(result).toEqual({
      success: false,
      failedStep: 4,
      error: '2개 씬 이미지 생성에 실패했습니다.',
    });
  });
});
