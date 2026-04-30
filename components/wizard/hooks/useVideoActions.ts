import React from 'react';
import { Scene, AIModel, StyleSheet, ProjectStats } from '../../../types';
import { generateSceneVideo } from '../../../services/geminiService';
import { uploadFileToCloud } from '../../../services/storageService';
import { saveMedia } from '../../../services/mediaCache';
import { isMediaUploaded, hasMedia } from './wizardHelpers';

interface VideoActionsDeps {
  userId: string;
  projectId: string;
  aspectRatio: '16:9' | '9:16' | '1:1' | '3:4';
  scenes: Partial<Scene>[];
  failedScenes: Map<string, string>;
  allModels: AIModel[];
  selectedVideoModel: string;
  characterProfile: string;
  styleSheet: StyleSheet | undefined;
  negativePrompt: string;
  characterReferenceImage: string | undefined;
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
    aspectRatio,
    scenes,
    failedScenes,
    allModels,
    selectedVideoModel,
    characterProfile,
    styleSheet,
    negativePrompt,
    characterReferenceImage,
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

  const handleBatchVideos = async () => {
    setProcessingType('video');
    const sceneSnapshot = [...scenes];
    const newFailed = new Map(failedScenes);

    const tasks = sceneSnapshot
      .map((s, i) => ({ idx: i, s }))
      .filter(({ s }) => !isMediaUploaded(s.video_path))
      .map(({ idx, s }) => ({
        idx,
        fn: async () => {
          if (
            hasMedia(s.video_path) &&
            !isMediaUploaded(s.video_path) &&
            s.video_path?.startsWith('blob:')
          ) {
            try {
              const blob = await fetch(s.video_path!).then(r => r.blob());
              const url = await uploadFileToCloud(
                `users/${userId}/projects/${projectId}/videos/s${idx}.mp4`,
                blob,
                'blob'
              );
              updateSceneAt(idx, { video_path: url });
            } catch (uploadErr) {
              console.warn(
                `[Video Upload] Scene ${idx} re-upload failed, keeping blob URL`,
                uploadErr
              );
            }
            return;
          }
          const vidModel = allModels.find(m => m.id === selectedVideoModel);
          const seedImage = s.image_path;
          const prevContext = idx > 0 ? sceneSnapshot[idx - 1]?.visual_prompt : undefined;
          const videoResult = await generateSceneVideo(
            s.visual_prompt!,
            seedImage,
            aspectRatio,
            vidModel?.modelId,
            vidModel?.provider,
            s.script_segment || s.audio_script,
            characterProfile || undefined,
            prevContext,
            idx,
            {
              scene: s,
              styleSheet,
              negativePrompt: negativePrompt || s.negativePrompt,
              referenceImage: characterReferenceImage,
              seedPreference: s.videoSeedPreference,
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
              videoSeedPreferenceUsed: s.videoSeedPreference || 'scene-image',
            });
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
          }
        },
      }));

    if (tasks.length === 0) {
      setProcessingType(null);
      return;
    }

    const results: { idx: number; error?: any }[] = [];
    for (let ti = 0; ti < tasks.length; ti++) {
      const task = tasks[ti];
      setProcessingSet(new Set([task.idx]));
      if (ti > 0) {
        const waitSec = 60;
        for (let w = waitSec; w > 0; w--) {
          setLoadingMessage(
            `다음 씬 대기 중... ${w}초 (${ti + 1}/${tasks.length}개 씬, API 속도 제한 방지)`
          );
          await new Promise(r => setTimeout(r, 1000));
        }
      }
      const vidModelName = allModels.find(m => m.id === selectedVideoModel)?.name || '';
      setLoadingMessage(
        `비디오 생성 중... (${vidModelName} | ${ti + 1}/${tasks.length}개 씬) — 최대 5분 소요`
      );
      try {
        await task.fn();
        results.push({ idx: task.idx });
        newFailed.delete(`video-${task.idx}`);
        sync();
        console.log(`[Batch Video] Scene ${task.idx + 1} completed successfully`);
      } catch (error: any) {
        const errMsg = error?.message || String(error);
        console.error(`[Batch Video] Scene ${task.idx + 1} FAILED:`, errMsg);
        results.push({ idx: task.idx, error });
        newFailed.set(`video-${task.idx}`, errMsg);
      }
      setProcessingSet(new Set());
    }

    const errors = results.filter(r => r.error);
    setFailedScenes(newFailed);
    setProcessingSet(new Set());
    setProcessingType(null);
    setLoadingMessage('');
    sync();
    if (errors.length > 0)
      alert(
        `비디오 생성 실패 (${errors.length}/${tasks.length}개 씬)\n실패한 씬 옆 '재시도' 버튼으로 개별 재생성할 수 있습니다.`
      );
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
