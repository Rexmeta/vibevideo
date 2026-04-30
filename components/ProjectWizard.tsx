
import React, { useState, useRef, useEffect } from 'react';
import { 
  generateScript, 
  segmentScriptIntoScenes, 
  generateSceneAudio, 
  generateSceneImage, 
  generateSceneVideo,
  generateStyleSheet,
  migrateSceneFields,
} from '../services/geminiService';
import { 
  saveProjectToCloud, 
  getProjectFromCloud, 
  uploadFileToCloud,
  generateProjectId 
} from '../services/storageService';
import { saveMedia, getMedia, saveProjectMeta, getProjectMeta } from '../services/mediaCache';
import { getModels, getModelsByType } from '../services/modelService';
import { estimateCost, formatUsd, resolveApiModelId } from '../services/pricing';
import { mergeAllScenes, MergeInput, renderPresentationVideo, PresentationSceneInput } from '../services/videoMergeService';
import { GENRES, PLATFORMS, applyPlatformDefaults } from '../services/presets';
import { DEFAULT_CAPTION_STYLE, CAPTION_PRESETS, alignWordsToDuration } from '../services/captionService';
import { Icons } from './Icons';
import { Scene, Project, ProjectStatus, ViewState, AIModel, VideoMode, TransitionType, MotionPreset, PresentationConfig, TextOverlay, GenreId, PlatformId, StyleSheet, ProjectStats, CaptionStyle, CaptionPreset, CharacterReference } from '../types';

interface ProjectWizardProps {
  userId: string;
  onNavigate: (view: ViewState) => void;
  initialProjectId?: string | null;
}

export const ProjectWizard: React.FC<ProjectWizardProps> = ({ userId, onNavigate, initialProjectId }) => {
  const [projectId, setProjectId] = useState<string>(initialProjectId || generateProjectId());
  const [createdAt, setCreatedAt] = useState<string>(new Date().toISOString());
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5 | 6 | 7>(1);
  const [maxStep, setMaxStep] = useState<number>(1);
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16' | '1:1' | '3:4'>('16:9');
  const [videoStyle, setVideoStyle] = useState('Cute Stickman');
  const [topic, setTopic] = useState('');
  const [duration, setDuration] = useState(30);
  const [script, setScript] = useState('');
  const [characterProfile, setCharacterProfile] = useState('');
  const [useReferenceImage, setUseReferenceImage] = useState(true);
  const [characterReferenceImage, setCharacterReferenceImage] = useState<string | undefined>(undefined);
  const [generatingReference, setGeneratingReference] = useState(false);
  const [characterReferences, setCharacterReferences] = useState<CharacterReference[]>([]);
  const [generatingCharRefIdx, setGeneratingCharRefIdx] = useState<number | null>(null);
  const [sceneDurationMode, setSceneDurationMode] = useState<'time' | 'scenes'>('time');
  const [targetSceneCount, setTargetSceneCount] = useState(4);
  const [useVeoAudio, setUseVeoAudio] = useState(true);
  const [videoMode, setVideoMode] = useState<VideoMode>('ai');
  const [scenes, setScenes] = useState<Partial<Scene>[]>([]);
  const [thumbnail, setThumbnail] = useState<string | undefined>(undefined);
  // Director Pipeline state
  const [genre, setGenre] = useState<GenreId | undefined>(undefined);
  const [platform, setPlatform] = useState<PlatformId | undefined>(undefined);
  const [styleSheet, setStyleSheet] = useState<StyleSheet | undefined>(undefined);
  const [visionCriticEnabled, setVisionCriticEnabled] = useState<boolean>(true);
  const [qualityThreshold, setQualityThreshold] = useState<number>(6);
  const [negativePrompt, setNegativePrompt] = useState<string>('');
  const [generatingStyleSheet, setGeneratingStyleSheet] = useState<boolean>(false);
  const [stats, setStats] = useState<ProjectStats>({ imagesGenerated: 0, criticCalls: 0, refineCalls: 0, videosGenerated: 0 });
  
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [processingSet, setProcessingSet] = useState<Set<number>>(new Set());
  const [processingType, setProcessingType] = useState<'audio' | 'image' | 'video' | null>(null);
  const [failedScenes, setFailedScenes] = useState<Map<string, string>>(new Map());
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingAudioIdx, setPlayingAudioIdx] = useState<number | null>(null);
  const [activePreviewIdx, setActivePreviewIdx] = useState(0);
  const [expandedQuality, setExpandedQuality] = useState<Set<number>>(new Set());
  const [selectedVideoIdx, setSelectedVideoIdx] = useState<number | null>(null);

  const [allModels, setAllModels] = useState<AIModel[]>([]);
  const [selectedImageModel, setSelectedImageModel] = useState<string>('');
  const [selectedVideoModel, setSelectedVideoModel] = useState<string>('');
  const [showModelSelector, setShowModelSelector] = useState<'image' | 'video' | null>(null);
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>(DEFAULT_CAPTION_STYLE);

  const restoredRef = useRef(false);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSyncRef = useRef<(() => Promise<void>) | null>(null);
  const syncParamsRef = useRef<any>(null);
  const blobUrlsRef = useRef<Set<string>>(new Set());

  const trackBlobUrl = (url: string) => { if (url.startsWith('blob:')) blobUrlsRef.current.add(url); };
  const revokeBlobUrl = (url?: string) => { if (url && url.startsWith('blob:') && blobUrlsRef.current.has(url)) { URL.revokeObjectURL(url); blobUrlsRef.current.delete(url); } };

  const scenesRef = useRef(scenes);
  const stepRef = useRef(step);
  const maxStepRef = useRef(maxStep);
  const topicRef = useRef(topic);
  const scriptRef = useRef(script);
  const thumbnailRef = useRef(thumbnail);
  const characterProfileRef = useRef(characterProfile);
  const statsRef = useRef(stats);
  const characterReferenceImageRef = useRef(characterReferenceImage);
  const characterReferencesRef = useRef(characterReferences);

  const addStats = (delta: Partial<ProjectStats>) => {
    setStats(prev => {
      const next = {
        imagesGenerated: (prev.imagesGenerated || 0) + (delta.imagesGenerated || 0),
        criticCalls: (prev.criticCalls || 0) + (delta.criticCalls || 0),
        refineCalls: (prev.refineCalls || 0) + (delta.refineCalls || 0),
        videosGenerated: (prev.videosGenerated || 0) + (delta.videosGenerated || 0),
      };
      statsRef.current = next;
      return next;
    });
  };

  useEffect(() => {
    getModels().then(models => {
      setAllModels(models);
      const imgModels = getModelsByType(models, 'image');
      const vidModels = getModelsByType(models, 'video');
      if (imgModels.length > 0 && !selectedImageModel) setSelectedImageModel(imgModels[0].id);
      if (vidModels.length > 0 && !selectedVideoModel) setSelectedVideoModel(vidModels[0].id);
    }).catch(e => console.warn('[Models] Load failed:', e));
  }, []);

  useEffect(() => { scenesRef.current = scenes; }, [scenes]);
  useEffect(() => { stepRef.current = step; }, [step]);
  useEffect(() => { maxStepRef.current = maxStep; }, [maxStep]);
  useEffect(() => { topicRef.current = topic; }, [topic]);
  useEffect(() => { scriptRef.current = script; }, [script]);
  useEffect(() => { thumbnailRef.current = thumbnail; }, [thumbnail]);
  useEffect(() => { characterProfileRef.current = characterProfile; }, [characterProfile]);
  useEffect(() => { statsRef.current = stats; }, [stats]);
  useEffect(() => { characterReferenceImageRef.current = characterReferenceImage; }, [characterReferenceImage]);
  useEffect(() => { characterReferencesRef.current = characterReferences; }, [characterReferences]);

  useEffect(() => {
    return () => {
      if (syncTimerRef.current) {
        clearTimeout(syncTimerRef.current);
        syncTimerRef.current = null;
      }
      if (syncCleanupRef.current) { syncCleanupRef.current(); syncCleanupRef.current = null; }
      blobUrlsRef.current.forEach(url => { try { URL.revokeObjectURL(url); } catch {} });
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
        const currentMaxStep = params.overrides?.maxStep ?? Math.max(maxStepRef.current, currentStep);
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
          character_references: (characterReferencesRef.current || [])
            .filter(c => c && c.name && c.imageUrl && c.imageUrl.startsWith('http')),
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
          ...params.extraData
        };
        const localProj = { ...proj, saved_scenes: proj.saved_scenes?.map(s => {
          const c = { ...s };
          if (c.audio_path && !c.audio_path.startsWith('http')) c.audio_path = '[local-audio]';
          if (c.image_path && !c.image_path.startsWith('http')) c.image_path = '[local-image]';
          if (c.video_path && !c.video_path.startsWith('http')) c.video_path = '[local-video]';
          return c;
        }) };
        saveProjectMeta(projectId, localProj).catch(() => {});
        try {
          const lsProj = { ...localProj, saved_scenes: localProj.saved_scenes?.map(s => {
            const c = { ...s };
            delete c.visual_prompt;
            delete c.audio_script;
            return c;
          }) };
          localStorage.setItem(`vibe_video_backup_${projectId}`, JSON.stringify(lsProj));
        } catch {}
        saveProjectToCloud(proj, true).catch(e => console.error("Unmount sync error:", e));
      }
    };
  }, []);

  useEffect(() => {
    if (!userId || restoredRef.current) return;
    restoredRef.current = true;
    const load = async () => {
      setLoading(true);
      setLoadingMessage("Cloud Workspace 로딩 중...");
      try {
        let p: Project | undefined;
        const idToLoad = initialProjectId || projectId;
        
        let cloudProject: Project | undefined;
        let localProject: Project | undefined;
        let idbProject: Project | undefined;
        
        if (initialProjectId) {
          try { cloudProject = await getProjectFromCloud(initialProjectId); } catch (e) {
            console.warn('[Restore] Cloud fetch failed:', e);
          }
        }
        
        const localData = localStorage.getItem(`vibe_video_backup_${idToLoad}`);
        if (localData) {
          try { localProject = JSON.parse(localData); } catch {}
        }
        
        try {
          const idbData = await getProjectMeta(idToLoad);
          if (idbData) idbProject = idbData;
        } catch {}

        const scoreProject = (proj: Project): number => {
          const maxStep = proj.saved_max_step || proj.saved_step || 1;
          const sceneCount = proj.saved_scenes?.length || 0;
          const hasContent = proj.saved_scenes?.some(s => s.visual_prompt || s.audio_script) ? 1 : 0;
          const mediaCount = proj.saved_scenes?.reduce((sum, s) => {
            let c = 0;
            if (s.audio_path) c++;
            if (s.image_path) c++;
            if (s.video_path) c++;
            return sum + c;
          }, 0) || 0;
          return maxStep * 1000 + sceneCount * 100 + mediaCount * 10 + hasContent;
        };

        const candidates = [cloudProject, idbProject, localProject].filter(Boolean) as Project[];
        if (candidates.length > 0) {
          p = candidates.reduce((best, current) => scoreProject(current) > scoreProject(best) ? current : best);
          
          const allSources = [cloudProject, idbProject, localProject].filter(Boolean) as Project[];
          if (p.saved_scenes?.length) {
            p = { ...p, saved_scenes: p.saved_scenes.map((s, i) => {
              const merged = { ...s };
              for (const src of allSources) {
                const srcScene = src.saved_scenes?.[i];
                if (!srcScene) continue;
                if (!merged.audio_path && srcScene.audio_path?.startsWith('http')) merged.audio_path = srcScene.audio_path;
                if (!merged.image_path && srcScene.image_path?.startsWith('http')) merged.image_path = srcScene.image_path;
                if (!merged.video_path && srcScene.video_path?.startsWith('http')) merged.video_path = srcScene.video_path;
                if (!merged.visual_prompt && srcScene.visual_prompt) merged.visual_prompt = srcScene.visual_prompt;
                if (!merged.audio_script && srcScene.audio_script) merged.audio_script = srcScene.audio_script;
                if (!merged.script_segment && srcScene.script_segment) merged.script_segment = srcScene.script_segment;
              }
              return merged;
            }) };
          }
          console.log(`[Restore] Sources: cloud=${!!cloudProject}(${cloudProject ? scoreProject(cloudProject) : '-'}), local=${!!localProject}(${localProject ? scoreProject(localProject) : '-'}), idb=${!!idbProject}(${idbProject ? scoreProject(idbProject) : '-'}), picked maxStep=${p.saved_max_step}, scenes=${p.saved_scenes?.length}`);
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
          if (p.vision_critic_enabled !== undefined) setVisionCriticEnabled(p.vision_critic_enabled);
          if (typeof p.quality_threshold === 'number') setQualityThreshold(p.quality_threshold);
          if (p.negative_prompt) setNegativePrompt(p.negative_prompt);
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

          const restoredScenes = migrateSceneFields(p.saved_scenes || []);
          const maxForRestore = Math.max(restoredMaxStep, restoredStep);
          const recoveredScenes = await Promise.all(restoredScenes.map(async (s, i) => {
            const sc = { ...s };
            if (sc.audio_path && (sc.audio_path.startsWith('data:') || (sc.audio_path.length > 200 && !sc.audio_path.startsWith('http')))) {
              saveMedia(p.id, i, 'audio', sc.audio_path);
            } else if (sc.audio_path === '[local-audio]' || (!sc.audio_path && maxForRestore >= 3)) {
              const cached = await getMedia(p.id, i, 'audio');
              if (cached) sc.audio_path = cached;
            }
            if (sc.image_path && sc.image_path.startsWith('data:')) {
              saveMedia(p.id, i, 'image', sc.image_path);
            } else if (sc.image_path === '[local-image]' || (!sc.image_path && maxForRestore >= 4)) {
              const cached = await getMedia(p.id, i, 'image');
              if (cached) sc.image_path = cached;
            }
            if (sc.video_path === '[local-video]' || (!sc.video_path && maxForRestore >= 5)) {
              const cachedVideo = await getMedia(p.id, i, 'video');
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
          }));
          setScenes(recoveredScenes);
          let computedMax = restoredMaxStep;
          if (recoveredScenes.length > 0) {
            if (recoveredScenes.some(s => s.video_path)) computedMax = Math.max(computedMax, 6);
            if (recoveredScenes.every(s => s.video_path)) computedMax = Math.max(computedMax, 7);
            if (recoveredScenes.some(s => s.image_path)) computedMax = Math.max(computedMax, 5);
            if (recoveredScenes.every(s => s.image_path)) computedMax = Math.max(computedMax, 5);
            if (recoveredScenes.some(s => s.audio_path)) computedMax = Math.max(computedMax, 4);
          }
          setMaxStep(computedMax);
        }
      } catch (err) {
        console.error("Restore failed:", err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [initialProjectId, userId]);

  const sync = (
    targetStep?: number, 
    scenesOverride?: Partial<Scene>[], 
    extraData: Partial<Project> = {},
    overrides: { script?: string; topic?: string; duration?: number; maxStep?: number } = {}
  ) => {
    if (!userId) return;
    syncParamsRef.current = { targetStep, scenesOverride, extraData, overrides };

    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    pendingSyncRef.current = null;
    syncTimerRef.current = setTimeout(async () => {
      syncTimerRef.current = null;
      const params = syncParamsRef.current;
      if (!params) return;
      syncParamsRef.current = null;

      const currentStep = params.targetStep || stepRef.current;
      const currentScenes = (params.scenesOverride || scenesRef.current) as Scene[];
      const currentMaxStep = params.overrides.maxStep ?? Math.max(maxStepRef.current, currentStep);
      
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
        character_references: (characterReferencesRef.current || [])
          .filter(c => c && c.name && c.imageUrl && c.imageUrl.startsWith('http')),
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
        ...params.extraData
      };

      const localProj = { ...proj, saved_scenes: proj.saved_scenes?.map(s => {
        const c = { ...s };
        if (c.audio_path && !c.audio_path.startsWith('http')) c.audio_path = '[local-audio]';
        if (c.image_path && !c.image_path.startsWith('http')) c.image_path = '[local-image]';
        if (c.video_path && !c.video_path.startsWith('http')) c.video_path = '[local-video]';
        return c;
      }) };

      saveProjectMeta(projectId, localProj).catch((e) => console.warn('[Sync] IndexedDB meta save failed:', e));

      try {
        const lsProj = { ...localProj, saved_scenes: localProj.saved_scenes?.map(s => {
          const c = { ...s };
          delete c.visual_prompt;
          delete c.audio_script;
          return c;
        }) };
        localStorage.setItem(`vibe_video_backup_${projectId}`, JSON.stringify(lsProj));
      } catch (e: any) {
        console.warn("[Sync] localStorage 저장 실패:", e?.message);
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
          console.warn("[Sync] localStorage metaOnly도 실패, IndexedDB만 사용");
        }
      }

      try {
        setSyncing(true);
        setSyncError(false);
        await saveProjectToCloud(proj, true);
      } catch (e) {
        console.error("Sync error:", e);
        setSyncError(true);
      } finally {
        setSyncing(false);
      }
    }, 1500);
  };

  const handlePlayAudio = (url: string, idx: number) => {
    if (playingAudioIdx === idx) {
      audioRef.current?.pause();
      setPlayingAudioIdx(null);
    } else {
      if (audioRef.current) {
        audioRef.current.src = url;
        audioRef.current.play();
        setPlayingAudioIdx(idx);
      }
    }
  };

  const isMediaUploaded = (path?: string): boolean => {
    return !!path && path.startsWith('http');
  };

  const hasMedia = (path?: string): boolean => {
    return !!path && (path.startsWith('http') || path.startsWith('data:') || path.startsWith('blob:'));
  };

  const tryUploadExisting = async (path: string, storagePath: string, format: 'base64' | 'blob'): Promise<string> => {
    if (path.startsWith('http')) return path;
    try {
      const url = await uploadFileToCloud(storagePath, path, format);
      return url;
    } catch {
      return path;
    }
  };

  const CONCURRENCY = 3;

  const runParallel = async <T,>(
    tasks: { idx: number; fn: () => Promise<T> }[],
    concurrency: number,
    onStart: (idx: number) => void,
    onDone: (idx: number) => void
  ): Promise<{ idx: number; result?: T; error?: any }[]> => {
    const results: { idx: number; result?: T; error?: any }[] = [];
    let cursor = 0;
    const run = async (): Promise<void> => {
      while (cursor < tasks.length) {
        const task = tasks[cursor++];
        onStart(task.idx);
        try {
          const result = await task.fn();
          results.push({ idx: task.idx, result });
        } catch (error) {
          results.push({ idx: task.idx, error });
        }
        onDone(task.idx);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, () => run()));
    return results;
  };

  const referenceImagesForScene = (s: Partial<Scene>): { name?: string; description?: string; image: string }[] => {
    if (!characterReferences || characterReferences.length === 0) return [];
    const tagged = (s?.characters || []).filter(Boolean);
    // Match canonical names (case-insensitive) so user re-edits of casing still work
    const lower = new Set(tagged.map(t => t.toLowerCase()));
    const matched = characterReferences.filter(c => c && c.imageUrl && lower.has(c.name.toLowerCase()));
    // If the scene has no character tags at all (legacy or AI omitted), include none —
    // we don't want to attach every cast member to every shot.
    return matched.map(c => ({ name: c.name, description: c.description, image: c.imageUrl }));
  };

  const updateSceneAt = (idx: number, updates: Partial<Scene>) => {
    setScenes(prev => {
      const next = [...prev];
      const old = next[idx];
      if (updates.video_path && old?.video_path && old.video_path !== updates.video_path) {
        revokeBlobUrl(old.video_path);
      }
      next[idx] = { ...old, ...updates };
      if (updates.video_path && updates.video_path.startsWith('blob:')) {
        trackBlobUrl(updates.video_path);
      }
      return next;
    });
  };

  const handleSingleAudio = async (idx: number) => {
    setProcessingType('audio');
    setProcessingSet(new Set([idx]));
    const fKey = `audio-${idx}`;
    try {
      const currentScene = scenes[idx];
      if (hasMedia(currentScene.audio_path) && !isMediaUploaded(currentScene.audio_path)) {
        const url = await tryUploadExisting(currentScene.audio_path!, `users/${userId}/projects/${projectId}/audio/s${idx}.wav`, 'base64');
        updateSceneAt(idx, { audio_path: url });
        setFailedScenes(prev => { const n = new Map(prev); n.delete(fKey); return n; });
        setProcessingSet(new Set()); setProcessingType(null);
        return;
      }
      const res = await generateSceneAudio(currentScene.script_segment!, videoStyle);
      if (res) {
        updateSceneAt(idx, { audio_path: res.audio_path, audio_duration: res.duration });
        saveMedia(projectId, idx, 'audio', res.audio_path);
        const url = await uploadFileToCloud(`users/${userId}/projects/${projectId}/audio/s${idx}.wav`, res.audio_path, 'base64');
        updateSceneAt(idx, { audio_path: url });
        setFailedScenes(prev => { const n = new Map(prev); n.delete(fKey); return n; });
        sync();
      }
    } catch (e: any) {
      console.error(`Scene ${idx} audio retry error:`, e);
      setFailedScenes(prev => new Map(prev).set(fKey, e?.message || '오류'));
    }
    setProcessingSet(new Set());
    setProcessingType(null);
  };

  const handleBatchAudio = async () => {
    setProcessingType('audio');
    const sceneSnapshot = [...scenes];
    const newFailed = new Map(failedScenes);
    
    const tasks = sceneSnapshot.map((s, i) => ({ idx: i, s }))
      .filter(({ s }) => !isMediaUploaded(s.audio_path))
      .map(({ idx, s }) => ({
        idx,
        fn: async () => {
          if (hasMedia(s.audio_path)) {
            const url = await tryUploadExisting(s.audio_path!, `users/${userId}/projects/${projectId}/audio/s${idx}.wav`, 'base64');
            updateSceneAt(idx, { audio_path: url });
            return;
          }
          const res = await generateSceneAudio(s.script_segment!, videoStyle);
          if (res) {
            updateSceneAt(idx, { audio_path: res.audio_path, audio_duration: res.duration });
            saveMedia(projectId, idx, 'audio', res.audio_path);
            const url = await uploadFileToCloud(`users/${userId}/projects/${projectId}/audio/s${idx}.wav`, res.audio_path, 'base64');
            updateSceneAt(idx, { audio_path: url });
          }
        }
      }));

    if (tasks.length === 0) { setProcessingType(null); return; }
    setLoadingMessage(`오디오 생성 중... (${tasks.length}개 씬, 최대 ${CONCURRENCY}개 동시 처리)`);

    const results = await runParallel(
      tasks, CONCURRENCY,
      (idx) => setProcessingSet(prev => new Set(prev).add(idx)),
      (idx) => setProcessingSet(prev => { const n = new Set(prev); n.delete(idx); return n; })
    );

    const errors = results.filter(r => r.error);
    errors.forEach(r => newFailed.set(`audio-${r.idx}`, r.error?.message || '오류'));
    results.filter(r => !r.error).forEach(r => newFailed.delete(`audio-${r.idx}`));
    setFailedScenes(newFailed);
    setProcessingSet(new Set());
    setProcessingType(null);
    setLoadingMessage('');
    sync();
    if (errors.length > 0) alert(`오디오 생성 실패 (${errors.length}/${tasks.length}개 씬)\n실패한 씬 옆 '재시도' 버튼으로 개별 재생성할 수 있습니다.`);
  };

  const handleBatchImages = async () => {
    setProcessingType('image');
    const sceneSnapshot = [...scenes];
    const newFailed = new Map(failedScenes);

    const tasks = sceneSnapshot.map((s, i) => ({ idx: i, s }))
      .filter(({ s }) => !isMediaUploaded(s.image_path))
      .map(({ idx, s }) => ({
        idx,
        fn: async () => {
          if (hasMedia(s.image_path)) {
            const url = await tryUploadExisting(s.image_path!, `users/${userId}/projects/${projectId}/images/s${idx}.jpg`, 'base64');
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
            { scene: s, styleSheet, negativePrompt: negativePrompt || s.negativePrompt, visionCritic: visionCriticEnabled, qualityThreshold, referenceImage: characterReferenceImage, referenceImages: referenceImagesForScene(s) },
          );
          if (result) {
            addStats(result.stats);
            const previewUrl = `data:${result.mimeType};base64,${result.base64}`;
            updateSceneAt(idx, { image_path: previewUrl, qualityScore: result.qualityScore });
            saveMedia(projectId, idx, 'image', previewUrl);
            const ext = result.mimeType.includes('png') ? 'png' : 'jpg';
            const url = await uploadFileToCloud(`users/${userId}/projects/${projectId}/images/s${idx}.${ext}`, result.base64, 'base64');
            updateSceneAt(idx, { image_path: url });
            if (idx === 0) setThumbnail(url);
          }
        }
      }));

    if (tasks.length === 0) { setProcessingType(null); return; }
    const imgModelName = allModels.find(m => m.id === selectedImageModel)?.name || '';
    setLoadingMessage(`이미지 생성 중... (${imgModelName} | ${tasks.length}개 씬, 최대 ${CONCURRENCY}개 동시 처리)`);

    const results = await runParallel(
      tasks, CONCURRENCY,
      (idx) => setProcessingSet(prev => new Set(prev).add(idx)),
      (idx) => setProcessingSet(prev => { const n = new Set(prev); n.delete(idx); return n; })
    );

    const errors = results.filter(r => r.error);
    errors.forEach(r => newFailed.set(`image-${r.idx}`, r.error?.message || '오류'));
    results.filter(r => !r.error).forEach(r => newFailed.delete(`image-${r.idx}`));
    setFailedScenes(newFailed);
    setProcessingSet(new Set());
    setProcessingType(null);
    setLoadingMessage('');
    sync();
    if (errors.length > 0) alert(`이미지 생성 실패 (${errors.length}/${tasks.length}개 씬)\n실패한 씬 옆 '재시도' 버튼으로 개별 재생성할 수 있습니다.`);
  };

  const handleRefineImage = async (idx: number) => {
    const currentScene = scenes[idx];
    const qs = currentScene?.qualityScore;
    const issues = qs?.issues && qs.issues.length > 0 ? qs.issues.join('; ') : 'composition or character consistency';
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
        { scene: currentScene, styleSheet, negativePrompt: negativePrompt || currentScene.negativePrompt, visionCritic: visionCriticEnabled, qualityThreshold, extraHint: hint, referenceImage: characterReferenceImage, referenceImages: referenceImagesForScene(currentScene) },
      );
      if (result) {
        addStats(result.stats);
        const previewUrl = `data:${result.mimeType};base64,${result.base64}`;
        updateSceneAt(idx, { image_path: previewUrl, qualityScore: result.qualityScore });
        saveMedia(projectId, idx, 'image', previewUrl);
        const ext = result.mimeType.includes('png') ? 'png' : 'jpg';
        const url = await uploadFileToCloud(`users/${userId}/projects/${projectId}/images/s${idx}.${ext}`, result.base64, 'base64');
        updateSceneAt(idx, { image_path: url });
        if (idx === 0) setThumbnail(url);
        setFailedScenes(prev => { const n = new Map(prev); n.delete(fKey); return n; });
        sync();
      }
    } catch (e: any) {
      console.error(e);
      setFailedScenes(prev => new Map(prev).set(fKey, e?.message || '오류'));
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
        const url = await tryUploadExisting(currentScene.image_path!, `users/${userId}/projects/${projectId}/images/s${idx}.jpg`, 'base64');
        updateSceneAt(idx, { image_path: url });
        if (idx === 0) setThumbnail(url);
        setFailedScenes(prev => { const n = new Map(prev); n.delete(fKey); return n; });
        setProcessingSet(new Set()); setProcessingType(null);
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
        { scene: currentScene, styleSheet, negativePrompt: negativePrompt || currentScene.negativePrompt, visionCritic: visionCriticEnabled, qualityThreshold, referenceImage: characterReferenceImage, referenceImages: referenceImagesForScene(currentScene) },
      );
      if (result) {
        addStats(result.stats);
        const previewUrl = `data:${result.mimeType};base64,${result.base64}`;
        updateSceneAt(idx, { image_path: previewUrl, qualityScore: result.qualityScore });
        saveMedia(projectId, idx, 'image', previewUrl);
        const ext = result.mimeType.includes('png') ? 'png' : 'jpg';
        const url = await uploadFileToCloud(`users/${userId}/projects/${projectId}/images/s${idx}.${ext}`, result.base64, 'base64');
        updateSceneAt(idx, { image_path: url });
        if (idx === 0) setThumbnail(url);
        setFailedScenes(prev => { const n = new Map(prev); n.delete(fKey); return n; });
        sync();
      }
    } catch (e: any) {
      console.error(e);
      setFailedScenes(prev => new Map(prev).set(fKey, e?.message || '오류'));
    }
    setProcessingSet(new Set());
    setProcessingType(null);
  };

  const fetchVideoAsBlob = async (videoUrl: string, sceneIdx: number): Promise<{ blobUrl: string; blob: Blob }> => {
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
      console.log(`[Video Cache] Scene ${sceneIdx} saved to IndexedDB (${Math.round(dataUrl.length / 1024)}KB)`);
    } catch (cacheErr) {
      console.warn(`[Video Cache] Scene ${sceneIdx} IndexedDB save failed:`, cacheErr);
    }
    return { blobUrl, blob };
  };

  const handleBatchVideos = async () => {
    setProcessingType('video');
    const sceneSnapshot = [...scenes];
    const newFailed = new Map(failedScenes);

    const tasks = sceneSnapshot.map((s, i) => ({ idx: i, s }))
      .filter(({ s }) => !isMediaUploaded(s.video_path))
      .map(({ idx, s }) => ({
        idx,
        fn: async () => {
          if (hasMedia(s.video_path) && !isMediaUploaded(s.video_path) && s.video_path?.startsWith('blob:')) {
            try {
              const blob = await fetch(s.video_path!).then(r => r.blob());
              const url = await uploadFileToCloud(`users/${userId}/projects/${projectId}/videos/s${idx}.mp4`, blob, 'blob');
              updateSceneAt(idx, { video_path: url });
            } catch (uploadErr) {
              console.warn(`[Video Upload] Scene ${idx} re-upload failed, keeping blob URL`, uploadErr);
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
            { scene: s, styleSheet, negativePrompt: negativePrompt || s.negativePrompt, referenceImage: characterReferenceImage },
          );
          if (videoResult?.videoUrl) {
            addStats(videoResult.stats);
            const { blobUrl, blob } = await fetchVideoAsBlob(videoResult.videoUrl, idx);
            updateSceneAt(idx, { video_path: blobUrl });
            try {
              const url = await uploadFileToCloud(`users/${userId}/projects/${projectId}/videos/s${idx}.mp4`, blob, 'blob');
              updateSceneAt(idx, { video_path: url });
            } catch (uploadErr) {
              console.warn(`[Video Upload] Scene ${idx} upload failed, keeping blob URL for preview`, uploadErr);
            }
          }
        }
      }));

    if (tasks.length === 0) { setProcessingType(null); return; }

    const results: { idx: number; error?: any }[] = [];
    for (let ti = 0; ti < tasks.length; ti++) {
      const task = tasks[ti];
      setProcessingSet(new Set([task.idx]));
      if (ti > 0) {
        const waitSec = 60;
        for (let w = waitSec; w > 0; w--) {
          setLoadingMessage(`다음 씬 대기 중... ${w}초 (${ti + 1}/${tasks.length}개 씬, API 속도 제한 방지)`);
          await new Promise(r => setTimeout(r, 1000));
        }
      }
      const vidModelName = allModels.find(m => m.id === selectedVideoModel)?.name || '';
      setLoadingMessage(`비디오 생성 중... (${vidModelName} | ${ti + 1}/${tasks.length}개 씬) — 최대 5분 소요`);
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
    if (errors.length > 0) alert(`비디오 생성 실패 (${errors.length}/${tasks.length}개 씬)\n실패한 씬 옆 '재시도' 버튼으로 개별 재생성할 수 있습니다.`);
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
        { scene: currentScene, styleSheet, negativePrompt: negativePrompt || currentScene.negativePrompt, referenceImage: characterReferenceImage },
      );
      if (videoResult?.videoUrl) {
        addStats(videoResult.stats);
        const { blobUrl, blob } = await fetchVideoAsBlob(videoResult.videoUrl, idx);
        updateSceneAt(idx, { video_path: blobUrl });
        console.log(`[Single Video] Scene ${idx + 1} generated successfully (model: ${vidModel?.modelId || 'default'})`);
        try {
          const url = await uploadFileToCloud(`users/${userId}/projects/${projectId}/videos/s${idx}.mp4`, blob, 'blob');
          updateSceneAt(idx, { video_path: url });
        } catch (uploadErr) {
          console.warn(`[Video Upload] Scene ${idx} upload failed, keeping blob URL for preview`, uploadErr);
        }
        setFailedScenes(prev => { const n = new Map(prev); n.delete(fKey); return n; });
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

  const [downloadingAll, setDownloadingAll] = useState(false);
  const [merging, setMerging] = useState(false);
  const [mergeProgress, setMergeProgress] = useState<string>('');
  const [mergePercent, setMergePercent] = useState(0);
  const [mergedVideoUrl, setMergedVideoUrl] = useState<string | null>(null);
  const syncAudioRef = useRef<HTMLAudioElement | null>(null);

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
    setMerging(true);
    setMergeProgress('FFmpeg 로딩 중...');
    setMergePercent(0);
    setMergedVideoUrl(null);
    try {
      const captionsEnabled = captionStyle.preset !== 'none';
      const inputs: MergeInput[] = scenes.map(s => {
        const dur = s.audio_duration || (duration / Math.max(1, scenes.length)) || 6;
        const text = (s.audio_script || s.script_segment || '').trim();
        const captionWords = (captionsEnabled && text)
          ? alignWordsToDuration(text, dur, captionStyle.enableEmoji)
          : undefined;
        return {
          videoUrl: s.video_path || '',
          audioUrl: useVeoAudio ? undefined : (s.audio_path || undefined),
          captionWords,
          captionDurationSec: dur,
        };
      });
      const blob = await mergeAllScenes(inputs, (stage, pct) => {
        setMergeProgress(stage);
        setMergePercent(pct);
      }, captionsEnabled ? captionStyle : undefined, aspectRatio);
      const url = URL.createObjectURL(blob);
      trackBlobUrl(url);
      setMergedVideoUrl(url);
    } catch (err: any) {
      console.error('[Merge] Failed:', err);
      setMergeProgress(`오류: ${err?.message || '합치기 실패'}`);
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

  const syncCleanupRef = useRef<(() => void) | null>(null);

  const syncAudioWithVideo = (videoEl: HTMLVideoElement | null, audioUrl?: string) => {
    if (syncCleanupRef.current) {
      syncCleanupRef.current();
      syncCleanupRef.current = null;
    }
    if (!videoEl || !audioUrl) return;
    const sa = syncAudioRef.current;
    if (!sa) return;
    sa.src = audioUrl;
    sa.currentTime = 0;

    const playHandler = () => { sa.currentTime = videoEl.currentTime; sa.play().catch(() => {}); };
    const pauseHandler = () => { sa.pause(); };
    const seekHandler = () => { sa.currentTime = videoEl.currentTime; };
    const endHandler = () => { sa.pause(); sa.currentTime = 0; };

    videoEl.addEventListener('play', playHandler);
    videoEl.addEventListener('pause', pauseHandler);
    videoEl.addEventListener('seeked', seekHandler);
    videoEl.addEventListener('ended', endHandler);

    if (!videoEl.paused) {
      sa.currentTime = videoEl.currentTime;
      sa.play().catch(() => {});
    }

    syncCleanupRef.current = () => {
      videoEl.removeEventListener('play', playHandler);
      videoEl.removeEventListener('pause', pauseHandler);
      videoEl.removeEventListener('seeked', seekHandler);
      videoEl.removeEventListener('ended', endHandler);
      sa.pause();
    };
  };

  const isProcessing = processingSet.size > 0;
  const isImagesReady = scenes.length > 0 && scenes.every(s => !!s.image_path);
  const isVideosReady = scenes.length > 0 && scenes.every(s => !!s.video_path);
  const isPresentationMode = videoMode === 'presentation';

  const TRANSITION_OPTIONS: { value: TransitionType; label: string }[] = [
    { value: 'none', label: '없음' },
    { value: 'fade', label: '페이드' },
    { value: 'fadeblack', label: '페이드 (블랙)' },
    { value: 'fadewhite', label: '페이드 (화이트)' },
    { value: 'wipeleft', label: '와이프 ←' },
    { value: 'wiperight', label: '와이프 →' },
    { value: 'wipeup', label: '와이프 ↑' },
    { value: 'wipedown', label: '와이프 ↓' },
    { value: 'slideleft', label: '슬라이드 ←' },
    { value: 'slideright', label: '슬라이드 →' },
    { value: 'slideup', label: '슬라이드 ↑' },
    { value: 'slidedown', label: '슬라이드 ↓' },
    { value: 'circleopen', label: '서클 열기' },
    { value: 'circleclose', label: '서클 닫기' },
    { value: 'smoothleft', label: '스무스 ←' },
    { value: 'smoothright', label: '스무스 →' },
  ];

  const MOTION_OPTIONS: { value: MotionPreset; label: string }[] = [
    { value: 'none', label: '정지' },
    { value: 'zoom-in', label: '줌 인' },
    { value: 'zoom-out', label: '줌 아웃' },
    { value: 'pan-left', label: '팬 ←' },
    { value: 'pan-right', label: '팬 →' },
    { value: 'pan-up', label: '팬 ↑' },
    { value: 'pan-down', label: '팬 ↓' },
  ];

  const getDefaultPresentation = (idx: number): PresentationConfig => ({
    transition: idx === 0 ? 'none' : 'fade',
    transitionDuration: 1,
    motion: 'zoom-in',
  });

  const updateScenePresentation = (idx: number, updates: Partial<PresentationConfig>) => {
    setScenes(prev => {
      const next = [...prev];
      const current = next[idx]?.presentation || getDefaultPresentation(idx);
      next[idx] = { ...next[idx], presentation: { ...current, ...updates } };
      return next;
    });
  };

  const updateSceneTextOverlay = (idx: number, updates: Partial<TextOverlay> | null) => {
    setScenes(prev => {
      const next = [...prev];
      const pres = next[idx]?.presentation || getDefaultPresentation(idx);
      if (updates === null) {
        next[idx] = { ...next[idx], presentation: { ...pres, textOverlay: undefined } };
      } else {
        const current = pres.textOverlay || { text: '', position: 'bottom' as const, fontSize: 32, color: '#ffffff', backgroundColor: 'rgba(0,0,0,0.6)' };
        next[idx] = { ...next[idx], presentation: { ...pres, textOverlay: { ...current, ...updates } } };
      }
      return next;
    });
  };

  const applyDefaultTransitions = (transitionType: TransitionType = 'fade') => {
    setScenes(prev => prev.map((s, i) => ({
      ...s,
      presentation: {
        ...(s.presentation || getDefaultPresentation(i)),
        transition: i === 0 ? 'none' : transitionType,
      }
    })));
  };

  const applyDefaultMotion = (motion: MotionPreset) => {
    setScenes(prev => prev.map((s, i) => ({
      ...s,
      presentation: {
        ...(s.presentation || getDefaultPresentation(i)),
        motion,
      }
    })));
  };

  const handleRenderPresentation = async () => {
    setMerging(true);
    setMergeProgress('프레젠테이션 비디오 렌더링 준비 중...');
    setMergePercent(0);
    setMergedVideoUrl(null);
    try {
      const captionsEnabled = captionStyle.preset !== 'none';
      const inputs: PresentationSceneInput[] = scenes.map((s, i) => {
        const pres = s.presentation || getDefaultPresentation(i);
        const dur = s.audio_duration || (duration / scenes.length) || 6;
        const text = (s.audio_script || s.script_segment || '').trim();
        const captionWords = (captionsEnabled && text)
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
      const blob = await renderPresentationVideo(inputs, aspectRatio, (stage, pct) => {
        setMergeProgress(stage);
        setMergePercent(pct);
      }, captionsEnabled ? captionStyle : undefined);
      const url = URL.createObjectURL(blob);
      trackBlobUrl(url);
      setMergedVideoUrl(url);
    } catch (err: any) {
      console.error('[Presentation Render] Failed:', err);
      setMergeProgress(`오류: ${err?.message || '렌더링 실패'}`);
    } finally {
      setMerging(false);
    }
  };
  const failedCount = (type: string) => Array.from(failedScenes.keys()).filter(k => k.startsWith(type)).length;

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 relative">
      <audio ref={audioRef} onEnded={() => setPlayingAudioIdx(null)} className="hidden" />
      <audio ref={syncAudioRef} className="hidden" />

      {/* Persistence Bar */}
      <div className={`fixed bottom-10 left-1/2 -translate-x-1/2 z-[110] pointer-events-none transition-all duration-500 ${syncing || syncError ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-20'}`}>
         <div className={`px-10 py-4 rounded-full shadow-[0_20px_50px_rgba(0,0,0,0.3)] flex items-center gap-4 border-2 ${syncError ? 'bg-red-500 border-red-400' : 'bg-brand-dark border-brand-cyan/20 backdrop-blur-xl'}`}>
            {syncing ? <Icons.Loader2 className="animate-spin text-brand-cyan" size={20} /> : <Icons.Cloud className="text-brand-cyan" size={20} />}
            <span className="text-sm font-black uppercase text-white tracking-[0.2em]">
              {syncError ? 'Cloud Offline - Retrying...' : syncing ? 'Saving Workspace...' : 'Project Synced'}
            </span>
         </div>
      </div>

      {/* Stepper */}
      <div className="flex justify-between mb-16 relative max-w-5xl mx-auto">
        {['Vibe', 'Script', 'Audio', 'Storyboard', isPresentationMode ? 'Transitions' : 'Motion', 'Preview', 'Export'].map((l, i) => (
          <div key={l} onClick={() => i+1 <= maxStep && !syncing && !loading && !isProcessing && setStep((i+1) as any)} className={`flex flex-col items-center z-10 transition-all ${i+1 <= maxStep ? 'cursor-pointer' : 'cursor-not-allowed'} ${i+1 <= maxStep ? 'opacity-100' : 'opacity-20'}`}>
            <div className={`w-12 h-12 rounded-full flex items-center justify-center font-black border-4 transition-all ${step === i+1 ? 'bg-brand-cyan border-white shadow-2xl scale-110' : i+1 <= maxStep ? 'bg-white border-brand-cyan/30' : 'bg-white border-gray-100'}`}>
              {i+1 < maxStep ? <Icons.Check size={20} /> : i+1}
            </div>
            <span className="mt-2 text-[10px] font-black uppercase tracking-tight">{l}</span>
          </div>
        ))}
        <div className="absolute top-6 left-0 w-full h-1 bg-gray-100 -z-0 rounded-full"></div>
        <div className="absolute top-6 left-0 h-1 bg-brand-cyan -z-0 rounded-full transition-all duration-700" style={{ width: `${((step-1)/6)*100}%` }}></div>
      </div>

      <div className="bg-white rounded-[4rem] shadow-2xl p-12 min-h-[750px] flex flex-col relative border border-gray-50 overflow-hidden">
        {loading && (
          <div className="absolute inset-0 bg-white/95 backdrop-blur-xl z-[150] flex flex-col items-center justify-center text-center p-10">
            <div className="relative mb-12">
               <div className="w-24 h-24 border-8 border-gray-100 border-t-brand-cyan rounded-full animate-spin"></div>
               <Icons.Cloud className="absolute inset-0 m-auto text-brand-dark" size={32} />
            </div>
            <p className="text-3xl font-black text-brand-dark mb-4">{loadingMessage}</p>
            <p className="text-gray-400 font-medium tracking-tight italic">당신의 모든 창작물은 구글 클라우드에서 안전하게 관리됩니다.</p>
          </div>
        )}

        {step === 1 && (
          <div className="flex-1 flex flex-col max-w-4xl mx-auto w-full">
            <div className="text-center mb-16">
              <h2 className="text-5xl font-black text-brand-dark mb-4 tracking-tighter">Workspace Config</h2>
              <p className="text-gray-400 text-lg font-medium italic">비디오의 톤앤매너를 설정하세요.</p>
            </div>
            <div className="space-y-16">
              <section>
                <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 mb-4 flex items-center gap-2">
                  <Icons.Film size={14} /> Genre <span className="text-gray-300 normal-case font-medium">(선택사항)</span>
                </h3>
                <p className="text-xs text-gray-400 mb-4 italic">장르를 선택하면 AI가 적절한 구조와 후크 전략으로 스크립트를 작성합니다.</p>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  {GENRES.map(g => (
                    <button
                      key={g.id}
                      onClick={() => setGenre(genre === g.id ? undefined : g.id)}
                      className={`p-4 rounded-[1.5rem] border-4 text-left transition-all ${genre === g.id ? 'border-brand-cyan bg-brand-cyan/5 shadow-xl scale-[1.02]' : 'border-gray-50 hover:border-gray-100'}`}
                    >
                      <span className="text-xs font-black block mb-1">{g.label}</span>
                      <span className="text-[10px] text-gray-400 leading-tight block">{g.description}</span>
                    </button>
                  ))}
                </div>
              </section>
              <section>
                <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 mb-4 flex items-center gap-2">
                  <Icons.Layers size={14} /> Platform <span className="text-gray-300 normal-case font-medium">(선택사항 · 비율·길이 자동 설정)</span>
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  {PLATFORMS.map(pl => (
                    <button
                      key={pl.id}
                      onClick={() => {
                        const next = platform === pl.id ? undefined : pl.id;
                        setPlatform(next);
                        if (next) {
                          const def = applyPlatformDefaults(next);
                          if (def.aspectRatio) setAspectRatio(def.aspectRatio as any);
                          if (def.duration) setDuration(def.duration);
                          if (def.targetSceneCount) setTargetSceneCount(def.targetSceneCount);
                        }
                      }}
                      className={`p-4 rounded-[1.5rem] border-4 text-left transition-all ${platform === pl.id ? 'border-brand-cyan bg-brand-cyan/5 shadow-xl scale-[1.02]' : 'border-gray-50 hover:border-gray-100'}`}
                    >
                      <span className="text-xs font-black block mb-1">{pl.label}</span>
                      <span className="text-[10px] text-gray-400 block">{pl.aspectRatio} · ~{pl.recommendedDurationSec}초</span>
                      <span className="text-[9px] text-gray-300 block mt-0.5">Hook: {pl.hookIntensity}</span>
                    </button>
                  ))}
                </div>
              </section>
              <section>
                <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 mb-8 flex items-center gap-2">Aspect Ratio</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                  {['16:9', '9:16', '1:1', '3:4'].map(r => (
                    <button key={r} onClick={() => setAspectRatio(r as any)} className={`p-8 rounded-[2.5rem] border-4 flex flex-col items-center gap-4 transition-all ${aspectRatio === r ? 'border-brand-cyan bg-brand-cyan/5 shadow-xl scale-[1.02]' : 'border-gray-50 hover:border-gray-100'}`}>
                      <span className="font-black text-xl">{r}</span>
                    </button>
                  ))}
                </div>
              </section>
              <section>
                <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 mb-8 flex items-center gap-2">Visual Style</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                  {['Cute Stickman', 'Japanese Anime', 'Realistic Cinematic', '3D Pixar-like'].map(s => (
                    <button key={s} onClick={() => setVideoStyle(s)} className={`p-6 rounded-[2.5rem] border-4 transition-all text-center ${videoStyle === s ? 'border-brand-cyan bg-brand-cyan/5 shadow-xl scale-[1.02]' : 'border-gray-50 hover:border-gray-100'}`}>
                      <span className="text-xs font-black uppercase">{s}</span>
                    </button>
                  ))}
                </div>
              </section>
              <section>
                <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 mb-8 flex items-center gap-2">
                  <Icons.Clock size={14} /> Scene Duration
                </h3>
                <div className="flex gap-4 mb-6">
                  <button
                    onClick={() => setSceneDurationMode('time')}
                    className={`flex-1 p-5 rounded-[2rem] border-4 text-center transition-all ${sceneDurationMode === 'time' ? 'border-brand-cyan bg-brand-cyan/5 shadow-xl scale-[1.02]' : 'border-gray-50 hover:border-gray-100'}`}
                  >
                    <span className="text-xs font-black uppercase block mb-1">총 영상 시간</span>
                    <span className="text-[10px] text-gray-400">초 단위로 설정</span>
                  </button>
                  <button
                    onClick={() => setSceneDurationMode('scenes')}
                    className={`flex-1 p-5 rounded-[2rem] border-4 text-center transition-all ${sceneDurationMode === 'scenes' ? 'border-brand-cyan bg-brand-cyan/5 shadow-xl scale-[1.02]' : 'border-gray-50 hover:border-gray-100'}`}
                  >
                    <span className="text-xs font-black uppercase block mb-1">씬(컷) 수</span>
                    <span className="text-[10px] text-gray-400">8초 단위 컷</span>
                  </button>
                </div>
                {sceneDurationMode === 'time' ? (
                  <div>
                    <div className="flex items-center gap-4">
                      <input
                        type="range" min={8} max={120} step={8} value={duration}
                        onChange={e => { const v = Number(e.target.value); setDuration(v); setTargetSceneCount(Math.max(1, Math.round(v / 8))); }}
                        className="flex-1 h-2 accent-brand-cyan"
                      />
                      <span className="text-2xl font-black text-brand-dark w-24 text-right">{duration}초</span>
                    </div>
                    <p className="text-xs text-gray-400 mt-2 italic">약 {Math.max(1, Math.round(duration / 8))}개 씬 (8초/씬 기준)</p>
                  </div>
                ) : (
                  <div>
                    <div className="flex items-center gap-6">
                      {[2, 3, 4, 5, 6, 8, 10].map(n => (
                        <button key={n} onClick={() => { setTargetSceneCount(n); setDuration(n * 8); }}
                          className={`w-14 h-14 rounded-2xl border-4 font-black text-lg transition-all ${targetSceneCount === n ? 'border-brand-cyan bg-brand-cyan/5 shadow-xl scale-110' : 'border-gray-50 hover:border-gray-100'}`}
                        >{n}</button>
                      ))}
                    </div>
                    <p className="text-xs text-gray-400 mt-2 italic">총 약 {targetSceneCount * 8}초 영상 ({targetSceneCount}컷 × 8초)</p>
                  </div>
                )}
              </section>
              <section>
                <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 mb-4 flex items-center gap-2">
                  <Icons.User size={14} /> Character Profile <span className="text-gray-300 normal-case font-medium">(선택사항)</span>
                </h3>
                <p className="text-xs text-gray-400 mb-4 italic">주인공의 외형을 상세히 설명하면 모든 씬에서 일관된 캐릭터가 등장합니다.</p>
                <textarea
                  value={characterProfile}
                  onChange={e => setCharacterProfile(e.target.value)}
                  placeholder="예: 30대 한국 남성, 짧은 검은 머리, 둥근 안경, 파란색 후드티를 입고 있음. 중간 체형, 밝고 친근한 표정."
                  className="w-full p-6 bg-gray-50 rounded-[2rem] outline-none text-sm font-medium leading-relaxed shadow-inner resize-none h-24"
                />
                <div className="mt-6 p-5 bg-gradient-to-br from-amber-50 to-orange-50 rounded-[2rem] border-2 border-amber-100">
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <div className="flex-1">
                      <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-700 flex items-center gap-2">
                        <Icons.ImageIcon size={12} /> Character Reference Image
                      </h4>
                      <p className="text-[10px] text-amber-600 mt-1 italic leading-relaxed">
                        업로드하거나 자동 생성한 참조 이미지를 모든 씬 생성에 함께 전달합니다. 캐릭터 얼굴·복장·정체성이 씬마다 흔들리지 않습니다.
                      </p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <label className="px-4 py-2 bg-white border border-amber-200 rounded-full text-[10px] font-bold text-amber-700 hover:bg-amber-50 cursor-pointer transition-all">
                        {generatingReference ? '업로드 중…' : '업로드'}
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          disabled={generatingReference}
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            if (file.size > 4 * 1024 * 1024) {
                              alert('참조 이미지는 4MB 이하여야 합니다.');
                              e.target.value = '';
                              return;
                            }
                            setGeneratingReference(true);
                            try {
                              const ext = (file.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
                              const storagePath = `users/${userId}/projects/${projectId}/character_ref.${ext}`;
                              const url = await uploadFileToCloud(storagePath, file, 'blob');
                              if (!url.startsWith('http')) {
                                throw new Error('Storage 업로드에 실패했습니다. Firebase Storage 설정을 확인해주세요.');
                              }
                              setCharacterReferenceImage(url);
                              sync();
                            } catch (err: any) {
                              alert(`참조 이미지 업로드 실패: ${err?.message || ''}`);
                            } finally {
                              setGeneratingReference(false);
                              e.target.value = '';
                            }
                          }}
                        />
                      </label>
                      <button
                        disabled={generatingReference || !characterProfile.trim()}
                        onClick={async () => {
                          setGeneratingReference(true);
                          try {
                            const imgModel = allModels.find(m => m.id === selectedImageModel);
                            const result = await generateSceneImage(
                              `Full-body character reference portrait of: ${characterProfile}. Neutral studio background, even lighting, character centered and clearly visible. Use this as a model sheet for downstream scenes.`,
                              videoStyle,
                              aspectRatio,
                              imgModel?.modelId,
                              imgModel?.provider,
                              characterProfile || undefined,
                              { styleSheet, visionCritic: false },
                            );
                            if (result) {
                              const ext = result.mimeType.includes('png') ? 'png' : 'jpg';
                              const storagePath = `users/${userId}/projects/${projectId}/character_ref.${ext}`;
                              const url = await uploadFileToCloud(storagePath, result.base64, 'base64');
                              if (!url.startsWith('http')) {
                                throw new Error('Storage 업로드에 실패했습니다. Firebase Storage 설정을 확인해주세요.');
                              }
                              setCharacterReferenceImage(url);
                              sync();
                            }
                          } catch (err: any) {
                            alert(`참조 이미지 생성 실패: ${err?.message || ''}`);
                          } finally {
                            setGeneratingReference(false);
                          }
                        }}
                        className="px-4 py-2 bg-amber-500 text-white rounded-full text-[10px] font-bold hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                      >
                        {generatingReference ? '생성 중…' : 'AI로 자동 생성'}
                      </button>
                      {characterReferenceImage && (
                        <button
                          onClick={() => { setCharacterReferenceImage(undefined); sync(); }}
                          className="px-3 py-2 bg-white border border-red-200 rounded-full text-[10px] font-bold text-red-500 hover:bg-red-50 transition-all"
                        >
                          제거
                        </button>
                      )}
                    </div>
                  </div>
                  {characterReferenceImage ? (
                    <div className="flex items-center gap-3 mt-2">
                      <img
                        src={characterReferenceImage}
                        alt="Character reference"
                        className="w-24 h-24 rounded-2xl object-cover border-4 border-white shadow-md"
                      />
                      <p className="text-[10px] text-amber-600 font-medium leading-relaxed">
                        ✓ 이 이미지가 모든 씬 이미지 생성에 reference 로 함께 전달됩니다.<br/>
                        Vision Critic 도 이 이미지를 기준으로 캐릭터 일관성을 채점합니다.
                      </p>
                    </div>
                  ) : (
                    <p className="text-[10px] text-amber-500 italic mt-1">
                      참조 이미지가 없으면 텍스트 설명만으로 매 씬을 그리므로 캐릭터가 흔들릴 수 있습니다.
                    </p>
                  )}
                </div>
                <div className="mt-4 flex items-center gap-3">
                  <button
                    onClick={() => setUseReferenceImage(!useReferenceImage)}
                    className={`w-12 h-7 rounded-full transition-all relative ${useReferenceImage ? 'bg-brand-cyan' : 'bg-gray-200'}`}
                  >
                    <div className={`w-5 h-5 bg-white rounded-full absolute top-1 transition-all shadow-sm ${useReferenceImage ? 'left-6' : 'left-1'}`} />
                  </button>
                  <span className="text-xs font-bold text-gray-500">첫 번째 씬 이미지를 나머지 씬의 참조 이미지로 사용</span>
                </div>
              </section>
              <section>
                <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 mb-4 flex items-center gap-2">
                  <Icons.User size={14} /> Cast (Multiple Characters) <span className="text-gray-300 normal-case font-medium">(선택사항)</span>
                </h3>
                <p className="text-xs text-gray-400 mb-4 italic">
                  여러 캐릭터(예: 호스트 & 게스트, 주인공 & 악역)가 등장하는 스토리에서 캐릭터마다 이름과 참조 이미지를 등록하세요.
                  스크립트 분석 시 각 씬에 등장하는 캐릭터가 자동으로 태깅되고, 이미지 생성 시 해당 캐릭터의 참조 이미지만 함께 전달됩니다.
                </p>
                <div className="space-y-3">
                  {characterReferences.map((c, idx) => (
                    <div key={idx} className="p-4 bg-gradient-to-br from-sky-50 to-indigo-50 rounded-3xl border-2 border-sky-100">
                      <div className="flex gap-4">
                        <div className="shrink-0">
                          {c.imageUrl ? (
                            <img src={c.imageUrl} alt={c.name || 'character'} className="w-20 h-20 rounded-2xl object-cover border-4 border-white shadow-md" />
                          ) : (
                            <div className="w-20 h-20 rounded-2xl bg-white/70 border-2 border-dashed border-sky-200 flex items-center justify-center text-[9px] text-sky-400 font-bold text-center px-1">
                              No image
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0 space-y-2">
                          <input
                            value={c.name}
                            onChange={e => {
                              const v = e.target.value;
                              setCharacterReferences(prev => prev.map((x, i) => i === idx ? { ...x, name: v } : x));
                            }}
                            placeholder="캐릭터 이름 (예: Alex, 진행자, 악당 보스)"
                            className="w-full p-3 bg-white rounded-xl outline-none text-sm font-bold shadow-inner"
                          />
                          <textarea
                            value={c.description || ''}
                            onChange={e => {
                              const v = e.target.value;
                              setCharacterReferences(prev => prev.map((x, i) => i === idx ? { ...x, description: v } : x));
                            }}
                            placeholder="외형 설명 (선택) — 예: 20대 여성, 단발머리, 흰 셔츠"
                            className="w-full p-3 bg-white rounded-xl outline-none text-[11px] font-medium shadow-inner resize-none h-12"
                          />
                          <div className="flex flex-wrap gap-2">
                            <label className="px-3 py-1.5 bg-white border border-sky-200 rounded-full text-[10px] font-bold text-sky-700 hover:bg-sky-50 cursor-pointer transition-all">
                              {generatingCharRefIdx === idx ? '업로드 중…' : '이미지 업로드'}
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                disabled={generatingCharRefIdx !== null}
                                onChange={async (e) => {
                                  const file = e.target.files?.[0];
                                  if (!file) return;
                                  if (file.size > 4 * 1024 * 1024) {
                                    alert('참조 이미지는 4MB 이하여야 합니다.');
                                    e.target.value = '';
                                    return;
                                  }
                                  setGeneratingCharRefIdx(idx);
                                  try {
                                    const ext = (file.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
                                    const safeName = (c.name || `cast${idx}`).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32) || `cast${idx}`;
                                    const storagePath = `users/${userId}/projects/${projectId}/cast/${safeName}_${idx}.${ext}`;
                                    const url = await uploadFileToCloud(storagePath, file, 'blob');
                                    if (!url.startsWith('http')) {
                                      throw new Error('Storage 업로드 실패. Firebase Storage 설정을 확인해주세요.');
                                    }
                                    setCharacterReferences(prev => prev.map((x, i) => i === idx ? { ...x, imageUrl: url } : x));
                                    sync();
                                  } catch (err: any) {
                                    alert(`업로드 실패: ${err?.message || ''}`);
                                  } finally {
                                    setGeneratingCharRefIdx(null);
                                    e.target.value = '';
                                  }
                                }}
                              />
                            </label>
                            <button
                              disabled={generatingCharRefIdx !== null || !(c.name && c.name.trim()) || !(c.description && c.description.trim())}
                              onClick={async () => {
                                setGeneratingCharRefIdx(idx);
                                try {
                                  const imgModel = allModels.find(m => m.id === selectedImageModel);
                                  const result = await generateSceneImage(
                                    `Full-body character reference portrait of "${c.name}": ${c.description || ''}. Neutral studio background, even lighting, character centered and clearly visible. Use as a model sheet.`,
                                    videoStyle,
                                    aspectRatio,
                                    imgModel?.modelId,
                                    imgModel?.provider,
                                    c.description || c.name,
                                    { styleSheet, visionCritic: false },
                                  );
                                  if (result) {
                                    const ext = result.mimeType.includes('png') ? 'png' : 'jpg';
                                    const safeName = (c.name || `cast${idx}`).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32) || `cast${idx}`;
                                    const storagePath = `users/${userId}/projects/${projectId}/cast/${safeName}_${idx}.${ext}`;
                                    const url = await uploadFileToCloud(storagePath, result.base64, 'base64');
                                    if (!url.startsWith('http')) {
                                      throw new Error('Storage 업로드 실패. Firebase Storage 설정을 확인해주세요.');
                                    }
                                    setCharacterReferences(prev => prev.map((x, i) => i === idx ? { ...x, imageUrl: url } : x));
                                    sync();
                                  }
                                } catch (err: any) {
                                  alert(`AI 생성 실패: ${err?.message || ''}`);
                                } finally {
                                  setGeneratingCharRefIdx(null);
                                }
                              }}
                              className="px-3 py-1.5 bg-sky-500 text-white rounded-full text-[10px] font-bold hover:bg-sky-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                              title={!c.description?.trim() ? '외형 설명을 먼저 적어주세요' : 'AI로 캐릭터 시트 생성'}
                            >
                              {generatingCharRefIdx === idx ? '생성 중…' : 'AI 생성'}
                            </button>
                            <button
                              onClick={() => {
                                if (!confirm(`'${c.name || '이 캐릭터'}'를 캐스트에서 제거할까요?`)) return;
                                setCharacterReferences(prev => prev.filter((_, i) => i !== idx));
                                sync();
                              }}
                              className="px-3 py-1.5 bg-white border border-red-200 rounded-full text-[10px] font-bold text-red-500 hover:bg-red-50 transition-all"
                            >
                              <Icons.Trash2 size={10} />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                  <button
                    onClick={() => {
                      setCharacterReferences(prev => ([...prev, { name: '', description: '', imageUrl: '' }]));
                    }}
                    className="w-full py-3 bg-white border-2 border-dashed border-sky-200 rounded-2xl text-xs font-bold text-sky-600 hover:bg-sky-50 hover:border-sky-300 transition-all flex items-center justify-center gap-2"
                  >
                    <Icons.Plus size={14} /> 캐릭터 추가
                  </button>
                  {characterReferences.length === 0 && (
                    <p className="text-[10px] text-gray-400 italic">
                      캐스트가 비어 있으면 위의 단일 'Character Reference Image'만 사용됩니다 (단일 주인공 영상에 적합).
                    </p>
                  )}
                  {characterReferences.length > 0 && (
                    <p className="text-[10px] text-sky-600 italic">
                      ✓ {characterReferences.filter(c => c.name && c.imageUrl).length}/{characterReferences.length}명 등록 완료. 다음 단계의 씬 분석에서 자동 태깅됩니다.
                    </p>
                  )}
                </div>
              </section>
              <section>
                <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 mb-4 flex items-center gap-2">
                  <Icons.Wand2 size={14} /> Director Pipeline
                </h3>
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setVisionCriticEnabled(!visionCriticEnabled)}
                      className={`w-12 h-7 rounded-full transition-all relative ${visionCriticEnabled ? 'bg-brand-cyan' : 'bg-gray-200'}`}
                    >
                      <div className={`w-5 h-5 bg-white rounded-full absolute top-1 transition-all shadow-sm ${visionCriticEnabled ? 'left-6' : 'left-1'}`} />
                    </button>
                    <div className="flex-1">
                      <span className="text-xs font-bold text-gray-700 block">Vision Critic 자동 품질 검수</span>
                      <span className="text-[10px] text-gray-400 italic">생성된 이미지를 AI가 채점하고 {qualityThreshold}점 미만이면 1회 자동 재생성합니다 (생성 시간 약 2배).</span>
                    </div>
                  </div>
                  {visionCriticEnabled && (
                    <div className="pl-15 ml-15">
                      <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 block mb-2 flex items-center justify-between">
                        <span>품질 기준 (Quality Threshold)</span>
                        <span className="text-brand-cyan font-black tabular-nums">{qualityThreshold}/10</span>
                      </label>
                      <input
                        type="range"
                        min={4}
                        max={8}
                        step={1}
                        value={qualityThreshold}
                        onChange={e => setQualityThreshold(parseInt(e.target.value, 10))}
                        className="w-full accent-brand-cyan"
                      />
                      <div className="flex justify-between text-[9px] text-gray-400 mt-1 font-bold">
                        <span>4 (관대)</span>
                        <span>6 (기본)</span>
                        <span>8 (엄격)</span>
                      </div>
                      <p className="text-[10px] text-gray-400 italic mt-2">기준이 높을수록 재생성이 잦아져 시간·비용이 늘어납니다.</p>
                    </div>
                  )}
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 block mb-2">
                      Negative Prompt <span className="text-gray-300 normal-case font-medium">(피하고 싶은 요소)</span>
                    </label>
                    <input
                      value={negativePrompt}
                      onChange={e => setNegativePrompt(e.target.value)}
                      placeholder="예: blurry, low quality, distorted hands, watermark, text"
                      className="w-full p-4 bg-gray-50 rounded-2xl outline-none text-xs font-medium shadow-inner"
                    />
                  </div>
                </div>
              </section>
              <section>
                <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 mb-4 flex items-center gap-2">
                  <Icons.Mic size={14} /> Audio Source
                </h3>
                <div className="flex gap-4">
                  <button
                    onClick={() => setUseVeoAudio(true)}
                    className={`flex-1 p-5 rounded-[2rem] border-4 text-left transition-all ${useVeoAudio ? 'border-brand-cyan bg-brand-cyan/5 shadow-xl scale-[1.02]' : 'border-gray-50 hover:border-gray-100'}`}
                  >
                    <span className="text-xs font-black uppercase block mb-1">Veo 3.1 내장 오디오</span>
                    <span className="text-[10px] text-gray-400 leading-relaxed block">비디오에 대사·효과음·배경음이 자동 포함됩니다. 별도 오디오 단계를 건너뛸 수 있습니다.</span>
                    <span className="inline-block mt-2 text-[9px] bg-green-50 text-green-600 px-2 py-0.5 rounded-full font-bold">추천 · 립싱크 지원</span>
                  </button>
                  <button
                    onClick={() => setUseVeoAudio(false)}
                    className={`flex-1 p-5 rounded-[2rem] border-4 text-left transition-all ${!useVeoAudio ? 'border-brand-cyan bg-brand-cyan/5 shadow-xl scale-[1.02]' : 'border-gray-50 hover:border-gray-100'}`}
                  >
                    <span className="text-xs font-black uppercase block mb-1">별도 TTS 나레이션</span>
                    <span className="text-[10px] text-gray-400 leading-relaxed block">Gemini TTS로 나레이션을 별도 생성합니다. 음성 스타일을 세밀하게 제어할 수 있습니다.</span>
                    <span className="inline-block mt-2 text-[9px] bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full font-bold">오디오 단계 필요</span>
                  </button>
                </div>
              </section>
            </div>
            <div className="space-y-16">
              <section>
                <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 mb-4 flex items-center gap-2">
                  <Icons.Film size={14} /> Video Creation Mode
                </h3>
                <p className="text-xs text-gray-400 mb-4 italic">비디오 제작 방식을 선택하세요.</p>
                <div className="flex gap-4">
                  <button
                    onClick={() => setVideoMode('ai')}
                    className={`flex-1 p-5 rounded-[2rem] border-4 text-left transition-all ${videoMode === 'ai' ? 'border-brand-cyan bg-brand-cyan/5 shadow-xl scale-[1.02]' : 'border-gray-50 hover:border-gray-100'}`}
                  >
                    <span className="text-xs font-black uppercase block mb-1">AI Video (Veo)</span>
                    <span className="text-[10px] text-gray-400 leading-relaxed block">AI가 각 씬을 동영상으로 직접 생성합니다. 가장 자연스러운 움직임과 애니메이션을 제공합니다.</span>
                    <span className="inline-block mt-2 text-[9px] bg-purple-50 text-purple-600 px-2 py-0.5 rounded-full font-bold">고품질 AI 영상</span>
                  </button>
                  <button
                    onClick={() => setVideoMode('presentation')}
                    className={`flex-1 p-5 rounded-[2rem] border-4 text-left transition-all ${videoMode === 'presentation' ? 'border-brand-cyan bg-brand-cyan/5 shadow-xl scale-[1.02]' : 'border-gray-50 hover:border-gray-100'}`}
                  >
                    <span className="text-xs font-black uppercase block mb-1">Presentation Mode</span>
                    <span className="text-[10px] text-gray-400 leading-relaxed block">이미지에 전환 효과(페이드, 슬라이드, 와이프 등), 모션(줌/팬), 텍스트 오버레이를 적용하여 프레젠테이션 스타일 영상을 만듭니다.</span>
                    <span className="inline-block mt-2 text-[9px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full font-bold">전환 효과 · 텍스트 · 빠른 생성</span>
                  </button>
                </div>
              </section>
            </div>
            <button onClick={() => { const ns = 2; setStep(ns); setMaxStep(prev => Math.max(prev, ns)); sync(ns); }} className="mt-20 bg-brand-dark text-white py-8 rounded-full font-black text-2xl shadow-2xl hover:brightness-110 transition-all">
              Initialize Vibe Script <Icons.ChevronRight className="inline" size={28} />
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="flex-1 flex flex-col max-w-4xl mx-auto w-full gap-8">
            <div className="flex gap-4">
              <input value={topic} onChange={e => setTopic(e.target.value)} placeholder="비디오 주제를 입력하세요 (예: 2024년 파리 올림픽 요약)..." className="flex-1 p-8 bg-gray-50 rounded-[2.5rem] outline-none text-2xl font-bold shadow-inner" />
              <button onClick={async () => {
                setLoading(true); setLoadingMessage("AI가 창의적인 스크립트를 빌드 중입니다...");
                try {
                  const result = await generateScript(topic, videoStyle, duration, targetSceneCount, { genre, platform });
                  setScript(result);
                } catch (e: any) {
                  console.error("Script generation failed:", e);
                  alert(e?.message?.includes('API key') 
                    ? 'API 키가 설정되지 않았습니다. Gemini API 키(API_KEY)를 환경 변수에 설정해주세요.'
                    : `스크립트 생성 실패: ${e?.message || '알 수 없는 오류'}`);
                } finally {
                  setLoading(false);
                }
              }} className="bg-brand-cyan text-black px-10 rounded-[2.5rem] shadow-xl hover:scale-105 transition-all"><Icons.Wand2 size={28} /></button>
            </div>
            <textarea value={script} onChange={e => setScript(e.target.value)} className="flex-1 p-10 bg-gray-50 rounded-[3rem] outline-none font-serif text-xl leading-relaxed shadow-inner" placeholder="AI가 작성한 스크립트..." />
            <div className="flex gap-4">
               <button onClick={() => setStep(1)} className="px-10 py-6 rounded-full font-black text-gray-400 hover:text-black transition-colors">Back</button>
               <button onClick={async () => {
                  setLoading(true); setLoadingMessage("스크립트를 씬 단위로 분석하고 있습니다...");
                  try {
                    const s = await segmentScriptIntoScenes(script, videoStyle, aspectRatio, characterProfile || undefined, targetSceneCount, { genre, platform, characterReferences });
                    setScenes(s);
                    if (!styleSheet) {
                      try {
                        setLoadingMessage('비주얼 스타일 시트를 추출하는 중...');
                        const sheet = await generateStyleSheet(topic, script, videoStyle, { genre });
                        setStyleSheet(sheet);
                      } catch (sheetErr) {
                        console.warn('[StyleSheet] auto-generation failed, continuing:', sheetErr);
                      }
                    }
                    setStep(3); setMaxStep(prev => Math.max(prev, 3)); setLoading(false);
                    await sync(3, s, {}, { script, topic, maxStep: Math.max(maxStep, 3) });
                  } catch (e) {
                    console.error("Scene segmentation failed:", e);
                    setLoading(false);
                  }
                }} className="flex-1 bg-brand-dark text-white py-6 rounded-full font-black text-2xl shadow-2xl hover:scale-[1.01] transition-all">
                Construct Storyboard
              </button>
            </div>
          </div>
        )}

        {(step >= 3 && step <= 5) && (
          <div className="flex-1 flex flex-col h-full">
            {step === 3 && useVeoAudio && (
              <div className="mb-6 p-6 bg-gradient-to-r from-green-50 to-emerald-50 rounded-[2rem] border-2 border-green-200">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center shrink-0 mt-0.5">
                    <Icons.Check size={20} className="text-green-600" />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-black text-sm text-green-800 mb-1">Veo 3.1 내장 오디오 활성화됨</h4>
                    <p className="text-xs text-green-700 leading-relaxed mb-3">
                      비디오 생성 시 대사·효과음·배경음이 자동으로 포함됩니다. 별도의 TTS 오디오 생성을 건너뛰고 바로 이미지 단계로 진행할 수 있습니다.
                    </p>
                    <div className="flex gap-3">
                      <button
                        onClick={() => { const ns = 4 as any; setStep(ns); setMaxStep(prev => Math.max(prev, ns)); sync(ns); }}
                        className="px-6 py-2.5 bg-green-600 text-white rounded-full text-xs font-black shadow-md hover:scale-105 transition-all flex items-center gap-2"
                      >
                        <Icons.ArrowRight size={14} /> 오디오 건너뛰기 → 이미지 단계로
                      </button>
                      <button
                        onClick={() => setUseVeoAudio(false)}
                        className="px-6 py-2.5 bg-white text-green-700 border border-green-300 rounded-full text-xs font-bold hover:bg-green-50 transition-all"
                      >
                        TTS 나레이션 모드로 전환
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
            <div className="flex justify-between items-center mb-10">
              <div>
                <h2 className="text-4xl font-black tracking-tight">
                  {step === 3 ? 'AI Audio Synthesis' : step === 4 ? 'Visual Storyboard' : (isPresentationMode ? 'Presentation Config' : 'AI Motion Engine')}
                </h2>
                <p className="text-gray-400 font-medium italic">
                  {step === 3 && useVeoAudio ? 'Veo 3.1 내장 오디오를 사용 중입니다. 아래에서 TTS 나레이션을 추가로 생성하거나 건너뛸 수 있습니다.' :
                   step === 4 ? '모든 이미지가 생성되어야 다음 단계로 진행할 수 있습니다.' :
                   isPresentationMode ? '각 씬의 전환 효과, 모션, 텍스트 오버레이를 설정하세요.' :
                   '오토 제너레이트 버튼을 클릭하여 모든 씬을 한 번에 완성하세요.'}
                </p>
                {failedCount(step === 3 ? 'audio' : step === 4 ? 'image' : 'video') > 0 && !isProcessing && (
                  <p className="text-red-500 text-sm font-bold mt-1">
                    {failedCount(step === 3 ? 'audio' : step === 4 ? 'image' : 'video')}개 씬 실패 - 개별 재시도하거나 전체 재생성을 눌러주세요
                  </p>
                )}
              </div>
              {step === 5 && isPresentationMode ? (
                <div className="flex items-center gap-3 flex-wrap">
                  <select
                    onChange={(e) => applyDefaultTransitions(e.target.value as TransitionType)}
                    className="px-5 py-3 rounded-2xl border-2 border-gray-200 text-sm font-bold bg-white"
                    defaultValue=""
                  >
                    <option value="" disabled>전체 전환 효과 일괄 적용</option>
                    {TRANSITION_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  <select
                    onChange={(e) => applyDefaultMotion(e.target.value as MotionPreset)}
                    className="px-5 py-3 rounded-2xl border-2 border-gray-200 text-sm font-bold bg-white"
                    defaultValue=""
                  >
                    <option value="" disabled>전체 모션 일괄 적용</option>
                    {MOTION_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <button 
                  disabled={isProcessing}
                  onClick={step === 3 ? handleBatchAudio : step === 4 ? handleBatchImages : handleBatchVideos} 
                  className={`px-12 py-5 rounded-full font-black text-lg shadow-xl transition-all ${isProcessing ? 'bg-gray-100 text-gray-300' : 'bg-brand-cyan text-black hover:scale-105 active:scale-95'}`}
                >
                  {isProcessing ? (
                    <span className="flex items-center gap-3">
                      <Icons.Loader2 className="animate-spin" size={20} />
                      {loadingMessage || `처리 중... (${processingSet.size}개 동시)`}
                    </span>
                  ) : `Auto-Generate All`}
                </button>
              )}
            </div>

            {(step === 4 || (step === 5 && !isPresentationMode)) && (
              <div className="mb-6">
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">
                    {step === 4 ? 'Image Model' : 'Video Model'}
                  </span>
                  <button
                    onClick={() => setShowModelSelector(showModelSelector === (step === 4 ? 'image' : 'video') ? null : (step === 4 ? 'image' : 'video'))}
                    className="text-xs font-bold text-brand-cyan hover:underline"
                  >
                    {showModelSelector === (step === 4 ? 'image' : 'video') ? '닫기' : '변경'}
                  </button>
                </div>
                {(() => {
                  const currentModels = step === 4 ? getModelsByType(allModels, 'image') : getModelsByType(allModels, 'video');
                  const selectedId = step === 4 ? selectedImageModel : selectedVideoModel;
                  const currentModel = currentModels.find(m => m.id === selectedId);
                  return (
                    <>
                      <div className="flex items-center gap-3 px-5 py-3 bg-gray-50 rounded-2xl border border-gray-100">
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-cyan/20 to-purple-100 flex items-center justify-center">
                          {step === 4 ? <Icons.ImageIcon size={14} className="text-brand-dark" /> : <Icons.Film size={14} className="text-brand-dark" />}
                        </div>
                        <div className="flex-1">
                          <span className="font-bold text-sm">{currentModel?.name || '모델 선택'}</span>
                          <span className="text-xs text-gray-400 ml-2">{currentModel?.provider}</span>
                        </div>
                        {currentModel && !currentModel.supportsKorean && (
                          <span className="text-[10px] bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full font-bold">한글 미지원</span>
                        )}
                      </div>
                      {showModelSelector === (step === 4 ? 'image' : 'video') && (
                        <div className="mt-3 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 max-h-64 overflow-y-auto p-1">
                          {currentModels.map(m => (
                            <button
                              key={m.id}
                              onClick={() => {
                                if (step === 4) setSelectedImageModel(m.id);
                                else setSelectedVideoModel(m.id);
                                setShowModelSelector(null);
                              }}
                              className={`p-4 rounded-2xl border-2 text-left transition-all hover:shadow-md ${m.id === selectedId ? 'border-brand-cyan bg-brand-cyan/5 shadow-lg' : 'border-gray-100 hover:border-gray-200'}`}
                            >
                              <div className="flex items-center gap-2 mb-1">
                                <span className="font-bold text-sm truncate">{m.name}</span>
                              </div>
                              <span className="text-[10px] text-gray-400 font-medium">{m.provider}</span>
                              <p className="text-[11px] text-gray-500 mt-1 line-clamp-2">{m.description}</p>
                              {!m.supportsKorean && (
                                <span className="inline-block mt-1 text-[9px] bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded font-bold">한글 미지원</span>
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            )}

            {step === 4 && (() => {
              const imgApiId = resolveApiModelId(allModels, selectedImageModel);
              const vidApiId = resolveApiModelId(allModels, selectedVideoModel);
              const breakdown = estimateCost({
                imagesGenerated: stats.imagesGenerated,
                refineCalls: stats.refineCalls,
                criticCalls: stats.criticCalls,
                videosGenerated: 0,
                imageModelId: imgApiId,
                videoModelId: vidApiId,
              });
              const tooltip = `예상 비용 (USD)\n이미지 ${formatUsd(breakdown.imagesUsd)} · 재생성 ${formatUsd(breakdown.refinesUsd)} · 비전 검증 ${formatUsd(breakdown.criticsUsd)}\n실제 청구액은 모델/해상도/토큰 수에 따라 달라질 수 있습니다.`;
              const showCost = (stats.imagesGenerated || stats.refineCalls || stats.criticCalls);
              return (
              <div className="mb-4 flex items-center gap-2 flex-wrap text-[11px] font-bold">
                <span className="text-gray-400 uppercase tracking-widest text-[10px]">생성 비용</span>
                <span className="bg-blue-50 text-blue-700 px-3 py-1.5 rounded-full">
                  이미지 {stats.imagesGenerated || 0}장
                </span>
                <span className="bg-amber-50 text-amber-700 px-3 py-1.5 rounded-full">
                  재생성 {stats.refineCalls || 0}회
                </span>
                <span className="bg-purple-50 text-purple-700 px-3 py-1.5 rounded-full">
                  비전 검증 {stats.criticCalls || 0}회
                </span>
                {showCost ? (
                  <span
                    className="bg-emerald-50 text-emerald-700 px-3 py-1.5 rounded-full cursor-help"
                    title={tooltip}
                  >
                    예상 비용 ~{formatUsd(breakdown.totalUsd)} USD
                  </span>
                ) : null}
                {(stats.imagesGenerated || stats.criticCalls || stats.refineCalls) ? (
                  <button
                    onClick={() => {
                      const reset = { imagesGenerated: 0, criticCalls: 0, refineCalls: 0, videosGenerated: stats.videosGenerated || 0 };
                      setStats(reset);
                      statsRef.current = reset;
                      sync();
                    }}
                    className="text-[10px] text-gray-400 hover:text-gray-700 font-bold underline ml-1"
                    title="이미지·검증 카운터 초기화"
                  >
                    초기화
                  </button>
                ) : null}
              </div>
              );
            })()}

            {step === 4 && characterReferenceImage && (
              <div className="mb-4 p-4 bg-gradient-to-br from-amber-50 to-orange-50 rounded-[2rem] border-2 border-amber-100 flex items-center gap-4">
                <img
                  src={characterReferenceImage}
                  alt="Character reference"
                  className="w-16 h-16 rounded-2xl object-cover border-4 border-white shadow-md shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-700 flex items-center gap-2">
                    <Icons.ImageIcon size={12} /> Character Reference Locked
                  </h4>
                  <p className="text-[10px] text-amber-600 italic mt-1">
                    이 참조 이미지가 모든 씬 이미지 생성에 함께 전달되어 캐릭터 일관성을 유지합니다.
                  </p>
                </div>
                <button
                  onClick={() => { if (confirm('참조 이미지를 제거할까요? 이미 생성된 씬 이미지는 그대로 유지됩니다.')) { setCharacterReferenceImage(undefined); sync(); } }}
                  className="px-3 py-1.5 bg-white border border-amber-200 rounded-full text-[10px] font-bold text-amber-700 hover:bg-amber-50 shrink-0"
                >
                  제거
                </button>
              </div>
            )}

            {step === 4 && styleSheet && (
              <div className="mb-6 p-6 bg-gradient-to-br from-purple-50 to-blue-50 rounded-[2rem] border-2 border-purple-100">
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div>
                    <h4 className="text-xs font-black uppercase tracking-[0.2em] text-purple-700 flex items-center gap-2">
                      <Icons.Palette size={14} /> Style Sheet
                    </h4>
                    <p className="text-[10px] text-purple-500 mt-1 italic">전 씬에 자동 적용되는 비주얼 가이드 — 일관된 색감·조명·무드를 보장합니다.</p>
                  </div>
                  <button
                    disabled={generatingStyleSheet || !script}
                    onClick={async () => {
                      setGeneratingStyleSheet(true);
                      try {
                        const sheet = await generateStyleSheet(topic, script, videoStyle, { genre });
                        setStyleSheet(sheet);
                      } catch (e: any) {
                        alert(`Style Sheet 재생성 실패: ${e?.message || ''}`);
                      } finally {
                        setGeneratingStyleSheet(false);
                      }
                    }}
                    className="px-4 py-2 bg-white border border-purple-200 rounded-full text-[10px] font-bold text-purple-700 hover:bg-purple-50 disabled:opacity-50"
                  >
                    {generatingStyleSheet ? '재생성 중…' : '재생성'}
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex gap-1">
                    {styleSheet.palette.map((color, ci) => (
                      <input
                        key={ci}
                        type="color"
                        value={color}
                        onChange={(e) => {
                          const next = [...styleSheet.palette];
                          next[ci] = e.target.value;
                          setStyleSheet({ ...styleSheet, palette: next });
                        }}
                        className="w-8 h-8 rounded-lg border-2 border-white shadow cursor-pointer"
                        title={color}
                      />
                    ))}
                  </div>
                  <div className="flex-1 min-w-[200px] grid grid-cols-1 md:grid-cols-2 gap-2">
                    <input
                      value={styleSheet.mood}
                      onChange={(e) => setStyleSheet({ ...styleSheet, mood: e.target.value })}
                      placeholder="Mood"
                      className="px-3 py-2 bg-white rounded-xl border border-purple-100 text-xs font-medium"
                    />
                    <input
                      value={styleSheet.lighting}
                      onChange={(e) => setStyleSheet({ ...styleSheet, lighting: e.target.value })}
                      placeholder="Lighting"
                      className="px-3 py-2 bg-white rounded-xl border border-purple-100 text-xs font-medium"
                    />
                  </div>
                </div>
              </div>
            )}
            {step === 5 && (
              <div className="mb-6 p-6 bg-gradient-to-br from-amber-50 to-pink-50 rounded-[2rem] border-2 border-amber-100">
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div>
                    <h4 className="text-xs font-black uppercase tracking-[0.2em] text-amber-700 flex items-center gap-2">
                      <Icons.Type size={14} /> 자막 스타일 <span className="text-[9px] text-amber-500 font-bold normal-case">Submagic-style</span>
                    </h4>
                    <p className="text-[10px] text-amber-600 mt-1 italic">단어별로 강조되는 자막을 영상에 자동으로 입힙니다 (한국어 어절 단위, 이모지 강조).</p>
                  </div>
                  <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-wider text-amber-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={captionStyle.enableEmoji}
                      onChange={(e) => { setCaptionStyle(cs => ({ ...cs, enableEmoji: e.target.checked })); sync(); }}
                      className="w-4 h-4 accent-amber-500"
                    />
                    Emoji
                  </label>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                  {CAPTION_PRESETS.map(p => (
                    <button
                      key={p.id}
                      onClick={() => { setCaptionStyle(cs => ({ ...cs, preset: p.id })); sync(); }}
                      className={`p-4 rounded-2xl border-2 text-left transition-all ${captionStyle.preset === p.id ? 'border-amber-500 bg-white shadow-lg scale-[1.02]' : 'border-amber-100 bg-white/60 hover:border-amber-200'}`}
                    >
                      <span className="block text-sm font-black mb-1">{p.label}</span>
                      <span className="block text-[10px] text-gray-500 leading-tight">{p.description}</span>
                    </button>
                  ))}
                </div>
                {captionStyle.preset !== 'none' && (
                  <div className="flex flex-wrap items-center gap-4">
                    <label className="flex items-center gap-2">
                      <span className="text-[10px] font-black uppercase tracking-widest text-amber-700">강조 색상</span>
                      <input
                        type="color"
                        value={captionStyle.emphasisColor}
                        onChange={(e) => { setCaptionStyle(cs => ({ ...cs, emphasisColor: e.target.value })); sync(); }}
                        className="w-9 h-9 rounded-lg border-2 border-white shadow cursor-pointer"
                      />
                    </label>
                    <span className="text-[10px] text-amber-600 italic ml-auto">자막은 내보내기 단계에서 영상에 입혀집니다.</span>
                  </div>
                )}
              </div>
            )}
            <div className="flex-1 overflow-y-auto pr-4 space-y-6 hide-scrollbar">
              {scenes.map((s, i) => {
                const mediaType = step === 3 ? 'audio' : step === 4 ? 'image' : 'video';
                const isFailed = failedScenes.has(`${mediaType}-${i}`);
                const failMsg = failedScenes.get(`${mediaType}-${i}`);
                const isActive = processingSet.has(i);
                const qs = s.qualityScore;
                const qsBadgeColor = !qs ? '' : qs.overall >= 8 ? 'bg-green-100 text-green-700' : qs.overall >= 6 ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700';
                const isQualityExpanded = expandedQuality.has(i);
                const toggleQuality = () => setExpandedQuality(prev => {
                  const n = new Set(prev);
                  if (n.has(i)) n.delete(i); else n.add(i);
                  return n;
                });
                const axisColor = (v: number) => v >= 8 ? 'bg-green-500' : v >= 6 ? 'bg-blue-500' : v >= 4 ? 'bg-amber-500' : 'bg-red-500';
                return (
                <div key={i} className={`p-8 rounded-[3.5rem] flex flex-col md:flex-row gap-8 items-center border transition-all duration-500 relative ${isActive ? 'bg-brand-cyan/10 border-brand-cyan scale-[1.01] shadow-2xl' : isFailed ? 'bg-red-50 border-red-300 shadow-md' : 'bg-gray-50 border-gray-100 shadow-sm'}`}>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-3 flex-wrap">
                      <span className="bg-brand-dark/5 text-brand-dark/40 px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest">Scene {i+1}</span>
                      {s.beatRole && <span className="bg-purple-50 text-purple-600 px-3 py-1 rounded-full text-[10px] font-black uppercase">{s.beatRole}</span>}
                      {s.shotType && <span className="bg-blue-50 text-blue-600 px-3 py-1 rounded-full text-[10px] font-bold">{s.shotType}</span>}
                      {s.cameraMovement && s.cameraMovement !== 'static' && <span className="bg-cyan-50 text-cyan-600 px-3 py-1 rounded-full text-[10px] font-bold">{s.cameraMovement}</span>}
                      {qs && (
                        <button
                          type="button"
                          onClick={toggleQuality}
                          className={`px-3 py-1 rounded-full text-[10px] font-black uppercase ${qsBadgeColor} hover:opacity-80 transition-opacity flex items-center gap-1`}
                          title="품질 점수 상세 보기"
                        >
                          ★ {qs.overall}/10{qs.refined ? ' ↻' : ''}
                          <Icons.ChevronDown size={10} className={`transition-transform ${isQualityExpanded ? 'rotate-180' : ''}`} />
                        </button>
                      )}
                      {isFailed && <span className="bg-red-100 text-red-600 px-3 py-1 rounded-full text-[10px] font-black uppercase">Failed</span>}
                      {isActive && <span className="bg-brand-cyan/20 text-brand-cyan px-3 py-1 rounded-full text-[10px] font-black uppercase animate-pulse">Processing</span>}
                    </div>
                    <p className="text-brand-dark text-sm font-medium leading-relaxed italic mb-3">"{s.script_segment}"</p>
                    {step === 4 && (s.lighting || s.durationSec) && (
                      <p className="text-[10px] text-gray-400 mb-3 font-medium">
                        {s.lighting && <>💡 {s.lighting}</>}{s.lighting && s.durationSec ? ' · ' : ''}{s.durationSec ? `⏱ ${s.durationSec}s` : ''}
                      </p>
                    )}
                    {isFailed && <p className="text-red-500 text-xs mb-3 font-medium">{failMsg}</p>}

                    {step === 4 && qs && isQualityExpanded && (
                      <div className="mb-4 p-4 rounded-2xl bg-white border border-gray-200 shadow-sm">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <Icons.Sparkles size={12} className="text-brand-cyan" />
                            <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">품질 점수 상세</span>
                            {qs.refined && <span className="text-[9px] font-bold text-purple-600 bg-purple-50 px-2 py-0.5 rounded-full">↻ refined</span>}
                          </div>
                        </div>
                        <div className="space-y-2 mb-3">
                          {[
                            { label: '캐릭터 일관성', value: qs.characterConsistency },
                            { label: '구도', value: qs.compositionQuality },
                            { label: '의도 일치', value: qs.intentAlignment },
                            { label: '종합', value: qs.overall },
                          ].map(axis => (
                            <div key={axis.label} className="flex items-center gap-3">
                              <span className="text-[11px] font-bold text-gray-700 w-24 shrink-0">{axis.label}</span>
                              <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                                <div className={`h-full ${axisColor(axis.value)} transition-all`} style={{ width: `${(axis.value / 10) * 100}%` }} />
                              </div>
                              <span className="text-[11px] font-black text-gray-700 w-10 text-right">{axis.value}/10</span>
                            </div>
                          ))}
                        </div>
                        {qs.issues && qs.issues.length > 0 ? (
                          <div className="mb-3 p-3 rounded-xl bg-amber-50 border border-amber-100">
                            <div className="flex items-center gap-1.5 mb-2">
                              <Icons.AlertCircle size={11} className="text-amber-600" />
                              <span className="text-[10px] font-black uppercase tracking-widest text-amber-700">AI가 지적한 이슈</span>
                            </div>
                            <ul className="space-y-1">
                              {qs.issues.map((issue, k) => (
                                <li key={k} className="text-[11px] text-amber-900 font-medium leading-relaxed pl-3 relative">
                                  <span className="absolute left-0 top-0">•</span>{issue}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : (
                          <p className="text-[11px] text-gray-400 italic mb-3">지적된 이슈 없음</p>
                        )}
                        <button
                          type="button"
                          onClick={() => handleRefineImage(i)}
                          disabled={isActive || !s.image_path}
                          className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-600 to-pink-500 text-white rounded-full text-[10px] font-black uppercase hover:scale-105 transition-all shadow-md disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
                        >
                          <Icons.Wand2 size={11} /> Refine This Scene
                        </button>
                      </div>
                    )}

                    {step === 5 && isPresentationMode ? (() => {
                      const pres = s.presentation || getDefaultPresentation(i);
                      return (
                        <div className="space-y-4 w-full">
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <div>
                              <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1 block">
                                <Icons.Layers size={10} className="inline mr-1" />전환 효과
                              </label>
                              <select
                                value={pres.transition}
                                onChange={(e) => updateScenePresentation(i, { transition: e.target.value as TransitionType })}
                                className="w-full px-3 py-2 rounded-xl border-2 border-gray-200 text-xs font-bold bg-white"
                              >
                                {i === 0 ? (
                                  <option value="none">없음 (첫 번째 씬)</option>
                                ) : (
                                  TRANSITION_OPTIONS.map(o => (
                                    <option key={o.value} value={o.value}>{o.label}</option>
                                  ))
                                )}
                              </select>
                            </div>
                            <div>
                              <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1 block">
                                <Icons.Move size={10} className="inline mr-1" />모션
                              </label>
                              <select
                                value={pres.motion}
                                onChange={(e) => updateScenePresentation(i, { motion: e.target.value as MotionPreset })}
                                className="w-full px-3 py-2 rounded-xl border-2 border-gray-200 text-xs font-bold bg-white"
                              >
                                {MOTION_OPTIONS.map(o => (
                                  <option key={o.value} value={o.value}>{o.label}</option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1 block">
                                <Icons.Clock size={10} className="inline mr-1" />전환 시간
                              </label>
                              <select
                                value={pres.transitionDuration}
                                onChange={(e) => updateScenePresentation(i, { transitionDuration: Number(e.target.value) })}
                                className="w-full px-3 py-2 rounded-xl border-2 border-gray-200 text-xs font-bold bg-white"
                                disabled={i === 0}
                              >
                                {[0.5, 1, 1.5, 2, 2.5, 3].map(v => (
                                  <option key={v} value={v}>{v}초</option>
                                ))}
                              </select>
                            </div>
                          </div>
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                                <Icons.Type size={10} className="inline mr-1" />텍스트 오버레이
                              </label>
                              {!pres.textOverlay ? (
                                <button onClick={() => updateSceneTextOverlay(i, { text: s.script_segment || '' })} className="text-[10px] font-bold text-brand-cyan hover:underline">
                                  + 추가
                                </button>
                              ) : (
                                <button onClick={() => updateSceneTextOverlay(i, null)} className="text-[10px] font-bold text-red-400 hover:underline">
                                  삭제
                                </button>
                              )}
                            </div>
                            {pres.textOverlay && (
                              <div className="space-y-2 p-3 bg-white rounded-xl border border-gray-100">
                                <textarea
                                  value={pres.textOverlay.text}
                                  onChange={(e) => updateSceneTextOverlay(i, { text: e.target.value })}
                                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-xs font-medium resize-none h-16"
                                  placeholder="표시할 텍스트..."
                                />
                                <div className="flex gap-2 flex-wrap">
                                  {(['top', 'center', 'bottom'] as const).map(pos => (
                                    <button
                                      key={pos}
                                      onClick={() => updateSceneTextOverlay(i, { position: pos })}
                                      className={`px-3 py-1 rounded-lg text-[10px] font-bold border transition-all ${pres.textOverlay?.position === pos ? 'border-brand-cyan bg-brand-cyan/10 text-brand-dark' : 'border-gray-200 text-gray-400 hover:border-gray-300'}`}
                                    >
                                      {pos === 'top' ? '상단' : pos === 'center' ? '중앙' : '하단'}
                                    </button>
                                  ))}
                                  <select
                                    value={pres.textOverlay.fontSize}
                                    onChange={(e) => updateSceneTextOverlay(i, { fontSize: Number(e.target.value) })}
                                    className="px-2 py-1 rounded-lg border border-gray-200 text-[10px] font-bold bg-white"
                                  >
                                    {[20, 24, 28, 32, 40, 48, 56].map(sz => (
                                      <option key={sz} value={sz}>{sz}px</option>
                                    ))}
                                  </select>
                                  <input
                                    type="color"
                                    value={pres.textOverlay.color}
                                    onChange={(e) => updateSceneTextOverlay(i, { color: e.target.value })}
                                    className="w-7 h-7 rounded-lg border border-gray-200 cursor-pointer"
                                    title="텍스트 색상"
                                  />
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })() : (
                    <div className="flex flex-wrap gap-3">
                      {!isProcessing && (
                        <>
                          {s.audio_path && (
                            <button onClick={() => handlePlayAudio(s.audio_path!, i)} className="flex items-center gap-2 px-6 py-2.5 bg-brand-dark text-white rounded-full text-[11px] font-black uppercase hover:scale-105 transition-all shadow-md">
                              {playingAudioIdx === i ? <Icons.Loader2 className="animate-spin" size={12} /> : <Icons.Play size={12} />} Preview Audio
                            </button>
                          )}
                          {step === 5 && s.video_path && (
                            <button onClick={() => setSelectedVideoIdx(selectedVideoIdx === i ? null : i)} className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-purple-600 to-pink-500 text-white rounded-full text-[11px] font-black uppercase hover:scale-105 transition-all shadow-md">
                              <Icons.Play size={12} /> Preview Video
                            </button>
                          )}
                          {step === 3 && (isFailed || !s.audio_path) && (
                            <button onClick={() => handleSingleAudio(i)} className="flex items-center gap-2 px-6 py-2.5 bg-red-500 text-white rounded-full text-[11px] font-black uppercase hover:scale-105 transition-all shadow-md">
                              <Icons.RefreshCw size={12} /> {isFailed ? '재시도' : '오디오 생성'}
                            </button>
                          )}
                          {step === 3 && s.audio_path && !isFailed && (
                            <button onClick={() => handleSingleAudio(i)} className="flex items-center gap-2 px-6 py-2.5 bg-white border-2 border-brand-dark text-black rounded-full text-[11px] font-black uppercase hover:bg-brand-dark hover:text-white transition-all shadow-sm">
                              <Icons.Wand2 size={12} /> Regenerate Audio
                            </button>
                          )}
                          {step === 4 && (isFailed || !s.image_path) && (
                            <button onClick={() => handleSingleImage(i)} className="flex items-center gap-2 px-6 py-2.5 bg-red-500 text-white rounded-full text-[11px] font-black uppercase hover:scale-105 transition-all shadow-md">
                              <Icons.RefreshCw size={12} /> {isFailed ? '재시도' : '이미지 생성'}
                            </button>
                          )}
                          {step === 4 && s.image_path && !isFailed && (
                            <button onClick={() => handleSingleImage(i)} className="flex items-center gap-2 px-6 py-2.5 bg-white border-2 border-brand-dark text-black rounded-full text-[11px] font-black uppercase hover:bg-brand-dark hover:text-white transition-all shadow-sm">
                              <Icons.Wand2 size={12} /> Regenerate Image
                            </button>
                          )}
                          {step === 5 && !isPresentationMode && (isFailed || !s.video_path) && (
                            <button onClick={() => handleSingleVideo(i)} className="flex items-center gap-2 px-6 py-2.5 bg-red-500 text-white rounded-full text-[11px] font-black uppercase hover:scale-105 transition-all shadow-md">
                              <Icons.RefreshCw size={12} /> {isFailed ? '재시도' : '비디오 생성'}
                            </button>
                          )}
                          {step === 5 && !isPresentationMode && s.video_path && !isFailed && (
                            <button onClick={() => handleSingleVideo(i)} className="flex items-center gap-2 px-6 py-2.5 bg-white border-2 border-brand-dark text-black rounded-full text-[11px] font-black uppercase hover:bg-brand-dark hover:text-white transition-all shadow-sm">
                               <Icons.Video size={12} /> Re-Motion Scene
                            </button>
                          )}
                        </>
                      )}
                    </div>
                    )}
                    {step === 5 && !isPresentationMode && selectedVideoIdx === i && s.video_path && (
                      <div className="mt-4 rounded-2xl overflow-hidden bg-black shadow-lg border-2 border-purple-400/30">
                        <video
                          key={`inline-preview-${i}-${s.video_path}`}
                          src={s.video_path}
                          poster={s.image_path}
                          autoPlay
                          controls
                          playsInline
                          className={`w-full ${aspectRatio === '9:16' ? 'max-h-[300px] mx-auto' : 'max-h-[240px]'} object-contain`}
                          ref={(el) => { if (el && s.audio_path && !useVeoAudio) syncAudioWithVideo(el, s.audio_path); }}
                        />
                      </div>
                    )}
                  </div>
                  
                  <div className={`shrink-0 bg-brand-dark rounded-[2.5rem] overflow-hidden shadow-2xl flex items-center justify-center border-4 relative transition-all duration-700 ${aspectRatio === '9:16' ? 'w-40 h-72' : 'w-72 h-40'} ${isActive ? 'border-brand-cyan scale-105' : isFailed ? 'border-red-400' : 'border-white'}`}>
                    {step === 3 ? (
                       <div className="flex flex-col items-center gap-4">
                          {isActive ? (
                             <Icons.Loader2 className="animate-spin text-brand-cyan" size={40} />
                          ) : isFailed ? (
                             <Icons.AlertCircle className="text-red-400" size={40} />
                          ) : s.audio_path ? (
                             <Icons.Check className="text-brand-cyan" size={40} strokeWidth={4} />
                          ) : (
                             <Icons.Mic className="text-white/10" size={40} />
                          )}
                       </div>
                    ) : (step === 4 || step === 5) ? (
                      <div className="relative w-full h-full group" onClick={() => { if (step === 5 && s.video_path) setSelectedVideoIdx(i); }}>
                        {s.video_path ? (
                          <>
                            <video src={s.video_path} autoPlay={false} loop muted playsInline className="w-full h-full object-cover" />
                            {step === 5 && (
                              <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                                <Icons.Maximize2 className="text-white" size={28} />
                              </div>
                            )}
                          </>
                        ) : s.image_path ? (
                          <img src={s.image_path} className="w-full h-full object-cover animate-in fade-in zoom-in-95 duration-700" key={s.image_path} alt="Scene Visual" />
                        ) : isFailed ? (
                          <Icons.AlertCircle className="text-red-400" size={40} />
                        ) : (
                          <Icons.ImageIcon className="text-white/10" size={40} />
                        )}
                        {isActive && (
                          <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center backdrop-blur-md z-10">
                            <Icons.Loader2 className="animate-spin text-brand-cyan mb-2" size={40} />
                            <span className="text-[10px] font-black text-brand-cyan uppercase tracking-widest animate-pulse">Rendering...</span>
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                </div>
                );
              })}
            </div>

            <div className="flex gap-4 mt-10">
               <button disabled={isProcessing} onClick={() => setStep((step - 1) as any)} className="px-10 py-6 rounded-full font-black text-gray-400 hover:text-black disabled:opacity-0 transition-all">Back</button>
               <button 
                  disabled={isProcessing || (step === 4 && !isImagesReady) || (step === 5 && !isPresentationMode && !isVideosReady)} 
                  onClick={() => { const ns = (step + 1) as any; setStep(ns); setMaxStep(prev => Math.max(prev, ns)); sync(ns); }} 
                  className={`flex-1 py-6 rounded-full font-black text-2xl shadow-2xl transition-all ${isProcessing || (step === 4 && !isImagesReady) || (step === 5 && !isPresentationMode && !isVideosReady) ? 'bg-gray-100 text-gray-300 cursor-not-allowed scale-95' : 'bg-brand-dark text-white hover:scale-[1.02] shadow-brand-cyan/20'}`}
               >
                {step === 4 && !isImagesReady ? '이미지를 모두 생성하세요' : 
                 step === 5 && !isPresentationMode && !isVideosReady ? '비디오를 모두 생성하세요' : 
                 'Proceed to Final Assembly'}
              </button>
            </div>
          </div>
        )}

        {/* STEP 6: Composition Preview */}
        {step === 6 && (
           <div className="flex-1 flex flex-col h-full animate-in fade-in duration-700">
              <div className="mb-10 text-center">
                <h2 className="text-5xl font-black text-brand-dark mb-4 tracking-tighter">Director's Preview</h2>
                <p className="text-gray-400 font-medium italic">모든 씬이 유기적으로 연결된 최종 결과물을 확인하세요.</p>
                {(() => {
                  const imgApiId = resolveApiModelId(allModels, selectedImageModel);
                  const vidApiId = resolveApiModelId(allModels, selectedVideoModel);
                  const breakdown = estimateCost({
                    imagesGenerated: stats.imagesGenerated,
                    refineCalls: stats.refineCalls,
                    criticCalls: stats.criticCalls,
                    videosGenerated: stats.videosGenerated,
                    imageModelId: imgApiId,
                    videoModelId: vidApiId,
                  });
                  const tooltip = `예상 비용 (USD)\n이미지 ${formatUsd(breakdown.imagesUsd)} · 재생성 ${formatUsd(breakdown.refinesUsd)} · 비전 검증 ${formatUsd(breakdown.criticsUsd)} · 비디오 ${formatUsd(breakdown.videosUsd)}\n실제 청구액은 모델/해상도/길이에 따라 달라질 수 있습니다.`;
                  const showCost = (stats.imagesGenerated || stats.refineCalls || stats.criticCalls || stats.videosGenerated);
                  return (
                  <div className="mt-4 inline-flex items-center gap-2 flex-wrap text-[11px] font-bold justify-center">
                    <span className="text-gray-400 uppercase tracking-widest text-[10px]">생성 비용</span>
                    <span className="bg-blue-50 text-blue-700 px-3 py-1.5 rounded-full">
                      이미지 {stats.imagesGenerated || 0}장
                    </span>
                    <span className="bg-amber-50 text-amber-700 px-3 py-1.5 rounded-full">
                      재생성 {stats.refineCalls || 0}회
                    </span>
                    <span className="bg-purple-50 text-purple-700 px-3 py-1.5 rounded-full">
                      비전 검증 {stats.criticCalls || 0}회
                    </span>
                    <span className="bg-pink-50 text-pink-700 px-3 py-1.5 rounded-full">
                      비디오 {stats.videosGenerated || 0}편
                    </span>
                    {showCost ? (
                      <span
                        className="bg-emerald-50 text-emerald-700 px-3 py-1.5 rounded-full cursor-help"
                        title={tooltip}
                      >
                        예상 비용 ~{formatUsd(breakdown.totalUsd)} USD
                      </span>
                    ) : null}
                  </div>
                  );
                })()}
                <div className="flex items-center justify-center gap-4 mt-4">
                  <button
                    onClick={() => { setActivePreviewIdx(0); }}
                    className="px-8 py-3 bg-brand-cyan text-black rounded-full font-black text-sm shadow-lg hover:scale-105 transition-all flex items-center gap-2"
                  >
                    <Icons.Play size={16} /> Play All
                  </button>
                  <span className="text-sm font-bold text-gray-500">
                    Scene {activePreviewIdx + 1} / {scenes.length}
                  </span>
                  <div className="w-40 h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-brand-cyan rounded-full transition-all duration-500" style={{ width: `${((activePreviewIdx + 1) / scenes.length) * 100}%` }}></div>
                  </div>
                </div>
              </div>

              <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-10">
                 <div className="lg:col-span-2 bg-brand-dark rounded-[3.5rem] overflow-hidden shadow-[0_40px_100px_rgba(0,0,0,0.5)] relative border-[12px] border-white group">
                    {scenes.length > 0 && scenes[activePreviewIdx] ? (
                       <div className="w-full h-full bg-black relative">
                         {isPresentationMode ? (
                           <>
                             {scenes[activePreviewIdx]?.image_path ? (
                               <img
                                 key={`pres-preview-${activePreviewIdx}`}
                                 src={scenes[activePreviewIdx]?.image_path}
                                 className="w-full h-full object-contain animate-in fade-in duration-700"
                                 alt={`Scene ${activePreviewIdx + 1}`}
                               />
                             ) : (
                               <div className="w-full h-full flex items-center justify-center">
                                 <Icons.ImageIcon className="text-white/20" size={60} />
                               </div>
                             )}
                             <div className="absolute bottom-4 left-4 right-4">
                               {scenes[activePreviewIdx]?.presentation?.textOverlay?.text && (
                                 <div className="bg-black/60 rounded-xl px-4 py-2 text-white text-sm font-medium text-center">
                                   {scenes[activePreviewIdx].presentation!.textOverlay!.text}
                                 </div>
                               )}
                               <div className="flex justify-center gap-2 mt-2">
                                 {(() => {
                                   const pres = scenes[activePreviewIdx]?.presentation;
                                   if (!pres) return null;
                                   return (
                                     <>
                                       {pres.transition !== 'none' && (
                                         <span className="bg-blue-500/80 text-white text-[9px] px-2 py-0.5 rounded-full font-bold">
                                           {TRANSITION_OPTIONS.find(t => t.value === pres.transition)?.label}
                                         </span>
                                       )}
                                       {pres.motion !== 'none' && (
                                         <span className="bg-purple-500/80 text-white text-[9px] px-2 py-0.5 rounded-full font-bold">
                                           {MOTION_OPTIONS.find(m => m.value === pres.motion)?.label}
                                         </span>
                                       )}
                                     </>
                                   );
                                 })()}
                               </div>
                             </div>
                           </>
                         ) : (
                           <>
                             <video 
                                key={`preview-${activePreviewIdx}-${scenes[activePreviewIdx]?.video_path || 'loading'}`} 
                                src={scenes[activePreviewIdx]?.video_path} 
                                poster={scenes[activePreviewIdx]?.image_path}
                                autoPlay 
                                playsInline
                                controls 
                                className="w-full h-full object-contain" 
                                ref={(el) => { if (el && scenes[activePreviewIdx]?.audio_path && !useVeoAudio) syncAudioWithVideo(el, scenes[activePreviewIdx].audio_path); }}
                                onEnded={() => {
                                  if (activePreviewIdx < scenes.length - 1) {
                                    setActivePreviewIdx(activePreviewIdx + 1);
                                  }
                                }}
                              />
                              {!scenes[activePreviewIdx]?.video_path && (
                                 <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40 backdrop-blur-sm pointer-events-none">
                                    <Icons.Loader2 className="animate-spin text-brand-cyan mb-4" size={48} />
                                    <span className="text-white font-black uppercase tracking-widest text-xs">Video Loading...</span>
                                 </div>
                              )}
                           </>
                         )}
                       </div>
                    ) : (
                       <div className="w-full h-full flex flex-col items-center justify-center text-white/10 gap-6">
                          <Icons.VideoOff size={100} />
                          <p className="font-black uppercase tracking-[0.3em] text-sm">Preview Initialization Failed</p>
                       </div>
                    )}
                    
                    {/* Scene Navigation HUD */}
                    <div className="absolute bottom-10 left-1/2 -translate-x-1/2 bg-black/60 backdrop-blur-2xl px-10 py-4 rounded-full flex gap-6 text-white text-[11px] font-black uppercase opacity-0 group-hover:opacity-100 transition-all duration-700 scale-90 group-hover:scale-100 z-30 shadow-2xl">
                       {scenes.map((_, i) => (
                         <button 
                            key={i} 
                            onClick={() => setActivePreviewIdx(i)} 
                            className={`w-12 h-12 rounded-full transition-all flex items-center justify-center border-2 ${activePreviewIdx === i ? 'bg-brand-cyan border-brand-cyan text-black scale-125 shadow-2xl shadow-brand-cyan/40' : 'border-white/20 hover:bg-white/10'}`}
                          >
                           {i+1}
                         </button>
                       ))}
                    </div>
                 </div>

                 {/* Sidebar Navigation */}
                 <div className="space-y-4 overflow-y-auto hide-scrollbar max-h-[550px] pr-2">
                    <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 mb-6 flex items-center gap-2">
                       <Icons.Layout size={14} /> Assembly Timeline
                    </h4>
                    {scenes.map((s, i) => (
                       <div 
                          key={i} 
                          onClick={() => setActivePreviewIdx(i)} 
                          className={`p-5 rounded-[2.5rem] border-2 cursor-pointer transition-all duration-500 ${activePreviewIdx === i ? 'border-brand-cyan bg-brand-cyan/5 shadow-2xl -translate-x-3' : 'border-gray-50 bg-gray-50 opacity-40 hover:opacity-100 hover:border-gray-200'}`}
                        >
                          <div className="flex items-center gap-5">
                             <div className="w-28 h-16 bg-black rounded-2xl overflow-hidden shrink-0 shadow-xl border-2 border-white/10">
                                {s.image_path ? (
                                  <img src={s.image_path} className="w-full h-full object-cover" alt="Timeline Thumbnail" />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center bg-gray-900"><Icons.Video size={16} className="text-white/20" /></div>
                                )}
                             </div>
                             <div className="flex-1">
                                <p className="text-[11px] font-black uppercase tracking-tight text-brand-dark line-clamp-2 italic leading-tight">
                                  Scene {i+1}: {s.script_segment}
                                </p>
                             </div>
                          </div>
                       </div>
                    ))}
                 </div>
              </div>

              <div className="flex gap-4 mt-12">
                 <button onClick={() => setStep(5)} className="px-12 py-6 rounded-full font-black text-gray-400 hover:text-black transition-all">Back</button>
                 <button onClick={() => { setStep(7); setMaxStep(prev => Math.max(prev, 7)); sync(7, undefined, { status: ProjectStatus.COMPLETED }); }} className="flex-1 bg-brand-dark text-white py-6 rounded-full font-black text-2xl shadow-2xl hover:scale-[1.02] shadow-brand-cyan/10 transition-all">Export Mastery</button>
              </div>
           </div>
        )}

        {/* STEP 7: Export */}
        {step === 7 && (
          <div className="flex-1 flex flex-col animate-in fade-in zoom-in-95 duration-1000">
             <div className="text-center mb-10">
                <h2 className="text-5xl font-black text-brand-dark mb-4 tracking-tighter">Export Your Video</h2>
                <p className="text-gray-400 font-medium italic text-lg">
                  모든 씬을 하나의 비디오로 합치거나, 개별 씬을 다운로드하세요.
                </p>
             </div>

             <div className="mb-8 flex flex-col items-center gap-4">
                {isPresentationMode ? (
                  <button
                    onClick={handleRenderPresentation}
                    disabled={merging || !isImagesReady}
                    className={`px-12 py-5 rounded-full font-black text-lg shadow-xl transition-all flex items-center gap-3 ${merging ? 'bg-gray-100 text-gray-400' : 'bg-gradient-to-r from-blue-600 to-brand-cyan text-white hover:scale-105 active:scale-95'}`}
                  >
                    {merging ? (
                      <><Icons.Loader2 className="animate-spin" size={20} /> {mergeProgress}</>
                    ) : (
                      <><Icons.Presentation size={20} /> 프레젠테이션 비디오 렌더링</>
                    )}
                  </button>
                ) : (
                  <button
                    onClick={handleMergeExport}
                    disabled={merging || scenes.every(s => !s.video_path)}
                    className={`px-12 py-5 rounded-full font-black text-lg shadow-xl transition-all flex items-center gap-3 ${merging ? 'bg-gray-100 text-gray-400' : 'bg-gradient-to-r from-purple-600 to-brand-cyan text-white hover:scale-105 active:scale-95'}`}
                  >
                    {merging ? (
                      <><Icons.Loader2 className="animate-spin" size={20} /> {mergeProgress}</>
                    ) : (
                      <><Icons.Film size={20} /> 하나의 비디오로 합치기</>
                    )}
                  </button>
                )}
                {merging && (
                  <div className="w-64 h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-purple-600 to-brand-cyan rounded-full transition-all duration-500" style={{ width: `${mergePercent}%` }}></div>
                  </div>
                )}
                {mergedVideoUrl && (
                  <div className="w-full max-w-2xl mt-4">
                    <div className="bg-brand-dark rounded-[2rem] overflow-hidden shadow-2xl border-4 border-white">
                      <video src={mergedVideoUrl} controls playsInline className="w-full aspect-video object-contain" />
                    </div>
                    <div className="flex justify-center gap-4 mt-4">
                      <button
                        onClick={handleDownloadMerged}
                        className="px-10 py-4 rounded-full font-black text-base bg-brand-cyan text-black hover:scale-105 transition-all shadow-lg flex items-center gap-2"
                      >
                        <Icons.Download size={18} /> 최종 비디오 다운로드
                      </button>
                    </div>
                  </div>
                )}
                <div className="flex gap-3 mt-2">
                  <button
                    onClick={handleDownloadAll}
                    disabled={downloadingAll || scenes.every(s => !s.video_path)}
                    className={`px-8 py-3 rounded-full font-bold text-sm transition-all flex items-center gap-2 ${downloadingAll ? 'bg-gray-100 text-gray-400' : 'bg-white border-2 border-gray-200 text-gray-600 hover:border-brand-dark hover:text-black'}`}
                  >
                    {downloadingAll ? (
                      <><Icons.Loader2 className="animate-spin" size={14} /> 다운로드 중...</>
                    ) : (
                      <><Icons.Download size={14} /> 개별 씬 다운로드</>
                    )}
                  </button>
                </div>
             </div>

             <div className="flex-1 overflow-y-auto pr-4 hide-scrollbar">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {scenes.map((s, i) => (
                    <div key={i} className="bg-gray-50 rounded-[2.5rem] overflow-hidden border border-gray-100 shadow-sm hover:shadow-xl transition-all">
                      <div className={`relative bg-black ${aspectRatio === '9:16' ? 'aspect-[9/16]' : 'aspect-video'} overflow-hidden`}>
                        {s.video_path ? (
                          <video
                            src={s.video_path}
                            poster={s.image_path}
                            controls
                            playsInline
                            className="w-full h-full object-cover"
                            ref={(el) => { if (el && s.audio_path && !useVeoAudio) syncAudioWithVideo(el, s.audio_path); }}
                          />
                        ) : s.image_path ? (
                          <img src={s.image_path} className="w-full h-full object-cover" alt={`Scene ${i + 1}`} />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Icons.VideoOff size={40} className="text-white/20" />
                          </div>
                        )}
                      </div>
                      <div className="p-6 flex items-center justify-between">
                        <div>
                          <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Scene {i + 1}</span>
                          <p className="text-xs text-brand-dark font-medium italic line-clamp-1 mt-1">{s.script_segment}</p>
                        </div>
                        {s.video_path && (
                          <button
                            onClick={() => downloadVideo(s.video_path!, `scene_${i + 1}.mp4`)}
                            className="shrink-0 w-10 h-10 bg-brand-dark text-white rounded-full flex items-center justify-center hover:scale-110 transition-all shadow-md"
                          >
                            <Icons.Download size={16} />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
             </div>

             <div className="flex gap-4 mt-10">
                <button onClick={() => setStep(6)} className="px-10 py-6 rounded-full font-black text-gray-400 hover:text-black transition-colors">Back</button>
                <button 
                  onClick={() => onNavigate('projects')} 
                  className="flex-1 bg-brand-dark text-white py-6 rounded-full font-black text-2xl shadow-2xl hover:scale-[1.02] transition-all flex items-center justify-center gap-4"
                >
                  Go to Workspace <Icons.ChevronRight size={28} />
                </button>
             </div>
          </div>
        )}
      </div>
    </div>
  );
};
