import React from 'react';
import { Scene, AIModel, StyleSheet, ProjectStats } from '../../../types';
import { generateSceneVideo } from '../../../services/geminiService';
import { uploadFileToCloud } from '../../../services/storageService';
import { saveMedia } from '../../../services/mediaCache';
import { jobManager, JobState } from '../../../services/jobManager';
import { isMediaUploaded, hasMedia } from './wizardHelpers';

interface VideoActionsDeps {
  userId: string;
  projectId: string;
  topic: string;
  aspectRatio: '16:9' | '9:16' | '1:1' | '3:4';
  scenes: Partial<Scene>[];
  failedScenes: Map<string, string>;
  allModels: AIModel[];
  selectedVideoModel: string;
  characterProfile: string;
  styleSheet: StyleSheet | undefined;
  negativePrompt: string;
  characterReferenceImage: string | undefined;
  linkedContextPackId?: string;
  linkedContextPackName?: string;
  setProcessingType: React.Dispatch<React.SetStateAction<'audio' | 'image' | 'video' | null>>;
  setProcessingSet: React.Dispatch<React.SetStateAction<Set<number>>>;
  setFailedScenes: React.Dispatch<React.SetStateAction<Map<string, string>>>;
  setLoadingMessage: React.Dispatch<React.SetStateAction<string>>;
  updateSceneAt: (idx: number, updates: Partial<Scene>) => void;
  addStats: (delta: Partial<ProjectStats>) => void;
  trackBlobUrl: (url: string) => void;
  sync: (
    targetStep?: number,
    scenesOverride?: Partial<Scene>[],
    extraData?: any,
    overrides?: any
  ) => void;
}

export const useVideoActions = (deps: VideoActionsDeps) => {
  const {
    userId,
    projectId,
    topic,
    aspectRatio,
    scenes,
    failedScenes,
    allModels,
    selectedVideoModel,
    characterProfile,
    styleSheet,
    negativePrompt,
    characterReferenceImage,
    linkedContextPackId,
    linkedContextPackName,
    setProcessingType,
    setProcessingSet,
    setFailedScenes,
    setLoadingMessage,
    updateSceneAt,
    addStats,
    trackBlobUrl,
    sync,
  } = deps;

  const fetchVideoAsBlob = async (
    videoUrl: string,
    sceneIdx: number
  ): Promise<{ blobUrl: string; blob: Blob }> => {
    const resp = await fetch(videoUrl);
    if (!resp.ok) throw new Error(`Video fetch failed: ${resp.status}`);
    const blob = await resp.blob();
    const blobUrl = URL.createObjectURL(blob);
    trackBlobUrl(blobUrl);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
      await saveMedia(projectId, sceneIdx, 'video', dataUrl);
      console.log(
        `[Video Cache] Scene ${sceneIdx} saved to IndexedDB (${Math.round(dataUrl.length / 1024)}KB)`
      );
    } catch (cacheErr) {
      console.warn(`[Video Cache] Scene ${sceneIdx} IndexedDB save failed:`, cacheErr);
    }
    return { blobUrl, blob };
  };

  /**
   * Enqueue video generation for every scene that doesn't yet have an
   * uploaded video. Work is delegated to the global JobManager so it
   * survives wizard unmount and shares the per-model rate budget across
   * concurrent projects. The returned promise resolves when
   * the queued job reaches a terminal state.
   */
  const handleBatchVideos = async (): Promise<void> => {
    setProcessingType('video');
    const sceneSnapshot = [...scenes];
    const vidModel = allModels.find(m => m.id === selectedVideoModel);

    // Separate the work into:
    //   1) blob-only re-uploads (cheap, do inline — no Veo call needed)
    //   2) actual generations → JobManager
    const reuploadIdxs: number[] = [];
    const genIdxs: number[] = [];
    sceneSnapshot.forEach((s, i) => {
      if (isMediaUploaded(s.video_path)) return;
      if (hasMedia(s.video_path) && s.video_path?.startsWith('blob:')) {
        reuploadIdxs.push(i);
      } else {
        genIdxs.push(i);
      }
    });

    // Inline re-uploads.
    for (const idx of reuploadIdxs) {
      const s = sceneSnapshot[idx];
      try {
        const blob = await fetch(s.video_path!).then(r => r.blob());
        const url = await uploadFileToCloud(
          `users/${userId}/projects/${projectId}/videos/s${idx}.mp4`,
          blob,
          'blob'
        );
        updateSceneAt(idx, { video_path: url });
      } catch (e) {
        console.warn(`[Video Upload] Scene ${idx} re-upload failed:`, e);
      }
    }

    if (genIdxs.length === 0) {
      setProcessingType(null);
      sync();
      return;
    }

    const vidModelName = vidModel?.name || '';
    setLoadingMessage(
      `비디오 생성 큐에 등록되었습니다 — Studio Dock에서 진행 상황을 확인하세요. (${vidModelName} | ${genIdxs.length}개 씬)`
    );

    const jobId = jobManager.enqueueVideoBatch({
      projectId,
      projectTitle: topic || '제목 없음',
      userId,
      scenes: sceneSnapshot,
      aspectRatio,
      model: vidModel,
      characterProfile: characterProfile || undefined,
      styleSheet,
      negativePrompt: negativePrompt || undefined,
      characterReferenceImage,
      contextPackId: linkedContextPackId,
      contextPackName: linkedContextPackName,
      onlyIndices: genIdxs,
      onSceneUpdate: (idx, updates) => {
        if (updates.video_path && updates.video_path.startsWith('blob:')) {
          trackBlobUrl(updates.video_path);
        }
        updateSceneAt(idx, updates);
        setFailedScenes(prev => {
          const n = new Map(prev);
          n.delete(`video-${idx}`);
          return n;
        });
        // Persist to the user's wizard sync after each scene.
        sync();
      },
      onStatsDelta: delta => addStats(delta),
    });

    // Wait for the job to finish so the wizard's loading state matches the
    // dock's, then surface a summary alert. Aborting the wait if the user
    // navigates away is fine — the unmount cleanup just stops listening,
    // the manager keeps running.
    await new Promise<void>(resolve => {
      const unsub = jobManager.subscribe(jobs => {
        const j = jobs.find(x => x.id === jobId);
        if (!j) return;
        // Mirror per-scene processing/failed badges.
        const procSet = new Set<number>();
        j.scenes.forEach(s => {
          if (s.status === 'running') procSet.add(s.idx);
        });
        setProcessingSet(procSet);
        const failedMap = new Map<string, string>();
        j.scenes.forEach(s => {
          if (s.status === 'failed' && s.error)
            failedMap.set(`video-${s.idx}`, s.error);
        });
        setFailedScenes(prev => {
          const next = new Map(prev);
          // Only sync video-* entries; leave audio/image alone.
          for (const k of Array.from(next.keys())) {
            if (k.startsWith('video-')) next.delete(k);
          }
          failedMap.forEach((v, k) => next.set(k, v));
          return next;
        });
        if (
          j.status === 'completed' ||
          j.status === 'failed' ||
          j.status === 'cancelled'
        ) {
          unsub();
          resolve();
        }
      });
    });

    const finalJob = jobManager.getJob(jobId);
    setProcessingSet(new Set());
    setProcessingType(null);
    setLoadingMessage('');
    sync();
    if (finalJob && finalJob.failed > 0) {
      alert(
        `비디오 생성 실패 (${finalJob.failed}/${finalJob.total}개 씬)\n실패한 씬 옆 '재시도' 버튼으로 개별 재생성할 수 있습니다.`
      );
    }
  };

  const handleSingleVideo = async (idx: number) => {
    setProcessingType('video');
    setProcessingSet(new Set([idx]));
    setLoadingMessage(`비디오 생성 중... (씬 ${idx + 1}) — 최대 5분 소요`);
    const currentScene = scenes[idx];
    const fKey = `video-${idx}`;
    try {
      const vidModel = allModels.find(m => m.id === selectedVideoModel);
      const seedImage = currentScene.image_path;
      const prevContext = idx > 0 ? scenes[idx - 1]?.visual_prompt : undefined;
      const rateKey = vidModel?.modelId || vidModel?.id || 'default-video';
      await jobManager.acquireRateToken(rateKey);
      const videoResult = await generateSceneVideo(
        currentScene.visual_prompt!,
        seedImage,
        aspectRatio,
        vidModel?.modelId,
        vidModel?.provider,
        currentScene.script_segment || currentScene.audio_script,
        characterProfile || undefined,
        prevContext,
        idx,
        {
          scene: currentScene,
          styleSheet,
          negativePrompt: negativePrompt || currentScene.negativePrompt,
          referenceImage: characterReferenceImage,
          seedPreference: currentScene.videoSeedPreference,
        }
      );
      if (videoResult?.videoUrl) {
        addStats(videoResult.stats);
        const { blobUrl, blob } = await fetchVideoAsBlob(videoResult.videoUrl, idx);
        updateSceneAt(idx, {
          video_path: blobUrl,
          seedSource: videoResult.seedSource,
          videoCast: videoResult.videoCast,
          videoCastAttached: videoResult.videoCastAttached,
          videoSeedPreferenceUsed: currentScene.videoSeedPreference || 'scene-image',
        });
        console.log(
          `[Single Video] Scene ${idx + 1} generated successfully (model: ${vidModel?.modelId || 'default'}, seed: ${videoResult.seedSource}, cast: [${videoResult.videoCast.join(', ')}], attached: ${videoResult.videoCastAttached})`
        );
        try {
          const url = await uploadFileToCloud(
            `users/${userId}/projects/${projectId}/videos/s${idx}.mp4`,
            blob,
            'blob'
          );
          updateSceneAt(idx, { video_path: url });
        } catch (uploadErr) {
          console.warn(
            `[Video Upload] Scene ${idx} upload failed, keeping blob URL for preview`,
            uploadErr
          );
        }
        setFailedScenes(prev => {
          const n = new Map(prev);
          n.delete(fKey);
          return n;
        });
        sync();
      }
    } catch (e: any) {
      const errMsg = e?.message || String(e);
      console.error(`[Single Video] Scene ${idx + 1} FAILED:`, errMsg);
      setFailedScenes(prev => new Map(prev).set(fKey, errMsg));
    }
    setProcessingSet(new Set());
    setProcessingType(null);
    setLoadingMessage('');
  };

  return { handleBatchVideos, handleSingleVideo };
};
