import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  generateScript,
  segmentScriptIntoScenes,
  generateSceneAudio,
  generateSceneImage,
  generateSceneVideo,
  generateStyleSheet,
  migrateSceneFields,
} from '../../services/geminiService';
import {
  saveProjectToCloud,
  getProjectFromCloud,
  uploadFileToCloud,
  generateProjectId,
} from '../../services/storageService';
import { saveMedia, getMedia, saveProjectMeta, getProjectMeta } from '../../services/mediaCache';
import { getModels, getModelsByType } from '../../services/modelService';
import {
  mergeAllScenes,
  MergeInput,
  renderPresentationVideo,
  PresentationSceneInput,
} from '../../services/videoMergeService';
import { DEFAULT_CAPTION_STYLE, alignWordsToDuration } from '../../services/captionService';
import {
  Scene,
  Project,
  ProjectStatus,
  ViewState,
  AIModel,
  VideoMode,
  TransitionType,
  MotionPreset,
  PresentationConfig,
  TextOverlay,
  GenreId,
  PlatformId,
  StyleSheet,
  ProjectStats,
  CaptionStyle,
  CharacterReference,
} from '../../types';

export interface WizardContextValue {
  // Identity
  userId: string;
  projectId: string;
  setProjectId: React.Dispatch<React.SetStateAction<string>>;
  createdAt: string;
  setCreatedAt: React.Dispatch<React.SetStateAction<string>>;
  onNavigate: (view: ViewState) => void;
  initialProjectId?: string | null;

  // Step
  step: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  setStep: React.Dispatch<React.SetStateAction<1 | 2 | 3 | 4 | 5 | 6 | 7>>;
  maxStep: number;
  setMaxStep: React.Dispatch<React.SetStateAction<number>>;

  // Project config
  aspectRatio: '16:9' | '9:16' | '1:1' | '3:4';
  setAspectRatio: React.Dispatch<React.SetStateAction<'16:9' | '9:16' | '1:1' | '3:4'>>;
  videoStyle: string;
  setVideoStyle: React.Dispatch<React.SetStateAction<string>>;
  topic: string;
  setTopic: React.Dispatch<React.SetStateAction<string>>;
  duration: number;
  setDuration: React.Dispatch<React.SetStateAction<number>>;
  script: string;
  setScript: React.Dispatch<React.SetStateAction<string>>;
  characterProfile: string;
  setCharacterProfile: React.Dispatch<React.SetStateAction<string>>;
  useReferenceImage: boolean;
  setUseReferenceImage: React.Dispatch<React.SetStateAction<boolean>>;
  characterReferenceImage: string | undefined;
  setCharacterReferenceImage: React.Dispatch<React.SetStateAction<string | undefined>>;
  generatingReference: boolean;
  setGeneratingReference: React.Dispatch<React.SetStateAction<boolean>>;
  characterReferences: CharacterReference[];
  setCharacterReferences: React.Dispatch<React.SetStateAction<CharacterReference[]>>;
  generatingCharRefIdx: number | null;
  setGeneratingCharRefIdx: React.Dispatch<React.SetStateAction<number | null>>;
  sceneDurationMode: 'time' | 'scenes';
  setSceneDurationMode: React.Dispatch<React.SetStateAction<'time' | 'scenes'>>;
  targetSceneCount: number;
  setTargetSceneCount: React.Dispatch<React.SetStateAction<number>>;
  useVeoAudio: boolean;
  setUseVeoAudio: React.Dispatch<React.SetStateAction<boolean>>;
  videoMode: VideoMode;
  setVideoMode: React.Dispatch<React.SetStateAction<VideoMode>>;
  scenes: Partial<Scene>[];
  setScenes: React.Dispatch<React.SetStateAction<Partial<Scene>[]>>;
  thumbnail: string | undefined;
  setThumbnail: React.Dispatch<React.SetStateAction<string | undefined>>;
  genre: GenreId | undefined;
  setGenre: React.Dispatch<React.SetStateAction<GenreId | undefined>>;
  platform: PlatformId | undefined;
  setPlatform: React.Dispatch<React.SetStateAction<PlatformId | undefined>>;
  styleSheet: StyleSheet | undefined;
  setStyleSheet: React.Dispatch<React.SetStateAction<StyleSheet | undefined>>;
  visionCriticEnabled: boolean;
  setVisionCriticEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  qualityThreshold: number;
  setQualityThreshold: React.Dispatch<React.SetStateAction<number>>;
  negativePrompt: string;
  setNegativePrompt: React.Dispatch<React.SetStateAction<string>>;
  generatingStyleSheet: boolean;
  setGeneratingStyleSheet: React.Dispatch<React.SetStateAction<boolean>>;
  stats: ProjectStats;
  setStats: React.Dispatch<React.SetStateAction<ProjectStats>>;

  // Loading / processing
  loading: boolean;
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  loadingMessage: string;
  setLoadingMessage: React.Dispatch<React.SetStateAction<string>>;
  processingSet: Set<number>;
  setProcessingSet: React.Dispatch<React.SetStateAction<Set<number>>>;
  processingType: 'audio' | 'image' | 'video' | null;
  setProcessingType: React.Dispatch<React.SetStateAction<'audio' | 'image' | 'video' | null>>;
  failedScenes: Map<string, string>;
  setFailedScenes: React.Dispatch<React.SetStateAction<Map<string, string>>>;
  syncing: boolean;
  syncError: boolean;

  // Audio / preview
  audioRef: React.MutableRefObject<HTMLAudioElement | null>;
  syncAudioRef: React.MutableRefObject<HTMLAudioElement | null>;
  playingAudioIdx: number | null;
  setPlayingAudioIdx: React.Dispatch<React.SetStateAction<number | null>>;
  activePreviewIdx: number;
  setActivePreviewIdx: React.Dispatch<React.SetStateAction<number>>;
  expandedQuality: Set<number>;
  setExpandedQuality: React.Dispatch<React.SetStateAction<Set<number>>>;
  selectedVideoIdx: number | null;
  setSelectedVideoIdx: React.Dispatch<React.SetStateAction<number | null>>;

  // Models
  allModels: AIModel[];
  selectedImageModel: string;
  setSelectedImageModel: React.Dispatch<React.SetStateAction<string>>;
  selectedVideoModel: string;
  setSelectedVideoModel: React.Dispatch<React.SetStateAction<string>>;
  showModelSelector: 'image' | 'video' | null;
  setShowModelSelector: React.Dispatch<React.SetStateAction<'image' | 'video' | null>>;
  captionStyle: CaptionStyle;
  setCaptionStyle: React.Dispatch<React.SetStateAction<CaptionStyle>>;

  // Export
  downloadingAll: boolean;
  setDownloadingAll: React.Dispatch<React.SetStateAction<boolean>>;
  merging: boolean;
  mergeProgress: string;
  mergePercent: number;
  mergedVideoUrl: string | null;
  setMergedVideoUrl: React.Dispatch<React.SetStateAction<string | null>>;

  // Derived
  isProcessing: boolean;
  isImagesReady: boolean;
  isVideosReady: boolean;
  isPresentationMode: boolean;

  // Helpers / actions
  trackBlobUrl: (url: string) => void;
  revokeBlobUrl: (url?: string) => void;
  addStats: (delta: Partial<ProjectStats>) => void;
  sync: (
    targetStep?: number,
    scenesOverride?: Partial<Scene>[],
    extraData?: Partial<Project>,
    overrides?: { script?: string; topic?: string; duration?: number; maxStep?: number }
  ) => void;
  handlePlayAudio: (url: string, idx: number) => void;
  syncAudioWithVideo: (videoEl: HTMLVideoElement | null, audioUrl?: string) => void;
  updateSceneAt: (idx: number, updates: Partial<Scene>) => void;
  toggleSceneCharacter: (idx: number, name: string) => void;
  referenceImagesForScene: (
    s: Partial<Scene>
  ) => { name?: string; description?: string; image: string }[];
  failedCount: (type: string) => number;
  downloadVideo: (url: string, filename: string) => Promise<void>;
  handleDownloadAll: () => Promise<void>;
  handleMergeExport: () => Promise<void>;
  handleDownloadMerged: () => Promise<void>;
  handleSingleAudio: (idx: number) => Promise<void>;
  handleBatchAudio: () => Promise<void>;
  handleBatchImages: () => Promise<void>;
  handleRefineImage: (idx: number) => Promise<void>;
  handleSingleImage: (idx: number) => Promise<void>;
  handleBatchVideos: () => Promise<void>;
  handleSingleVideo: (idx: number) => Promise<void>;
  handleRenderPresentation: () => Promise<void>;

  // Presentation mode helpers
  getDefaultPresentation: (idx: number) => PresentationConfig;
  updateScenePresentation: (idx: number, updates: Partial<PresentationConfig>) => void;
  updateSceneTextOverlay: (idx: number, updates: Partial<TextOverlay> | null) => void;
  applyDefaultTransitions: (transitionType?: TransitionType) => void;
  applyDefaultMotion: (motion: MotionPreset) => void;

  TRANSITION_OPTIONS: { value: TransitionType; label: string }[];
  MOTION_OPTIONS: { value: MotionPreset; label: string }[];

  // Refs (exposed for advanced use such as quick-pipeline orchestration)
  scenesRef: React.MutableRefObject<Partial<Scene>[]>;
  statsRef: React.MutableRefObject<ProjectStats>;
}

const WizardCtx = createContext<WizardContextValue | null>(null);

export const useWizard = (): WizardContextValue => {
  const ctx = useContext(WizardCtx);
  if (!ctx) throw new Error('useWizard must be used inside WizardProvider');
  return ctx;
};

interface ProviderProps {
  userId: string;
  onNavigate: (view: ViewState) => void;
  initialProjectId?: string | null;
  children: React.ReactNode;
}

export const WizardProvider: React.FC<ProviderProps> = ({
  userId,
  onNavigate,
  initialProjectId,
  children,
}) => {
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
  const [genre, setGenre] = useState<GenreId | undefined>(undefined);
  const [platform, setPlatform] = useState<PlatformId | undefined>(undefined);
  const [styleSheet, setStyleSheet] = useState<StyleSheet | undefined>(undefined);
  const [visionCriticEnabled, setVisionCriticEnabled] = useState<boolean>(true);
  const [qualityThreshold, setQualityThreshold] = useState<number>(6);
  const [negativePrompt, setNegativePrompt] = useState<string>('');
  const [generatingStyleSheet, setGeneratingStyleSheet] = useState<boolean>(false);
  const [stats, setStats] = useState<ProjectStats>({
    imagesGenerated: 0,
    criticCalls: 0,
    refineCalls: 0,
    videosGenerated: 0,
  });

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

  const trackBlobUrl = (url: string) => {
    if (url.startsWith('blob:')) blobUrlsRef.current.add(url);
  };
  const revokeBlobUrl = (url?: string) => {
    if (url && url.startsWith('blob:') && blobUrlsRef.current.has(url)) {
      URL.revokeObjectURL(url);
      blobUrlsRef.current.delete(url);
    }
  };

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
    getModels()
      .then(models => {
        setAllModels(models);
        const imgModels = getModelsByType(models, 'image');
        const vidModels = getModelsByType(models, 'video');
        if (imgModels.length > 0 && !selectedImageModel) setSelectedImageModel(imgModels[0].id);
        if (vidModels.length > 0 && !selectedVideoModel) setSelectedVideoModel(vidModels[0].id);
      })
      .catch(e => console.warn('[Models] Load failed:', e));
  }, []);

  useEffect(() => {
    scenesRef.current = scenes;
  }, [scenes]);
  useEffect(() => {
    stepRef.current = step;
  }, [step]);
  useEffect(() => {
    maxStepRef.current = maxStep;
  }, [maxStep]);
  useEffect(() => {
    topicRef.current = topic;
  }, [topic]);
  useEffect(() => {
    scriptRef.current = script;
  }, [script]);
  useEffect(() => {
    thumbnailRef.current = thumbnail;
  }, [thumbnail]);
  useEffect(() => {
    characterProfileRef.current = characterProfile;
  }, [characterProfile]);
  useEffect(() => {
    statsRef.current = stats;
  }, [stats]);
  useEffect(() => {
    characterReferenceImageRef.current = characterReferenceImage;
  }, [characterReferenceImage]);
  useEffect(() => {
    characterReferencesRef.current = characterReferences;
  }, [characterReferences]);

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

  useEffect(() => {
    if (!userId || restoredRef.current) return;
    restoredRef.current = true;
    const load = async () => {
      setLoading(true);
      setLoadingMessage('Cloud Workspace 로딩 중...');
      try {
        let p: Project | undefined;
        const idToLoad = initialProjectId || projectId;

        let cloudProject: Project | undefined;
        let localProject: Project | undefined;
        let idbProject: Project | undefined;

        if (initialProjectId) {
          try {
            cloudProject = await getProjectFromCloud(initialProjectId);
          } catch (e) {
            console.warn('[Restore] Cloud fetch failed:', e);
          }
        }

        const localData = localStorage.getItem(`vibe_video_backup_${idToLoad}`);
        if (localData) {
          try {
            localProject = JSON.parse(localData);
          } catch {}
        }

        try {
          const idbData = await getProjectMeta(idToLoad);
          if (idbData) idbProject = idbData;
        } catch {}

        const scoreProject = (proj: Project): number => {
          const maxStep = proj.saved_max_step || proj.saved_step || 1;
          const sceneCount = proj.saved_scenes?.length || 0;
          const hasContent = proj.saved_scenes?.some(s => s.visual_prompt || s.audio_script) ? 1 : 0;
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
          const recoveredScenes = await Promise.all(
            restoredScenes.map(async (s, i) => {
              const sc = { ...s };
              if (
                sc.audio_path &&
                (sc.audio_path.startsWith('data:') ||
                  (sc.audio_path.length > 200 && !sc.audio_path.startsWith('http')))
              ) {
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
            })
          );
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
        console.error('Restore failed:', err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [initialProjectId, userId]);

  const sync: WizardContextValue['sync'] = (
    targetStep,
    scenesOverride,
    extraData = {},
    overrides = {}
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

  const isMediaUploaded = (path?: string): boolean => !!path && path.startsWith('http');
  const hasMedia = (path?: string): boolean =>
    !!path && (path.startsWith('http') || path.startsWith('data:') || path.startsWith('blob:'));

  const tryUploadExisting = async (
    path: string,
    storagePath: string,
    format: 'base64' | 'blob'
  ): Promise<string> => {
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

  const referenceImagesForScene = (
    s: Partial<Scene>
  ): { name?: string; description?: string; image: string }[] => {
    if (!characterReferences || characterReferences.length === 0) return [];
    const tagged = (s?.characters || []).filter(Boolean);
    const lower = new Set(tagged.map(t => t.toLowerCase()));
    const matched = characterReferences.filter(
      c => c && c.imageUrl && lower.has(c.name.toLowerCase())
    );
    return matched.map(c => ({ name: c.name, description: c.description, image: c.imageUrl }));
  };

  const toggleSceneCharacter = (idx: number, name: string) => {
    if (!name) return;
    setScenes(prev => {
      const next = [...prev];
      const old = next[idx];
      if (!old) return prev;
      const current = (old.characters || []).filter(
        (c): c is string => typeof c === 'string' && c.length > 0
      );
      const exists = current.some(c => c.toLowerCase() === name.toLowerCase());
      const updated = exists
        ? current.filter(c => c.toLowerCase() !== name.toLowerCase())
        : [...current, name];
      next[idx] = { ...old, characters: updated };
      return next;
    });
    sync();
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
        const url = await tryUploadExisting(
          currentScene.audio_path!,
          `users/${userId}/projects/${projectId}/audio/s${idx}.wav`,
          'base64'
        );
        updateSceneAt(idx, { audio_path: url });
        setFailedScenes(prev => {
          const n = new Map(prev);
          n.delete(fKey);
          return n;
        });
        setProcessingSet(new Set());
        setProcessingType(null);
        return;
      }
      const res = await generateSceneAudio(currentScene.script_segment!, videoStyle);
      if (res) {
        updateSceneAt(idx, { audio_path: res.audio_path, audio_duration: res.duration });
        saveMedia(projectId, idx, 'audio', res.audio_path);
        const url = await uploadFileToCloud(
          `users/${userId}/projects/${projectId}/audio/s${idx}.wav`,
          res.audio_path,
          'base64'
        );
        updateSceneAt(idx, { audio_path: url });
        setFailedScenes(prev => {
          const n = new Map(prev);
          n.delete(fKey);
          return n;
        });
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

    const tasks = sceneSnapshot
      .map((s, i) => ({ idx: i, s }))
      .filter(({ s }) => !isMediaUploaded(s.audio_path))
      .map(({ idx, s }) => ({
        idx,
        fn: async () => {
          if (hasMedia(s.audio_path)) {
            const url = await tryUploadExisting(
              s.audio_path!,
              `users/${userId}/projects/${projectId}/audio/s${idx}.wav`,
              'base64'
            );
            updateSceneAt(idx, { audio_path: url });
            return;
          }
          const res = await generateSceneAudio(s.script_segment!, videoStyle);
          if (res) {
            updateSceneAt(idx, { audio_path: res.audio_path, audio_duration: res.duration });
            saveMedia(projectId, idx, 'audio', res.audio_path);
            const url = await uploadFileToCloud(
              `users/${userId}/projects/${projectId}/audio/s${idx}.wav`,
              res.audio_path,
              'base64'
            );
            updateSceneAt(idx, { audio_path: url });
          }
        },
      }));

    if (tasks.length === 0) {
      setProcessingType(null);
      return;
    }
    setLoadingMessage(`오디오 생성 중... (${tasks.length}개 씬, 최대 ${CONCURRENCY}개 동시 처리)`);

    const results = await runParallel(
      tasks,
      CONCURRENCY,
      idx => setProcessingSet(prev => new Set(prev).add(idx)),
      idx =>
        setProcessingSet(prev => {
          const n = new Set(prev);
          n.delete(idx);
          return n;
        })
    );

    const errors = results.filter(r => r.error);
    errors.forEach(r => newFailed.set(`audio-${r.idx}`, r.error?.message || '오류'));
    results.filter(r => !r.error).forEach(r => newFailed.delete(`audio-${r.idx}`));
    setFailedScenes(newFailed);
    setProcessingSet(new Set());
    setProcessingType(null);
    setLoadingMessage('');
    sync();
    if (errors.length > 0)
      alert(
        `오디오 생성 실패 (${errors.length}/${tasks.length}개 씬)\n실패한 씬 옆 '재시도' 버튼으로 개별 재생성할 수 있습니다.`
      );
  };

  const handleBatchImages = async () => {
    setProcessingType('image');
    const sceneSnapshot = [...scenes];
    const newFailed = new Map(failedScenes);

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
      idx =>
        setProcessingSet(prev => {
          const n = new Set(prev);
          n.delete(idx);
          return n;
        })
    );

    const errors = results.filter(r => r.error);
    errors.forEach(r => newFailed.set(`image-${r.idx}`, r.error?.message || '오류'));
    results.filter(r => !r.error).forEach(r => newFailed.delete(`image-${r.idx}`));
    setFailedScenes(newFailed);
    setProcessingSet(new Set());
    setProcessingType(null);
    setLoadingMessage('');
    sync();
    if (errors.length > 0)
      alert(
        `이미지 생성 실패 (${errors.length}/${tasks.length}개 씬)\n실패한 씬 옆 '재시도' 버튼으로 개별 재생성할 수 있습니다.`
      );
  };

  const handleRefineImage = async (idx: number) => {
    const currentScene = scenes[idx];
    const qs = currentScene?.qualityScore;
    const issues =
      qs?.issues && qs.issues.length > 0 ? qs.issues.join('; ') : 'composition or character consistency';
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
      setFailedScenes(prev => new Map(prev).set(fKey, e?.message || '오류'));
    }
    setProcessingSet(new Set());
    setProcessingType(null);
  };

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
          if (hasMedia(s.video_path) && !isMediaUploaded(s.video_path) && s.video_path?.startsWith('blob:')) {
            try {
              const blob = await fetch(s.video_path!).then(r => r.blob());
              const url = await uploadFileToCloud(
                `users/${userId}/projects/${projectId}/videos/s${idx}.mp4`,
                blob,
                'blob'
              );
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
            {
              scene: s,
              styleSheet,
              negativePrompt: negativePrompt || s.negativePrompt,
              referenceImage: characterReferenceImage,
              referenceImages: referenceImagesForScene(s),
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
          referenceImages: referenceImagesForScene(currentScene),
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
        const dur = s.audio_duration || duration / Math.max(1, scenes.length) || 6;
        const text = (s.audio_script || s.script_segment || '').trim();
        const captionWords =
          captionsEnabled && text ? alignWordsToDuration(text, dur, captionStyle.enableEmoji) : undefined;
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

    const playHandler = () => {
      sa.currentTime = videoEl.currentTime;
      sa.play().catch(() => {});
    };
    const pauseHandler = () => {
      sa.pause();
    };
    const seekHandler = () => {
      sa.currentTime = videoEl.currentTime;
    };
    const endHandler = () => {
      sa.pause();
      sa.currentTime = 0;
    };

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
        const current =
          pres.textOverlay || {
            text: '',
            position: 'bottom' as const,
            fontSize: 32,
            color: '#ffffff',
            backgroundColor: 'rgba(0,0,0,0.6)',
          };
        next[idx] = { ...next[idx], presentation: { ...pres, textOverlay: { ...current, ...updates } } };
      }
      return next;
    });
  };

  const applyDefaultTransitions = (transitionType: TransitionType = 'fade') => {
    setScenes(prev =>
      prev.map((s, i) => ({
        ...s,
        presentation: {
          ...(s.presentation || getDefaultPresentation(i)),
          transition: i === 0 ? 'none' : transitionType,
        },
      }))
    );
  };

  const applyDefaultMotion = (motion: MotionPreset) => {
    setScenes(prev =>
      prev.map((s, i) => ({
        ...s,
        presentation: {
          ...(s.presentation || getDefaultPresentation(i)),
          motion,
        },
      }))
    );
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
        const dur = s.audio_duration || duration / scenes.length || 6;
        const text = (s.audio_script || s.script_segment || '').trim();
        const captionWords =
          captionsEnabled && text ? alignWordsToDuration(text, dur, captionStyle.enableEmoji) : undefined;
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
      setMergeProgress(`오류: ${err?.message || '렌더링 실패'}`);
    } finally {
      setMerging(false);
    }
  };

  const failedCount = (type: string) =>
    Array.from(failedScenes.keys()).filter(k => k.startsWith(type)).length;

  const value: WizardContextValue = {
    userId,
    projectId,
    setProjectId,
    createdAt,
    setCreatedAt,
    onNavigate,
    initialProjectId,
    step,
    setStep,
    maxStep,
    setMaxStep,
    aspectRatio,
    setAspectRatio,
    videoStyle,
    setVideoStyle,
    topic,
    setTopic,
    duration,
    setDuration,
    script,
    setScript,
    characterProfile,
    setCharacterProfile,
    useReferenceImage,
    setUseReferenceImage,
    characterReferenceImage,
    setCharacterReferenceImage,
    generatingReference,
    setGeneratingReference,
    characterReferences,
    setCharacterReferences,
    generatingCharRefIdx,
    setGeneratingCharRefIdx,
    sceneDurationMode,
    setSceneDurationMode,
    targetSceneCount,
    setTargetSceneCount,
    useVeoAudio,
    setUseVeoAudio,
    videoMode,
    setVideoMode,
    scenes,
    setScenes,
    thumbnail,
    setThumbnail,
    genre,
    setGenre,
    platform,
    setPlatform,
    styleSheet,
    setStyleSheet,
    visionCriticEnabled,
    setVisionCriticEnabled,
    qualityThreshold,
    setQualityThreshold,
    negativePrompt,
    setNegativePrompt,
    generatingStyleSheet,
    setGeneratingStyleSheet,
    stats,
    setStats,
    loading,
    setLoading,
    loadingMessage,
    setLoadingMessage,
    processingSet,
    setProcessingSet,
    processingType,
    setProcessingType,
    failedScenes,
    setFailedScenes,
    syncing,
    syncError,
    audioRef,
    syncAudioRef,
    playingAudioIdx,
    setPlayingAudioIdx,
    activePreviewIdx,
    setActivePreviewIdx,
    expandedQuality,
    setExpandedQuality,
    selectedVideoIdx,
    setSelectedVideoIdx,
    allModels,
    selectedImageModel,
    setSelectedImageModel,
    selectedVideoModel,
    setSelectedVideoModel,
    showModelSelector,
    setShowModelSelector,
    captionStyle,
    setCaptionStyle,
    downloadingAll,
    setDownloadingAll,
    merging,
    mergeProgress,
    mergePercent,
    mergedVideoUrl,
    setMergedVideoUrl,
    isProcessing,
    isImagesReady,
    isVideosReady,
    isPresentationMode,
    trackBlobUrl,
    revokeBlobUrl,
    addStats,
    sync,
    handlePlayAudio,
    syncAudioWithVideo,
    updateSceneAt,
    toggleSceneCharacter,
    referenceImagesForScene,
    failedCount,
    downloadVideo,
    handleDownloadAll,
    handleMergeExport,
    handleDownloadMerged,
    handleSingleAudio,
    handleBatchAudio,
    handleBatchImages,
    handleRefineImage,
    handleSingleImage,
    handleBatchVideos,
    handleSingleVideo,
    handleRenderPresentation,
    getDefaultPresentation,
    updateScenePresentation,
    updateSceneTextOverlay,
    applyDefaultTransitions,
    applyDefaultMotion,
    TRANSITION_OPTIONS,
    MOTION_OPTIONS,
    scenesRef,
    statsRef,
  };

  return <WizardCtx.Provider value={value}>{children}</WizardCtx.Provider>;
};
