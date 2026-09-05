import { WizardContextValue } from './WizardContext';
import {
  runSceneSegmentation,
  runStyleSheetGeneration,
  runTextGeneration,
} from '../../services/generationCommands';
import { throwGenerationFailure } from '../../services/generationContract';

export type QuickPipelineStage =
  | 'script'
  | 'segment'
  | 'style'
  | 'audio'
  | 'images'
  | 'videos'
  | 'done';

export interface QuickPipelineProgress {
  stage: QuickPipelineStage;
  label: string;
  percent: number;
  detail?: string;
  /** Total number of scenes the pipeline is operating on (after segmentation). */
  totalScenes?: number;
  /** Realized wall-clock duration (ms) for each stage that has finished so far. */
  stageDurations?: Partial<Record<QuickPipelineStage, number>>;
  /** Total wall-clock time (ms) since the pipeline started. */
  totalMs?: number;
}

export interface QuickPipelineResult {
  success: boolean;
  failedStep?: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  error?: string;
}

/**
 * Callback used by the pipeline to pause at a per-scene stage when one or more
 * scenes failed. Resolves with `true` once all originally-missing scenes have
 * been recovered (e.g. via inline retry buttons), or `false` if the user gives
 * up — in which case the pipeline will surface the existing failure state.
 */
export type AwaitRetries = (
  stage: 'audio' | 'images' | 'videos',
  missingIdx: number[]
) => Promise<boolean>;

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

export const runQuickPipeline = async (
  ctx: WizardContextValue,
  topic: string,
  onProgress: (p: QuickPipelineProgress) => void,
  awaitRetries?: AwaitRetries
): Promise<QuickPipelineResult> => {
  const {
    setTopic,
    videoStyle,
    duration,
    targetSceneCount,
    genre,
    platform,
    aspectRatio,
    characterProfile,
    characterReferences,
    creativeBrief,
    setScript,
    setScenes,
    setStyleSheet,
    styleSheet,
    setStep,
    setMaxStep,
    sync,
    handleBatchAudio,
    handleBatchImages,
    handleBatchVideos,
    useVeoAudio,
    isPresentationMode,
    scenesRef,
  } = ctx;

  setTopic(topic);

  // Track realized wall-clock duration per stage so the UI can surface
  // "Audio: 24s · Images: 1m 12s ..." once each stage finishes.
  const stageDurations: Partial<Record<QuickPipelineStage, number>> = {};
  const pipelineStart = Date.now();
  let currentStage: QuickPipelineStage | null = null;
  let stageStart = pipelineStart;

  const emit = (p: QuickPipelineProgress) => {
    // When we enter a new stage, close out the previous one's duration.
    if (p.stage !== currentStage) {
      if (currentStage && currentStage !== 'done') {
        stageDurations[currentStage] = Date.now() - stageStart;
      }
      currentStage = p.stage;
      stageStart = Date.now();
    }
    onProgress({
      ...p,
      stageDurations: { ...stageDurations },
      totalMs: Date.now() - pipelineStart,
    });
  };

  // STEP 2: Script
  let scriptText = '';
  let totalScenes = 0;
  try {
    emit({ stage: 'script', label: '스크립트 생성 중...', percent: 5 });
    scriptText = throwGenerationFailure(await runTextGeneration({
      topic,
      style: videoStyle,
      lengthSeconds: duration,
      sceneCount: targetSceneCount,
      genre,
      platform,
      creativeBrief,
      textModel: ctx.selectedTextModel || undefined,
    }));
    setScript(scriptText);

    emit({ stage: 'segment', label: '씬 분석 중...', percent: 18 });
    const segScenes = throwGenerationFailure(await runSceneSegmentation({
      script: scriptText,
      style: videoStyle,
      ratio: aspectRatio,
      characterProfile: characterProfile || undefined,
      sceneCount: targetSceneCount,
      genre,
      platform,
      characterReferences,
      creativeBrief,
      textModel: ctx.selectedTextModel || undefined,
    }));
    setScenes(segScenes);
    scenesRef.current = segScenes;
    totalScenes = segScenes.length;
    await wait(50);

    if (!styleSheet) {
      try {
        emit({
          stage: 'style',
          label: '스타일 시트 추출 중...',
          percent: 25,
          totalScenes,
        });
        const sheet = throwGenerationFailure(await runStyleSheetGeneration({
          topic,
          script: scriptText,
          visualStyle: videoStyle,
          genre,
          textModel: ctx.selectedTextModel || undefined,
        }));
        setStyleSheet(sheet);
      } catch (sheetErr) {
        console.warn('[QuickMode] Style sheet failed, continuing:', sheetErr);
      }
    }

    setStep(3);
    setMaxStep(prev => Math.max(prev, 3));
    sync(3, segScenes, {}, { script: scriptText, topic, maxStep: 3 });
  } catch (e: any) {
    return { success: false, failedStep: 2, error: e?.message || '스크립트 생성 실패' };
  }

  // STEP 3: Audio (skip if Veo handles it)
  if (!useVeoAudio) {
    try {
      emit({
        stage: 'audio',
        label: `오디오 생성 중... (${totalScenes}개 씬 병렬 처리)`,
        percent: 35,
        totalScenes,
      });
      await handleBatchAudio();
      let allAudio = scenesRef.current.every(s => !!s.audio_path);
      if (!allAudio && awaitRetries) {
        const missingIdx = scenesRef.current
          .map((s, i) => (!s.audio_path ? i : -1))
          .filter(i => i >= 0);
        await awaitRetries('audio', missingIdx);
        allAudio = scenesRef.current.every(s => !!s.audio_path);
      }
      if (!allAudio) {
        const missing = scenesRef.current.filter(s => !s.audio_path).length;
        return { success: false, failedStep: 3, error: `${missing}개 씬 오디오 생성에 실패했습니다.` };
      }
    } catch (e: any) {
      return { success: false, failedStep: 3, error: e?.message || '오디오 생성 실패' };
    }
  }

  // STEP 4: Images
  try {
    emit({
      stage: 'images',
      label: `이미지 생성 중... (${totalScenes}개 씬 병렬 처리)`,
      percent: 55,
      totalScenes,
    });
    setStep(4);
    setMaxStep(prev => Math.max(prev, 4));
    await handleBatchImages();
    let allImg = scenesRef.current.every(s => !!s.image_path);
    if (!allImg && awaitRetries) {
      const missingIdx = scenesRef.current
        .map((s, i) => (!s.image_path ? i : -1))
        .filter(i => i >= 0);
      await awaitRetries('images', missingIdx);
      allImg = scenesRef.current.every(s => !!s.image_path);
    }
    if (!allImg) {
      const missing = scenesRef.current.filter(s => !s.image_path).length;
      return { success: false, failedStep: 4, error: `${missing}개 씬 이미지 생성에 실패했습니다.` };
    }
  } catch (e: any) {
    return { success: false, failedStep: 4, error: e?.message || '이미지 생성 실패' };
  }

  // STEP 5: Videos (skip if presentation mode)
  if (!isPresentationMode) {
    try {
      emit({
        stage: 'videos',
        label: `비디오 생성 중... (씬당 약 1분 + 60초 대기)`,
        percent: 75,
        totalScenes,
      });
      setStep(5);
      setMaxStep(prev => Math.max(prev, 5));
      await handleBatchVideos();
      let allVid = scenesRef.current.every(s => !!s.video_path);
      if (!allVid && awaitRetries) {
        const missingIdx = scenesRef.current
          .map((s, i) => (!s.video_path ? i : -1))
          .filter(i => i >= 0);
        await awaitRetries('videos', missingIdx);
        allVid = scenesRef.current.every(s => !!s.video_path);
      }
      if (!allVid) {
        const missing = scenesRef.current.filter(s => !s.video_path).length;
        return { success: false, failedStep: 5, error: `${missing}개 씬 비디오 생성에 실패했습니다.` };
      }
    } catch (e: any) {
      return { success: false, failedStep: 5, error: e?.message || '비디오 생성 실패' };
    }
  } else {
    setStep(5);
    setMaxStep(prev => Math.max(prev, 5));
  }

  emit({ stage: 'done', label: '완료! Preview 단계로 이동합니다...', percent: 100, totalScenes });
  setStep(6);
  setMaxStep(prev => Math.max(prev, 6));
  sync(6);

  return { success: true };
};
