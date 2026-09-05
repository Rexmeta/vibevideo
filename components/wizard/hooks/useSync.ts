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
  CreativeBrief,
  RemixSourceData,
} from '../../../types';
import {
  saveProjectToCloud,
  saveProjectFieldsToCloud,
  sanitizeSceneForFirestore,
  sanitizeSceneFieldForFirestore,
  sceneMapKey,
} from '../../../services/storageService';
import { isCloudSyncEnabled } from '../../../services/cloudSyncSettings';
import { deleteField } from 'firebase/firestore';
import { saveProjectMeta } from '../../../services/mediaCache';
import type { WizardMode } from '../ModeGate';
import { normalizeLegacyProject } from '../../../services/projectSnapshotMapper';

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
  selectedTextModel: string;
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
  linkedContextPackIdRef: React.MutableRefObject<string | undefined>;
  contextPackVersionRef: React.MutableRefObject<number | undefined>;
  contextPackDirtyRef: React.MutableRefObject<boolean>;
  creativeBriefRef: React.MutableRefObject<CreativeBrief>;
  remixSourceRef: React.MutableRefObject<RemixSourceData | undefined>;
  backgroundReplacementsRef: React.MutableRefObject<Record<string, string>>;
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
    selectedTextModel,
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
    linkedContextPackIdRef,
    contextPackVersionRef,
    contextPackDirtyRef,
    creativeBriefRef,
    remixSourceRef,
    backgroundReplacementsRef,
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

  // Firestore rejects writes that contain `undefined` values
  // (e.g. "Unsupported field value: undefined (found in field thumbnail)").
  // Several optional fields on the project payload start out `undefined`
  // for brand-new projects (thumbnail, saved_mode, saved_topic, ...), so
  // strip any top-level `undefined` keys before handing the object off to
  // the cloud-save layer. Local IndexedDB / localStorage paths keep the
  // original `proj` so they continue to mirror the in-memory shape.
  const stripUndefinedTop = <T extends Record<string, any>>(obj: T): T => {
    const cleaned: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v === undefined) continue;
      cleaned[k] = v;
    }
    return cleaned as T;
  };
  // Cloud-form snapshot of the last successful cloud write.
  // - top-level fields are stored as-is from the most recent `proj`
  // - `saved_scenes` is stored as the sanitized cloud form
  // null means "no successful write yet" -> next sync does a full save.
  type CloudSnapshot = { saved_scenes: Array<Record<string, any>> } & Record<string, any>;
  const lastSyncedRef = useRef<CloudSnapshot | null>(null);

  // Top-level keys we never diff/send via the partial path.
  // - id/user_id/created_at: identity (set by full save).
  // - updated_at/version: bumped server-side by storageService.
  // - saved_scenes: handled separately (per-scene dotted-path patches into
  //   `saved_scenes_map` plus `scene_count` / `total_duration`).
  // - scene_count / total_duration: derived; emitted only when scenes change.
  const FIELDS_NEVER_DIFFED = new Set([
    'id',
    'user_id',
    'created_at',
    'updated_at',
    'version',
    'saved_scenes',
    'scene_count',
    'total_duration',
  ]);

  const stableEq = (a: unknown, b: unknown): boolean => {
    if (a === b) return true;
    let sa: string;
    let sb: string;
    try { sa = JSON.stringify(a); } catch { sa = String(a); }
    try { sb = JSON.stringify(b); } catch { sb = String(b); }
    return sa === sb;
  };

  /** Build the cloud-form snapshot we store in `lastSyncedRef`. */
  const buildSnapshot = (proj: Project): CloudSnapshot => {
    const { saved_scenes, ...rest } = proj;
    const top: Record<string, any> = {};
    for (const [k, v] of Object.entries(rest)) {
      if (v === undefined) continue;
      top[k] = v;
    }
    const scenes = (saved_scenes || []).slice(0, 80).map(sanitizeSceneForFirestore);
    // Deep-clone so subsequent in-place mutations to `proj` cannot leak in.
    return JSON.parse(JSON.stringify({ ...top, saved_scenes: scenes }));
  };

  /**
   * Diff `proj` against the previous cloud-form snapshot and produce the
   * minimal payload for `saveProjectFieldsToCloud`. Per-scene field changes
   * become dotted paths like `saved_scenes_map.05.image_path`.
   */
  const computePartialPayload = (
    proj: Project,
    prev: CloudSnapshot,
  ): Record<string, any> => {
    const payload: Record<string, any> = {};

    // ---- Top-level scalar / object fields ----
    const topKeys = new Set<string>([
      ...Object.keys(prev),
      ...Object.keys(proj as Record<string, any>),
    ]);
    for (const k of topKeys) {
      if (FIELDS_NEVER_DIFFED.has(k)) continue;
      const a = (proj as any)[k];
      const b = (prev as any)[k];
      if (stableEq(a, b)) continue;
      // Send raw proj value (storageService handles deletion sentinels for
      // character_reference_image; everything else is plain JSON).
      payload[k] = a === undefined ? deleteField() : a;
    }

    // ---- Per-scene dotted-path patches ----
    const prevScenes: Array<Record<string, any>> = Array.isArray(prev.saved_scenes)
      ? prev.saved_scenes
      : [];
    const currRawScenes = (proj.saved_scenes || []).slice(0, 80);
    const currScenes = currRawScenes.map(sanitizeSceneForFirestore);

    let scenesTouched = false;
    const maxLen = Math.max(prevScenes.length, currScenes.length);
    for (let i = 0; i < maxLen; i++) {
      const key = sceneMapKey(i);
      const prevS = prevScenes[i];
      const currS = currScenes[i];

      if (!prevS && currS) {
        // New scene: write whole scene at this index.
        payload[`saved_scenes_map.${key}`] = currS;
        scenesTouched = true;
      } else if (prevS && !currS) {
        // Scene removed: delete this map entry.
        payload[`saved_scenes_map.${key}`] = deleteField();
        scenesTouched = true;
      } else if (prevS && currS) {
        // Per-field diff (cloud form vs cloud form).
        const fieldKeys = new Set<string>([
          ...Object.keys(prevS),
          ...Object.keys(currS),
        ]);
        for (const f of fieldKeys) {
          const a = currS[f];
          const b = prevS[f];
          if (stableEq(a, b)) continue;
          if (a === undefined) {
            payload[`saved_scenes_map.${key}.${f}`] = deleteField();
          } else {
            // Belt-and-braces: ensure the field value is cloud-storable.
            const sv = sanitizeSceneFieldForFirestore(f, a);
            if (sv === undefined) {
              payload[`saved_scenes_map.${key}.${f}`] = deleteField();
            } else {
              payload[`saved_scenes_map.${key}.${f}`] = sv;
            }
          }
          scenesTouched = true;
        }
      }
    }

    if (scenesTouched) {
      payload['scene_count'] = currScenes.length;
      const totalDuration = currScenes.reduce(
        (sum, s) => sum + (Number(s.audio_duration) || 0),
        0,
      );
      payload['total_duration'] = Math.round(totalDuration * 10) / 10;
    }

    return payload;
  };

  // Build the project snapshot synchronously from the latest refs/props.
  // Used both by the immediate local-backup write and by the debounced
  // cloud sync, so a step transition followed by a fast tab-close still
  // leaves a complete local snapshot behind even though the cloud write
  // never fires.
  const buildProjectSnapshot = (
    targetStep?: number,
    scenesOverride?: Partial<Scene>[],
    extraData: Partial<Project> = {},
    overrides: { script?: string; topic?: string; duration?: number; maxStep?: number } = {},
  ): Project => {
    const currentStep = targetStep || stepRef.current;
    const currentScenes = (scenesOverride || scenesRef.current) as Scene[];
    const currentMaxStep = overrides.maxStep ?? Math.max(maxStepRef.current, currentStep);
    return normalizeLegacyProject({
      id: projectId,
      user_id: userId,
      title: overrides.topic || topicRef.current || '새 비디오 프로젝트',
      aspect_ratio: aspectRatio,
      style_template: videoStyle,
      status: ProjectStatus.DRAFT,
      created_at: createdAt,
      updated_at: new Date().toISOString(),
      saved_step: currentStep,
      saved_max_step: currentMaxStep,
      saved_mode: savedModeRef.current ?? undefined,
      saved_script: overrides.script ?? scriptRef.current,
      saved_scenes: currentScenes,
      saved_topic: overrides.topic || topicRef.current,
      saved_duration: overrides.duration ?? duration,
      thumbnail: extraData.thumbnail || thumbnailRef.current,
      selected_image_model: selectedImageModel,
      selected_video_model: selectedVideoModel,
      selected_text_model: selectedTextModel || undefined,
      character_profile: characterProfileRef.current,
      use_reference_image: useReferenceImage,
      character_reference_image: characterReferenceImageRef.current?.startsWith('http')
        ? characterReferenceImageRef.current
        : (null as any),
      // Keep entries with a valid name regardless of imageUrl; only strip
      // local blob:// URLs so text-only remix character edits survive sync.
      character_references: (characterReferencesRef.current || []).filter(
        c => c && c.name && (!c.imageUrl || c.imageUrl.startsWith('http')),
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
      linked_context_pack_id: linkedContextPackIdRef.current,
      context_pack_version: contextPackVersionRef.current,
      context_pack_dirty: contextPackDirtyRef.current,
      creative_brief: Object.keys(creativeBriefRef.current).length > 0
        ? creativeBriefRef.current
        : undefined,
      remix_source: remixSourceRef.current,
      background_replacements:
        Object.keys(backgroundReplacementsRef.current).length > 0
          ? backgroundReplacementsRef.current
          : undefined,
      ...extraData,
    } as Project);
  };

  // Strip in-memory media payloads from a project so it fits in
  // localStorage / IndexedDB without ballooning the row.
  const toLocalForm = (proj: Project): Project => ({
    ...proj,
    saved_scenes: proj.saved_scenes?.map(s => {
      const c = { ...s };
      if (c.audio_path && !c.audio_path.startsWith('http')) c.audio_path = '[local-audio]';
      if (c.image_path && !c.image_path.startsWith('http')) c.image_path = '[local-image]';
      if (c.video_path && !c.video_path.startsWith('http')) c.video_path = '[local-video]';
      return c;
    }),
  });

  const writeLocalBackupNow = (proj: Project): void => {
    const localProj = toLocalForm(proj);
    saveProjectMeta(projectId, localProj).catch(() => {});
    try {
      const lsProj = {
        ...localProj,
        saved_scenes: localProj.saved_scenes?.map(s => {
          const c = { ...s };
          delete (c as any).visual_prompt;
          delete (c as any).audio_script;
          return c;
        }),
      };
      localStorage.setItem(`vibe_video_backup_${projectId}`, JSON.stringify(lsProj));
    } catch {
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
          saved_mode: localProj.saved_mode,
          saved_topic: localProj.saved_topic,
          saved_duration: localProj.saved_duration,
          thumbnail: localProj.thumbnail,
          selected_image_model: localProj.selected_image_model,
          selected_video_model: localProj.selected_video_model,
          selected_text_model: localProj.selected_text_model,
          saved_scenes: localProj.saved_scenes?.map(s => ({
            scene_number: s.scene_number,
            audio_path: s.audio_path,
            image_path: s.image_path,
            video_path: s.video_path,
            audio_duration: s.audio_duration,
          })),
        };
        localStorage.setItem(`vibe_video_backup_${projectId}`, JSON.stringify(metaOnly));
      } catch {}
    }
  };

  const sync: SyncFn = (targetStep, scenesOverride, extraData = {}, overrides = {}) => {
    if (!userId) return;
    syncParamsRef.current = { targetStep, scenesOverride, extraData, overrides };
    syncPendingRef.current = true;

    // Local backup is the single source of truth when the cloud is
    // unavailable. Write it synchronously now (before the cloud debounce)
    // so a quick tab close doesn't lose the latest step/scenes.
    try {
      writeLocalBackupNow(buildProjectSnapshot(targetStep, scenesOverride, extraData, overrides));
    } catch (e) {
      console.warn('[Sync] immediate local backup failed:', (e as Error)?.message);
    }

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
        selected_text_model: selectedTextModel || undefined,
        character_profile: characterProfileRef.current,
        use_reference_image: useReferenceImage,
        character_reference_image: characterReferenceImageRef.current?.startsWith('http')
          ? characterReferenceImageRef.current
          : (null as any),
        character_references: (characterReferencesRef.current || []).filter(
          c => c && c.name && (!c.imageUrl || c.imageUrl.startsWith('http'))
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
        linked_context_pack_id: linkedContextPackIdRef.current,
        context_pack_version: contextPackVersionRef.current,
        context_pack_dirty: contextPackDirtyRef.current,
        creative_brief: Object.keys(creativeBriefRef.current).length > 0
          ? creativeBriefRef.current
          : undefined,
        remix_source: remixSourceRef.current,
        background_replacements:
          Object.keys(backgroundReplacementsRef.current).length > 0
            ? backgroundReplacementsRef.current
            : undefined,
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
            selected_text_model: localProj.selected_text_model,
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

      // Skip cloud write when user has disabled cloud sync.
      if (!isCloudSyncEnabled()) {
        syncPendingRef.current = false;
        return;
      }

      try {
        setSyncing(true);
        setSyncError(false);

        const prevSnapshot = lastSyncedRef.current;
        if (!prevSnapshot) {
          // No baseline yet: do a full save so the doc (and `saved_scenes_map`)
          // exist before we start firing dotted-path patches at it.
          await saveProjectToCloud(stripUndefinedTop(proj), true);
          lastSyncedRef.current = buildSnapshot(proj);
        } else {
          const payload = computePartialPayload(proj, prevSnapshot);
          const keyCount = Object.keys(payload).length;
          if (keyCount === 0) {
            // Nothing actually changed in cloud-storable form. Skip the write.
          } else {
            try {
              await saveProjectFieldsToCloud(projectId, payload);
              lastSyncedRef.current = buildSnapshot(proj);
              const sceneKeys = Object.keys(payload).filter(k =>
                k.startsWith('saved_scenes_map.'),
              );
              console.log(
                `[Sync] partial cloud write: ${keyCount} key(s)` +
                  (sceneKeys.length ? ` (${sceneKeys.length} scene patch(es))` : ''),
              );
            } catch (partialErr) {
              console.warn(
                '[Sync] partial save failed, falling back to full save:',
                (partialErr as Error)?.message,
              );
              await saveProjectToCloud(stripUndefinedTop(proj), true);
              lastSyncedRef.current = buildSnapshot(proj);
            }
          }
        }
      } catch (e) {
        console.error('Sync error:', e);
        setSyncError(true);
        // Force a full re-sync on the next attempt to recover from any drift.
        lastSyncedRef.current = null;
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
            c => c && c.name && (!c.imageUrl || c.imageUrl.startsWith('http'))
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
          linked_context_pack_id: linkedContextPackIdRef.current,
          context_pack_version: contextPackVersionRef.current,
          context_pack_dirty: contextPackDirtyRef.current,
          creative_brief: Object.keys(creativeBriefRef.current).length > 0
            ? creativeBriefRef.current
            : undefined,
          remix_source: remixSourceRef.current,
          background_replacements:
            Object.keys(backgroundReplacementsRef.current).length > 0
              ? backgroundReplacementsRef.current
              : undefined,
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
        saveProjectToCloud(stripUndefinedTop(proj), true).catch(e => console.error('Unmount sync error:', e));
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return sync;
};
