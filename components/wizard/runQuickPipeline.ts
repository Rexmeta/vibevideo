import { WizardContextValue } from './WizardContext';
import {
  generateScript,
  segmentScriptIntoScenes,
  generateStyleSheet,
} from '../../services/geminiService';

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
}

export interface QuickPipelineResult {
  success: boolean;
  failedStep?: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  error?: string;
}

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

export const runQuickPipeline = async (
  ctx: WizardContextValue,
  topic: string,
  onProgress: (p: QuickPipelineProgress) => void
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

  // STEP 2: Script
  let scriptText = '';
  let totalScenes = 0;
  try {
    onProgress({ stage: 'script', label: '스크립트 생성 중...', percent: 5 });
    scriptText = await generateScript(topic, videoStyle, duration, targetSceneCount, { genre, platform });
    setScript(scriptText);

    onProgress({ stage: 'segment', label: '씬 분석 중...', percent: 18 });
    const segScenes = await segmentScriptIntoScenes(
      scriptText,
      videoStyle,
      aspectRatio,
      characterProfile || undefined,
      targetSceneCount,
      { genre, platform, characterReferences }
    );
    setScenes(segScenes);
    scenesRef.current = segScenes;
    totalScenes = segScenes.length;
    await wait(50);

    if (!styleSheet) {
      try {
        onProgress({
          stage: 'style',
          label: '스타일 시트 추출 중...',
          percent: 25,
          totalScenes,
        });
        const sheet = await generateStyleSheet(topic, scriptText, videoStyle, { genre });
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
      onProgress({
        stage: 'audio',
        label: `오디오 생성 중... (${totalScenes}개 씬 병렬 처리)`,
        percent: 35,
        totalScenes,
      });
      await handleBatchAudio();
      const allAudio = scenesRef.current.every(s => !!s.audio_path);
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
    onProgress({
      stage: 'images',
      label: `이미지 생성 중... (${totalScenes}개 씬 병렬 처리)`,
      percent: 55,
      totalScenes,
    });
    setStep(4);
    setMaxStep(prev => Math.max(prev, 4));
    await handleBatchImages();
    const allImg = scenesRef.current.every(s => !!s.image_path);
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
      onProgress({
        stage: 'videos',
        label: `비디오 생성 중... (씬당 약 1분 + 60초 대기)`,
        percent: 75,
        totalScenes,
      });
      setStep(5);
      setMaxStep(prev => Math.max(prev, 5));
      await handleBatchVideos();
      const allVid = scenesRef.current.every(s => !!s.video_path);
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

  onProgress({ stage: 'done', label: '완료! Preview 단계로 이동합니다...', percent: 100, totalScenes });
  setStep(6);
  setMaxStep(prev => Math.max(prev, 6));
  sync(6);

  return { success: true };
};
