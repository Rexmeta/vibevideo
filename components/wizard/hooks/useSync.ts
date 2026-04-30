import React, { useEffect, useRef } from 'react';
import {
  Project,
  ProjectStatus,
  Scene,
  ProjectStats,
  CharacterReference,
  CaptionStyle,
  GenreId,
  PlatformId,
  StyleSheet,
  VideoMode,
} from '../../../types';
import { saveProjectToCloud } from '../../../services/storageService';
import { saveProjectMeta } from '../../../services/mediaCache';
import type { WizardMode } from '../ModeGate';

export type SyncFn = (
  targetStep?: number,
  scenesOverride?: Partial<Scene>[],
  extraData?: Partial<Project>,
  overrides?: { script?: string; topic?: string; duration?: number; maxStep?: number }
) => void;

interface SyncDeps {
  userId: string;
  projectId: string;
  createdAt: string;
  aspectRatio: '16:9' | '9:16' | '1:1' | '3:4';
  videoStyle: string;
  duration: number;
  selectedImageModel: string;
  selectedVideoModel: string;
  useReferenceImage: boolean;
  sceneDurationMode: 'time' | 'scenes';
  targetSceneCount: number;
  useVeoAudio: boolean;
  videoMode: VideoMode;
  genre: GenreId | undefined;
  platform: PlatformId | undefined;
  styleSheet: StyleSheet | undefined;
  visionCriticEnabled: boolean;
  qualityThreshold: number;
  negativePrompt: string;
  captionStyle: CaptionStyle;
  scenesRef: React.MutableRefObject<Partial<Scene>[]>;
  stepRef: React.MutableRefObject<number>;
  maxStepRef: React.MutableRefObject<number>;
  topicRef: React.MutableRefObject<string>;
  scriptRef: React.MutableRefObject<string>;
  thumbnailRef: React.MutableRefObject<string | undefined>;
  characterProfileRef: React.MutableRefObject<string>;
  statsRef: React.MutableRefObject<ProjectStats>;
  characterReferenceImageRef: React.MutableRefObject<string | undefined>;
  characterReferencesRef: React.MutableRefObject<CharacterReference[]>;
  savedModeRef: React.MutableRefObject<WizardMode | null>;
  syncPendingRef: React.MutableRefObject<boolean>;
  blobUrlsRef: React.MutableRefObject<Set<string>>;
  syncCleanupRef: React.MutableRefObject<(() => void) | null>;
  setSyncing: React.Dispatch<React.SetStateAction<boolean>>;
  setSyncError: React.Dispatch<React.SetStateAction<boolean>>;
}

export const useSync = (deps: SyncDeps): SyncFn => {
  const {
    userId,
    projectId,
    createdAt,
    aspectRatio,
    videoStyle,
    duration,
    selectedImageModel,
    selectedVideoModel,
    useReferenceImage,
    sceneDurationMode,
    targetSceneCount,
    useVeoAudio,
    videoMode,
    genre,
    platform,
    styleSheet,
    visionCriticEnabled,
    qualityThreshold,
    negativePrompt,
    captionStyle,
    scenesRef,
    stepRef,
    maxStepRef,
    topicRef,
    scriptRef,
    thumbnailRef,
    characterProfileRef,
    statsRef,
    characterReferenceImageRef,
    characterReferencesRef,
    savedModeRef,
    syncPendingRef,
    blobUrlsRef,
    syncCleanupRef,
    setSyncing,
    setSyncError,
  } = deps;

  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSyncRef = useRef<(() => Promise<void>) | null>(null);
  const syncParamsRef = useRef<any>(null);

  const sync: SyncFn = (targetStep, scenesOverride, extraData = {}, overrides = {}) => {
    if (!userId) return;
    syncParamsRef.current = { targetStep, scenesOverride, extraData, overrides };
    syncPendingRef.current = true;

    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    pendingSyncRef.current = null;
    syncTimerRef.current = setTimeout(async () => {
      syncTimerRef.current = null;
      const params = syncParamsRef.current;
      if (!params) {
        syncPendingRef.current = false;
        return;
      }
      syncParamsRef.current = null;
      syncPendingRef.current = false;

      const currentStep = params.targetStep || stepRef.current;
      const currentScenes = (params.scenesOverride || scenesRef.current) as Scene[];
      const currentMaxStep =
        params.overrides.maxStep ?? Math.max(maxStepRef.current, currentStep);

      const proj: Project = {
        id: projectId,
        user_id: userId,
        title: params.overrides.topic || topicRef.current || '새 비디오 프로젝트',
        aspect_ratio: aspectRatio,
        style_template: videoStyle,
        status: ProjectStatus.DRAFT,
        created_at: createdAt,
        updated_at: new Date().toISOString(),
        saved_step: currentStep,
        saved_max_step: currentMaxStep,
        saved_mode: savedModeRef.current ?? undefined,
        saved_script: params.overrides.script ?? scriptRef.current,
        saved_scenes: currentScenes,
        saved_topic: params.overrides.topic || topicRef.current,
        saved_duration: params.overrides.duration ?? duration,
        thumbnail: params.extraData.thumbnail || thumbnailRef.current,
        selected_image_model: selectedImageModel,
        selected_video_model: selectedVideoModel,
        character_profile: characterProfileRef.current,
        use_reference_image: useReferenceImage,
        character_reference_image: characterReferenceImageRef.current?.startsWith('http')
          ? characterReferenceImageRef.current
          : (null as any),
        character_references: (characterReferencesRef.current || []).filter(
          c => c && c.name && c.imageUrl && c.imageUrl.startsWith('http')
        ),
        scene_duration_mode: sceneDurationMode,
        target_scene_count: targetSceneCount,
        use_veo_audio: useVeoAudio,
        video_mode: videoMode,
        genre,
        platform,
        style_sheet: styleSheet,
        vision_critic_enabled: visionCriticEnabled,
        quality_threshold: qualityThreshold,
        negative_prompt: negativePrompt || undefined,
        stats: statsRef.current,
        caption_style: captionStyle,
        ...params.extraData,
      };

      const localProj = {
        ...proj,
        saved_scenes: proj.saved_scenes?.map(s => {
          const c = { ...s };
          if (c.audio_path && !c.audio_path.startsWith('http')) c.audio_path = '[local-audio]';
          if (c.image_path && !c.image_path.startsWith('http')) c.image_path = '[local-image]';
          if (c.video_path && !c.video_path.startsWith('http')) c.video_path = '[local-video]';
          return c;
        }),
      };

      saveProjectMeta(projectId, localProj).catch(e =>
        console.warn('[Sync] IndexedDB meta save failed:', e)
      );

      try {
        const lsProj = {
          ...localProj,
          saved_scenes: localProj.saved_scenes?.map(s => {
            const c = { ...s };
            delete c.visual_prompt;
            delete c.audio_script;
            return c;
          }),
        };
        localStorage.setItem(`vibe_video_backup_${projectId}`, JSON.stringify(lsProj));
      } catch (e: any) {
        console.warn('[Sync] localStorage 저장 실패:', e?.message);
        try {
          const metaOnly = {
            id: localProj.id,
            user_id: localProj.user_id,
            title: localProj.title,
            aspect_ratio: localProj.aspect_ratio,
            style_template: localProj.style_template,
            status: localProj.status,
            created_at: localProj.created_at,
            updated_at: localProj.updated_at,
            saved_step: localProj.saved_step,
            saved_max_step: localProj.saved_max_step,
            saved_topic: localProj.saved_topic,
            saved_duration: localProj.saved_duration,
            thumbnail: localProj.thumbnail,
            selected_image_model: localProj.selected_image_model,
            selected_video_model: localProj.selected_video_model,
            saved_scenes: localProj.saved_scenes?.map(s => ({
              scene_number: s.scene_number,
              audio_path: s.audio_path,
              image_path: s.image_path,
              video_path: s.video_path,
              audio_duration: s.audio_duration,
            })),
          };
          localStorage.setItem(`vibe_video_backup_${projectId}`, JSON.stringify(metaOnly));
        } catch (e2) {
          console.warn('[Sync] localStorage metaOnly도 실패, IndexedDB만 사용');
        }
      }

      try {
        setSyncing(true);
        setSyncError(false);
        await saveProjectToCloud(proj, true);
      } catch (e) {
        console.error('Sync error:', e);
        setSyncError(true);
      } finally {
        setSyncing(false);
      }
    }, 1500);
  };

  // Unmount cleanup: flush pending sync, revoke blob URLs.
  // NOTE: This effect intentionally has empty deps and captures initial values
  // for non-ref props (matching the original WizardContext behavior).
  useEffect(() => {
    return () => {
      if (syncTimerRef.current) {
        clearTimeout(syncTimerRef.current);
        syncTimerRef.current = null;
      }
      if (syncCleanupRef.current) {
        syncCleanupRef.current();
        syncCleanupRef.current = null;
      }
      blobUrlsRef.current.forEach(url => {
        try {
          URL.revokeObjectURL(url);
        } catch {}
      });
      blobUrlsRef.current.clear();
      const fn = pendingSyncRef.current;
      pendingSyncRef.current = null;
      if (fn) {
        fn();
      } else if (syncParamsRef.current) {
        const params = syncParamsRef.current;
        syncParamsRef.current = null;
        const currentStep = params.targetStep || stepRef.current;
        const currentScenes = (params.scenesOverride || scenesRef.current) as Scene[];
        const currentMaxStep =
          params.overrides?.maxStep ?? Math.max(maxStepRef.current, currentStep);
        const proj: Project = {
          id: projectId,
          user_id: userId,
          title: params.overrides?.topic || topicRef.current || '새 비디오 프로젝트',
          aspect_ratio: aspectRatio,
          style_template: videoStyle,
          status: ProjectStatus.DRAFT,
          created_at: createdAt,
          updated_at: new Date().toISOString(),
          saved_step: currentStep,
          saved_max_step: currentMaxStep,
          saved_mode: savedModeRef.current ?? undefined,
          saved_script: params.overrides?.script ?? scriptRef.current,
          saved_scenes: currentScenes,
          saved_topic: params.overrides?.topic || topicRef.current,
          saved_duration: params.overrides?.duration ?? duration,
          thumbnail: params.extraData?.thumbnail || thumbnailRef.current,
          selected_image_model: selectedImageModel,
          selected_video_model: selectedVideoModel,
          character_profile: characterProfileRef.current,
          use_reference_image: useReferenceImage,
          character_reference_image: characterReferenceImageRef.current?.startsWith('http')
            ? characterReferenceImageRef.current
            : (null as any),
          character_references: (characterReferencesRef.current || []).filter(
            c => c && c.name && c.imageUrl && c.imageUrl.startsWith('http')
          ),
          scene_duration_mode: sceneDurationMode,
          target_scene_count: targetSceneCount,
          use_veo_audio: useVeoAudio,
          video_mode: videoMode,
          genre,
          platform,
          style_sheet: styleSheet,
          vision_critic_enabled: visionCriticEnabled,
          quality_threshold: qualityThreshold,
          negative_prompt: negativePrompt || undefined,
          stats: statsRef.current,
          ...params.extraData,
        };
        const localProj = {
          ...proj,
          saved_scenes: proj.saved_scenes?.map(s => {
            const c = { ...s };
            if (c.audio_path && !c.audio_path.startsWith('http')) c.audio_path = '[local-audio]';
            if (c.image_path && !c.image_path.startsWith('http')) c.image_path = '[local-image]';
            if (c.video_path && !c.video_path.startsWith('http')) c.video_path = '[local-video]';
            return c;
          }),
        };
        saveProjectMeta(projectId, localProj).catch(() => {});
        try {
          const lsProj = {
            ...localProj,
            saved_scenes: localProj.saved_scenes?.map(s => {
              const c = { ...s };
              delete c.visual_prompt;
              delete c.audio_script;
              return c;
            }),
          };
          localStorage.setItem(`vibe_video_backup_${projectId}`, JSON.stringify(lsProj));
        } catch {}
        saveProjectToCloud(proj, true).catch(e => console.error('Unmount sync error:', e));
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return sync;
};
