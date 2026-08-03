import React, { useState } from 'react';
import { Icons } from '../Icons';
import { useWizard } from './WizardContext';
import { ConfirmModal } from './ConfirmModal';
import { ExportLimitsSettings } from './ExportLimitsSettings';

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
    isSample,
    cloneSampleToProject,
    exportRiskAssessment,
    refreshExportLimits,
    autoSplitPlan,
    handleAutoSplitExport,
    duration,
    canRetryFFmpegLoad,
    retryFFmpegLoad,
  } = w;

  const [confirmOpen, setConfirmOpen] = useState(false);
  const isBlocked = exportRiskAssessment.level === 'block';
  const isWarn = exportRiskAssessment.level === 'warn';
  // Task #99: long-form mode auto-engages once total duration crosses 3 min,
  // or whenever the safe-chunk planner needs to split into 4+ parts.
  const isLongForm = duration >= 180 || autoSplitPlan.chunks.length >= 4;
  // Only non-hidden scenes count for export eligibility
  const visibleScenes = scenes.filter(s => !s.hidden);
  const canAutoSplit =
    !merging &&
    visibleScenes.length > 0 &&
    autoSplitPlan.needsSplit &&
    (isPresentationMode
      ? visibleScenes.every(s => !!s.image_path)
      : visibleScenes.some(s => !!s.video_path));

  const runExport = () => {
    if (isLongForm && canAutoSplit) {
      handleAutoSplitExport();
      return;
    }
    if (isPresentationMode) handleRenderPresentation();
    else handleMergeExport();
  };

  const handlePrimaryClick = () => {
    if (isWarn) setConfirmOpen(true);
    else runExport();
  };

  // Disable export buttons when all scenes are hidden or no required assets exist.
  // Presentation render requires every visible scene to have an image to avoid
  // passing empty imageUrl strings into the renderer (which causes load failures).
  const allVisibleImagesReady = visibleScenes.length > 0 && visibleScenes.every(s => !!s.image_path);
  const noVisibleVideos = visibleScenes.every(s => !s.video_path);
  const presentationDisabled = merging || visibleScenes.length === 0 || !allVisibleImagesReady || isBlocked;
  const mergeDisabled = merging || visibleScenes.length === 0 || noVisibleVideos || isBlocked;

  const bannerStyle =
    exportRiskAssessment.level === 'safe'
      ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
      : exportRiskAssessment.level === 'warn'
      ? 'bg-amber-50 border-amber-200 text-amber-900'
      : 'bg-red-50 border-red-200 text-red-900';

  const bannerIcon =
    exportRiskAssessment.level === 'safe' ? (
      <Icons.Check size={18} />
    ) : exportRiskAssessment.level === 'warn' ? (
      <Icons.AlertTriangle size={18} />
    ) : (
      <Icons.AlertCircle size={18} />
    );

  const bannerLabel =
    exportRiskAssessment.level === 'safe'
      ? '안전'
      : exportRiskAssessment.level === 'warn'
      ? '주의'
      : '위험';

  return (
    <div className="flex-1 flex flex-col animate-in fade-in zoom-in-95 duration-1000">
      <div className="text-center mb-10">
        <h2 className="text-5xl font-black text-brand-dark mb-4 tracking-tighter">Export Your Video</h2>
        <p className="text-gray-400 font-medium italic text-lg">
          모든 씬을 하나의 비디오로 합치거나, 개별 씬을 다운로드하세요.
        </p>
      </div>

      <ExportLimitsSettings onChanged={refreshExportLimits} />

      {isLongForm && (
        <div className="mb-6 rounded-3xl border-2 border-purple-200 bg-gradient-to-br from-purple-50 via-white to-pink-50 px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-2xl bg-purple-500 text-white flex items-center justify-center shrink-0 shadow-md">
              <Icons.Film size={18} />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] font-black uppercase tracking-widest text-purple-700">
                  Long-form Mode
                </span>
                <span className="text-xs font-black text-purple-900">
                  {Math.floor(duration / 60)}분 {duration % 60 ? `${duration % 60}초` : ''} · {scenes.length}개 씬
                </span>
              </div>
              <p className="text-sm font-semibold leading-snug text-purple-900">
                약 {autoSplitPlan.chunks.length}개 파트로 자동 분할 렌더링 후 한 편의 영상으로 결합합니다.
              </p>
              <p className="mt-1 text-[11px] text-purple-800 italic leading-relaxed">
                각 파트는 60–90초 분량으로 묶이고, 파트 사이에는 메모리를 정리합니다. 결합 단계에서 메모리가 부족하면 파트별로 자동 다운로드됩니다.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className={`mb-6 rounded-3xl border-2 px-5 py-4 ${bannerStyle}`}>
        <div className="flex items-start gap-3">
          <span className="mt-0.5">{bannerIcon}</span>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-black uppercase tracking-widest opacity-70">
                내보내기 위험도
              </span>
              <span className="text-xs font-black uppercase tracking-widest">{bannerLabel}</span>
            </div>
            <p className="text-sm font-semibold leading-snug">{exportRiskAssessment.summary}</p>
            {exportRiskAssessment.reasons.length > 0 && (
              <ul className="mt-2 text-xs leading-relaxed list-disc list-inside space-y-0.5 opacity-90">
                {exportRiskAssessment.reasons.map((r, i) => (
                  <li key={`r-${i}`}>{r}</li>
                ))}
              </ul>
            )}
            {exportRiskAssessment.recommendations.length > 0 && (
              <p className="mt-2 text-xs italic opacity-80">
                권장: {exportRiskAssessment.recommendations.join(' · ')}
              </p>
            )}
            {exportRiskAssessment.level !== 'safe' && canAutoSplit && (
              <div className="mt-3">
                <button
                  onClick={handleAutoSplitExport}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white border-2 border-current text-xs font-black uppercase tracking-wider hover:scale-[1.02] active:scale-95 transition-all"
                >
                  <Icons.Scissors size={14} />
                  자동으로 안전하게 {autoSplitPlan.chunks.length}개로 나눠서 내보내기
                </button>
                <p className="mt-1 text-[11px] opacity-70">
                  씬을 안전 등급에 맞춰 묶어 part_1.mp4, part_2.mp4 ... 형식으로 순서대로 다운로드합니다.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mb-8 flex flex-col items-center gap-4">
        {isPresentationMode ? (
          <button
            onClick={handlePrimaryClick}
            disabled={presentationDisabled}
            title={isBlocked ? exportRiskAssessment.summary : undefined}
            className={`px-12 py-5 rounded-full font-black text-lg shadow-xl transition-all flex items-center gap-3 ${merging || isBlocked ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-gradient-to-r from-blue-600 to-brand-cyan text-white hover:scale-105 active:scale-95'}`}
          >
            {merging ? (
              <><Icons.Loader2 className="animate-spin" size={20} /> {mergeProgress}</>
            ) : (
              <><Icons.Presentation size={20} /> 프레젠테이션 비디오 렌더링</>
            )}
          </button>
        ) : (
          <button
            onClick={handlePrimaryClick}
            disabled={mergeDisabled}
            title={isBlocked ? exportRiskAssessment.summary : undefined}
            className={`px-12 py-5 rounded-full font-black text-lg shadow-xl transition-all flex items-center gap-3 ${merging || isBlocked ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-gradient-to-r from-purple-600 to-brand-cyan text-white hover:scale-105 active:scale-95'}`}
          >
            {merging ? (
              <><Icons.Loader2 className="animate-spin" size={20} /> {mergeProgress}</>
            ) : isLongForm ? (
              <><Icons.Film size={20} /> 한 편으로 합치기 ({autoSplitPlan.chunks.length}개 파트)</>
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
        {!merging && mergeProgress.startsWith('오류') && (
          <div className="flex flex-col items-center gap-2 max-w-md">
            <p className="text-sm text-red-500 font-semibold text-center">{mergeProgress}</p>
            {canRetryFFmpegLoad && (
              <button
                onClick={retryFFmpegLoad}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white border-2 border-red-300 text-red-600 text-xs font-black uppercase tracking-wider hover:scale-[1.02] active:scale-95 transition-all"
              >
                <Icons.RefreshCw size={14} /> 다시 시도
              </button>
            )}
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

      {isSample && (
        <div className="mt-10 bg-gradient-to-r from-cyan-50 via-white to-purple-50 border-2 border-cyan-100 rounded-3xl p-6 flex flex-col sm:flex-row items-center gap-4">
          <div className="w-12 h-12 bg-brand-cyan rounded-2xl flex items-center justify-center shrink-0">
            <Icons.Sparkles size={22} className="text-black" />
          </div>
          <div className="flex-1 text-center sm:text-left">
            <h4 className="font-black text-base">샘플은 여기까지! 직접 만들어볼까요?</h4>
            <p className="text-xs text-gray-500 mt-0.5">새 프로젝트를 시작해 나만의 스토리로 AI 영상을 생성하세요.</p>
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

      <div className="flex gap-4 mt-10">
        <button onClick={() => setStep(6)} className="px-10 py-6 rounded-full font-black text-gray-400 hover:text-black transition-colors">Back</button>
        <button onClick={() => onNavigate('projects')} className="flex-1 bg-brand-dark text-white py-6 rounded-full font-black text-2xl shadow-2xl hover:scale-[1.02] transition-all flex items-center justify-center gap-4">
          Go to Workspace <Icons.ChevronRight size={28} />
        </button>
      </div>

      <ConfirmModal
        open={confirmOpen}
        title="메모리 부담이 큰 내보내기입니다"
        description={
          <div className="space-y-2">
            <p>{exportRiskAssessment.summary}</p>
            {exportRiskAssessment.reasons.length > 0 && (
              <ul className="list-disc list-inside text-xs space-y-0.5 opacity-90">
                {exportRiskAssessment.reasons.map((r, i) => (
                  <li key={`m-${i}`}>{r}</li>
                ))}
              </ul>
            )}
            {exportRiskAssessment.recommendations.length > 0 && (
              <p className="text-xs italic opacity-80">
                권장: {exportRiskAssessment.recommendations.join(' · ')}
              </p>
            )}
            <p className="text-xs">그래도 진행하시겠습니까?</p>
          </div>
        }
        confirmLabel="계속 진행"
        cancelLabel="취소"
        tone="default"
        icon={<Icons.AlertTriangle size={24} />}
        onConfirm={() => {
          setConfirmOpen(false);
          runExport();
        }}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
};
