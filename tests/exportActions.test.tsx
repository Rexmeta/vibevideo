import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sceneFixture } from './fixtures/regression';

const {
  mergeAllScenes,
  renderPresentationVideo,
  concatMp4Parts,
  applyLogoWatermark,
  generateSlideClip,
  exportControls,
} = vi.hoisted(() => ({
  mergeAllScenes: vi.fn(),
  renderPresentationVideo: vi.fn(),
  concatMp4Parts: vi.fn(),
  applyLogoWatermark: vi.fn(),
  generateSlideClip: vi.fn(),
  exportControls: {
    chunks: null as number[][] | null,
    longForm: false,
  },
}));

vi.mock('../services/videoMergeService', () => ({
  mergeAllScenes,
  renderPresentationVideo,
  concatMp4Parts,
  applyLogoWatermark,
  generateSlideClip,
  terminateFFmpegForCleanup: vi.fn(),
  getResolution: () => ({ w: 1280, h: 720 }),
  FFmpegLoadTimeoutError: class extends Error {},
}));
vi.mock('../services/ffmpegLimits', () => ({
  evaluateExportLimits: () => ({ level: 'safe', summary: '', reasons: [] }),
  planSafeExportChunks: ({ durations }: any) => ({
    chunks: exportControls.chunks || [durations.map((_: number, i: number) => i)],
  }),
  isMemoryRelatedError: () => false,
  FRIENDLY_OOM_MESSAGE: 'oom',
}));
vi.mock('../services/chapterService', () => ({
  isLongFormDuration: () => exportControls.longForm,
}));
vi.mock('../services/captionService', () => ({
  alignWordsToDuration: (text: string, duration: number) => [{ word: text, startMs: 0, endMs: duration * 1000 }],
}));

import { useExportActions } from '../components/wizard/hooks/useExportActions';

const captionStyle = { preset: 'karaoke', emphasisColor: '#fff', enableEmoji: false } as any;
const makeDeps = (overrides: Record<string, unknown> = {}) => ({
  scenes: [
    sceneFixture({ video_path: 'video-1', image_path: 'image-1', audio_path: 'audio-1' }),
    sceneFixture({ scene_number: 2, video_path: 'video-2', image_path: 'image-2', audio_path: 'audio-2' }),
  ],
  captionStyle,
  useVeoAudio: false,
  duration: 8,
  aspectRatio: '16:9',
  topic: 'fixture',
  mergedVideoUrl: null,
  isPresentationMode: false,
  setMerging: vi.fn(),
  setMergeProgress: vi.fn(),
  setMergePercent: vi.fn(),
  setMergedVideoUrl: vi.fn(),
  setDownloadingAll: vi.fn(),
  trackBlobUrl: vi.fn(),
  getDefaultPresentation: () => ({ transition: 'none', transitionDuration: 1, motion: 'none' }),
  ...overrides,
} as any);

describe('export action characterization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mergeAllScenes.mockResolvedValue(new Blob(['merged']));
    renderPresentationVideo.mockResolvedValue(new Blob(['presentation']));
    concatMp4Parts.mockResolvedValue(new Blob(['concat']));
    applyLogoWatermark.mockImplementation(async (b: Blob) => b);
    generateSlideClip.mockResolvedValue(new Blob(['slide']));
    exportControls.chunks = null;
    exportControls.longForm = false;
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:result'), revokeObjectURL: vi.fn() });
  });

  it('preserves visible scene order and passes external audio plus deterministic captions to AI-video merge', async () => {
    const deps = makeDeps({
      scenes: [
        sceneFixture({ video_path: 'video-1', image_path: 'image-1', audio_path: 'audio-1' }),
        sceneFixture({ scene_number: 99, video_path: 'hidden-video', hidden: true }),
        sceneFixture({ scene_number: 2, video_path: 'video-2', image_path: 'image-2', audio_path: 'audio-2' }),
      ],
    });
    const { result } = renderHook(() => useExportActions(deps));
    await act(() => result.current.handleMergeExport());

    expect(mergeAllScenes).toHaveBeenCalledOnce();
    const inputs = mergeAllScenes.mock.calls[0][0];
    expect(inputs.map((x: any) => x.videoUrl)).toEqual(['video-1', 'video-2']);
    expect(inputs.map((x: any) => x.audioUrl)).toEqual(['audio-1', 'audio-2']);
    expect(inputs[0].captionWords).toEqual([{ word: 'hello deterministic world', startMs: 0, endMs: 4000 }]);
  });

  it('uses presentation images, audio, previous-scene transitions, captions and branding in order', async () => {
    const brandKit = {
      introConfig: { text: 'intro', bgColor: '#000', durationSec: 2 },
      outroConfig: { text: 'outro', bgColor: '#000', durationSec: 2 },
      logoUrl: 'logo.png',
      logoPosition: 'bottom-right',
      logoOpacity: 0.7,
    };
    const deps = makeDeps({
      isPresentationMode: true,
      brandKit,
      scenes: [
        sceneFixture({ image_path: 'image-1', audio_path: 'audio-1', transitionTo: 'wipeleft' }),
        sceneFixture({ scene_number: 2, image_path: 'image-2', audio_path: 'audio-2' }),
      ],
    });
    const { result } = renderHook(() => useExportActions(deps));
    await act(() => result.current.handleRenderPresentation());

    const inputs = renderPresentationVideo.mock.calls[0][0];
    expect(inputs.map((x: any) => x.imageUrl)).toEqual(['image-1', 'image-2']);
    expect(inputs[1].transition).toBe('wipeleft');
    expect(inputs[0].audioUrl).toBe('audio-1');
    expect(generateSlideClip).toHaveBeenCalledTimes(2);
    expect(concatMp4Parts.mock.calls[0][0]).toHaveLength(3);
    expect(applyLogoWatermark).toHaveBeenCalledWith(expect.any(Blob), 'logo.png', 'bottom-right', 0.7, expect.any(Function));
  });

  it('falls back to deterministic per-part downloads when long-form final concat fails', async () => {
    exportControls.longForm = true;
    exportControls.chunks = [[0], [1]];
    concatMp4Parts.mockRejectedValueOnce(new Error('wasm memory exhausted'));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ blob: async () => new Blob(['download']) }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const deps = makeDeps();
    const { result } = renderHook(() => useExportActions(deps));

    await act(() => result.current.handleAutoSplitExport());

    expect(mergeAllScenes).toHaveBeenCalledTimes(2);
    expect(concatMp4Parts).toHaveBeenCalledWith(expect.arrayContaining([expect.any(Blob)]), expect.any(Function));
    expect(click).toHaveBeenCalledTimes(2);
    expect(deps.setMergeProgress).toHaveBeenLastCalledWith(
      '최종 결합 실패 — 2개 파트로 개별 다운로드했습니다.',
    );
  });
});
