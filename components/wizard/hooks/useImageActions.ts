import React from 'react';
import { Scene, AIModel, StyleSheet, ProjectStats, CharacterReference } from '../../../types';
import { generateSceneImage } from '../../../services/geminiService';
import { uploadFileToCloud } from '../../../services/storageService';
import { saveMedia } from '../../../services/mediaCache';
import {
  CONCURRENCY,
  getGenerationErrorMessage,
  hasMedia,
  isMediaUploaded,
  runParallel,
  summarizeGenerationErrors,
  tryUploadExisting,
} from './wizardHelpers';

interface ImageActionsDeps {
  userId: string;
  projectId: string;
  videoStyle: string;
  aspectRatio: '16:9' | '9:16' | '1:1' | '3:4';
  scenes: Partial<Scene>[];
  failedScenes: Map<string, string>;
  allModels: AIModel[];
  selectedImageModel: string;
  characterProfile: string;
  styleSheet: StyleSheet | undefined;
  negativePrompt: string;
  visionCriticEnabled: boolean;
  qualityThreshold: number;
  characterReferenceImage: string | undefined;
  setProcessingType: React.Dispatch<React.SetStateAction<'audio' | 'image' | 'video' | null>>;
  setProcessingSet: React.Dispatch<React.SetStateAction<Set<number>>>;
  setFailedScenes: React.Dispatch<React.SetStateAction<Map<string, string>>>;
  setLoadingMessage: React.Dispatch<React.SetStateAction<string>>;
  setThumbnail: React.Dispatch<React.SetStateAction<string | undefined>>;
  updateSceneAt: (idx: number, updates: Partial<Scene>) => void;
  addStats: (delta: Partial<ProjectStats>) => void;
  referenceImagesForScene: (
    s: Partial<Scene>
  ) => { name?: string; description?: string; image: string }[];
  sync: (
    targetStep?: number,
    scenesOverride?: Partial<Scene>[],
    extraData?: any,
    overrides?: any
  ) => void;
}

export const useImageActions = (deps: ImageActionsDeps) => {
  const {
    userId,
    projectId,
    videoStyle,
    aspectRatio,
    scenes,
    failedScenes,
    allModels,
    selectedImageModel,
    characterProfile,
    styleSheet,
    negativePrompt,
    visionCriticEnabled,
    qualityThreshold,
    characterReferenceImage,
    setProcessingType,
    setProcessingSet,
    setFailedScenes,
    setLoadingMessage,
    setThumbnail,
    updateSceneAt,
    addStats,
    referenceImagesForScene,
    sync,
  } = deps;

  const handleBatchImages = async () => {
    setProcessingType('image');
    const sceneSnapshot = [...scenes];

    const tasks = sceneSnapshot
      .map((s, i) => ({ idx: i, s }))
      .filter(({ s }) => !isMediaUploaded(s.image_path))
      .map(({ idx, s }) => ({
        idx,
        fn: async () => {
          if (hasMedia(s.image_path)) {
            const url = await tryUploadExisting(
              s.image_path!,
              `users/${userId}/projects/${projectId}/images/s${idx}.jpg`,
              'base64'
            );
            updateSceneAt(idx, { image_path: url });
            if (idx === 0 && url.startsWith('http')) setThumbnail(url);
            return;
          }
          const imgModel = allModels.find(m => m.id === selectedImageModel);
          const result = await generateSceneImage(
            s.visual_prompt!,
            videoStyle,
            aspectRatio,
            imgModel?.modelId,
            imgModel?.provider,
            characterProfile || undefined,
            {
              scene: s,
              styleSheet,
              negativePrompt: negativePrompt || s.negativePrompt,
              visionCritic: visionCriticEnabled,
              qualityThreshold,
              referenceImage: characterReferenceImage,
              referenceImages: referenceImagesForScene(s),
            }
          );
          if (result) {
            addStats(result.stats);
            const previewUrl = `data:${result.mimeType};base64,${result.base64}`;
            updateSceneAt(idx, { image_path: previewUrl, qualityScore: result.qualityScore });
            saveMedia(projectId, idx, 'image', previewUrl);
            const ext = result.mimeType.includes('png') ? 'png' : 'jpg';
            const url = await uploadFileToCloud(
              `users/${userId}/projects/${projectId}/images/s${idx}.${ext}`,
              result.base64,
              'base64'
            );
            updateSceneAt(idx, { image_path: url });
            if (idx === 0) setThumbnail(url);
          }
        },
      }));

    if (tasks.length === 0) {
      setProcessingType(null);
      return;
    }
    const imgModelName = allModels.find(m => m.id === selectedImageModel)?.name || '';
    setLoadingMessage(
      `이미지 생성 중... (${imgModelName} | ${tasks.length}개 씬, 최대 ${CONCURRENCY}개 동시 처리)`
    );

    const results = await runParallel(
      tasks,
      CONCURRENCY,
      idx => setProcessingSet(prev => new Set(prev).add(idx)),
      (idx, error) => {
        setProcessingSet(prev => {
          const n = new Set(prev);
          n.delete(idx);
          return n;
        });
        // Surface per-scene status as soon as it settles so live progress UIs
        // (Quick mode grid) can show failed scenes mid-batch.
        setFailedScenes(prev => {
          const n = new Map(prev);
          if (error) n.set(`image-${idx}`, getGenerationErrorMessage(error));
          else n.delete(`image-${idx}`);
          return n;
        });
      }
    );

    const errors = results.filter(r => r.error);
    setProcessingSet(new Set());
    setProcessingType(null);
    setLoadingMessage('');
    sync();
    if (errors.length > 0) {
      const errorDetails = summarizeGenerationErrors(errors.map(({ error }) => error));
      alert(
        `이미지 생성 실패 (${errors.length}/${tasks.length}개 씬)${
          errorDetails.length > 0 ? `\n\n오류 내용:\n${errorDetails.join('\n')}` : ''
        }\n\n실패한 씬 옆 '재시도' 버튼으로 개별 재생성할 수 있습니다.`
      );
    }
  };

  const handleRefineImage = async (idx: number) => {
    const currentScene = scenes[idx];
    const qs = currentScene?.qualityScore;
    const issues =
      qs?.issues && qs.issues.length > 0
        ? qs.issues.join('; ')
        : 'composition or character consistency';
    const hint = qs
      ? `Previous attempt scored ${qs.overall}/10 (character ${qs.characterConsistency}, composition ${qs.compositionQuality}, intent ${qs.intentAlignment}). Fix these issues: ${issues}. Strictly preserve the requested character and style sheet.`
      : `Refine the image: improve composition, character consistency, and intent alignment.`;

    setProcessingType('image');
    setProcessingSet(new Set([idx]));
    const fKey = `image-${idx}`;
    try {
      const imgModel = allModels.find(m => m.id === selectedImageModel);
      const result = await generateSceneImage(
        currentScene.visual_prompt!,
        videoStyle,
        aspectRatio,
        imgModel?.modelId,
        imgModel?.provider,
        characterProfile || undefined,
        {
          scene: currentScene,
          styleSheet,
          negativePrompt: negativePrompt || currentScene.negativePrompt,
          visionCritic: visionCriticEnabled,
          qualityThreshold,
          extraHint: hint,
          referenceImage: characterReferenceImage,
          referenceImages: referenceImagesForScene(currentScene),
        }
      );
      if (result) {
        addStats(result.stats);
        const previewUrl = `data:${result.mimeType};base64,${result.base64}`;
        updateSceneAt(idx, { image_path: previewUrl, qualityScore: result.qualityScore });
        saveMedia(projectId, idx, 'image', previewUrl);
        const ext = result.mimeType.includes('png') ? 'png' : 'jpg';
        const url = await uploadFileToCloud(
          `users/${userId}/projects/${projectId}/images/s${idx}.${ext}`,
          result.base64,
          'base64'
        );
        updateSceneAt(idx, { image_path: url });
        if (idx === 0) setThumbnail(url);
        setFailedScenes(prev => {
          const n = new Map(prev);
          n.delete(fKey);
          return n;
        });
        sync();
      }
    } catch (e: any) {
      console.error(e);
      setFailedScenes(prev => new Map(prev).set(fKey, getGenerationErrorMessage(e)));
    }
    setProcessingSet(new Set());
    setProcessingType(null);
  };

  const handleSingleImage = async (idx: number) => {
    setProcessingType('image');
    setProcessingSet(new Set([idx]));
    const currentScene = scenes[idx];
    const fKey = `image-${idx}`;
    try {
      if (hasMedia(currentScene.image_path) && !isMediaUploaded(currentScene.image_path)) {
        const url = await tryUploadExisting(
          currentScene.image_path!,
          `users/${userId}/projects/${projectId}/images/s${idx}.jpg`,
          'base64'
        );
        updateSceneAt(idx, { image_path: url });
        if (idx === 0) setThumbnail(url);
        setFailedScenes(prev => {
          const n = new Map(prev);
          n.delete(fKey);
          return n;
        });
        setProcessingSet(new Set());
        setProcessingType(null);
        return;
      }
      const imgModel = allModels.find(m => m.id === selectedImageModel);
      const result = await generateSceneImage(
        currentScene.visual_prompt!,
        videoStyle,
        aspectRatio,
        imgModel?.modelId,
        imgModel?.provider,
        characterProfile || undefined,
        {
          scene: currentScene,
          styleSheet,
          negativePrompt: negativePrompt || currentScene.negativePrompt,
          visionCritic: visionCriticEnabled,
          qualityThreshold,
          referenceImage: characterReferenceImage,
          referenceImages: referenceImagesForScene(currentScene),
        }
      );
      if (result) {
        addStats(result.stats);
        const previewUrl = `data:${result.mimeType};base64,${result.base64}`;
        updateSceneAt(idx, { image_path: previewUrl, qualityScore: result.qualityScore });
        saveMedia(projectId, idx, 'image', previewUrl);
        const ext = result.mimeType.includes('png') ? 'png' : 'jpg';
        const url = await uploadFileToCloud(
          `users/${userId}/projects/${projectId}/images/s${idx}.${ext}`,
          result.base64,
          'base64'
        );
        updateSceneAt(idx, { image_path: url });
        if (idx === 0) setThumbnail(url);
        setFailedScenes(prev => {
          const n = new Map(prev);
          n.delete(fKey);
          return n;
        });
        sync();
      }
    } catch (e: any) {
      console.error(e);
      setFailedScenes(prev => new Map(prev).set(fKey, getGenerationErrorMessage(e)));
    }
    setProcessingSet(new Set());
    setProcessingType(null);
  };

  return { handleBatchImages, handleRefineImage, handleSingleImage };
};
