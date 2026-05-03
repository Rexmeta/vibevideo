import React from 'react';
import { Scene, PresentationConfig, CaptionStyle } from '../../../types';
import {
  mergeAllScenes,
  MergeInput,
  renderPresentationVideo,
  PresentationSceneInput,
  getResolution,
} from '../../../services/videoMergeService';
import { alignWordsToDuration } from '../../../services/captionService';
import {
  evaluateExportLimits,
  isMemoryRelatedError,
  FRIENDLY_OOM_MESSAGE,
  planSafeExportChunks,
  SafeChunkPlan,
} from '../../../services/ffmpegLimits';

interface ExportActionsDeps {
  scenes: Partial<Scene>[];
  captionStyle: CaptionStyle;
  useVeoAudio: boolean;
  duration: number;
  aspectRatio: '16:9' | '9:16' | '1:1' | '3:4';
  topic: string;
  mergedVideoUrl: string | null;
  isPresentationMode: boolean;
  setMerging: React.Dispatch<React.SetStateAction<boolean>>;
  setMergeProgress: React.Dispatch<React.SetStateAction<string>>;
  setMergePercent: React.Dispatch<React.SetStateAction<number>>;
  setMergedVideoUrl: React.Dispatch<React.SetStateAction<string | null>>;
  setDownloadingAll: React.Dispatch<React.SetStateAction<boolean>>;
  trackBlobUrl: (url: string) => void;
  getDefaultPresentation: (idx: number) => PresentationConfig;
  limitsVersion?: number;
}

export const useExportActions = (deps: ExportActionsDeps) => {
  const {
    scenes,
    captionStyle,
    useVeoAudio,
    duration,
    aspectRatio,
    topic,
    mergedVideoUrl,
    isPresentationMode,
    setMerging,
    setMergeProgress,
    setMergePercent,
    setMergedVideoUrl,
    setDownloadingAll,
    trackBlobUrl,
    getDefaultPresentation,
  } = deps;

  const computeTotalDuration = (): number => {
    const fallbackPerScene = scenes.length > 0 ? (duration / scenes.length) || 6 : 6;
    const sum = scenes.reduce(
      (acc, s) => acc + (s.audio_duration || fallbackPerScene),
      0
    );
    return Math.max(sum, duration || 0);
  };

  const sceneDurations = (): number[] => {
    const fallbackPerScene = scenes.length > 0 ? (duration / scenes.length) || 6 : 6;
    return scenes.map(s => s.audio_duration || fallbackPerScene);
  };

  const buildAssessment = () =>
    evaluateExportLimits({
      totalDurationSec: computeTotalDuration(),
      sceneCount: scenes.length,
      resolution: getResolution(aspectRatio),
      hasCaptions: captionStyle.preset !== 'none',
      isPresentationMode,
    });

  const buildAutoSplitPlan = (): SafeChunkPlan =>
    planSafeExportChunks({
      durations: sceneDurations(),
      resolution: getResolution(aspectRatio),
      hasCaptions: captionStyle.preset !== 'none',
      isPresentationMode,
    });

  const downloadVideo = async (url: string, filename: string) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch (e) {
      console.error('Download failed:', e);
      window.open(url, '_blank');
    }
  };

  const handleDownloadAll = async () => {
    setDownloadingAll(true);
    for (let i = 0; i < scenes.length; i++) {
      const s = scenes[i];
      if (s.video_path) {
        await downloadVideo(s.video_path, `scene_${i + 1}.mp4`);
        if (i < scenes.length - 1) await new Promise(r => setTimeout(r, 500));
      }
    }
    setDownloadingAll(false);
  };

  const handleMergeExport = async () => {
    const assessment = buildAssessment();
    if (assessment.level === 'block') {
      const msg = `${assessment.summary} ${assessment.reasons[0] || ''}`.trim();
      console.warn('[Merge] Blocked by limits:', assessment);
      setMergeProgress(msg);
      setMergePercent(0);
      setMerging(false);
      return;
    }
    setMerging(true);
    setMergeProgress('FFmpeg 로딩 중...');
    setMergePercent(0);
    setMergedVideoUrl(null);
    try {
      const captionsEnabled = captionStyle.preset !== 'none';
      const inputs: MergeInput[] = scenes.map(s => {
        const dur = s.audio_duration || duration / Math.max(1, scenes.length) || 6;
        const text = (s.audio_script || s.script_segment || '').trim();
        const captionWords =
          captionsEnabled && text
            ? alignWordsToDuration(text, dur, captionStyle.enableEmoji)
            : undefined;
        return {
          videoUrl: s.video_path || '',
          audioUrl: useVeoAudio ? undefined : s.audio_path || undefined,
          captionWords,
          captionDurationSec: dur,
        };
      });
      const blob = await mergeAllScenes(
        inputs,
        (stage, pct) => {
          setMergeProgress(stage);
          setMergePercent(pct);
        },
        captionsEnabled ? captionStyle : undefined,
        aspectRatio
      );
      const url = URL.createObjectURL(blob);
      trackBlobUrl(url);
      setMergedVideoUrl(url);
    } catch (err: any) {
      console.error('[Merge] Failed:', err);
      const friendly = isMemoryRelatedError(err) ? FRIENDLY_OOM_MESSAGE : (err?.message || '합치기 실패');
      setMergeProgress(`오류: ${friendly}`);
    } finally {
      setMerging(false);
    }
  };

  const handleDownloadMerged = async () => {
    if (!mergedVideoUrl) return;
    const a = document.createElement('a');
    a.href = mergedVideoUrl;
    a.download = `${topic || 'video'}_final.mp4`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleRenderPresentation = async () => {
    const assessment = buildAssessment();
    if (assessment.level === 'block') {
      const msg = `${assessment.summary} ${assessment.reasons[0] || ''}`.trim();
      console.warn('[Presentation Render] Blocked by limits:', assessment);
      setMergeProgress(msg);
      setMergePercent(0);
      setMerging(false);
      return;
    }
    setMerging(true);
    setMergeProgress('프레젠테이션 비디오 렌더링 준비 중...');
    setMergePercent(0);
    setMergedVideoUrl(null);
    try {
      const captionsEnabled = captionStyle.preset !== 'none';
      const inputs: PresentationSceneInput[] = scenes.map((s, i) => {
        const pres = s.presentation || getDefaultPresentation(i);
        const dur = s.audio_duration || duration / scenes.length || 6;
        const text = (s.audio_script || s.script_segment || '').trim();
        const captionWords =
          captionsEnabled && text
            ? alignWordsToDuration(text, dur, captionStyle.enableEmoji)
            : undefined;
        return {
          imageUrl: s.image_path || '',
          audioUrl: s.audio_path || undefined,
          duration: dur,
          transition: pres.transition,
          transitionDuration: pres.transitionDuration,
          motion: pres.motion,
          textOverlay: pres.textOverlay,
          captionWords,
        };
      });
      const blob = await renderPresentationVideo(
        inputs,
        aspectRatio,
        (stage, pct) => {
          setMergeProgress(stage);
          setMergePercent(pct);
        },
        captionsEnabled ? captionStyle : undefined
      );
      const url = URL.createObjectURL(blob);
      trackBlobUrl(url);
      setMergedVideoUrl(url);
    } catch (err: any) {
      console.error('[Presentation Render] Failed:', err);
      const friendly = isMemoryRelatedError(err) ? FRIENDLY_OOM_MESSAGE : (err?.message || '렌더링 실패');
      setMergeProgress(`오류: ${friendly}`);
    } finally {
      setMerging(false);
    }
  };

  const handleAutoSplitExport = async () => {
    const allDurations = sceneDurations();
    const eligibleIdx = scenes
      .map((s, i) => ({ s, i }))
      .filter(({ s }) =>
        isPresentationMode ? !!s.image_path : !!s.video_path
      )
      .map(({ i }) => i);

    if (eligibleIdx.length === 0) {
      setMergeProgress('내보낼 수 있는 씬이 없습니다.');
      return;
    }

    const eligibleDurations = eligibleIdx.map(i => allDurations[i]);
    const subPlan = planSafeExportChunks({
      durations: eligibleDurations,
      resolution: getResolution(aspectRatio),
      hasCaptions: captionStyle.preset !== 'none',
      isPresentationMode,
    });
    const chunks = subPlan.chunks.map(group => group.map(j => eligibleIdx[j]));
    if (chunks.length === 0) {
      setMergeProgress('내보낼 씬이 없습니다.');
      return;
    }

    const captionsEnabled = captionStyle.preset !== 'none';
    const durations = allDurations;

    setMerging(true);
    setMergedVideoUrl(null);
    setMergeProgress(`${chunks.length}개 파트로 나눠 내보내는 중...`);
    setMergePercent(0);

    try {
      let lastUrl: string | null = null;

      for (let ci = 0; ci < chunks.length; ci++) {
        const indices = chunks[ci];
        const partLabel = `Part ${ci + 1}/${chunks.length}`;

        const reportProgress = (stage: string, pct: number) => {
          setMergeProgress(`${partLabel} · ${stage}`);
          const base = (ci / chunks.length) * 100;
          const span = 100 / chunks.length;
          setMergePercent(Math.min(99, Math.round(base + (pct * span) / 100)));
        };

        let blob: Blob;

        if (isPresentationMode) {
          const inputs: PresentationSceneInput[] = indices.map(i => {
            const s = scenes[i];
            const pres = s.presentation || getDefaultPresentation(i);
            const dur = durations[i];
            const text = (s.audio_script || s.script_segment || '').trim();
            const captionWords =
              captionsEnabled && text
                ? alignWordsToDuration(text, dur, captionStyle.enableEmoji)
                : undefined;
            return {
              imageUrl: s.image_path || '',
              audioUrl: s.audio_path || undefined,
              duration: dur,
              transition: pres.transition,
              transitionDuration: pres.transitionDuration,
              motion: pres.motion,
              textOverlay: pres.textOverlay,
              captionWords,
            };
          });
          blob = await renderPresentationVideo(
            inputs,
            aspectRatio,
            reportProgress,
            captionsEnabled ? captionStyle : undefined
          );
        } else {
          const inputs: MergeInput[] = indices.map(i => {
            const s = scenes[i];
            const dur = durations[i];
            const text = (s.audio_script || s.script_segment || '').trim();
            const captionWords =
              captionsEnabled && text
                ? alignWordsToDuration(text, dur, captionStyle.enableEmoji)
                : undefined;
            return {
              videoUrl: s.video_path || '',
              audioUrl: useVeoAudio ? undefined : s.audio_path || undefined,
              captionWords,
              captionDurationSec: dur,
            };
          });
          blob = await mergeAllScenes(
            inputs,
            reportProgress,
            captionsEnabled ? captionStyle : undefined,
            aspectRatio
          );
        }

        const url = URL.createObjectURL(blob);
        trackBlobUrl(url);
        lastUrl = url;

        const safeTopic = (topic || 'video').replace(/[\\/:*?"<>|]+/g, '_');
        await downloadVideo(url, `${safeTopic}_part_${ci + 1}.mp4`);

        if (ci < chunks.length - 1) {
          await new Promise(r => setTimeout(r, 600));
        }
      }

      if (lastUrl) setMergedVideoUrl(lastUrl);
      setMergePercent(100);
      setMergeProgress(`${chunks.length}개 파트 내보내기 완료`);
    } catch (err: any) {
      console.error('[Auto Split Export] Failed:', err);
      const friendly = isMemoryRelatedError(err)
        ? FRIENDLY_OOM_MESSAGE
        : (err?.message || '자동 분할 내보내기 실패');
      setMergeProgress(`오류: ${friendly}`);
    } finally {
      setMerging(false);
    }
  };

  return {
    downloadVideo,
    handleDownloadAll,
    handleMergeExport,
    handleDownloadMerged,
    handleRenderPresentation,
    handleAutoSplitExport,
    exportRiskAssessment: buildAssessment(),
    autoSplitPlan: buildAutoSplitPlan(),
  };
};
