import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { generateProjectId } from '../../services/storageService';
import { getModels, getModelsByType } from '../../services/modelService';
import { DEFAULT_CAPTION_STYLE } from '../../services/captionService';
import { listPacks } from '../../services/contextPackService';
import { jobManager } from '../../services/jobManager';
import { hasAnyGoogleApiKey, API_KEY_CHANGE_EVENT } from '../../services/apiKeyService';
import { ApiKeyRequiredModal } from '../ApiKeyRequiredModal';
import {
  Scene,
  ViewState,
  AIModel,
  VideoMode,
  GenreId,
  PlatformId,
  StyleSheet,
  ProjectStats,
  CaptionStyle,
  CharacterReference,
  ContextPack,
} from '../../types';
import type { WizardMode } from './ModeGate';

import { WizardContextValue } from './wizardTypes';
import {
  TRANSITION_OPTIONS,
  MOTION_OPTIONS,
  buildReferenceImagesForScene,
} from './hooks/wizardHelpers';
import { useSync } from './hooks/useSync';
import { useRestore } from './hooks/useRestore';
import { usePresentationActions } from './hooks/usePresentationActions';
import { useAudioActions } from './hooks/useAudioActions';
import { useImageActions } from './hooks/useImageActions';
import { useVideoActions } from './hooks/useVideoActions';
import { useExportActions } from './hooks/useExportActions';
import { useAudioVideoSync } from './hooks/useAudioVideoSync';

export type { WizardContextValue } from './wizardTypes';

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
  /**
   * Invoked when the wizard needs the host environment to surface its API key
   * picker (AI Studio host bridge or admin/settings page in the standalone
   * deployment). Provided by App so the modal "Select API Key" button works
   * the same way as the top-level banner.
   */
  onRequestSelectKey?: () => void | Promise<void>;
  children: React.ReactNode;
}

const AISTUDIO_CHECK_TIMEOUT_MS = 1500;

const isAiStudioEnv = (): boolean => {
  try { return typeof window !== 'undefined' && !!(window as any).aistudio; } catch { return false; }
};

/**
 * Unified "is a Google key actually selectable?" probe.
 *
 * Local store wins instantly. In AI Studio, the host may have a
 * host-selected key that never lands in localStorage — we must ask
 * the bridge. The race protects against a hung host call.
 */
const hasSelectableGoogleKey = async (): Promise<boolean> => {
  if (hasAnyGoogleApiKey()) return true;
  if (!isAiStudioEnv()) return false;
  try {
    return await Promise.race<boolean>([
      Promise.resolve((window as any).aistudio.hasSelectedApiKey()).then(v => !!v),
      new Promise<boolean>(resolve => setTimeout(() => resolve(false), AISTUDIO_CHECK_TIMEOUT_MS)),
    ]);
  } catch {
    return false;
  }
};

export const WizardProvider: React.FC<ProviderProps> = ({
  userId,
  onNavigate,
  initialProjectId,
  onRequestSelectKey,
  children,
}) => {
  // ---- Identity / step ----
  const [projectId, setProjectId] = useState<string>(initialProjectId || generateProjectId());
  const [createdAt, setCreatedAt] = useState<string>(new Date().toISOString());
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5 | 6 | 7>(1);
  const [maxStep, setMaxStep] = useState<number>(1);
  const [savedMode, setSavedModeState] = useState<WizardMode | null>(null);

  // ---- Project config ----
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16' | '1:1' | '3:4'>('16:9');
  const [videoStyle, setVideoStyle] = useState('Cute Stickman');
  const [topic, setTopic] = useState('');
  const [duration, setDuration] = useState(30);
  const [script, setScript] = useState('');
  const [characterProfile, setCharacterProfile] = useState('');
  const [useReferenceImage, setUseReferenceImage] = useState(true);
  const [characterReferenceImage, setCharacterReferenceImage] = useState<string | undefined>(
    undefined
  );
  const [generatingReference, setGeneratingReference] = useState(false);
  const [characterReferences, setCharacterReferences] = useState<CharacterReference[]>([]);
  const [generatingCharRefIdx, setGeneratingCharRefIdx] = useState<number | null>(null);
  const [sceneDurationMode, setSceneDurationMode] = useState<'time' | 'scenes'>('time');
  const [targetSceneCount, setTargetSceneCount] = useState(4);
  const [useVeoAudio, setUseVeoAudio] = useState(true);
  const [videoMode, setVideoMode] = useState<VideoMode>('ai');
  // ContextPack linkage state.
  const [linkedContextPackId, setLinkedContextPackId] = useState<string | undefined>(undefined);
  const [linkedContextPackName, setLinkedContextPackName] = useState<string | undefined>(undefined);
  const [linkedContextPack, setLinkedContextPack] = useState<ContextPack | undefined>(undefined);
  const [contextPackVersion, setContextPackVersion] = useState<number | undefined>(undefined);
  const [contextPackDirty, setContextPackDirty] = useState<boolean>(false);
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

  // ---- Loading / processing ----
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [processingSet, setProcessingSet] = useState<Set<number>>(new Set());
  const [processingType, setProcessingType] = useState<'audio' | 'image' | 'video' | null>(null);
  const [failedScenes, setFailedScenes] = useState<Map<string, string>>(new Map());
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState(false);

  // ---- Audio / preview ----
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const syncAudioRef = useRef<HTMLAudioElement | null>(null);
  const [playingAudioIdx, setPlayingAudioIdx] = useState<number | null>(null);
  const [activePreviewIdx, setActivePreviewIdx] = useState(0);
  const [expandedQuality, setExpandedQuality] = useState<Set<number>>(new Set());
  const [selectedVideoIdx, setSelectedVideoIdx] = useState<number | null>(null);

  // ---- Models / captions ----
  const [allModels, setAllModels] = useState<AIModel[]>([]);
  const [selectedImageModel, setSelectedImageModel] = useState<string>('');
  const [selectedVideoModel, setSelectedVideoModel] = useState<string>('');
  const [showModelSelector, setShowModelSelector] = useState<'image' | 'video' | null>(null);
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>(DEFAULT_CAPTION_STYLE);

  // ---- Export ----
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [merging, setMerging] = useState(false);
  const [mergeProgress, setMergeProgress] = useState<string>('');
  const [mergePercent, setMergePercent] = useState(0);
  const [mergedVideoUrl, setMergedVideoUrl] = useState<string | null>(null);

  // ---- Refs that mirror state for cross-cutting consumers ----
  const scenesRef = useRef(scenes);
  const stepRef = useRef<number>(step);
  const maxStepRef = useRef<number>(maxStep);
  const topicRef = useRef(topic);
  const scriptRef = useRef(script);
  const thumbnailRef = useRef(thumbnail);
  const characterProfileRef = useRef(characterProfile);
  const statsRef = useRef(stats);
  const characterReferenceImageRef = useRef(characterReferenceImage);
  const characterReferencesRef = useRef(characterReferences);
  const linkedContextPackIdRef = useRef(linkedContextPackId);
  const contextPackVersionRef = useRef(contextPackVersion);
  const contextPackDirtyRef = useRef(contextPackDirty);
  const savedModeRef = useRef<WizardMode | null>(savedMode);
  const syncRef = useRef<WizardContextValue['sync'] | null>(null);
  const syncPendingRef = useRef<boolean>(false);
  const blobUrlsRef = useRef<Set<string>>(new Set());

  const setSavedMode = (mode: WizardMode | null) => {
    const changed = savedModeRef.current !== mode;
    savedModeRef.current = mode;
    setSavedModeState(mode);
    // A mode switch is often the last thing the user does before navigating
    // away, so make sure the new preference reaches the cloud record.
    // If a richer snapshot is already queued, leave it alone — the queued
    // sync reads `savedModeRef` at fire time and will include the new mode.
    // Only schedule a fresh sync when nothing is pending.
    if (changed && !syncPendingRef.current) {
      syncRef.current?.();
    }
  };

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
    linkedContextPackIdRef.current = linkedContextPackId;
  }, [linkedContextPackId]);
  useEffect(() => {
    contextPackVersionRef.current = contextPackVersion;
  }, [contextPackVersion]);
  useEffect(() => {
    contextPackDirtyRef.current = contextPackDirty;
  }, [contextPackDirty]);

  // ---- Blob URL tracking ----
  const trackBlobUrl = (url: string) => {
    if (url.startsWith('blob:')) blobUrlsRef.current.add(url);
  };
  const revokeBlobUrl = (url?: string) => {
    if (url && url.startsWith('blob:') && blobUrlsRef.current.has(url)) {
      URL.revokeObjectURL(url);
      blobUrlsRef.current.delete(url);
    }
  };

  // ---- Stats updater ----
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

  // ---- Load model list ----
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Resolve the linked ContextPack's display name whenever the linkage
  // changes — used by the Studio Dock card subtitle so users can tell
  // which pack a running batch was started from.
  useEffect(() => {
    if (!linkedContextPackId) {
      setLinkedContextPackName(undefined);
      setLinkedContextPack(undefined);
      return;
    }
    let cancelled = false;
    listPacks(userId)
      .then(packs => {
        if (cancelled) return;
        const pack = packs.find(p => p.id === linkedContextPackId);
        setLinkedContextPackName(pack?.name);
        setLinkedContextPack(pack);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [userId, linkedContextPackId]);

  // ---- Audio↔video sync (Step 6 preview) ----
  const { syncAudioWithVideo, syncCleanupRef } = useAudioVideoSync({ syncAudioRef });

  // ---- Sync (with unmount flush) ----
  const sync = useSync({
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
    linkedContextPackIdRef,
    contextPackVersionRef,
    contextPackDirtyRef,
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
  });
  syncRef.current = sync;

  // ---- Restore on mount ----
  useRestore({
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
  });

  // ---- Scene helpers ----
  const referenceImagesForScene = (s: Partial<Scene>) =>
    buildReferenceImagesForScene(characterReferences, s);

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

  // ---- Audio / Image / Video / Export action hooks ----
  const { handlePlayAudio, handleSingleAudio, handleBatchAudio } = useAudioActions({
    userId,
    projectId,
    videoStyle,
    scenes,
    failedScenes,
    audioRef,
    playingAudioIdx,
    setPlayingAudioIdx,
    setProcessingType,
    setProcessingSet,
    setFailedScenes,
    setLoadingMessage,
    updateSceneAt,
    sync,
  });

  const { handleBatchImages, handleRefineImage, handleSingleImage } = useImageActions({
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
  });

  // ---- API key gate (Veo) ----
  // Step 5 / Quick Pipeline both call into the video handlers below. We
  // intercept those calls when no Google key is registered, surface a
  // friendly modal, and resume execution automatically once a key shows up
  // (either via the AI Studio host picker or the admin settings page).
  const [apiKeyModalOpen, setApiKeyModalOpen] = useState(false);
  const apiKeyModalAistudioRef = useRef<boolean>(false);
  const pendingKeyResolversRef = useRef<Array<(ok: boolean) => void>>([]);

  const flushPendingKeyWaiters = async () => {
    if (pendingKeyResolversRef.current.length === 0) return;
    const ok = await hasSelectableGoogleKey();
    if (!ok) return;
    const queued = pendingKeyResolversRef.current;
    pendingKeyResolversRef.current = [];
    setApiKeyModalOpen(false);
    queued.forEach(r => r(true));
  };

  // While the modal is open, watch for a key being registered and auto-resume
  // every queued caller. Storage / custom events cover localStorage edits
  // (admin page, other tabs). The window 'focus' handler is what catches the
  // AI Studio host bridge case, where the host picker may have set a
  // host-selected key that never touches localStorage.
  useEffect(() => {
    if (!apiKeyModalOpen) return;
    const flush = () => { void flushPendingKeyWaiters(); };
    const onStorage = (e: StorageEvent) => {
      if (!e.key || e.key === 'vibe_model_api_keys' || e.key === 'vibe_ai_models') flush();
    };
    window.addEventListener(API_KEY_CHANGE_EVENT, flush);
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', flush);
    return () => {
      window.removeEventListener(API_KEY_CHANGE_EVENT, flush);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', flush);
    };
  }, [apiKeyModalOpen]);

  // Defensive lifecycle cleanup: if the wizard unmounts (e.g. navigating
  // away to admin) while video actions are still suspended, resolve every
  // queued waiter as `false` so their promise chains don't leak.
  useEffect(() => {
    return () => {
      const queued = pendingKeyResolversRef.current;
      pendingKeyResolversRef.current = [];
      queued.forEach(r => r(false));
    };
  }, []);

  const ensureGoogleApiKey = async (): Promise<boolean> => {
    if (await hasSelectableGoogleKey()) return true;
    apiKeyModalAistudioRef.current = isAiStudioEnv();
    setApiKeyModalOpen(true);
    return new Promise<boolean>(resolve => {
      pendingKeyResolversRef.current.push(resolve);
    });
  };

  const cancelApiKeyModal = () => {
    const queued = pendingKeyResolversRef.current;
    pendingKeyResolversRef.current = [];
    setApiKeyModalOpen(false);
    queued.forEach(r => r(false));
  };

  const handleSelectKeyClick = async () => {
    if (onRequestSelectKey) {
      try { await onRequestSelectKey(); } catch (e) {
        console.warn('[Wizard] onRequestSelectKey failed:', e);
      }
    }
    // After the host bridge / admin redirect resolves, flush waiters using
    // the unified probe so an AI-Studio-only host key counts the same as a
    // localStorage entry. Outside AI Studio, the admin redirect unmounts
    // the wizard, so this is a best-effort flush only.
    await flushPendingKeyWaiters();
  };

  const { handleBatchVideos: rawHandleBatchVideos, handleSingleVideo: rawHandleSingleVideo } = useVideoActions({
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
  });

  const handleBatchVideos = async (): Promise<void> => {
    const ok = await ensureGoogleApiKey();
    if (!ok) return;
    return rawHandleBatchVideos();
  };

  const handleSingleVideo = async (idx: number): Promise<void> => {
    const ok = await ensureGoogleApiKey();
    if (!ok) return;
    return rawHandleSingleVideo(idx);
  };

  // If an in-flight job for this project already exists in the global
  // JobManager (because it started in a previous wizard mount, and the
  // wizard has now been reopened), rebind its per-scene callbacks to
  // this mount's updaters so live progress shows up in the wizard, not
  // just the Studio Dock.
  useEffect(() => {
    if (!projectId) return;
    const existing = jobManager.findByProject(projectId);
    if (
      existing &&
      (existing.status === 'running' ||
        existing.status === 'queued' ||
        existing.status === 'paused')
    ) {
      jobManager.rebindCallbacks(existing.id, {
        onSceneUpdate: (idx, updates) => {
          if (updates.video_path && updates.video_path.startsWith('blob:')) {
            trackBlobUrl(updates.video_path);
          }
          updateSceneAt(idx, updates);
        },
        onStatsDelta: delta => addStats(delta),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const {
    getDefaultPresentation,
    updateScenePresentation,
    updateSceneTextOverlay,
    applyDefaultTransitions,
    applyDefaultMotion,
  } = usePresentationActions({ setScenes });

  const [exportLimitsVersion, setExportLimitsVersion] = useState(0);
  const refreshExportLimits = React.useCallback(
    () => setExportLimitsVersion(v => v + 1),
    []
  );

  const {
    downloadVideo,
    handleDownloadAll,
    handleMergeExport,
    handleDownloadMerged,
    handleRenderPresentation,
    handleAutoSplitExport,
    exportRiskAssessment,
    autoSplitPlan,
  } = useExportActions({
    scenes,
    captionStyle,
    useVeoAudio,
    duration,
    aspectRatio,
    topic,
    mergedVideoUrl,
    isPresentationMode: videoMode === 'presentation',
    setMerging,
    setMergeProgress,
    setMergePercent,
    setMergedVideoUrl,
    setDownloadingAll,
    trackBlobUrl,
    getDefaultPresentation,
    limitsVersion: exportLimitsVersion,
  });

  // ---- Derived state ----
  const isProcessing = processingSet.size > 0;
  const isImagesReady = scenes.length > 0 && scenes.every(s => !!s.image_path);
  const isVideosReady = scenes.length > 0 && scenes.every(s => !!s.video_path);
  const isPresentationMode = videoMode === 'presentation';

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
    savedMode,
    setSavedMode,
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
    linkedContextPackId,
    setLinkedContextPackId,
    linkedContextPackName,
    linkedContextPack,
    contextPackVersion,
    setContextPackVersion,
    contextPackDirty,
    setContextPackDirty,
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
    handleAutoSplitExport,
    exportRiskAssessment,
    refreshExportLimits,
    autoSplitPlan,
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

  return (
    <WizardCtx.Provider value={value}>
      {children}
      <ApiKeyRequiredModal
        open={apiKeyModalOpen}
        aistudioMode={apiKeyModalAistudioRef.current}
        onSelectKey={handleSelectKeyClick}
        onClose={cancelApiKeyModal}
      />
    </WizardCtx.Provider>
  );
};
