import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { generateProjectId } from '../../services/storageService';
import { SAMPLE_PROJECT_ID, isSampleProjectId, buildSampleProject } from '../../services/sampleProject';
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
  CreativeBrief,
  RemixSourceData,
} from '../../types';
import type { WizardMode } from './ModeGate';

import { WizardContextValue } from './wizardTypes';
import {
  TRANSITION_OPTIONS,
  MOTION_OPTIONS,
  buildReferenceImagesForScene,
} from './hooks/wizardHelpers';
import { useSync, type SyncFn } from './hooks/useSync';
import { useRestore } from './hooks/useRestore';
import { usePresentationActions } from './hooks/usePresentationActions';
import { useAudioActions } from './hooks/useAudioActions';
import { useImageActions } from './hooks/useImageActions';
import { useVideoActions } from './hooks/useVideoActions';
import { useExportActions } from './hooks/useExportActions';
import { useAudioVideoSync } from './hooks/useAudioVideoSync';

export type { WizardContextValue } from './wizardTypes';
import { loadBrandKit } from '../../services/brandKitService';
import type { BrandKit } from '../../types';

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
  /**
   * Express Quick Mode preset (Task #95): seed the wizard with the
   * "1-2 minute finish" preset (presentation video mode, vision critic
   * off, 2 short scenes) so the user can hit Start with just a topic.
   */
  expressMode?: boolean;
  /** Task #95: Notified when a sample wizard clones itself into a real
   *  owned project so the parent can update editingProjectId. */
  onProjectIdChange?: (newId: string) => void;
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
  expressMode,
  onProjectIdChange,
  children,
}) => {
  // ---- Sample / Express seed (Task #95) ----
  const isSampleEntry = isSampleProjectId(initialProjectId);
  const sampleSeedRef = useRef<ReturnType<typeof buildSampleProject> | null>(null);
  if (isSampleEntry && !sampleSeedRef.current) {
    sampleSeedRef.current = buildSampleProject(userId);
  }
  const sampleSeed = sampleSeedRef.current;
  // Once the user clones the sample to their own project we flip this on so
  // sync() activates and isSample-gated UI (read-only banners, upgrade CTA)
  // disappears — the project becomes a normal owned project.
  const [clonedFromSample, setClonedFromSample] = useState(false);
  const isSample = isSampleEntry && !clonedFromSample;

  // ---- Identity / step ----
  const [projectId, setProjectId] = useState<string>(initialProjectId || generateProjectId());
  const [createdAt, setCreatedAt] = useState<string>(
    () => sampleSeed?.created_at || new Date().toISOString()
  );
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5 | 6 | 7>(sampleSeed ? 6 : 1);
  const [maxStep, setMaxStep] = useState<number>(sampleSeed ? 7 : 1);
  const [savedMode, setSavedModeState] = useState<WizardMode | null>(
    sampleSeed ? 'pro' : null
  );

  // ---- Project config ----
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16' | '1:1' | '3:4'>(
    sampleSeed?.aspect_ratio || '16:9'
  );
  const [videoStyle, setVideoStyle] = useState(sampleSeed?.style_template || 'Cute Stickman');
  const [topic, setTopic] = useState(sampleSeed?.saved_topic || '');
  const [duration, setDuration] = useState(
    sampleSeed?.saved_duration ?? (expressMode ? 16 : 30)
  );
  const [script, setScript] = useState(sampleSeed?.saved_script || '');
  const [characterProfile, setCharacterProfile] = useState('');
  const [useReferenceImage, setUseReferenceImage] = useState(true);
  const [characterReferenceImage, setCharacterReferenceImage] = useState<string | undefined>(
    undefined
  );
  const [generatingReference, setGeneratingReference] = useState(false);
  const [characterReferences, setCharacterReferences] = useState<CharacterReference[]>([]);
  const [generatingCharRefIdx, setGeneratingCharRefIdx] = useState<number | null>(null);
  const [sceneDurationMode, setSceneDurationMode] = useState<'time' | 'scenes'>('time');
  const [targetSceneCount, setTargetSceneCount] = useState(
    sampleSeed?.target_scene_count ?? (expressMode ? 2 : 4)
  );
  const [useVeoAudio, setUseVeoAudio] = useState(sampleSeed?.use_veo_audio ?? true);
  const [videoMode, setVideoMode] = useState<VideoMode>(
    sampleSeed?.video_mode || (expressMode ? 'presentation' : 'ai')
  );
  // ContextPack linkage state.
  const [linkedContextPackId, setLinkedContextPackId] = useState<string | undefined>(undefined);
  const [linkedContextPackName, setLinkedContextPackName] = useState<string | undefined>(undefined);
  const [linkedContextPack, setLinkedContextPack] = useState<ContextPack | undefined>(undefined);
  const [contextPackVersion, setContextPackVersion] = useState<number | undefined>(undefined);
  const [contextPackDirty, setContextPackDirty] = useState<boolean>(false);
  const [scenes, setScenes] = useState<Partial<Scene>[]>(
    () => (sampleSeed?.saved_scenes as Partial<Scene>[] | undefined) || []
  );
  const [thumbnail, setThumbnail] = useState<string | undefined>(sampleSeed?.thumbnail);
  const [genre, setGenre] = useState<GenreId | undefined>(undefined);
  const [platform, setPlatform] = useState<PlatformId | undefined>(undefined);
  const [styleSheet, setStyleSheet] = useState<StyleSheet | undefined>(undefined);
  const [visionCriticEnabled, setVisionCriticEnabled] = useState<boolean>(
    sampleSeed?.vision_critic_enabled ?? (expressMode ? false : true)
  );
  const [qualityThreshold, setQualityThreshold] = useState<number>(6);
  const [negativePrompt, setNegativePrompt] = useState<string>('');
  const [generatingStyleSheet, setGeneratingStyleSheet] = useState<boolean>(false);
  const [creativeBrief, setCreativeBrief] = useState<CreativeBrief>({});
  const [remixSource, setRemixSource] = useState<RemixSourceData | undefined>(undefined);
  const [backgroundReplacements, setBackgroundReplacements] = useState<Record<string, string>>({});
  const [stats, setStats] = useState<ProjectStats>({
    imagesGenerated: sampleSeed?.stats?.imagesGenerated || 0,
    criticCalls: sampleSeed?.stats?.criticCalls || 0,
    refineCalls: sampleSeed?.stats?.refineCalls || 0,
    videosGenerated: sampleSeed?.stats?.videosGenerated || 0,
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
  const [selectedTextModel, setSelectedTextModel] = useState<string>('');
  const [showModelSelector, setShowModelSelector] = useState<'image' | 'video' | null>(null);
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>(
    sampleSeed?.caption_style || DEFAULT_CAPTION_STYLE
  );

  // ---- Brand Kit ----
  const [brandKit, setBrandKit] = useState<BrandKit | undefined>(undefined);

  // Load brand kit on mount (non-blocking — runs after the wizard is displayed)
  useEffect(() => {
    if (!userId || isSampleEntry) return;
    let cancelled = false;
    loadBrandKit(userId)
      .then(kit => {
        if (cancelled) return;
        setBrandKit(kit);
        // Auto-apply brand palette to StyleSheet when this is a fresh project
        // (no styleSheet set yet and the project is new).
        if (!initialProjectId) {
          setStyleSheet(prev => {
            if (prev) return prev; // already set — don't overwrite
            const { primary, secondary, accent } = kit.palette;
            // Seed a minimal StyleSheet using the brand colours as the first
            // three palette entries; the remaining two slots get neutral fills
            // so the palette is always length-5.
            return {
              palette: [primary, secondary, accent, '#f8f9fa', '#212529'],
              lighting: 'natural cinematic lighting',
              mood: 'brand-consistent',
            };
          });
        }
      })
      .catch(e => console.warn('[BrandKit] load failed:', e));
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

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
  const creativeBriefRef = useRef(creativeBrief);
  const remixSourceRef = useRef(remixSource);
  const backgroundReplacementsRef = useRef(backgroundReplacements);
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
  useEffect(() => {
    creativeBriefRef.current = creativeBrief;
  }, [creativeBrief]);
  useEffect(() => {
    remixSourceRef.current = remixSource;
  }, [remixSource]);
  useEffect(() => {
    backgroundReplacementsRef.current = backgroundReplacements;
  }, [backgroundReplacements]);

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
        const txtModels = getModelsByType(models, 'text');
        if (imgModels.length > 0 && !selectedImageModel) setSelectedImageModel(imgModels[0].id);
        if (vidModels.length > 0 && !selectedVideoModel) setSelectedVideoModel(vidModels[0].id);
        if (txtModels.length > 0 && !selectedTextModel) setSelectedTextModel(txtModels[0].modelId);
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
  const rawSync = useSync({
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
  });
  // Sample project: never write to cloud / cache. The sample is read-only
  // until the user clicks "AI 영상으로 업그레이드" which clones it into a
  // real project (clonedFromSample flips on, sync re-enables).
  const noopSync: SyncFn = () => {};
  const sync: SyncFn = isSample ? noopSync : rawSync;
  syncRef.current = sync;

  // Clone the in-memory sample into a real owned project. Generates a fresh
  // project id, flips clonedFromSample on (re-enabling sync), notifies the
  // parent so editingProjectId follows, and immediately persists current
  // state under the new id. Returns the new id.
  const cloneSampleToProject = (): string => {
    if (!isSample) return projectId;
    const newId = generateProjectId();
    setProjectId(newId);
    setCreatedAt(new Date().toISOString());
    setClonedFromSample(true);
    onProjectIdChange?.(newId);
    // Defer initial sync until after the state flip so rawSync sees the new id.
    queueMicrotask(() => syncRef.current && syncRef.current());
    return newId;
  };

  // ---- Restore on mount ----
  const { restoreStatus, restoreError, restoreSlow, retryRestore } = useRestore({
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
    setSelectedTextModel,
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
    setCreativeBrief,
    setRemixSource,
    setBackgroundReplacements,
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

  // Task #95 clone-on-edit: any mutating action on a sample session must
  // first clone the read-only sample into a real owned project so changes
  // persist + Sync resumes. ensureOwned() is a no-op once cloned (or on
  // non-sample sessions), so wrappers below are cheap.
  const ensureOwned = () => {
    if (isSample) cloneSampleToProject();
  };

  const updateSceneAt = (idx: number, updates: Partial<Scene>) => {
    // updateSceneAt is also called by the action hooks themselves (post-
    // generation, with paths owned by the new project id). We only need
    // ensureOwned() for direct user edits — the wrappers above already
    // guarantee actions run under the cloned id, so calling it here is
    // a defensive belt: idempotent if already cloned.
    if (isSample) cloneSampleToProject();
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
    ensureOwned();
    const ok = await ensureGoogleApiKey();
    if (!ok) return;
    return rawHandleBatchVideos();
  };

  const handleSingleVideo = async (idx: number): Promise<void> => {
    ensureOwned();
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
    canRetryFFmpegLoad,
    retryFFmpegLoad,
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
    brandKit,
  });

  // Task #95 clone-on-edit wrappers — every user-initiated mutating action
  // first clones the sample if needed, then dispatches to the latest raw
  // handler via actionsRef. Routing via ref (rather than the closure-
  // captured handler from this render) is what makes the clone
  // deterministic: by the time we call actionsRef.current.x() we've
  // yielded to React, the rerender has run, the action hooks have
  // re-executed with the new projectId, and actionsRef has been updated.
  const actionsRef = useRef({
    handleBatchAudio,
    handleSingleAudio,
    handleBatchImages,
    handleSingleImage,
    handleRefineImage,
    handleBatchVideos,
    handleSingleVideo,
    handleRenderPresentation,
    handleMergeExport,
    handleAutoSplitExport,
  });
  actionsRef.current = {
    handleBatchAudio,
    handleSingleAudio,
    handleBatchImages,
    handleSingleImage,
    handleRefineImage,
    handleBatchVideos,
    handleSingleVideo,
    handleRenderPresentation,
    handleMergeExport,
    handleAutoSplitExport,
  };

  // Yield until the next paint frame so React has applied the clone state
  // update (and the action hooks have re-derived with the new projectId).
  // Two rAFs is enough to guarantee a commit phase has flushed even in
  // batched updates.
  const waitForRerender = (): Promise<void> =>
    new Promise(resolve => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });

  const ensureOwnedAsync = async () => {
    if (!isSample) return;
    cloneSampleToProject();
    await waitForRerender();
  };

  const wrappedHandleBatchAudio = async () => { await ensureOwnedAsync(); return actionsRef.current.handleBatchAudio(); };
  const wrappedHandleSingleAudio = async (idx: number) => { await ensureOwnedAsync(); return actionsRef.current.handleSingleAudio(idx); };
  const wrappedHandleBatchImages = async () => { await ensureOwnedAsync(); return actionsRef.current.handleBatchImages(); };
  const wrappedHandleSingleImage = async (idx: number) => { await ensureOwnedAsync(); return actionsRef.current.handleSingleImage(idx); };
  const wrappedHandleRefineImage = async (idx: number) => { await ensureOwnedAsync(); return actionsRef.current.handleRefineImage(idx); };
  const wrappedHandleBatchVideos = async () => { await ensureOwnedAsync(); return actionsRef.current.handleBatchVideos(); };
  const wrappedHandleSingleVideo = async (idx: number) => { await ensureOwnedAsync(); return actionsRef.current.handleSingleVideo(idx); };
  const wrappedHandleRenderPresentation = async () => { await ensureOwnedAsync(); return actionsRef.current.handleRenderPresentation(); };
  const wrappedHandleMergeExport = async () => { await ensureOwnedAsync(); return actionsRef.current.handleMergeExport(); };
  const wrappedHandleAutoSplitExport = async () => { await ensureOwnedAsync(); return actionsRef.current.handleAutoSplitExport(); };

  // ---- Derived state ----
  const isProcessing = processingSet.size > 0;
  const isImagesReady = scenes.length > 0 && scenes.every(s => !!s.image_path);
  const isVideosReady = scenes.length > 0 && scenes.every(s => !!s.video_path);
  const isPresentationMode = videoMode === 'presentation';

  const failedCount = (type: string) =>
    Array.from(failedScenes.keys()).filter(k => k.startsWith(type)).length;

  const value: WizardContextValue = {
    isSample,
    cloneSampleToProject,
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
    creativeBrief,
    setCreativeBrief,
    remixSource,
    setRemixSource,
    backgroundReplacements,
    setBackgroundReplacements,
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
    restoreStatus,
    restoreError,
    restoreSlow,
    retryRestore,
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
    selectedTextModel,
    setSelectedTextModel,
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
    handleMergeExport: wrappedHandleMergeExport,
    handleDownloadMerged,
    handleSingleAudio: wrappedHandleSingleAudio,
    handleBatchAudio: wrappedHandleBatchAudio,
    handleBatchImages: wrappedHandleBatchImages,
    handleRefineImage: wrappedHandleRefineImage,
    handleSingleImage: wrappedHandleSingleImage,
    handleBatchVideos: wrappedHandleBatchVideos,
    handleSingleVideo: wrappedHandleSingleVideo,
    handleRenderPresentation: wrappedHandleRenderPresentation,
    handleAutoSplitExport: wrappedHandleAutoSplitExport,
    canRetryFFmpegLoad,
    retryFFmpegLoad,
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
    brandKit,
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
