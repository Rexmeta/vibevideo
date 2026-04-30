import React from 'react';
import { Icons } from '../Icons';
import { useWizard } from './WizardContext';

export const Step7Export: React.FC = () => {
  const w = useWizard();
  const {
    isPresentationMode,
    handleRenderPresentation,
    handleMergeExport,
    handleDownloadMerged,
    handleDownloadAll,
    downloadingAll,
    merging,
    mergeProgress,
    mergePercent,
    mergedVideoUrl,
    isImagesReady,
    scenes,
    aspectRatio,
    useVeoAudio,
    syncAudioWithVideo,
    downloadVideo,
    setStep,
    onNavigate,
  } = w;

  return (
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
              <button onClick={handleDownloadMerged} className="px-10 py-4 rounded-full font-black text-base bg-brand-cyan text-black hover:scale-105 transition-all shadow-lg flex items-center gap-2">
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
        <button onClick={() => onNavigate('projects')} className="flex-1 bg-brand-dark text-white py-6 rounded-full font-black text-2xl shadow-2xl hover:scale-[1.02] transition-all flex items-center justify-center gap-4">
          Go to Workspace <Icons.ChevronRight size={28} />
        </button>
      </div>
    </div>
  );
};
