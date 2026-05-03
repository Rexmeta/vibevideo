import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Project,
  Scene,
  ProjectStats,
  CharacterReference,
  CaptionStyle,
  GenreId,
  PlatformId,
  StyleSheet,
  VideoMode,
} from '../../../types';
import type { WizardMode } from '../ModeGate';
import {
  getProjectFromCloud,
  getFirestoreHealthInfo,
} from '../../../services/storageService';
import {
  saveMedia,
  getMedia,
  getProjectMeta,
  listProjectMediaIndices,
} from '../../../services/mediaCache';
import { migrateSceneFields } from '../../../services/geminiService';
import { DEFAULT_CAPTION_STYLE } from '../../../services/captionService';
import { isSampleProjectId } from '../../../services/sampleProject';

export type RestoreSourceStatus = 'pending' | 'ok' | 'empty' | 'timeout' | 'error';

export interface RestoreStatus {
  cloud: RestoreSourceStatus;
  local: RestoreSourceStatus;
  idb: RestoreSourceStatus;
  scenes: 'present' | 'missing' | 'unknown';
}

export type RestoreErrorKind =
  | { kind: 'no_scenes'; cloudOk: boolean; firestoreDisabled: boolean }
  | { kind: 'all_failed'; firestoreDisabled: boolean };

export interface UseRestoreReturn {
  restoreStatus: RestoreStatus;
  restoreError: RestoreErrorKind | null;
  restoreSlow: boolean;
  retryRestore: () => void;
}

interface RestoreDeps {
  userId: string;
  initialProjectId?: string | null;
  projectId: string;
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setLoadingMessage: React.Dispatch<React.SetStateAction<string>>;
  setProjectId: React.Dispatch<React.SetStateAction<string>>;
  setCreatedAt: React.Dispatch<React.SetStateAction<string>>;
  setTopic: React.Dispatch<React.SetStateAction<string>>;
  setAspectRatio: React.Dispatch<React.SetStateAction<'16:9' | '9:16' | '1:1' | '3:4'>>;
  setVideoStyle: React.Dispatch<React.SetStateAction<string>>;
  setStep: React.Dispatch<React.SetStateAction<1 | 2 | 3 | 4 | 5 | 6 | 7>>;
  setMaxStep: React.Dispatch<React.SetStateAction<number>>;
  setSavedMode: (mode: WizardMode | null) => void;
  setScript: React.Dispatch<React.SetStateAction<string>>;
  setDuration: React.Dispatch<React.SetStateAction<number>>;
  setThumbnail: React.Dispatch<React.SetStateAction<string | undefined>>;
  setCharacterProfile: React.Dispatch<React.SetStateAction<string>>;
  setUseReferenceImage: React.Dispatch<React.SetStateAction<boolean>>;
  setCharacterReferenceImage: React.Dispatch<React.SetStateAction<string | undefined>>;
  setCharacterReferences: React.Dispatch<React.SetStateAction<CharacterReference[]>>;
  setSceneDurationMode: React.Dispatch<React.SetStateAction<'time' | 'scenes'>>;
  setTargetSceneCount: React.Dispatch<React.SetStateAction<number>>;
  setUseVeoAudio: React.Dispatch<React.SetStateAction<boolean>>;
  setVideoMode: React.Dispatch<React.SetStateAction<VideoMode>>;
  setSelectedImageModel: React.Dispatch<React.SetStateAction<string>>;
  setSelectedVideoModel: React.Dispatch<React.SetStateAction<string>>;
  setGenre: React.Dispatch<React.SetStateAction<GenreId | undefined>>;
  setPlatform: React.Dispatch<React.SetStateAction<PlatformId | undefined>>;
  setStyleSheet: React.Dispatch<React.SetStateAction<StyleSheet | undefined>>;
  setVisionCriticEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  setQualityThreshold: React.Dispatch<React.SetStateAction<number>>;
  setNegativePrompt: React.Dispatch<React.SetStateAction<string>>;
  setStats: React.Dispatch<React.SetStateAction<ProjectStats>>;
  setCaptionStyle: React.Dispatch<React.SetStateAction<CaptionStyle>>;
  setLinkedContextPackId: React.Dispatch<React.SetStateAction<string | undefined>>;
  setContextPackVersion: React.Dispatch<React.SetStateAction<number | undefined>>;
  setContextPackDirty: React.Dispatch<React.SetStateAction<boolean>>;
  setScenes: React.Dispatch<React.SetStateAction<Partial<Scene>[]>>;
  characterReferencesRef: React.MutableRefObject<CharacterReference[]>;
  statsRef: React.MutableRefObject<ProjectStats>;
  trackBlobUrl: (url: string) => void;
}

const INITIAL_STATUS: RestoreStatus = {
  cloud: 'pending',
  local: 'pending',
  idb: 'pending',
  scenes: 'unknown',
};

export const useRestore = (deps: RestoreDeps): UseRestoreReturn => {
  const restoredRef = useRef(false);
  const slowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [restoreStatus, setRestoreStatus] = useState<RestoreStatus>(INITIAL_STATUS);
  const [restoreError, setRestoreError] = useState<RestoreErrorKind | null>(null);
  const [restoreSlow, setRestoreSlow] = useState(false);

  const {
    userId,
    initialProjectId,
    projectId,
    setLoading,
    setLoadingMessage,
    setProjectId,
    setCreatedAt,
    setTopic,
    setAspectRatio,
    setVideoStyle,
    setStep,
    setMaxStep,
    setSavedMode,
    setScript,
    setDuration,
    setThumbnail,
    setCharacterProfile,
    setUseReferenceImage,
    setCharacterReferenceImage,
    setCharacterReferences,
    setSceneDurationMode,
    setTargetSceneCount,
    setUseVeoAudio,
    setVideoMode,
    setSelectedImageModel,
    setSelectedVideoModel,
    setGenre,
    setPlatform,
    setStyleSheet,
    setVisionCriticEnabled,
    setQualityThreshold,
    setNegativePrompt,
    setStats,
    setCaptionStyle,
    setLinkedContextPackId,
    setContextPackVersion,
    setContextPackDirty,
    setScenes,
    characterReferencesRef,
    statsRef,
    trackBlobUrl,
  } = deps;

  const retryRestore = useCallback(() => {
    restoredRef.current = false;
    setRestoreError(null);
    setRestoreSlow(false);
    setRestoreStatus(INITIAL_STATUS);
    setRetryNonce(n => n + 1);
  }, []);

  useEffect(() => {
    // Sample project: no cloud/local fetch — WizardContext seeds state
    // directly from buildSampleProject(). Mark restore as complete so
    // ProjectWizard's loading gate doesn't block the wizard. This branch
    // sits ABOVE the !userId guard so anonymous (signed-out) sample
    // sessions also short-circuit cleanly without needing a userId.
    if (isSampleProjectId(initialProjectId)) {
      if (restoredRef.current) return;
      restoredRef.current = true;
      setLoading(false);
      setRestoreStatus({ cloud: 'empty', local: 'empty', idb: 'empty', scenes: 'present' });
      return;
    }

    if (!userId || restoredRef.current) return;
    restoredRef.current = true;

    const idToLoad = initialProjectId || projectId;
    const isExisting = !!initialProjectId;

    const load = async () => {
      setLoading(true);
      setLoadingMessage('Cloud Workspace 로딩 중...');
      setRestoreError(null);
      setRestoreSlow(false);

      // Show "slow" message after 5s of waiting on the cloud.
      slowTimerRef.current = setTimeout(() => {
        setRestoreSlow(true);
        setLoadingMessage('클라우드 응답이 느립니다, 캐시본을 사용 중...');
      }, 5000);

      try {
        let cloudProject: Project | undefined;
        let localProject: Project | undefined;
        let idbProject: Project | undefined;
        let cloudStatus: RestoreSourceStatus = 'pending';
        let localStatus: RestoreSourceStatus = 'pending';
        let idbStatus: RestoreSourceStatus = 'pending';

        if (initialProjectId) {
          try {
            cloudProject = await getProjectFromCloud(initialProjectId);
            cloudStatus = cloudProject ? 'ok' : 'empty';
          } catch (e: any) {
            const msg = String(e?.message || '');
            cloudStatus = msg.includes('시간 초과') ? 'timeout' : 'error';
            console.warn('[Restore] Cloud fetch failed:', e);
          }
        } else {
          cloudStatus = 'empty';
        }

        try {
          const localData = localStorage.getItem(`vibe_video_backup_${idToLoad}`);
          if (localData) {
            try {
              localProject = JSON.parse(localData);
              localStatus = 'ok';
            } catch {
              localStatus = 'error';
            }
          } else {
            localStatus = 'empty';
          }
        } catch {
          localStatus = 'error';
        }

        try {
          const idbData = await getProjectMeta(idToLoad);
          if (idbData) {
            idbProject = idbData;
            idbStatus = 'ok';
          } else {
            idbStatus = 'empty';
          }
        } catch {
          idbStatus = 'error';
        }

        const scoreProject = (proj: Project): number => {
          const maxStep = proj.saved_max_step || proj.saved_step || 1;
          const sceneCount = proj.saved_scenes?.length || 0;
          const hasContent = proj.saved_scenes?.some(s => s.visual_prompt || s.audio_script)
            ? 1
            : 0;
          const mediaCount =
            proj.saved_scenes?.reduce((sum, s) => {
              let c = 0;
              if (s.audio_path) c++;
              if (s.image_path) c++;
              if (s.video_path) c++;
              return sum + c;
            }, 0) || 0;
          return maxStep * 1000 + sceneCount * 100 + mediaCount * 10 + hasContent;
        };

        const candidates = [cloudProject, idbProject, localProject].filter(Boolean) as Project[];
        let p: Project | undefined;
        if (candidates.length > 0) {
          p = candidates.reduce((best, current) =>
            scoreProject(current) > scoreProject(best) ? current : best
          );

          const allSources = [cloudProject, idbProject, localProject].filter(Boolean) as Project[];
          if (p.saved_scenes?.length) {
            p = {
              ...p,
              saved_scenes: p.saved_scenes.map((s, i) => {
                const merged = { ...s };
                for (const src of allSources) {
                  const srcScene = src.saved_scenes?.[i];
                  if (!srcScene) continue;
                  if (!merged.audio_path && srcScene.audio_path?.startsWith('http'))
                    merged.audio_path = srcScene.audio_path;
                  if (!merged.image_path && srcScene.image_path?.startsWith('http'))
                    merged.image_path = srcScene.image_path;
                  if (!merged.video_path && srcScene.video_path?.startsWith('http'))
                    merged.video_path = srcScene.video_path;
                  if (!merged.visual_prompt && srcScene.visual_prompt)
                    merged.visual_prompt = srcScene.visual_prompt;
                  if (!merged.audio_script && srcScene.audio_script)
                    merged.audio_script = srcScene.audio_script;
                  if (!merged.script_segment && srcScene.script_segment)
                    merged.script_segment = srcScene.script_segment;
                }
                return merged;
              }),
            };
          }
          console.log(
            `[Restore] Sources: cloud=${!!cloudProject}(${cloudProject ? scoreProject(cloudProject) : '-'}), local=${!!localProject}(${localProject ? scoreProject(localProject) : '-'}), idb=${!!idbProject}(${idbProject ? scoreProject(idbProject) : '-'}), picked maxStep=${p.saved_max_step}, scenes=${p.saved_scenes?.length}`
          );
        }

        if (p) {
          setProjectId(p.id);
          setCreatedAt(p.created_at || new Date().toISOString());
          setTopic(p.saved_topic || '');
          setAspectRatio(p.aspect_ratio as any);
          setVideoStyle(p.style_template);
          const restoredStep = (p.saved_step || 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7;
          const restoredMaxStep = p.saved_max_step || p.saved_step || 1;
          setStep(restoredStep);
          setMaxStep(restoredMaxStep);
          if (p.saved_mode === 'quick' || p.saved_mode === 'pro') {
            setSavedMode(p.saved_mode);
          }
          setScript(p.saved_script || '');
          setDuration(p.saved_duration || 30);
          setThumbnail(p.thumbnail);
          if (p.character_profile) setCharacterProfile(p.character_profile);
          if (p.use_reference_image !== undefined) setUseReferenceImage(p.use_reference_image);
          if (p.character_reference_image) setCharacterReferenceImage(p.character_reference_image);
          if (Array.isArray(p.character_references)) {
            const cleaned = p.character_references
              .filter(c => c && c.name && c.imageUrl)
              .map(c => ({ name: c.name, description: c.description, imageUrl: c.imageUrl }));
            setCharacterReferences(cleaned);
            characterReferencesRef.current = cleaned;
          }
          if (p.scene_duration_mode) setSceneDurationMode(p.scene_duration_mode);
          if (p.target_scene_count) setTargetSceneCount(p.target_scene_count);
          if (p.use_veo_audio !== undefined) setUseVeoAudio(p.use_veo_audio);
          if (p.video_mode) setVideoMode(p.video_mode);
          if (p.selected_image_model) setSelectedImageModel(p.selected_image_model);
          if (p.selected_video_model) setSelectedVideoModel(p.selected_video_model);
          if (p.genre) setGenre(p.genre);
          if (p.platform) setPlatform(p.platform);
          if (p.style_sheet) setStyleSheet(p.style_sheet);
          if (p.vision_critic_enabled !== undefined)
            setVisionCriticEnabled(p.vision_critic_enabled);
          if (typeof p.quality_threshold === 'number') setQualityThreshold(p.quality_threshold);
          if (p.negative_prompt) setNegativePrompt(p.negative_prompt);
          if (p.linked_context_pack_id) setLinkedContextPackId(p.linked_context_pack_id);
          if (typeof p.context_pack_version === 'number')
            setContextPackVersion(p.context_pack_version);
          if (p.context_pack_dirty) setContextPackDirty(true);
          if (p.stats) {
            const restoredStats = {
              imagesGenerated: p.stats.imagesGenerated || 0,
              criticCalls: p.stats.criticCalls || 0,
              refineCalls: p.stats.refineCalls || 0,
              videosGenerated: p.stats.videosGenerated || 0,
            };
            setStats(restoredStats);
            statsRef.current = restoredStats;
          }
          if (p.caption_style) setCaptionStyle({ ...DEFAULT_CAPTION_STYLE, ...p.caption_style });

          let restoredScenes = migrateSceneFields(p.saved_scenes || []);

          // Cloud (and the other caches) returned a project record but with
          // zero scenes. If IndexedDB still has media for this project,
          // synthesize empty scene slots and let the per-scene media
          // recovery loop slot the cached media back in. This is the
          // recovery path for projects whose cloud writes failed in past
          // sessions due to the Firestore 403 outage.
          if (restoredScenes.length === 0 && isExisting) {
            try {
              const mediaIndices = await listProjectMediaIndices(p.id);
              if (mediaIndices.length > 0) {
                const maxIdx = mediaIndices.reduce((m, x) => Math.max(m, x.idx), -1);
                restoredScenes = Array.from({ length: maxIdx + 1 }, (_, i) => ({
                  scene_number: i + 1,
                })) as Partial<Scene>[];
                console.log(
                  `[Restore] Synthesized ${restoredScenes.length} scene slot(s) from IndexedDB media (${mediaIndices.length} files).`,
                );
              }
            } catch (e) {
              console.warn('[Restore] IDB media scan failed:', e);
            }
          }

          const maxForRestore = Math.max(restoredMaxStep, restoredStep);
          const recoveredScenes = await Promise.all(
            restoredScenes.map(async (s, i) => {
              const sc = { ...s };
              if (
                sc.audio_path &&
                (sc.audio_path.startsWith('data:') ||
                  (sc.audio_path.length > 200 && !sc.audio_path.startsWith('http')))
              ) {
                saveMedia(p!.id, i, 'audio', sc.audio_path);
              } else if (
                sc.audio_path === '[local-audio]' ||
                (!sc.audio_path && maxForRestore >= 3)
              ) {
                const cached = await getMedia(p!.id, i, 'audio');
                if (cached) sc.audio_path = cached;
              }
              if (sc.image_path && sc.image_path.startsWith('data:')) {
                saveMedia(p!.id, i, 'image', sc.image_path);
              } else if (
                sc.image_path === '[local-image]' ||
                (!sc.image_path && maxForRestore >= 4)
              ) {
                const cached = await getMedia(p!.id, i, 'image');
                if (cached) sc.image_path = cached;
              }
              if (sc.video_path === '[local-video]' || (!sc.video_path && maxForRestore >= 5)) {
                const cachedVideo = await getMedia(p!.id, i, 'video');
                if (cachedVideo) {
                  try {
                    if (cachedVideo.startsWith('blob:')) {
                      sc.video_path = cachedVideo;
                      trackBlobUrl(sc.video_path);
                    } else if (cachedVideo.startsWith('data:')) {
                      const resp = await fetch(cachedVideo);
                      const blob = await resp.blob();
                      sc.video_path = URL.createObjectURL(blob);
                      trackBlobUrl(sc.video_path);
                    } else {
                      sc.video_path = cachedVideo;
                    }
                  } catch {
                    sc.video_path = undefined;
                  }
                } else {
                  sc.video_path = undefined;
                }
              }
              return sc;
            })
          );
          setScenes(recoveredScenes);
          let computedMax = restoredMaxStep;
          if (recoveredScenes.length > 0) {
            if (recoveredScenes.some(s => s.video_path))
              computedMax = Math.max(computedMax, 6);
            if (recoveredScenes.every(s => s.video_path))
              computedMax = Math.max(computedMax, 7);
            if (recoveredScenes.some(s => s.image_path))
              computedMax = Math.max(computedMax, 5);
            if (recoveredScenes.every(s => s.image_path))
              computedMax = Math.max(computedMax, 5);
            if (recoveredScenes.some(s => s.audio_path))
              computedMax = Math.max(computedMax, 4);
          }
          setMaxStep(computedMax);

          const scenesPresent = recoveredScenes.length > 0;
          setRestoreStatus({
            cloud: cloudStatus,
            local: localStatus,
            idb: idbStatus,
            scenes: scenesPresent ? 'present' : 'missing',
          });

          // Loaded a project record but zero scenes recovered from any
          // source. Surface explicit guidance instead of dropping the user
          // onto an empty Step 1 wizard. Brand new "untouched" projects
          // (no script, no topic, no media — i.e. the user just created
          // a shell) are excluded so they can still fall into the normal
          // step 1 flow.
          if (isExisting && !scenesPresent) {
            const isUntouched =
              !p.saved_topic &&
              !p.saved_script &&
              (p.saved_step || 1) <= 1 &&
              (p.saved_max_step || 1) <= 1;
            if (!isUntouched) {
              const health = getFirestoreHealthInfo();
              setRestoreError({
                kind: 'no_scenes',
                cloudOk: cloudStatus === 'ok',
                firestoreDisabled: health.disabled,
              });
            }
          }
        } else {
          setRestoreStatus({
            cloud: cloudStatus,
            local: localStatus,
            idb: idbStatus,
            scenes: 'missing',
          });
          if (isExisting) {
            const health = getFirestoreHealthInfo();
            setRestoreError({
              kind: 'all_failed',
              firestoreDisabled: health.disabled,
            });
          }
        }
      } catch (err) {
        console.error('Restore failed:', err);
        if (isExisting) {
          const health = getFirestoreHealthInfo();
          setRestoreError({ kind: 'all_failed', firestoreDisabled: health.disabled });
        }
      } finally {
        if (slowTimerRef.current) {
          clearTimeout(slowTimerRef.current);
          slowTimerRef.current = null;
        }
        setLoading(false);
      }
    };

    load();

    return () => {
      if (slowTimerRef.current) {
        clearTimeout(slowTimerRef.current);
        slowTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialProjectId, userId, retryNonce]);

  return { restoreStatus, restoreError, restoreSlow, retryRestore };
};
