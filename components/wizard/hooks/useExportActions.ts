import React from 'react';
import { Scene, PresentationConfig, CaptionStyle } from '../../../types';
import {
  mergeAllScenes,
  MergeInput,
  renderPresentationVideo,
  PresentationSceneInput,
  getResolution,
  terminateFFmpegForCleanup,
  concatMp4Parts,
  FFmpegLoadTimeoutError,
} from '../../../services/videoMergeService';
import { isLongFormDuration } from '../../../services/chapterService';
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

export const FFMPEG_LOAD_FAILURE_MESSAGE =
  'FFmpeg 로딩에 실패했습니다. 새로고침 후 다시 시도해 주세요.';

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

  const lastFailedFFmpegLoadActionRef = React.useRef<(() => Promise<void>) | null>(null);
  const [canRetryFFmpegLoad, setCanRetryFFmpegLoad] = React.useState(false);

  const clearFFmpegLoadRetry = () => {
    lastFailedFFmpegLoadActionRef.current = null;
    setCanRetryFFmpegLoad(false);
  };

  const markFFmpegLoadFailure = (action: () => Promise<void>) => {
    lastFailedFFmpegLoadActionRef.current = action;
    setCanRetryFFmpegLoad(true);
  };

  const retryFFmpegLoad = async () => {
    const action = lastFailedFFmpegLoadActionRef.current;
    if (!action) return;
    await action();
  };

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
    clearFFmpegLoadRetry();
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
      const friendly = err instanceof FFmpegLoadTimeoutError
        ? FFMPEG_LOAD_FAILURE_MESSAGE
        : isMemoryRelatedError(err) ? FRIENDLY_OOM_MESSAGE : (err?.message || '합치기 실패');
      setMergeProgress(`오류: ${friendly}`);
      setMergePercent(0);
      if (err instanceof FFmpegLoadTimeoutError) {
        markFFmpegLoadFailure(handleMergeExport);
      }
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

    // Task #99: long-form mode keeps part blobs in memory and stitches
    // them into a single MP4 at the end (with per-part download fallback
    // on OOM). Short-form auto-split keeps the legacy per-part-download UX.
    const longForm = isLongFormDuration(duration) || chunks.length >= 4;

    setMerging(true);
    setMergedVideoUrl(null);
    setMergeProgress(
      longForm
        ? `Long-form 렌더 시작 · ${chunks.length}개 파트`
        : `${chunks.length}개 파트로 나눠 내보내는 중...`
    );
    setMergePercent(0);
    clearFFmpegLoadRetry();

    const renderedParts: Blob[] = [];
    const safeTopic = (topic || 'video').replace(/[\\/:*?"<>|]+/g, '_');

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
        renderedParts.push(blob);

        if (!longForm) {
          // Legacy short-form path: download each part right away so the
          // user gets feedback without waiting for the full set.
          await downloadVideo(url, `${safeTopic}_part_${ci + 1}.mp4`);
        } else {
          setMergeProgress(
            `Part ${ci + 1}/${chunks.length} 렌더 완료 · 메모리 정리 중...`
          );
          // Long-form: tear down the FFmpeg.wasm singleton between chunks
          // so each chapter starts from a clean WASM heap (avoids the 2GB
          // ceiling on 10-min projects). Subsequent calls lazy-reload core.
          try { await terminateFFmpegForCleanup(); } catch {}
        }

        if (ci < chunks.length - 1) {
          await new Promise(r => setTimeout(r, 600));
        }
      }

      if (longForm && renderedParts.length > 1) {
        // Final concat pass: stitch all rendered parts into a single
        // 10-min MP4. Falls back to per-part downloads on FFmpeg failure
        // (typically OOM on very memory-constrained devices).
        setMergeProgress('최종 결합 중... (한 편의 영상으로 합치는 중)');
        setMergePercent(95);
        try {
          try { await terminateFFmpegForCleanup(); } catch {}
          const finalBlob = await concatMp4Parts(renderedParts, (stage, pct) => {
            setMergeProgress(`최종 결합 · ${stage}`);
            // Map 0-100 of the final concat into the last 5% of overall progress.
            setMergePercent(Math.min(99, 95 + Math.round(pct / 20)));
          });
          const finalUrl = URL.createObjectURL(finalBlob);
          trackBlobUrl(finalUrl);
          setMergedVideoUrl(finalUrl);
          setMergePercent(100);
          setMergeProgress(`Long-form 영상 완성 · ${chunks.length}개 파트 결합`);
        } catch (concatErr: any) {
          console.warn(
            '[Long-form Export] Final concat failed, falling back to per-part downloads:',
            concatErr
          );
          for (let pi = 0; pi < renderedParts.length; pi++) {
            const partUrl = URL.createObjectURL(renderedParts[pi]);
            trackBlobUrl(partUrl);
            await downloadVideo(partUrl, `${safeTopic}_part_${pi + 1}.mp4`);
            if (pi < renderedParts.length - 1) {
              await new Promise(r => setTimeout(r, 400));
            }
          }
          if (lastUrl) setMergedVideoUrl(lastUrl);
          setMergePercent(100);
          setMergeProgress(
            `최종 결합 실패 — ${renderedParts.length}개 파트로 개별 다운로드했습니다.`
          );
        }
      } else {
        if (lastUrl) setMergedVideoUrl(lastUrl);
        setMergePercent(100);
        setMergeProgress(`${chunks.length}개 파트 내보내기 완료`);
      }
    } catch (err: any) {
      console.error('[Auto Split Export] Failed:', err);
      const friendly = err instanceof FFmpegLoadTimeoutError
        ? FFMPEG_LOAD_FAILURE_MESSAGE
        : isMemoryRelatedError(err)
          ? FRIENDLY_OOM_MESSAGE
          : (err?.message || '자동 분할 내보내기 실패');
      setMergeProgress(`오류: ${friendly}`);
      setMergePercent(0);
      if (err instanceof FFmpegLoadTimeoutError) {
        markFFmpegLoadFailure(handleAutoSplitExport);
      }
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
    canRetryFFmpegLoad,
    retryFFmpegLoad,
  };
};
