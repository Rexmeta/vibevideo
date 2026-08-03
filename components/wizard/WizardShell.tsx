import React, { useState } from 'react';
import { Icons } from '../Icons';
import { useWizard } from './WizardContext';
import { getFirestoreHealthInfo } from '../../services/storageService';
import { Step1Setup } from './Step1Setup';
import { Step2Script } from './Step2Script';
import { StepsAudioImageVideo } from './StepsAudioImageVideo';
import { Step6Preview } from './Step6Preview';
import { Step7Export } from './Step7Export';
import { setStoredMode, type WizardMode } from './ModeGate';
import { ConfirmModal } from './ConfirmModal';
import type { RemixSourceData } from '../../types';

// ─── Remix Source Banner ─────────────────────────────────────────────────────

const RemixSourceBanner: React.FC<{
  source: RemixSourceData;
  onDismiss: () => void;
}> = ({ source, onDismiss }) => {
  const scoreColor =
    source.overallScore >= 7
      ? 'text-green-600'
      : source.overallScore >= 5
      ? 'text-amber-600'
      : 'text-red-500';
  return (
    <div className="mb-6 p-4 rounded-2xl border-2 border-red-100 bg-gradient-to-r from-red-50 to-orange-50 flex gap-3 items-start">
      <div className="w-9 h-9 rounded-xl bg-red-500 flex items-center justify-center shrink-0 mt-0.5">
        <Icons.Play size={13} className="text-white fill-white" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[10px] font-black uppercase tracking-widest text-red-600">
            원본 분석 요약
          </span>
          <span className={`text-xs font-black ${scoreColor}`}>
            {source.overallScore.toFixed(1)}/10
          </span>
          {source.format && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-bold">
              {source.format}
            </span>
          )}
        </div>
        <p className="text-sm font-bold text-gray-800 leading-snug line-clamp-1 mb-1.5">
          {source.detectedTitle || source.videoUrl}
        </p>
        <div className="flex flex-wrap gap-3 text-[11px]">
          {source.topStrength && (
            <span className="flex items-center gap-1 text-green-700">
              <span>✅</span>
              <span className="font-semibold">{source.topStrength.label}</span>
            </span>
          )}
          {source.topWeakness && (
            <span className="flex items-center gap-1 text-red-600">
              <span>⚠️</span>
              <span className="font-semibold">{source.topWeakness.label}</span>
            </span>
          )}
          {source.selectedTips.length > 0 && (
            <span className="text-indigo-600 font-semibold">
              {source.selectedTips.length}개 팁 적용 예정
            </span>
          )}
        </div>
      </div>
      <button
        onClick={onDismiss}
        className="shrink-0 text-gray-300 hover:text-gray-600 transition-colors"
        title="배너 닫기"
        aria-label="리믹스 배너 닫기"
      >
        <Icons.X size={14} />
      </button>
    </div>
  );
};

interface WizardShellProps {
  onSwitchMode?: (mode: WizardMode) => void;
  onStartFreshProject?: () => void;
}

export const WizardShell: React.FC<WizardShellProps> = ({ onSwitchMode, onStartFreshProject }) => {
  const w = useWizard();
  const {
    audioRef,
    syncAudioRef,
    setPlayingAudioIdx,
    syncing,
    syncError,
    isPresentationMode,
    step,
    setStep,
    maxStep,
    isProcessing,
    loading,
    loadingMessage,
    scenes,
    projectId,
    remixSource,
    setRemixSource,
  } = w;

  const [remixBannerDismissed, setRemixBannerDismissed] = useState(false);

  const projectHasProgress = (scenes && scenes.length > 0) || maxStep > 1 || step > 1;
  const cloudDisabled = getFirestoreHealthInfo().disabled;
  const canShowSwitch = !!onSwitchMode && !syncing && !loading && !isProcessing;

  const [switchConfirmOpen, setSwitchConfirmOpen] = useState(false);

  const performSwitchToQuick = () => {
    setStoredMode('quick', projectId);
    // Force a fresh wizard session in Quick Mode. If App provided
    // onStartFreshProject, it will clear the editing project id and
    // bump a session key so ProjectWizard truly remounts. Otherwise
    // fall back to flipping the mode in place.
    if (onStartFreshProject) {
      onStartFreshProject();
    } else {
      onSwitchMode!('quick');
    }
  };

  const handleSwitchToQuick = () => {
    if (projectHasProgress) {
      setSwitchConfirmOpen(true);
      return;
    }
    setStoredMode('quick', projectId);
    onSwitchMode!('quick');
  };

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

      {/* Cloud-disabled badge: signals to the user that the workspace is
          running off the local backup only, so cross-device visibility
          will return once Firestore is re-enabled. */}
      {cloudDisabled && (
        <div className="max-w-5xl mx-auto mb-4 flex justify-center">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-50 border border-amber-200 text-amber-800 text-[11px] font-bold uppercase tracking-wider">
            <Icons.AlertTriangle size={12} />
            로컬 전용 모드 — 이 기기에만 저장됩니다
          </div>
        </div>
      )}

      {/* Mode Toggle */}
      {canShowSwitch && (
        <div className="max-w-5xl mx-auto mb-6 flex justify-end">
          <button
            onClick={handleSwitchToQuick}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white border-2 border-gray-100 hover:border-brand-cyan hover:bg-brand-cyan/5 text-brand-dark text-[11px] font-black uppercase tracking-widest transition-all shadow-sm"
            title={projectHasProgress ? '현재 프로젝트를 두고 Quick Mode로 새 프로젝트 시작' : 'Quick Mode로 돌아가기'}
          >
            <Icons.Wand2 size={14} className="text-brand-cyan" />
            Quick Mode로 전환
          </button>
        </div>
      )}

      <ConfirmModal
        open={switchConfirmOpen}
        title="Quick Mode로 전환할까요?"
        description={
          <>
            현재 프로젝트는 그대로 두고 Quick Mode로 새 프로젝트를 시작합니다.
            {'\n'}진행 중인 작업은 자동으로 저장되어 있으며, 프로젝트 목록에서 다시 열 수 있어요.
          </>
        }
        confirmLabel="Switch to Quick Mode"
        cancelLabel="Stay"
        icon={<Icons.Wand2 size={24} />}
        onCancel={() => setSwitchConfirmOpen(false)}
        onConfirm={() => {
          setSwitchConfirmOpen(false);
          performSwitchToQuick();
        }}
      />

      {/* Stepper */}
      <div className="flex justify-between mb-16 relative max-w-5xl mx-auto">
        {['Vibe', 'Script', 'Audio', 'Storyboard', isPresentationMode ? 'Transitions' : 'Motion', 'Preview', 'Export'].map((l, i) => (
          <div
            key={l}
            onClick={() => i + 1 <= maxStep && !syncing && !loading && !isProcessing && setStep((i + 1) as any)}
            className={`flex flex-col items-center z-10 transition-all ${i + 1 <= maxStep ? 'cursor-pointer' : 'cursor-not-allowed'} ${i + 1 <= maxStep ? 'opacity-100' : 'opacity-20'}`}
          >
            <div className={`w-12 h-12 rounded-full flex items-center justify-center font-black border-4 transition-all ${step === i + 1 ? 'bg-brand-cyan border-white shadow-2xl scale-110' : i + 1 <= maxStep ? 'bg-white border-brand-cyan/30' : 'bg-white border-gray-100'}`}>
              {i + 1 < maxStep ? <Icons.Check size={20} /> : i + 1}
            </div>
            <span className="mt-2 text-[10px] font-black uppercase tracking-tight">{l}</span>
          </div>
        ))}
        <div className="absolute top-6 left-0 w-full h-1 bg-gray-100 -z-0 rounded-full"></div>
        <div className="absolute top-6 left-0 h-1 bg-brand-cyan -z-0 rounded-full transition-all duration-700" style={{ width: `${((step - 1) / 6) * 100}%` }}></div>
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

        {/* Remix source banner — shown on Steps 1 & 2 when project was derived from a YouTube video */}
        {remixSource && !remixBannerDismissed && (step === 1 || step === 2) && (
          <RemixSourceBanner
            source={remixSource}
            onDismiss={() => setRemixBannerDismissed(true)}
          />
        )}

        {step === 1 && <Step1Setup />}
        {step === 2 && <Step2Script />}
        {(step === 3 || step === 4 || step === 5) && <StepsAudioImageVideo />}
        {step === 6 && <Step6Preview />}
        {step === 7 && <Step7Export />}
      </div>
    </div>
  );
};
