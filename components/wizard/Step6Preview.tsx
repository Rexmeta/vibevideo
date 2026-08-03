import React from 'react';
import { Icons } from '../Icons';
import { useWizard } from './WizardContext';
import { estimateCost, formatUsd, resolveApiModelId } from '../../services/pricing';
import { ProjectStatus, TransitionType } from '../../types';
import { TimelineEditor } from './TimelineEditor';

export const Step6Preview: React.FC = () => {
  const w = useWizard();
  const {
    setStep,
    setMaxStep,
    sync,
    activePreviewIdx,
    setActivePreviewIdx,
    scenes,
    setScenes,
    updateSceneAt,
    isPresentationMode,
    useVeoAudio,
    syncAudioWithVideo,
    allModels,
    selectedImageModel,
    selectedVideoModel,
    stats,
    TRANSITION_OPTIONS,
    MOTION_OPTIONS,
    isSample,
    cloneSampleToProject,
    onNavigate,
  } = w;

  const handleReorder = (fromIdx: number, toIdx: number) => {
    setScenes(prev => {
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next.map((s, i) => ({ ...s, scene_number: i + 1 }));
    });
    // Keep active preview pointing at same visual scene after reorder
    if (activePreviewIdx === fromIdx) {
      setActivePreviewIdx(toIdx);
    } else if (activePreviewIdx > fromIdx && activePreviewIdx <= toIdx) {
      setActivePreviewIdx(activePreviewIdx - 1);
    } else if (activePreviewIdx < fromIdx && activePreviewIdx >= toIdx) {
      setActivePreviewIdx(activePreviewIdx + 1);
    }
  };

  const handleResizeDuration = (idx: number, newDuration: number) => {
    updateSceneAt(idx, { durationSec: newDuration });
  };

  const handleSetTransition = (idx: number, t: TransitionType) => {
    updateSceneAt(idx, { transitionTo: t });
  };

  const handleToggleHidden = (idx: number) => {
    updateSceneAt(idx, { hidden: !scenes[idx]?.hidden });
  };

  return (
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
              <span className="bg-blue-50 text-blue-700 px-3 py-1.5 rounded-full">이미지 {stats.imagesGenerated || 0}장</span>
              <span className="bg-amber-50 text-amber-700 px-3 py-1.5 rounded-full">재생성 {stats.refineCalls || 0}회</span>
              <span className="bg-purple-50 text-purple-700 px-3 py-1.5 rounded-full">비전 검증 {stats.criticCalls || 0}회</span>
              <span className="bg-pink-50 text-pink-700 px-3 py-1.5 rounded-full">비디오 {stats.videosGenerated || 0}편</span>
              {showCost ? (
                <span className="bg-emerald-50 text-emerald-700 px-3 py-1.5 rounded-full cursor-help" title={tooltip}>
                  예상 비용 ~{formatUsd(breakdown.totalUsd)} USD
                </span>
              ) : null}
            </div>
          );
        })()}
        <div className="flex items-center justify-center gap-4 mt-4">
          <button onClick={() => { setActivePreviewIdx(0); }} className="px-8 py-3 bg-brand-cyan text-black rounded-full font-black text-sm shadow-lg hover:scale-105 transition-all flex items-center gap-2">
            <Icons.Play size={16} /> Play All
          </button>
          <span className="text-sm font-bold text-gray-500">Scene {activePreviewIdx + 1} / {scenes.length}</span>
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

          <div className="absolute bottom-10 left-1/2 -translate-x-1/2 bg-black/60 backdrop-blur-2xl px-10 py-4 rounded-full flex gap-6 text-white text-[11px] font-black uppercase opacity-0 group-hover:opacity-100 transition-all duration-700 scale-90 group-hover:scale-100 z-30 shadow-2xl">
            {scenes.map((_, i) => (
              <button key={i} onClick={() => setActivePreviewIdx(i)} className={`w-12 h-12 rounded-full transition-all flex items-center justify-center border-2 ${activePreviewIdx === i ? 'bg-brand-cyan border-brand-cyan text-black scale-125 shadow-2xl shadow-brand-cyan/40' : 'border-white/20 hover:bg-white/10'}`}>
                {i + 1}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-4 overflow-y-auto hide-scrollbar max-h-[550px] pr-2">
          <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 mb-6 flex items-center gap-2">
            <Icons.Layout size={14} /> Assembly Timeline
          </h4>
          {scenes.map((s, i) => (
            <div key={i} onClick={() => setActivePreviewIdx(i)} className={`p-5 rounded-[2.5rem] border-2 cursor-pointer transition-all duration-500 ${activePreviewIdx === i ? 'border-brand-cyan bg-brand-cyan/5 shadow-2xl -translate-x-3' : 'border-gray-50 bg-gray-50 opacity-40 hover:opacity-100 hover:border-gray-200'}`}>
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
                    Scene {i + 1}: {s.script_segment}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Timeline Editor */}
      <TimelineEditor
        scenes={scenes}
        activeIdx={activePreviewIdx}
        TRANSITION_OPTIONS={TRANSITION_OPTIONS}
        onSelectScene={setActivePreviewIdx}
        onReorder={handleReorder}
        onResizeDuration={handleResizeDuration}
        onSetTransition={handleSetTransition}
        onToggleHidden={handleToggleHidden}
      />

      {isSample && (
        <div className="mt-10 bg-gradient-to-r from-cyan-50 via-white to-purple-50 border-2 border-cyan-100 rounded-3xl p-6 flex flex-col sm:flex-row items-center gap-4">
          <div className="w-12 h-12 bg-brand-cyan rounded-2xl flex items-center justify-center shrink-0">
            <Icons.Sparkles size={22} className="text-black" />
          </div>
          <div className="flex-1 text-center sm:text-left">
            <h4 className="font-black text-base">샘플을 마음에 들어하셨나요?</h4>
            <p className="text-xs text-gray-500 mt-0.5">새 프로젝트로 만들어 직접 편집하고 AI 영상으로 업그레이드하세요.</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 shrink-0">
            <button
              onClick={() => onNavigate('create')}
              className="px-5 py-3 rounded-full bg-white border-2 border-black text-black font-black text-sm hover:scale-105 transition-all"
            >
              내 주제로 새로 만들기
            </button>
            <button
              onClick={() => { cloneSampleToProject(); setStep(1); }}
              className="px-6 py-3 rounded-full bg-black text-white font-black text-sm hover:scale-105 transition-all flex items-center gap-2"
            >
              AI 영상으로 업그레이드 <Icons.ArrowRight size={16} />
            </button>
          </div>
        </div>
      )}

      <div className="flex gap-4 mt-12">
        <button onClick={() => setStep(5)} className="px-12 py-6 rounded-full font-black text-gray-400 hover:text-black transition-all">Back</button>
        <button onClick={() => { setStep(7); setMaxStep(prev => Math.max(prev, 7)); sync(7, undefined, { status: ProjectStatus.COMPLETED }); }} className="flex-1 bg-brand-dark text-white py-6 rounded-full font-black text-2xl shadow-2xl hover:scale-[1.02] shadow-brand-cyan/10 transition-all">Export Mastery</button>
      </div>
    </div>
  );
};
