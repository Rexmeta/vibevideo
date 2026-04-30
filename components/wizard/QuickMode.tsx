import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Icons } from '../Icons';
import { useWizard } from './WizardContext';
import { runQuickPipeline, QuickPipelineProgress, QuickPipelineStage, AwaitRetries } from './runQuickPipeline';
import { setStoredMode, type WizardMode } from './ModeGate';
import type { Scene } from '../../types';

interface Props {
  onSwitchMode: (mode: WizardMode) => void;
}

type SceneStageStatus = 'queued' | 'waiting' | 'in-progress' | 'done' | 'failed';

interface SceneStageView {
  idx: number;
  status: SceneStageStatus;
  thumbnail?: string;
  errorMessage?: string;
  label: string;
}

const STAGE_META: Record<QuickPipelineStage, { label: string; Icon: LucideIcon }> = {
  script: { label: '스크립트', Icon: Icons.Type },
  segment: { label: '씬 분석', Icon: Icons.Layers },
  style: { label: '스타일 시트', Icon: Icons.Palette },
  audio: { label: '오디오', Icon: Icons.Mic },
  images: { label: '이미지', Icon: Icons.ImageIcon },
  videos: { label: '비디오', Icon: Icons.Film },
  done: { label: '완료', Icon: Icons.Check },
};

const PER_SCENE_STAGES: QuickPipelineStage[] = ['audio', 'images', 'videos'];

const formatDuration = (seconds: number): string => {
  if (!isFinite(seconds) || seconds <= 0) return '곧 완료';
  const s = Math.round(seconds);
  if (s < 60) return `약 ${s}초`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (r === 0) return `약 ${m}분`;
  return `약 ${m}분 ${r}초`;
};

// Compact realized-duration formatter for the stage timeline ("24s", "1m 12s").
const formatRealized = (ms: number | undefined): string | null => {
  if (!ms || !isFinite(ms) || ms <= 0) return null;
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (r === 0) return `${m}m`;
  return `${m}m ${r}s`;
};

export const QuickMode: React.FC<Props> = ({ onSwitchMode }) => {
  const ctx = useWizard();
  const {
    topic,
    setTopic,
    duration,
    setDuration,
    aspectRatio,
    setAspectRatio,
    videoStyle,
    setVideoStyle,
    useVeoAudio,
    setUseVeoAudio,
    videoMode,
    setVideoMode,
    syncing,
    syncError,
    audioRef,
    syncAudioRef,
    setPlayingAudioIdx,
    projectId,
    scenes,
    processingSet,
    processingType,
    failedScenes,
    isPresentationMode,
    handleSingleAudio,
    handleSingleImage,
    handleSingleVideo,
    handleBatchAudio,
    handleBatchImages,
    handleBatchVideos,
  } = ctx;

  const [progress, setProgress] = useState<QuickPipelineProgress | null>(null);
  const [running, setRunning] = useState(false);
  // True during the brief delay between the pipeline finishing successfully
  // and the auto-handoff to Pro mode, while the timing summary is on screen.
  const [handoffPending, setHandoffPending] = useState(false);
  const [failure, setFailure] = useState<{ step: number; error: string } | null>(null);

  // When the pipeline pauses at a per-scene stage because of failures, we record
  // which scene indices the pipeline is waiting on. The pipeline's awaitRetries
  // callback returns a Promise that we resolve once those scenes recover (or
  // when the user explicitly gives up via the handoff button).
  const [awaitingRetries, setAwaitingRetries] = useState<{
    stage: 'audio' | 'images' | 'videos';
    missing: number[];
  } | null>(null);
  const awaitContinueRef = useRef<((cont: boolean) => void) | null>(null);

  // Track when each per-scene stage started, plus a rolling estimate of how long
  // each scene takes so we can surface an "estimated time remaining" hint.
  const stageStartedRef = useRef<Map<QuickPipelineStage, number>>(new Map());
  const [now, setNow] = useState<number>(Date.now());

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);

  useEffect(() => {
    if (!progress) return;
    const stage = progress.stage;
    if (PER_SCENE_STAGES.includes(stage) && !stageStartedRef.current.has(stage)) {
      stageStartedRef.current.set(stage, Date.now());
    }
    if (stage === 'done') {
      stageStartedRef.current.clear();
    }
  }, [progress]);

  const awaitRetries: AwaitRetries = (stage, missing) =>
    new Promise<boolean>(resolve => {
      awaitContinueRef.current = resolve;
      setAwaitingRetries({ stage, missing });
    });

  const handleStart = async () => {
    if (!topic.trim()) {
      alert('비디오 주제를 입력하세요.');
      return;
    }
    setFailure(null);
    setRunning(true);
    stageStartedRef.current = new Map();
    setProgress({ stage: 'script', label: '시작합니다...', percent: 1 });

    const result = await runQuickPipeline(ctx, topic, p => setProgress(p), awaitRetries);

    setRunning(false);
    setAwaitingRetries(null);
    awaitContinueRef.current = null;

    if (!result.success) {
      setFailure({ step: result.failedStep || 2, error: result.error || '알 수 없는 오류' });
    } else {
      // Give the user a few seconds to read the per-stage timing summary
      // before the auto-handoff to Pro mode swaps the screen out. The
      // manual "Pro Mode로 전환" button is hidden during this window so
      // it can't fight the auto-handoff or be clicked accidentally.
      setHandoffPending(true);
      await new Promise(r => setTimeout(r, 5000));
      setStoredMode('pro', projectId);
      onSwitchMode('pro');
    }
  };

  const handleHandoff = () => {
    if (awaitContinueRef.current) {
      awaitContinueRef.current(false);
      awaitContinueRef.current = null;
    }
    setAwaitingRetries(null);
    setStoredMode('pro', projectId);
    onSwitchMode('pro');
  };

  // Auto-resume the pipeline as soon as every originally-missing scene has
  // recovered (i.e. has a fresh path AND no lingering failure marker).
  useEffect(() => {
    if (!awaitingRetries) return;
    const { stage, missing } = awaitingRetries;
    const failPrefix = stage === 'audio' ? 'audio-' : stage === 'images' ? 'image-' : 'video-';
    const allDone = missing.every(idx => {
      const s = scenes[idx];
      if (!s) return false;
      if (stage === 'audio') return !!s.audio_path;
      if (stage === 'images') return !!s.image_path;
      return !!s.video_path;
    });
    const stillFailing = missing.some(idx => failedScenes.has(`${failPrefix}${idx}`));
    if (allDone && !stillFailing && awaitContinueRef.current) {
      const resolve = awaitContinueRef.current;
      awaitContinueRef.current = null;
      setAwaitingRetries(null);
      resolve(true);
    }
  }, [awaitingRetries, scenes, failedScenes]);

  const retryScene = (idx: number) => {
    if (!activeStage) return;
    if (processingType !== null) return;
    if (activeStage === 'audio') void handleSingleAudio(idx);
    else if (activeStage === 'images') void handleSingleImage(idx);
    else if (activeStage === 'videos') void handleSingleVideo(idx);
  };

  const retryAllFailed = () => {
    if (!activeStage) return;
    if (processingType !== null) return;
    // The batch handlers already filter out scenes that already have an
    // uploaded media path, so re-running the batch only re-attempts the
    // failed/missing scenes.
    if (activeStage === 'audio') void handleBatchAudio();
    else if (activeStage === 'images') void handleBatchImages();
    else if (activeStage === 'videos') void handleBatchVideos();
  };

  const hasMeaningfulChanges =
    topic.trim().length > 0 ||
    duration !== 30 ||
    aspectRatio !== '16:9' ||
    videoStyle !== 'Cute Stickman' ||
    videoMode !== 'ai' ||
    useVeoAudio !== true;

  const handleSwitchToPro = () => {
    if (hasMeaningfulChanges) {
      const ok = window.confirm(
        'Pro Mode로 전환합니다.\n지금까지 입력한 주제와 설정(길이, 비율, 스타일 등)은 그대로 유지되며, 7단계 전체를 직접 제어할 수 있어요.\n\n계속할까요?'
      );
      if (!ok) return;
    }
    setStoredMode('pro', projectId);
    onSwitchMode('pro');
  };

  const canShowSwitch = !running && !syncing && !handoffPending;

  const activeStage = progress?.stage;
  const totalScenes = progress?.totalScenes ?? scenes.length;

  // Build per-scene status entries for the currently active per-scene stage.
  const sceneViews: SceneStageView[] = useMemo(() => {
    if (!activeStage || !PER_SCENE_STAGES.includes(activeStage)) return [];
    const stageProcessingType: Record<QuickPipelineStage, 'audio' | 'image' | 'video' | null> = {
      script: null,
      segment: null,
      style: null,
      audio: 'audio',
      images: 'image',
      videos: 'video',
      done: null,
    };
    const failKeyPrefix: Record<QuickPipelineStage, string> = {
      script: '',
      segment: '',
      style: '',
      audio: 'audio-',
      images: 'image-',
      videos: 'video-',
      done: '',
    };
    const expectedType = stageProcessingType[activeStage];
    const list: Partial<Scene>[] =
      scenes.length > 0
        ? scenes
        : Array.from<unknown, Partial<Scene>>({ length: totalScenes }, () => ({}));
    // Pre-compute which scenes are still pending. For the videos stage the
    // batch handler runs scenes sequentially with a 60s rate-limit wait
    // *before* the next scene is marked as in-progress. During that wait
    // `processingSet` is empty, so the very next un-finished scene is shown
    // as "waiting" instead of plain "queued" to set accurate expectations.
    const pendingIndices: number[] = [];
    list.forEach((s, idx) => {
      const isDone =
        activeStage === 'audio'
          ? !!s.audio_path
          : activeStage === 'images'
          ? !!s.image_path
          : !!s.video_path;
      const failKey = `${failKeyPrefix[activeStage]}${idx}`;
      if (!isDone && !failedScenes.get(failKey)) pendingIndices.push(idx);
    });
    const isVideoWaiting =
      activeStage === 'videos' &&
      processingType === 'video' &&
      processingSet.size === 0 &&
      pendingIndices.length > 0;
    const nextWaitingIdx = isVideoWaiting ? pendingIndices[0] : -1;
    return list.map((s, idx) => {
      const isProcessing = processingType === expectedType && processingSet.has(idx);
      const failKey = `${failKeyPrefix[activeStage]}${idx}`;
      const failed = failedScenes.get(failKey);
      let done = false;
      if (activeStage === 'audio') done = !!s.audio_path;
      else if (activeStage === 'images') done = !!s.image_path;
      else if (activeStage === 'videos') done = !!s.video_path;
      let status: SceneStageStatus = 'queued';
      // Prefer "done" / "in-progress" over a stale "failed" marker so that a
      // scene currently being retried shows a spinner instead of the red
      // overlay.
      if (done) status = 'done';
      else if (isProcessing) status = 'in-progress';
      else if (failed) status = 'failed';
      else if (idx === nextWaitingIdx) status = 'waiting';
      const label =
        status === 'done'
          ? '완료'
          : status === 'in-progress'
          ? '생성 중...'
          : status === 'failed'
          ? '실패'
          : status === 'waiting'
          ? '대기열 대기 중'
          : '대기 중';
      return {
        idx,
        status,
        // Use the scene image as the thumbnail for done scenes when available
        // (works for the images and videos stages; audio stage falls back to a number badge).
        thumbnail: s.image_path || undefined,
        errorMessage: failed,
        label,
      };
    });
  }, [activeStage, scenes, processingSet, processingType, failedScenes, totalScenes]);

  const completedCount = sceneViews.filter(v => v.status === 'done').length;
  const inProgressCount = sceneViews.filter(v => v.status === 'in-progress').length;
  const failedCount = sceneViews.filter(v => v.status === 'failed').length;
  const remainingCount = Math.max(0, sceneViews.length - completedCount - failedCount);

  // Estimated time remaining: extrapolate from how long completed scenes took
  // in the current stage. Falls back to a per-stage default when nothing has
  // finished yet.
  const estimatedRemainingMs = useMemo(() => {
    if (!activeStage || !PER_SCENE_STAGES.includes(activeStage) || sceneViews.length === 0)
      return null;
    if (remainingCount === 0 && inProgressCount === 0) return null;
    const startedAt = stageStartedRef.current.get(activeStage);
    if (!startedAt) return null;
    const elapsed = now - startedAt;
    if (completedCount > 0) {
      const perScene = elapsed / completedCount;
      // remainingCount already includes both queued and in-progress scenes,
      // so multiply once — adding inProgressCount again would double-count.
      return perScene * remainingCount;
    }
    // No scenes finished yet — use rough defaults so we still show *something*.
    const defaults: Partial<Record<QuickPipelineStage, number>> = {
      audio: 8_000,
      images: 25_000,
      videos: 90_000,
    };
    const perScene = defaults[activeStage] ?? 15_000;
    return perScene * sceneViews.length;
  }, [activeStage, sceneViews.length, completedCount, inProgressCount, remainingCount, now]);

  const stageList: QuickPipelineStage[] = useMemo(() => {
    const base: QuickPipelineStage[] = ['script', 'segment', 'style'];
    if (!useVeoAudio) base.push('audio');
    base.push('images');
    if (!isPresentationMode) base.push('videos');
    return base;
  }, [useVeoAudio, isPresentationMode]);

  const stageReached = (stage: QuickPipelineStage): boolean => {
    if (!activeStage) return false;
    if (activeStage === 'done') return true;
    return stageList.indexOf(stage) <= stageList.indexOf(activeStage);
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-12 relative">
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

      {canShowSwitch && (
        <div className="mb-6 flex justify-end">
          <button
            onClick={handleSwitchToPro}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white border-2 border-gray-100 hover:border-brand-dark hover:bg-brand-dark/5 text-brand-dark text-[11px] font-black uppercase tracking-widest transition-all shadow-sm"
            title={hasMeaningfulChanges ? '입력한 설정을 그대로 들고 Pro Mode 7단계로 이동' : 'Pro Mode 7단계로 이동'}
          >
            <Icons.SlidersHorizontal size={14} className="text-brand-dark" />
            Pro Mode로 전환
          </button>
        </div>
      )}

      <div className="text-center mb-10">
        <div className="inline-flex items-center gap-2 mb-4 px-4 py-1.5 rounded-full bg-brand-cyan/10 text-brand-dark text-[11px] font-black uppercase tracking-widest">
          <Icons.Wand2 size={14} /> Quick Mode
        </div>
        <h1 className="text-5xl font-black tracking-tighter text-brand-dark mb-3">한 번에 만들기</h1>
        <p className="text-gray-500 italic font-medium">주제를 입력하고 시작 버튼을 누르면 AI가 모든 것을 처리합니다.</p>
      </div>

      <div className="bg-white rounded-[3.5rem] shadow-2xl p-10 md:p-14 border border-gray-50">
        {!running && !progress?.percent && (
          <div className="space-y-8">
            <div>
              <label className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 mb-3 block">비디오 주제</label>
              <textarea
                value={topic}
                onChange={e => setTopic(e.target.value)}
                placeholder="예: 2024년 파리 올림픽 하이라이트 1분 요약"
                className="w-full p-6 bg-gray-50 rounded-[2rem] outline-none text-xl font-bold shadow-inner resize-none h-32"
                autoFocus
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 mb-2 block">길이</label>
                <select
                  value={duration}
                  onChange={e => setDuration(Number(e.target.value))}
                  className="w-full px-4 py-3 bg-gray-50 rounded-2xl text-sm font-bold border-2 border-transparent focus:border-brand-cyan outline-none"
                >
                  {[16, 24, 32, 48, 60, 90, 120].map(d => (
                    <option key={d} value={d}>{d}초</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 mb-2 block">비율</label>
                <select
                  value={aspectRatio}
                  onChange={e => setAspectRatio(e.target.value as any)}
                  className="w-full px-4 py-3 bg-gray-50 rounded-2xl text-sm font-bold border-2 border-transparent focus:border-brand-cyan outline-none"
                >
                  {['16:9', '9:16', '1:1', '3:4'].map(r => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 mb-2 block">스타일</label>
                <select
                  value={videoStyle}
                  onChange={e => setVideoStyle(e.target.value)}
                  className="w-full px-4 py-3 bg-gray-50 rounded-2xl text-sm font-bold border-2 border-transparent focus:border-brand-cyan outline-none"
                >
                  {['Cute Stickman', 'Japanese Anime', 'Realistic Cinematic', '3D Pixar-like'].map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <button
                onClick={() => setVideoMode(videoMode === 'ai' ? 'presentation' : 'ai')}
                className={`p-5 rounded-[1.5rem] border-2 text-left transition-all ${videoMode === 'ai' ? 'border-brand-cyan bg-brand-cyan/5' : 'border-gray-100 hover:border-gray-200'}`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-black uppercase">AI Video</span>
                  {videoMode === 'ai' && <Icons.Check size={16} className="text-brand-cyan" />}
                </div>
                <p className="text-[10px] text-gray-400">Veo로 직접 동영상 생성 (씬당 ~1분 + 60초 대기)</p>
              </button>
              <button
                onClick={() => setVideoMode(videoMode === 'presentation' ? 'ai' : 'presentation')}
                className={`p-5 rounded-[1.5rem] border-2 text-left transition-all ${videoMode === 'presentation' ? 'border-brand-cyan bg-brand-cyan/5' : 'border-gray-100 hover:border-gray-200'}`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-black uppercase">Presentation</span>
                  {videoMode === 'presentation' && <Icons.Check size={16} className="text-brand-cyan" />}
                </div>
                <p className="text-[10px] text-gray-400">이미지 + 전환 효과 (가장 빠름, 비디오 단계 생략)</p>
              </button>
            </div>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={useVeoAudio}
                onChange={e => setUseVeoAudio(e.target.checked)}
                className="w-4 h-4 accent-brand-cyan"
              />
              <span className="text-sm font-bold text-gray-700">Veo 내장 오디오 사용 (별도 TTS 단계 생략)</span>
            </label>

            <button
              onClick={handleStart}
              disabled={!topic.trim()}
              className="w-full bg-brand-dark text-white py-7 rounded-full font-black text-2xl shadow-2xl hover:scale-[1.01] transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-3"
            >
              <Icons.Wand2 size={24} /> 자동 생성 시작
            </button>
          </div>
        )}

        {(running || (progress && progress.percent > 0)) && (
          <div className="py-8">
            <div className="text-center">
              <div className="relative inline-block mb-8">
                {failure ? (
                  <div className="w-32 h-32 border-8 border-red-100 border-t-red-400 rounded-full"></div>
                ) : (
                  <div className="w-32 h-32 border-8 border-gray-100 border-t-brand-cyan rounded-full animate-spin"></div>
                )}
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className={`text-2xl font-black tabular-nums ${failure ? 'text-red-500' : 'text-brand-dark'}`}>
                    {failure ? '!' : `${progress?.percent ?? 0}%`}
                  </span>
                </div>
              </div>
              <p className="text-2xl font-black text-brand-dark mb-2">
                {failure ? '생성 중단됨' : progress?.label || '진행 중...'}
              </p>
              {activeStage && PER_SCENE_STAGES.includes(activeStage) && sceneViews.length > 0 ? (
                <p className="text-sm text-gray-500 font-bold mb-2">
                  씬 {completedCount} / {sceneViews.length} 완료
                  {inProgressCount > 0 ? ` · 진행 ${inProgressCount}` : ''}
                  {failedCount > 0 ? ` · 실패 ${failedCount}` : ''}
                </p>
              ) : null}
              {!failure && estimatedRemainingMs !== null && (
                <p className="text-xs text-gray-400 mb-6">
                  예상 남은 시간: {formatDuration(estimatedRemainingMs / 1000)}
                </p>
              )}
              {!failure && estimatedRemainingMs === null && (
                <p className="text-sm text-gray-400 italic mb-6">잠시만 기다려주세요. 비디오 단계는 씬당 약 1분 + 60초 대기가 필요합니다.</p>
              )}
              <div className="max-w-md mx-auto h-3 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${
                    failure
                      ? 'bg-gradient-to-r from-red-300 to-red-500'
                      : 'bg-gradient-to-r from-brand-cyan to-emerald-400'
                  }`}
                  style={{ width: `${progress?.percent ?? 0}%` }}
                />
              </div>
            </div>

            {/* Stage timeline */}
            <div className="mt-10 flex items-center justify-center gap-2 flex-wrap">
              {stageList.map((stage, i) => {
                const reached = stageReached(stage);
                const current = stage === activeStage && !failure;
                const meta = STAGE_META[stage];
                const StageIcon = meta.Icon;
                // Show realized duration once a stage has finished. The
                // pipeline emits a `stageDurations` map as soon as each
                // stage is closed out, so completed (non-current) stages
                // get an annotation like "24s" or "1m 12s".
                const realized =
                  reached && !current
                    ? formatRealized(progress?.stageDurations?.[stage])
                    : null;
                return (
                  <React.Fragment key={stage}>
                    {i > 0 && (
                      <span
                        className={`h-[2px] w-6 ${
                          reached ? 'bg-brand-cyan' : 'bg-gray-200'
                        }`}
                      />
                    )}
                    <div
                      className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-black uppercase tracking-widest border-2 transition-colors ${
                        current
                          ? 'border-brand-cyan bg-brand-cyan/10 text-brand-dark'
                          : reached
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : 'border-gray-100 bg-gray-50 text-gray-400'
                      }`}
                    >
                      {current ? (
                        <Icons.Loader2 size={12} className="animate-spin" />
                      ) : reached ? (
                        <Icons.Check size={12} />
                      ) : (
                        <StageIcon size={12} />
                      )}
                      <span>{meta.label}</span>
                      {realized && (
                        <span className="px-1.5 py-0.5 rounded-full bg-white/70 text-emerald-700 text-[9px] tabular-nums tracking-wider border border-emerald-100">
                          {realized}
                        </span>
                      )}
                    </div>
                  </React.Fragment>
                );
              })}
            </div>

            {/* Final per-stage timing summary, shown briefly before the
                auto-handoff to Pro mode. */}
            {activeStage === 'done' && !failure && progress?.stageDurations && (
              <div className="mt-8 max-w-xl mx-auto px-6 py-5 rounded-2xl bg-emerald-50 border-2 border-emerald-100">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-700">
                    완료 — 단계별 소요 시간
                  </span>
                  {progress.totalMs && (
                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-900 tabular-nums">
                      Total {formatRealized(progress.totalMs)}
                    </span>
                  )}
                </div>
                <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                  {stageList.map(stage => {
                    const meta = STAGE_META[stage];
                    const StageIcon = meta.Icon;
                    const realized = formatRealized(progress.stageDurations?.[stage]);
                    // The pipeline omits the 'style' stage when a stylesheet
                    // already exists, so a missing duration here means the
                    // stage was skipped, not that timing was lost.
                    const skipped = !realized;
                    return (
                      <li
                        key={stage}
                        className="flex items-center justify-between text-[11px] font-bold text-emerald-900"
                      >
                        <span className="flex items-center gap-1.5">
                          <StageIcon size={11} className={skipped ? 'text-emerald-300' : 'text-emerald-600'} />
                          <span className={skipped ? 'text-emerald-700/60' : ''}>{meta.label}</span>
                        </span>
                        <span className={`tabular-nums ${skipped ? 'text-emerald-500/70 italic font-normal' : 'text-emerald-700'}`}>
                          {realized || '건너뜀'}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-3 text-[10px] text-emerald-700/80 italic text-center">
                  잠시 후 Pro Mode로 자동 전환됩니다...
                </p>
              </div>
            )}

            {/* Per-scene grid */}
            {activeStage && PER_SCENE_STAGES.includes(activeStage) && sceneViews.length > 0 && (
              <div className="mt-8">
                <div className="flex items-center justify-between mb-4 px-1">
                  <h3 className="text-xs font-black uppercase tracking-[0.2em] text-gray-500">
                    씬별 상태 ({STAGE_META[activeStage].label})
                  </h3>
                  <span className="text-[11px] font-bold text-gray-400">
                    {completedCount}/{sceneViews.length} 완료
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {sceneViews.map(view => {
                    const borderClass =
                      view.status === 'done'
                        ? 'border-emerald-300'
                        : view.status === 'in-progress'
                        ? 'border-brand-cyan animate-pulse'
                        : view.status === 'waiting'
                        ? 'border-amber-300'
                        : view.status === 'failed'
                        ? 'border-red-300'
                        : 'border-gray-200';
                    const statusBadgeClass =
                      view.status === 'done'
                        ? 'bg-emerald-500 text-white'
                        : view.status === 'in-progress'
                        ? 'bg-brand-cyan text-brand-dark'
                        : view.status === 'waiting'
                        ? 'bg-amber-400 text-white'
                        : view.status === 'failed'
                        ? 'bg-red-500 text-white'
                        : 'bg-gray-200 text-gray-500';
                    const isImageStage = activeStage === 'images';
                    const showThumb =
                      view.thumbnail && (activeStage === 'videos' || (isImageStage && view.status === 'done'));
                    return (
                      <div
                        key={view.idx}
                        className={`relative rounded-2xl overflow-hidden border-2 ${borderClass} bg-gray-50 aspect-video transition-colors`}
                        title={view.errorMessage || `씬 ${view.idx + 1} — ${view.label}`}
                      >
                        {showThumb ? (
                          <img
                            src={view.thumbnail}
                            alt={`Scene ${view.idx + 1}`}
                            className="absolute inset-0 w-full h-full object-cover"
                          />
                        ) : (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <span className="text-3xl font-black text-gray-300 tabular-nums">
                              {view.idx + 1}
                            </span>
                          </div>
                        )}
                        {/* Overlay for in-progress / waiting / failed */}
                        {view.status === 'in-progress' && (
                          <div className="absolute inset-0 bg-brand-cyan/30 flex items-center justify-center">
                            <Icons.Loader2 className="animate-spin text-white" size={24} />
                          </div>
                        )}
                        {view.status === 'waiting' && (
                          <div className="absolute inset-0 bg-amber-400/30 flex items-center justify-center">
                            <Icons.Clock className="text-white" size={20} />
                          </div>
                        )}
                        {view.status === 'failed' && (
                          <div className="absolute inset-0 bg-red-500/40 flex flex-col items-center justify-center gap-2">
                            <Icons.AlertCircle className="text-white" size={20} />
                            <button
                              onClick={() => retryScene(view.idx)}
                              disabled={processingType !== null}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white text-red-600 text-[10px] font-black uppercase tracking-widest shadow hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed transition-transform"
                              title={view.errorMessage || '이 씬만 다시 생성'}
                            >
                              <Icons.RefreshCw size={11} />
                              재시도
                            </button>
                          </div>
                        )}
                        {/* Bottom label */}
                        <div className="absolute bottom-0 left-0 right-0 px-2 py-1.5 bg-black/60 backdrop-blur-sm flex items-center justify-between gap-2">
                          <span className="text-[10px] font-black uppercase tracking-widest text-white/90">
                            씬 {view.idx + 1}
                          </span>
                          <span
                            className={`text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full ${statusBadgeClass}`}
                          >
                            {view.label}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {failedCount > 0 && (
                  <div className="mt-4 flex flex-col items-center gap-2">
                    <p className="text-[11px] text-red-500 font-bold text-center">
                      {failedCount}개 씬에서 오류가 발생했습니다.
                      {awaitingRetries
                        ? ' 재시도가 모두 완료되면 자동으로 다음 단계로 진행됩니다.'
                        : ''}
                    </p>
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      <button
                        onClick={retryAllFailed}
                        disabled={processingType !== null}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-red-500 text-white text-[11px] font-black uppercase tracking-widest shadow hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed transition-transform"
                      >
                        <Icons.RefreshCw size={12} />
                        재시도 전체
                      </button>
                      {awaitingRetries && (
                        <button
                          onClick={handleHandoff}
                          className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white border-2 border-gray-200 text-gray-700 text-[11px] font-black uppercase tracking-widest hover:border-brand-dark transition-colors"
                        >
                          <Icons.SlidersHorizontal size={12} />
                          Pro Mode에서 이어서 작업
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {failure && (
          <div className="pt-2 pb-8 text-center">
            <div className="max-w-xl mx-auto px-6 py-4 rounded-2xl bg-red-50 border-2 border-red-100 mb-6">
              <p className="text-sm font-bold text-red-700 mb-1">단계 {failure.step}에서 문제가 발생했습니다.</p>
              <p className="text-xs text-red-500">{failure.error}</p>
            </div>
            <div className="flex gap-3 justify-center flex-wrap">
              <button
                onClick={handleHandoff}
                className="px-8 py-4 rounded-full bg-brand-dark text-white font-black text-sm shadow-xl hover:scale-105 transition-all flex items-center gap-2"
              >
                <Icons.SlidersHorizontal size={16} /> Pro Mode에서 이어서 작업
              </button>
              <button
                onClick={() => { setFailure(null); handleStart(); }}
                className="px-8 py-4 rounded-full bg-white border-2 border-gray-200 text-gray-700 font-black text-sm hover:border-brand-dark transition-all"
              >
                다시 시도
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
