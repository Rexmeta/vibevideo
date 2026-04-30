import React, { useState } from 'react';
import { Icons } from '../Icons';
import { useWizard } from './WizardContext';
import { runQuickPipeline, QuickPipelineProgress } from './runQuickPipeline';
import { setStoredMode, type WizardMode } from './ModeGate';

interface Props {
  onSwitchMode: (mode: WizardMode) => void;
}

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
  } = ctx;

  const [progress, setProgress] = useState<QuickPipelineProgress | null>(null);
  const [running, setRunning] = useState(false);
  const [failure, setFailure] = useState<{ step: number; error: string } | null>(null);

  const handleStart = async () => {
    if (!topic.trim()) {
      alert('비디오 주제를 입력하세요.');
      return;
    }
    setFailure(null);
    setRunning(true);
    setProgress({ stage: 'script', label: '시작합니다...', percent: 1 });

    const result = await runQuickPipeline(ctx, topic, p => setProgress(p));

    setRunning(false);

    if (!result.success) {
      setFailure({ step: result.failedStep || 2, error: result.error || '알 수 없는 오류' });
    } else {
      setStoredMode('pro', projectId);
      onSwitchMode('pro');
    }
  };

  const handleHandoff = () => {
    setStoredMode('pro', projectId);
    onSwitchMode('pro');
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

      <div className="text-center mb-10">
        <div className="inline-flex items-center gap-2 mb-4 px-4 py-1.5 rounded-full bg-brand-cyan/10 text-brand-dark text-[11px] font-black uppercase tracking-widest">
          <Icons.Wand2 size={14} /> Quick Mode
        </div>
        <h1 className="text-5xl font-black tracking-tighter text-brand-dark mb-3">한 번에 만들기</h1>
        <p className="text-gray-500 italic font-medium">주제를 입력하고 시작 버튼을 누르면 AI가 모든 것을 처리합니다.</p>
        <button
          onClick={() => { setStoredMode('pro', projectId); onSwitchMode('pro'); }}
          className="mt-3 text-xs font-bold text-gray-400 hover:text-brand-dark underline-offset-4 hover:underline"
        >
          더 정밀한 제어가 필요하다면 Pro Mode로 전환
        </button>
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

        {(running || (progress && progress.percent > 0)) && !failure && (
          <div className="py-8 text-center">
            <div className="relative inline-block mb-10">
              <div className="w-32 h-32 border-8 border-gray-100 border-t-brand-cyan rounded-full animate-spin"></div>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-2xl font-black text-brand-dark tabular-nums">{progress?.percent ?? 0}%</span>
              </div>
            </div>
            <p className="text-2xl font-black text-brand-dark mb-3">{progress?.label || '진행 중...'}</p>
            <p className="text-sm text-gray-400 italic mb-8">잠시만 기다려주세요. 비디오 단계는 씬당 약 1분 + 60초 대기가 필요합니다.</p>
            <div className="max-w-md mx-auto h-3 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-brand-cyan to-emerald-400 rounded-full transition-all duration-700"
                style={{ width: `${progress?.percent ?? 0}%` }}
              />
            </div>
          </div>
        )}

        {failure && (
          <div className="py-8 text-center">
            <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-red-100 flex items-center justify-center">
              <Icons.AlertCircle size={36} className="text-red-500" />
            </div>
            <h3 className="text-3xl font-black text-brand-dark mb-2">생성 중단됨</h3>
            <p className="text-gray-500 mb-2">단계 {failure.step}에서 문제가 발생했습니다.</p>
            <p className="text-sm text-red-500 font-bold mb-8 max-w-md mx-auto">{failure.error}</p>
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
