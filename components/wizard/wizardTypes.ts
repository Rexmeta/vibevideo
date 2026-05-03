import React from 'react';
import {
  Scene,
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
  ContextPack,
} from '../../types';
import { SyncFn } from './hooks/useSync';
import type { WizardMode } from './ModeGate';
import type { ExportRiskAssessment } from '../../services/ffmpegLimits';

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
  savedMode: WizardMode | null;
  setSavedMode: (mode: WizardMode | null) => void;

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
  // ContextPack linkage on the active project. The wizard
  // surfaces a "팩에서 상속됨" badge and a "팩 변경 적용" action when
  // dirty.
  linkedContextPackId?: string;
  setLinkedContextPackId: React.Dispatch<React.SetStateAction<string | undefined>>;
  linkedContextPackName?: string;
  linkedContextPack?: ContextPack;
  contextPackVersion?: number;
  setContextPackVersion: React.Dispatch<React.SetStateAction<number | undefined>>;
  contextPackDirty: boolean;
  setContextPackDirty: React.Dispatch<React.SetStateAction<boolean>>;
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
  sync: SyncFn;
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
  exportRiskAssessment: ExportRiskAssessment;
  refreshExportLimits: () => void;

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
