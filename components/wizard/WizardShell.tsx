import React from 'react';
import { Icons } from '../Icons';
import { useWizard } from './WizardContext';
import { Step1Setup } from './Step1Setup';
import { Step2Script } from './Step2Script';
import { StepsAudioImageVideo } from './StepsAudioImageVideo';
import { Step6Preview } from './Step6Preview';
import { Step7Export } from './Step7Export';
import { setStoredMode, type WizardMode } from './ModeGate';

interface WizardShellProps {
  onSwitchMode?: (mode: WizardMode) => void;
}

export const WizardShell: React.FC<WizardShellProps> = ({ onSwitchMode }) => {
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
  } = w;

  const projectHasProgress = (scenes && scenes.length > 0) || maxStep > 1 || step > 1;
  const canSwitchToQuick = !!onSwitchMode && !projectHasProgress && !syncing && !loading && !isProcessing;

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

      {/* Mode Toggle */}
      {canSwitchToQuick && (
        <div className="max-w-5xl mx-auto mb-6 flex justify-end">
          <button
            onClick={() => {
              setStoredMode('quick');
              onSwitchMode!('quick');
            }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white border-2 border-gray-100 hover:border-brand-cyan hover:bg-brand-cyan/5 text-brand-dark text-[11px] font-black uppercase tracking-widest transition-all shadow-sm"
            title="Quick Mode로 돌아가기"
          >
            <Icons.Wand2 size={14} className="text-brand-cyan" />
            Quick Mode로 전환
          </button>
        </div>
      )}

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

        {step === 1 && <Step1Setup />}
        {step === 2 && <Step2Script />}
        {(step === 3 || step === 4 || step === 5) && <StepsAudioImageVideo />}
        {step === 6 && <Step6Preview />}
        {step === 7 && <Step7Export />}
      </div>
    </div>
  );
};
