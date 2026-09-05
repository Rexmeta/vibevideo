import React, { useState } from 'react';
import { Icons } from '../Icons';
import { useWizard } from './WizardContext';
import { jobManager } from '../../services/jobManager';
import { getModelsByType } from '../../services/modelService';
import { runStyleSheetGeneration } from '../../services/generationCommands';
import { throwGenerationFailure } from '../../services/generationContract';
import { estimateCost, formatUsd, resolveApiModelId } from '../../services/pricing';
import { CAPTION_PRESETS } from '../../services/captionService';
import { TransitionType, MotionPreset, SeedSource } from '../../types';
import { SceneAIEditModal } from './SceneAIEditModal';
import type { SceneRefineResult } from '../../services/geminiService';
import type { Scene } from '../../types';

// hint: Structural and logic conflict. Both design and behavior differ.
export const StepsAudioImageVideo: React.FC = () => {
  const [aiEditSceneIdx, setAiEditSceneIdx] = useState<number | null>(null);
  const [promptChangedPopoverIdx, setPromptChangedPopoverIdx] = useState<number | null>(null);
  const w = useWizard();
  const {
    step,
    setStep,
    isPresentationMode,
    failedCount,
    isProcessing,
    useVeoAudio,
    handleBatchAudio,
    handleBatchImages,
    handleBatchVideos,
    loadingMessage,
    processingSet,
    showModelSelector,
    setShowModelSelector,
    allModels,
    selectedImageModel,
    setSelectedImageModel,
    selectedVideoModel,
    setSelectedVideoModel,
    selectedTextModel,
    stats,
    setStats,
    statsRef,
    sync,
    characterReferenceImage,
    setCharacterReferenceImage,
    styleSheet,
    setStyleSheet,
    generatingStyleSheet,
    setGeneratingStyleSheet,
    topic,
    script,
    videoStyle,
    genre,
    captionStyle,
    setCaptionStyle,
    scenes,
    setScenes,
    failedScenes,
    expandedQuality,
    setExpandedQuality,
    handleRefineImage,
    handleSingleAudio,
    handleSingleImage,
    handleSingleVideo,
    handlePlayAudio,
    playingAudioIdx,
    selectedVideoIdx,
    setSelectedVideoIdx,
    aspectRatio,
    syncAudioWithVideo,
    setMaxStep,
    isImagesReady,
    isVideosReady,
    characterReferences,
    toggleSceneCharacter,
    updateSceneAt,
    applyDefaultTransitions,
    applyDefaultMotion,
    TRANSITION_OPTIONS,
    MOTION_OPTIONS,
    getDefaultPresentation,
    updateScenePresentation,
    updateSceneTextOverlay,
  } = w;

  return (
    <div className="flex-1 flex flex-col h-full">
      <div className="flex justify-between items-center mb-10">
        <div>
          <h2 className="text-4xl font-black tracking-tight">
            {step === 3 ? 'AI Audio Synthesis' : step === 4 ? 'Visual Storyboard' : (isPresentationMode ? 'Presentation Config' : 'AI Motion Engine')}
          </h2>
          <p className="text-gray-400 font-medium italic">
            {step === 3 && useVeoAudio ? 'Veo 3.1 내장 오디오를 사용 중입니다. 아래에서 TTS 나레이션을 추가로 생성하거나 건너뛸 수 있습니다.' :
             step === 4 ? '모든 이미지가 생성되어야 다음 단계로 진행할 수 있습니다.' :
             isPresentationMode ? '각 씬의 전환 효과, 모션, 텍스트 오버레이를 설정하세요.' :
             '오토 제너레이트 버튼을 클릭하여 모든 씬을 한 번에 완성하세요.'}
          </p>
          {failedCount(step === 3 ? 'audio' : step === 4 ? 'image' : 'video') > 0 && !isProcessing && (
            <p className="text-red-500 text-sm font-bold mt-1">
              {failedCount(step === 3 ? 'audio' : step === 4 ? 'image' : 'video')}개 씬 실패 - 개별 재시도하거나 전체 재생성을 눌러주세요
            </p>
          )}
        </div>
        {step === 5 && isPresentationMode ? (
          <div className="flex items-center gap-3 flex-wrap">
            <select
              onChange={(e) => applyDefaultTransitions(e.target.value as TransitionType)}
              className="px-5 py-3 rounded-2xl border-2 border-gray-200 text-sm font-bold bg-white"
              defaultValue=""
            >
              <option value="" disabled>전체 전환 효과 일괄 적용</option>
              {TRANSITION_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <select
              onChange={(e) => applyDefaultMotion(e.target.value as MotionPreset)}
              className="px-5 py-3 rounded-2xl border-2 border-gray-200 text-sm font-bold bg-white"
              defaultValue=""
            >
              <option value="" disabled>전체 모션 일괄 적용</option>
              {MOTION_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        ) : (
          <div className="flex flex-col items-end gap-2">
            <button
              disabled={isProcessing}
              onClick={step === 3 ? handleBatchAudio : step === 4 ? handleBatchImages : handleBatchVideos}
              className={`px-12 py-5 rounded-full font-black text-lg shadow-xl transition-all ${isProcessing ? 'bg-gray-100 text-gray-300' : 'bg-brand-cyan text-black hover:scale-105 active:scale-95'}`}
            >
              {isProcessing ? (
                <span className="flex items-center gap-3">
                  <Icons.Loader2 className="animate-spin" size={20} />
                  {loadingMessage || `처리 중... (${processingSet.size}개 동시)`}
                </span>
              ) : `Auto-Generate All`}
            </button>
            {step === 3 && !isProcessing && scenes.some(s => s.promptChanged && s.script_segment_original && s.script_segment !== s.script_segment_original) && (
              <button
                onClick={() => {
                  scenes.forEach((s, i) => {
                    if (s.promptChanged && s.script_segment_original && s.script_segment !== s.script_segment_original) {
                      handleSingleAudio(i);
                    }
                  });
                }}
                className="flex items-center gap-2 px-6 py-2.5 rounded-full font-black text-sm shadow-md transition-all bg-orange-500 text-white hover:scale-105 active:scale-95"
                title="스크립트가 변경된 모든 씬의 오디오를 한 번에 재생성합니다."
              >
                <Icons.RefreshCw size={14} />
                변경된 씬 오디오 재생성
              </button>
            )}
          </div>
        )}
      </div>

      {(step === 4 || (step === 5 && !isPresentationMode)) && (
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-3">
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">
              {step === 4 ? 'Image Model' : 'Video Model'}
            </span>
            <button
              onClick={() => setShowModelSelector(showModelSelector === (step === 4 ? 'image' : 'video') ? null : (step === 4 ? 'image' : 'video'))}
              className="text-xs font-bold text-brand-cyan hover:underline"
            >
              {showModelSelector === (step === 4 ? 'image' : 'video') ? '닫기' : '변경'}
            </button>
          </div>
          {(() => {
            const currentModels = step === 4 ? getModelsByType(allModels, 'image') : getModelsByType(allModels, 'video');
            const selectedId = step === 4 ? selectedImageModel : selectedVideoModel;
            const currentModel = currentModels.find(m => m.id === selectedId);
            return (
              <>
                <div className="flex items-center gap-3 px-5 py-3 bg-gray-50 rounded-2xl border border-gray-100">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-cyan/20 to-purple-100 flex items-center justify-center">
                    {step === 4 ? <Icons.ImageIcon size={14} className="text-brand-dark" /> : <Icons.Film size={14} className="text-brand-dark" />}
                  </div>
                  <div className="flex-1">
                    <span className="font-bold text-sm">{currentModel?.name || '모델 선택'}</span>
                    <span className="text-xs text-gray-400 ml-2">{currentModel?.provider}</span>
                  </div>
                  {currentModel && !currentModel.supportsKorean && (
                    <span className="text-[10px] bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full font-bold">한글 미지원</span>
                  )}
                </div>
                {showModelSelector === (step === 4 ? 'image' : 'video') && (
                  <div className="mt-3 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 max-h-64 overflow-y-auto p-1">
                    {currentModels.map(m => (
                      <button
                        key={m.id}
                        onClick={() => {
                          if (step === 4) setSelectedImageModel(m.id);
                          else setSelectedVideoModel(m.id);
                          setShowModelSelector(null);
                        }}
                        className={`p-4 rounded-2xl border-2 text-left transition-all hover:shadow-md ${m.id === selectedId ? 'border-brand-cyan bg-brand-cyan/5 shadow-lg' : 'border-gray-100 hover:border-gray-200'}`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-bold text-sm truncate">{m.name}</span>
                        </div>
                        <span className="text-[10px] text-gray-400 font-medium">{m.provider}</span>
                        <p className="text-[11px] text-gray-500 mt-1 line-clamp-2">{m.description}</p>
                        {!m.supportsKorean && (
                          <span className="inline-block mt-1 text-[9px] bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded font-bold">한글 미지원</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </>
            );
          })()}
        </div>
      )}

      {step === 4 && (() => {
        const imgApiId = resolveApiModelId(allModels, selectedImageModel);
        const vidApiId = resolveApiModelId(allModels, selectedVideoModel);
        const breakdown = estimateCost({
          imagesGenerated: stats.imagesGenerated,
          refineCalls: stats.refineCalls,
          criticCalls: stats.criticCalls,
          videosGenerated: 0,
          imageModelId: imgApiId,
          videoModelId: vidApiId,
        });
        const tooltip = `예상 비용 (USD)\n이미지 ${formatUsd(breakdown.imagesUsd)} · 재생성 ${formatUsd(breakdown.refinesUsd)} · 비전 검증 ${formatUsd(breakdown.criticsUsd)}\n실제 청구액은 모델/해상도/토큰 수에 따라 달라질 수 있습니다.`;
        const showCost = (stats.imagesGenerated || stats.refineCalls || stats.criticCalls);
        return (
          <div className="mb-4 flex items-center gap-2 flex-wrap text-[11px] font-bold">
            <span className="text-gray-400 uppercase tracking-widest text-[10px]">생성 비용</span>
            <span className="bg-blue-50 text-blue-700 px-3 py-1.5 rounded-full">이미지 {stats.imagesGenerated || 0}장</span>
            <span className="bg-amber-50 text-amber-700 px-3 py-1.5 rounded-full">재생성 {stats.refineCalls || 0}회</span>
            <span className="bg-purple-50 text-purple-700 px-3 py-1.5 rounded-full">비전 검증 {stats.criticCalls || 0}회</span>
            {showCost ? (
              <span className="bg-emerald-50 text-emerald-700 px-3 py-1.5 rounded-full cursor-help" title={tooltip}>
                예상 비용 ~{formatUsd(breakdown.totalUsd)} USD
              </span>
            ) : null}
            {(stats.imagesGenerated || stats.criticCalls || stats.refineCalls) ? (
              <button
                onClick={() => {
                  const reset = { imagesGenerated: 0, criticCalls: 0, refineCalls: 0, videosGenerated: stats.videosGenerated || 0 };
                  setStats(reset);
                  statsRef.current = reset;
                  sync();
                }}
                className="text-[10px] text-gray-400 hover:text-gray-700 font-bold underline ml-1"
                title="이미지·검증 카운터 초기화"
              >
                초기화
              </button>
            ) : null}
          </div>
        );
      })()}

      {step === 4 && characterReferenceImage && (
        <div className="mb-4 p-4 bg-gradient-to-br from-amber-50 to-orange-50 rounded-[2rem] border-2 border-amber-100 flex items-center gap-4">
          <img src={characterReferenceImage} alt="Character reference" className="w-16 h-16 rounded-2xl object-cover border-4 border-white shadow-md shrink-0" />
          <div className="flex-1 min-w-0">
            <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-700 flex items-center gap-2">
              <Icons.ImageIcon size={12} /> Character Reference Locked
            </h4>
            <p className="text-[10px] text-amber-600 italic mt-1">
              이 참조 이미지가 모든 씬 이미지 생성에 함께 전달되어 캐릭터 일관성을 유지합니다.
            </p>
          </div>
          <button
            onClick={() => { if (confirm('참조 이미지를 제거할까요? 이미 생성된 씬 이미지는 그대로 유지됩니다.')) { setCharacterReferenceImage(undefined); sync(); } }}
            className="px-3 py-1.5 bg-white border border-amber-200 rounded-full text-[10px] font-bold text-amber-700 hover:bg-amber-50 shrink-0"
          >
            제거
          </button>
        </div>
      )}

      {step === 4 && styleSheet && (
        <div className="mb-6 p-6 bg-gradient-to-br from-purple-50 to-blue-50 rounded-[2rem] border-2 border-purple-100">
          <div className="flex items-start justify-between gap-4 mb-3">
            <div>
              <h4 className="text-xs font-black uppercase tracking-[0.2em] text-purple-700 flex items-center gap-2">
                <Icons.Palette size={14} /> Style Sheet
              </h4>
              <p className="text-[10px] text-purple-500 mt-1 italic">전 씬에 자동 적용되는 비주얼 가이드 — 일관된 색감·조명·무드를 보장합니다.</p>
            </div>
            <button
              disabled={generatingStyleSheet || !script}
              onClick={async () => {
                setGeneratingStyleSheet(true);
                try {
                  const sheet = throwGenerationFailure(await runStyleSheetGeneration({
                    topic,
                    script,
                    visualStyle: videoStyle,
                    genre,
                    textModel: selectedTextModel || undefined,
                  }));
                  setStyleSheet(sheet);
                } catch (e: any) {
                  alert(`Style Sheet 재생성 실패: ${e?.message || ''}`);
                } finally {
                  setGeneratingStyleSheet(false);
                }
              }}
              className="px-4 py-2 bg-white border border-purple-200 rounded-full text-[10px] font-bold text-purple-700 hover:bg-purple-50 disabled:opacity-50"
            >
              {generatingStyleSheet ? '재생성 중…' : '재생성'}
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex gap-1">
              {styleSheet.palette.map((color, ci) => (
                <input
                  key={ci}
                  type="color"
                  value={color}
                  onChange={(e) => {
                    const next = [...styleSheet.palette];
                    next[ci] = e.target.value;
                    setStyleSheet({ ...styleSheet, palette: next });
                  }}
                  className="w-8 h-8 rounded-lg border-2 border-white shadow cursor-pointer"
                  title={color}
                />
              ))}
            </div>
            <div className="flex-1 min-w-[200px] grid grid-cols-1 md:grid-cols-2 gap-2">
              <input value={styleSheet.mood} onChange={(e) => setStyleSheet({ ...styleSheet, mood: e.target.value })} placeholder="Mood" className="px-3 py-2 bg-white rounded-xl border border-purple-100 text-xs font-medium" />
              <input value={styleSheet.lighting} onChange={(e) => setStyleSheet({ ...styleSheet, lighting: e.target.value })} placeholder="Lighting" className="px-3 py-2 bg-white rounded-xl border border-purple-100 text-xs font-medium" />
            </div>
          </div>
        </div>
      )}

      {step === 5 && (
        <div className="mb-6 p-6 bg-gradient-to-br from-amber-50 to-pink-50 rounded-[2rem] border-2 border-amber-100">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <h4 className="text-xs font-black uppercase tracking-[0.2em] text-amber-700 flex items-center gap-2">
                <Icons.Type size={14} /> 자막 스타일 <span className="text-[9px] text-amber-500 font-bold normal-case">Submagic-style</span>
              </h4>
              <p className="text-[10px] text-amber-600 mt-1 italic">단어별로 강조되는 자막을 영상에 자동으로 입힙니다 (한국어 어절 단위, 이모지 강조).</p>
            </div>
            <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-wider text-amber-700 cursor-pointer">
              <input type="checkbox" checked={captionStyle.enableEmoji} onChange={(e) => { setCaptionStyle(cs => ({ ...cs, enableEmoji: e.target.checked })); sync(); }} className="w-4 h-4 accent-amber-500" />
              Emoji
            </label>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            {CAPTION_PRESETS.map(p => (
              <button
                key={p.id}
                onClick={() => { setCaptionStyle(cs => ({ ...cs, preset: p.id })); sync(); }}
                className={`p-4 rounded-2xl border-2 text-left transition-all ${captionStyle.preset === p.id ? 'border-amber-500 bg-white shadow-lg scale-[1.02]' : 'border-amber-100 bg-white/60 hover:border-amber-200'}`}
              >
                <span className="block text-sm font-black mb-1">{p.label}</span>
                <span className="block text-[10px] text-gray-500 leading-tight">{p.description}</span>
              </button>
            ))}
          </div>
          {captionStyle.preset !== 'none' && (
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-amber-700">강조 색상</span>
                <input type="color" value={captionStyle.emphasisColor} onChange={(e) => { setCaptionStyle(cs => ({ ...cs, emphasisColor: e.target.value })); sync(); }} className="w-9 h-9 rounded-lg border-2 border-white shadow cursor-pointer" />
              </label>
              <span className="text-[10px] text-amber-600 italic ml-auto">자막은 내보내기 단계에서 영상에 입혀집니다.</span>
            </div>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto pr-4 space-y-6 hide-scrollbar">
        {scenes.map((s, i) => {
          const mediaType = step === 3 ? 'audio' : step === 4 ? 'image' : 'video';
          const isFailed = failedScenes.has(`${mediaType}-${i}`);
          const failMsg = failedScenes.get(`${mediaType}-${i}`);
          const isActive = processingSet.has(i);
          const qs = s.qualityScore;
          const qsBadgeColor = !qs ? '' : qs.overall >= 8 ? 'bg-green-100 text-green-700' : qs.overall >= 6 ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700';
          const isQualityExpanded = expandedQuality.has(i);
          const toggleQuality = () => setExpandedQuality(prev => {
            const n = new Set(prev);
            if (n.has(i)) n.delete(i); else n.add(i);
            return n;
          });
          const axisColor = (v: number) => v >= 8 ? 'bg-green-500' : v >= 6 ? 'bg-blue-500' : v >= 4 ? 'bg-amber-500' : 'bg-red-500';
          return (
            <div key={i} className={`p-8 rounded-[3.5rem] flex flex-col md:flex-row gap-8 items-center border transition-all duration-500 relative ${isActive ? 'bg-brand-cyan/10 border-brand-cyan scale-[1.01] shadow-2xl' : isFailed ? 'bg-red-50 border-red-300 shadow-md' : 'bg-gray-50 border-gray-100 shadow-sm'}`}>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  <span className="bg-brand-dark/5 text-brand-dark/40 px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest">Scene {i + 1}</span>
                  {s.beatRole && <span className="bg-purple-50 text-purple-600 px-3 py-1 rounded-full text-[10px] font-black uppercase">{s.beatRole}</span>}
                  {s.shotType && <span className="bg-blue-50 text-blue-600 px-3 py-1 rounded-full text-[10px] font-bold">{s.shotType}</span>}
                  {s.cameraMovement && s.cameraMovement !== 'static' && <span className="bg-cyan-50 text-cyan-600 px-3 py-1 rounded-full text-[10px] font-bold">{s.cameraMovement}</span>}
                  {qs && (
                    <button type="button" onClick={toggleQuality} className={`px-3 py-1 rounded-full text-[10px] font-black uppercase ${qsBadgeColor} hover:opacity-80 transition-opacity flex items-center gap-1`} title="품질 점수 상세 보기">
                      ★ {qs.overall}/10{qs.refined ? ' ↻' : ''}
                      <Icons.ChevronDown size={10} className={`transition-transform ${isQualityExpanded ? 'rotate-180' : ''}`} />
                    </button>
                  )}
                  {isFailed && <span className="bg-red-100 text-red-600 px-3 py-1 rounded-full text-[10px] font-black uppercase">Failed</span>}
                  {isActive && <span className="bg-brand-cyan/20 text-brand-cyan px-3 py-1 rounded-full text-[10px] font-black uppercase animate-pulse">Processing</span>}
                  {s.promptChanged && (
                    <span className="relative">
                      <span
                        className={`bg-amber-100 text-amber-700 border border-amber-300 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider transition-colors ${step === 4 || step === 5 ? 'cursor-pointer hover:bg-amber-200' : 'cursor-default'}`}
                        title={step === 3 ? 'AI 편집으로 프롬프트가 변경됨. 스크립트가 바뀐 경우 오디오를 재생성하세요.' : 'AI 편집으로 프롬프트가 변경됨. 클릭하면 옵션을 선택하세요.'}
                        onClick={(e) => {
                          if (step === 4 || step === 5) {
                            e.stopPropagation();
                            setPromptChangedPopoverIdx(promptChangedPopoverIdx === i ? null : i);
                          }
                        }}
                      >
                        ✦ 재생성 권장
                      </span>
                      {promptChangedPopoverIdx === i && (step === 4 || step === 5) && (
                        <div
                          className="absolute top-full mt-1 left-0 z-50 bg-white border border-amber-200 rounded-2xl shadow-xl p-2 flex flex-col gap-1 min-w-[200px]"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setPromptChangedPopoverIdx(null);
                              if (step === 4) handleSingleImage(i);
                              else handleSingleVideo(i);
                            }}
                            className="px-3 py-2 rounded-xl text-[11px] font-bold text-left hover:bg-amber-50 text-amber-800 transition-colors flex items-center gap-2"
                          >
                            <Icons.RefreshCw size={11} /> 재생성
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              updateSceneAt(i, { promptChanged: false });
                              sync();
                              setPromptChangedPopoverIdx(null);
                            }}
                            className="px-3 py-2 rounded-xl text-[11px] font-bold text-left hover:bg-gray-50 text-gray-700 transition-colors flex items-center gap-2"
                          >
                            <Icons.ImageIcon size={11} /> 미디어 유지 (텍스트만 적용)
                          </button>
                        </div>
                      )}
                    </span>
                  )}
                  {step === 3 && s.promptChanged && s.script_segment_original && s.script_segment !== s.script_segment_original && (
                    <button
                      type="button"
                      onClick={() => handleSingleAudio(i)}
                      disabled={isProcessing}
                      className={`flex items-center gap-1 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border transition-colors ${isProcessing ? 'bg-orange-50 border-orange-200 text-orange-400 cursor-not-allowed opacity-60' : 'bg-orange-100 text-orange-700 border-orange-300 hover:bg-orange-200 cursor-pointer'}`}
                      title="스크립트가 변경됨 — 클릭하면 나레이션을 새 대사로 재생성합니다."
                    >
                      <Icons.RefreshCw size={10} /> 오디오 재생성
                    </button>
                  )}
                  {step === 5 && !isPresentationMode && s.video_path && s.seedSource && (() => {
                    const seedBadge = s.seedSource === 'reference'
                      ? { cls: 'bg-emerald-50 text-emerald-700 border border-emerald-200', label: '참조 이미지로 시드', title: '캐릭터 참조 이미지로 정체성 잠금' }
                      : s.seedSource === 'scene-image'
                      ? { cls: 'bg-blue-50 text-blue-700 border border-blue-200', label: '씬 이미지로 시드', title: '이 씬에서 생성된 이미지를 시드로 사용' }
                      : { cls: 'bg-gray-100 text-gray-600 border border-gray-200', label: '텍스트만 사용', title: '시드 이미지 없이 텍스트 프롬프트만으로 생성됨' };
                    return (
                      <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${seedBadge.cls}`} title={seedBadge.title}>
                        {seedBadge.label}
                      </span>
                    );
                  })()}
                  {step === 5 && !isPresentationMode && s.video_meta?.resumed && (
                    <span className="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-indigo-50 text-indigo-700 border border-indigo-200" title="이전 세션에서 제출된 작업이 새 세션에서 완료됨">
                      재개됨
                    </span>
                  )}
                  {step === 5 && !isPresentationMode && s.video_meta?.uploadStatus === 'pending-upload' && (
                    <>
                      <span className="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-50 text-amber-800 border border-amber-200" title="Firebase Storage 업로드를 백그라운드에서 재시도 중">
                        업로드 재시도 중
                      </span>
                      <button
                        type="button"
                        onClick={() => jobManager.retryUploadsNow(w.projectId)}
                        className="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-600 text-white hover:bg-amber-700 transition-colors"
                        title="지금 업로드 재시도"
                      >
                        지금 다시 업로드
                      </button>
                    </>
                  )}
                  {step === 5 && !isPresentationMode && s.video_meta?.longWait && (
                    <>
                      <span className="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-purple-50 text-purple-700 border border-purple-200" title="Veo 폴링이 30분을 초과했습니다 — 작업은 계속 추적됩니다">
                        장시간 대기
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          jobManager.continueLongWait({
                            projectId: w.projectId,
                            userId: w.userId,
                            sceneIdx: i,
                          })
                        }
                        className="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-purple-600 text-white hover:bg-purple-700 transition-colors"
                        title="이 씬의 폴링을 다시 시작"
                      >
                        계속 추적
                      </button>
                      <button
                        type="button"
                        onClick={() => jobManager.abandonLongWait(w.projectId, i)}
                        className="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
                        title="이 씬의 추적을 중단"
                      >
                        추적 중단
                      </button>
                    </>
                  )}
                </div>
                <p className="text-brand-dark text-sm font-medium leading-relaxed italic mb-3">"{s.script_segment}"</p>
                {step === 5 && !isPresentationMode && s.video_path && Array.isArray(s.videoCast) && (() => {
                  const cast = s.videoCast!.filter((n): n is string => typeof n === 'string' && n.trim().length > 0);
                  const attached = !!s.videoCastAttached;
                  const containerCls = attached
                    ? 'bg-emerald-50 border border-emerald-200'
                    : 'bg-amber-50 border border-amber-200';
                  const labelCls = attached ? 'text-emerald-700' : 'text-amber-700';
                  const modeBadgeCls = attached
                    ? 'bg-emerald-600 text-white'
                    : 'bg-amber-500 text-white';
                  const modeLabel = attached ? '참조 첨부' : '텍스트만';
                  const modeTitle = attached
                    ? '비디오 모델에 명명된 캐릭터의 참조 이미지가 첨부되어 전송됨'
                    : '비디오 모델은 단일 시드 이미지만 받기 때문에, 명명된 캐릭터는 프롬프트 텍스트로만 전달됨';
                  if (cast.length === 0) {
                    return (
                      <div className={`flex items-center gap-2 mb-3 flex-wrap px-3 py-1.5 rounded-2xl ${containerCls}`}>
                        <span className={`text-[10px] font-black uppercase tracking-widest ${labelCls}`}>Video Cast</span>
                        <span className="text-[10px] text-gray-400 italic">명명된 캐릭터 없음 — 프롬프트만 전송됨</span>
                      </div>
                    );
                  }
                  return (
                    <div className={`flex items-center gap-2 mb-3 flex-wrap px-3 py-1.5 rounded-2xl ${containerCls}`} title={modeTitle}>
                      <span className={`text-[10px] font-black uppercase tracking-widest ${labelCls}`}>Video Cast</span>
                      {cast.map(name => {
                        const ref = characterReferences.find(c => c.name.toLowerCase() === name.toLowerCase());
                        return (
                          <span
                            key={`vidcast-${name}`}
                            className={`flex items-center gap-1.5 pl-1 pr-2.5 py-0.5 rounded-full bg-white border ${attached ? 'border-emerald-300' : 'border-amber-300'}`}
                            title={ref?.description || name}
                          >
                            {ref?.imageUrl ? (
                              <img src={ref.imageUrl} alt="" className="w-5 h-5 rounded-full object-cover" />
                            ) : (
                              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-black ${attached ? 'bg-emerald-200 text-emerald-800' : 'bg-amber-200 text-amber-800'}`}>{name.charAt(0).toUpperCase()}</span>
                            )}
                            <span className="text-[11px] font-bold text-brand-dark">{name}</span>
                          </span>
                        );
                      })}
                      <span
                        className={`ml-auto px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider ${modeBadgeCls}`}
                        title={modeTitle}
                      >
                        {modeLabel}
                      </span>
                    </div>
                  );
                })()}
                {(step === 3 || step === 4 || step === 5) && characterReferences.length > 0 && (() => {
                  const tagged = (s.characters || []).filter((t): t is string => typeof t === 'string' && t.trim().length > 0);
                  const taggedLower = new Set(tagged.map(t => t.trim().toLowerCase()));
                  const available = characterReferences.filter(c => c.name && c.name.trim() && !taggedLower.has(c.name.trim().toLowerCase()));
                  // Detect a cast edit on Step 5 that hasn't been baked into
                  // the existing video yet. Compare current `characters`
                  // against `videoCast`, the snapshot of names actually sent
                  // to the video model on the last successful generation.
                  // Legacy scenes without a snapshot suppress the hint.
                  const castDiffersFromVideo = (() => {
                    if (step !== 5 || !s.video_path || !s.videoCast) return false;
                    const sentLower = new Set(s.videoCast.map(n => n.trim().toLowerCase()));
                    if (sentLower.size !== taggedLower.size) return true;
                    for (const n of taggedLower) if (!sentLower.has(n)) return true;
                    return false;
                  })();
                  return (
                    <div className="flex items-center gap-2 mb-3 flex-wrap">
                      <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 mr-1">Cast</span>
                      {tagged.length === 0 && available.length > 0 && (
                        <span className="text-[10px] text-gray-300 italic mr-1">캐릭터 없음 — 아래에서 추가</span>
                      )}
                      {tagged.map(name => {
                        const ref = characterReferences.find(c => c.name.toLowerCase() === name.toLowerCase());
                        return (
                          <button key={`tagged-${name}`} type="button" onClick={() => toggleSceneCharacter(i, name)} className="group flex items-center gap-1.5 pl-1 pr-2.5 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-red-50 hover:border-red-200 hover:text-red-700 transition-colors" title={`'${name}' 제거`}>
                            {ref?.imageUrl ? (
                              <img src={ref.imageUrl} alt="" className="w-5 h-5 rounded-full object-cover" />
                            ) : (
                              <span className="w-5 h-5 rounded-full bg-emerald-200 flex items-center justify-center text-[9px] font-black">{name.charAt(0).toUpperCase()}</span>
                            )}
                            <span className="text-[11px] font-bold">{name}</span>
                            <Icons.X size={10} className="opacity-50 group-hover:opacity-100" />
                          </button>
                        );
                      })}
                      {available.map(c => (
                        <button key={`avail-${c.name}`} type="button" onClick={() => toggleSceneCharacter(i, c.name)} className="flex items-center gap-1.5 pl-1 pr-2.5 py-0.5 rounded-full bg-white border border-dashed border-gray-300 text-gray-500 hover:border-emerald-400 hover:text-emerald-700 hover:bg-emerald-50 transition-colors" title={`'${c.name}' 추가`}>
                          {c.imageUrl ? (
                            <img src={c.imageUrl} alt="" className="w-5 h-5 rounded-full object-cover opacity-60" />
                          ) : (
                            <span className="w-5 h-5 rounded-full bg-gray-200 flex items-center justify-center text-[9px] font-black">{c.name.charAt(0).toUpperCase()}</span>
                          )}
                          <span className="text-[11px] font-bold">+ {c.name}</span>
                        </button>
                      ))}
                      {castDiffersFromVideo && (
                        <button
                          type="button"
                          onClick={() => handleSingleVideo(i)}
                          disabled={isProcessing}
                          title={isActive ? '이 씬을 재생성 중입니다…' : isProcessing ? '다른 씬을 처리 중입니다. 잠시 후 다시 시도해주세요.' : '클릭하면 새 캐스트로 이 씬을 바로 재생성합니다.'}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold transition-colors ${isProcessing ? 'bg-amber-50 border-amber-200 text-amber-800 opacity-60 cursor-not-allowed' : 'bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100 hover:border-amber-300 cursor-pointer'}`}
                        >
                          {isActive ? (
                            <>
                              <Icons.Loader2 size={10} className="animate-spin" />
                              재생성 중…
                            </>
                          ) : (
                            <>
                              <Icons.RefreshCw size={10} />
                              지금 재생성 — 새 캐스트 반영
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  );
                })()}
                {step === 4 && (s.lighting || s.durationSec) && (
                  <p className="text-[10px] text-gray-400 mb-3 font-medium">
                    {s.lighting && <>💡 {s.lighting}</>}{s.lighting && s.durationSec ? ' · ' : ''}{s.durationSec ? `⏱ ${s.durationSec}s` : ''}
                  </p>
                )}
                {isFailed && <p className="text-red-500 text-xs mb-3 font-medium">{failMsg}</p>}

                {step === 4 && qs && isQualityExpanded && (
                  <div className="mb-4 p-4 rounded-2xl bg-white border border-gray-200 shadow-sm">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Icons.Sparkles size={12} className="text-brand-cyan" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">품질 점수 상세</span>
                        {qs.refined && <span className="text-[9px] font-bold text-purple-600 bg-purple-50 px-2 py-0.5 rounded-full">↻ refined</span>}
                      </div>
                    </div>
                    <div className="space-y-2 mb-3">
                      {[
                        { label: '캐릭터 일관성', value: qs.characterConsistency },
                        { label: '구도', value: qs.compositionQuality },
                        { label: '의도 일치', value: qs.intentAlignment },
                        { label: '종합', value: qs.overall },
                      ].map(axis => (
                        <div key={axis.label} className="flex items-center gap-3">
                          <span className="text-[11px] font-bold text-gray-700 w-24 shrink-0">{axis.label}</span>
                          <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div className={`h-full ${axisColor(axis.value)} transition-all`} style={{ width: `${(axis.value / 10) * 100}%` }} />
                          </div>
                          <span className="text-[11px] font-black text-gray-700 w-10 text-right">{axis.value}/10</span>
                        </div>
                      ))}
                    </div>
                    {qs.issues && qs.issues.length > 0 ? (
                      <div className="mb-3 p-3 rounded-xl bg-amber-50 border border-amber-100">
                        <div className="flex items-center gap-1.5 mb-2">
                          <Icons.AlertCircle size={11} className="text-amber-600" />
                          <span className="text-[10px] font-black uppercase tracking-widest text-amber-700">AI가 지적한 이슈</span>
                        </div>
                        <ul className="space-y-1">
                          {qs.issues.map((issue, k) => (
                            <li key={k} className="text-[11px] text-amber-900 font-medium leading-relaxed pl-3 relative">
                              <span className="absolute left-0 top-0">•</span>{issue}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <p className="text-[11px] text-gray-400 italic mb-3">지적된 이슈 없음</p>
                    )}
                    <button type="button" onClick={() => handleRefineImage(i)} disabled={isActive || !s.image_path} className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-600 to-pink-500 text-white rounded-full text-[10px] font-black uppercase hover:scale-105 transition-all shadow-md disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100">
                      <Icons.Wand2 size={11} /> Refine This Scene
                    </button>
                  </div>
                )}

                {step === 5 && isPresentationMode ? (() => {
                  const pres = s.presentation || getDefaultPresentation(i);
                  return (
                    <div className="space-y-4 w-full">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div>
                          <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1 block">
                            <Icons.Layers size={10} className="inline mr-1" />전환 효과
                          </label>
                          <select
                            value={pres.transition}
                            onChange={(e) => updateScenePresentation(i, { transition: e.target.value as TransitionType })}
                            className="w-full px-3 py-2 rounded-xl border-2 border-gray-200 text-xs font-bold bg-white"
                          >
                            {i === 0 ? (
                              <option value="none">없음 (첫 번째 씬)</option>
                            ) : (
                              TRANSITION_OPTIONS.map(o => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                              ))
                            )}
                          </select>
                        </div>
                        <div>
                          <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1 block">
                            <Icons.Move size={10} className="inline mr-1" />모션
                          </label>
                          <select value={pres.motion} onChange={(e) => updateScenePresentation(i, { motion: e.target.value as MotionPreset })} className="w-full px-3 py-2 rounded-xl border-2 border-gray-200 text-xs font-bold bg-white">
                            {MOTION_OPTIONS.map(o => (
                              <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1 block">
                            <Icons.Clock size={10} className="inline mr-1" />전환 시간
                          </label>
                          <select value={pres.transitionDuration} onChange={(e) => updateScenePresentation(i, { transitionDuration: Number(e.target.value) })} className="w-full px-3 py-2 rounded-xl border-2 border-gray-200 text-xs font-bold bg-white" disabled={i === 0}>
                            {[0.5, 1, 1.5, 2, 2.5, 3].map(v => (
                              <option key={v} value={v}>{v}초</option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                            <Icons.Type size={10} className="inline mr-1" />텍스트 오버레이
                          </label>
                          {!pres.textOverlay ? (
                            <button onClick={() => updateSceneTextOverlay(i, { text: s.script_segment || '' })} className="text-[10px] font-bold text-brand-cyan hover:underline">+ 추가</button>
                          ) : (
                            <button onClick={() => updateSceneTextOverlay(i, null)} className="text-[10px] font-bold text-red-400 hover:underline">삭제</button>
                          )}
                        </div>
                        {pres.textOverlay && (
                          <div className="space-y-2 p-3 bg-white rounded-xl border border-gray-100">
                            <textarea value={pres.textOverlay.text} onChange={(e) => updateSceneTextOverlay(i, { text: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-gray-200 text-xs font-medium resize-none h-16" placeholder="표시할 텍스트..." />
                            <div className="flex gap-2 flex-wrap">
                              {(['top', 'center', 'bottom'] as const).map(pos => (
                                <button key={pos} onClick={() => updateSceneTextOverlay(i, { position: pos })} className={`px-3 py-1 rounded-lg text-[10px] font-bold border transition-all ${pres.textOverlay?.position === pos ? 'border-brand-cyan bg-brand-cyan/10 text-brand-dark' : 'border-gray-200 text-gray-400 hover:border-gray-300'}`}>
                                  {pos === 'top' ? '상단' : pos === 'center' ? '중앙' : '하단'}
                                </button>
                              ))}
                              <select value={pres.textOverlay.fontSize} onChange={(e) => updateSceneTextOverlay(i, { fontSize: Number(e.target.value) })} className="px-2 py-1 rounded-lg border border-gray-200 text-[10px] font-bold bg-white">
                                {[20, 24, 28, 32, 40, 48, 56].map(sz => (
                                  <option key={sz} value={sz}>{sz}px</option>
                                ))}
                              </select>
                              <input type="color" value={pres.textOverlay.color} onChange={(e) => updateSceneTextOverlay(i, { color: e.target.value })} className="w-7 h-7 rounded-lg border border-gray-200 cursor-pointer" title="텍스트 색상" />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })() : (
                  <>
                  {step === 5 && !isPresentationMode && !isProcessing && (() => {
                    const seedMode: SeedSource = s.videoSeedPreference || 'scene-image';
                    const hasSceneImage = !!s.image_path;
                    const hasReference = !!characterReferenceImage;
                    const opts: { key: SeedSource; label: string; sub: string; disabled?: boolean }[] = [
                      { key: 'scene-image', label: '씬 이미지', sub: hasSceneImage ? '현재 씬 컷' : (hasReference ? '없음 → 레퍼런스' : '없음 → 텍스트') },
                      { key: 'reference', label: '캐릭터 레퍼런스', sub: hasReference ? '잠긴 인물 사진' : '레퍼런스 미설정', disabled: !hasReference },
                      { key: 'text-only', label: '텍스트만', sub: '시드 이미지 없이' },
                    ];
                    // Same staleness pattern as castDiffersFromVideo above:
                    // when an existing video was rendered with a different
                    // seed preference than the one currently selected,
                    // surface an inline hint so the user knows the toggle
                    // only applies on the next regeneration. Legacy scenes
                    // without a snapshot suppress the hint.
                    const seedDiffersFromVideo = !!s.video_path
                      && !!s.videoSeedPreferenceUsed
                      && s.videoSeedPreferenceUsed !== seedMode;
                    return (
                      <div className="mb-3 p-3 rounded-2xl bg-gradient-to-br from-purple-50 to-pink-50 border border-purple-200/60">
                        <div className="flex items-center justify-between mb-2">
                          <div className="text-[10px] font-black uppercase tracking-wider text-purple-700 flex items-center gap-1.5">
                            <Icons.Video size={11} /> Veo 시드 선택
                          </div>
                          <div className="text-[9px] font-medium text-gray-500">기본: 씬 이미지</div>
                        </div>
                        <div className="grid grid-cols-3 gap-1.5">
                          {opts.map(opt => {
                            const active = seedMode === opt.key;
                            return (
                              <button
                                key={opt.key}
                                type="button"
                                disabled={opt.disabled}
                                onClick={() => updateSceneAt(i, { videoSeedPreference: opt.key })}
                                title={opt.disabled ? '캐릭터 레퍼런스가 설정되지 않았습니다 (Step 1)' : `${opt.label} - ${opt.sub}`}
                                className={`px-2 py-1.5 rounded-lg text-[10px] font-bold border transition-all ${
                                  active
                                    ? 'border-purple-500 bg-purple-500 text-white shadow-sm'
                                    : opt.disabled
                                      ? 'border-gray-200 bg-gray-50 text-gray-300 cursor-not-allowed'
                                      : 'border-gray-200 bg-white text-gray-600 hover:border-purple-300 hover:text-purple-700'
                                }`}
                              >
                                <div className="leading-tight">{opt.label}</div>
                                <div className={`text-[8px] font-medium leading-tight mt-0.5 ${active ? 'text-purple-100' : 'text-gray-400'}`}>{opt.sub}</div>
                              </button>
                            );
                          })}
                        </div>
                        {seedDiffersFromVideo && (
                          <div className="mt-2 flex items-center gap-1.5">
                            <span
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-800 text-[10px] font-bold"
                              title="현재 영상은 이전 시드 선택으로 만들어졌어요. 아래 '재생성' 버튼을 누르면 새 시드 선택이 적용됩니다."
                            >
                              <Icons.AlertCircle size={10} />
                              변경 사항은 다음 재생성부터 반영됩니다
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                  <div className="flex flex-wrap gap-3">
                    {!isProcessing && (
                      <>
                        {s.audio_path && (
                          <button onClick={() => handlePlayAudio(s.audio_path!, i)} className="flex items-center gap-2 px-6 py-2.5 bg-brand-dark text-white rounded-full text-[11px] font-black uppercase hover:scale-105 transition-all shadow-md">
                            {playingAudioIdx === i ? <Icons.Loader2 className="animate-spin" size={12} /> : <Icons.Play size={12} />} Preview Audio
                          </button>
                        )}
                        {step === 5 && s.video_path && (
                          <button onClick={() => setSelectedVideoIdx(selectedVideoIdx === i ? null : i)} className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-purple-600 to-pink-500 text-white rounded-full text-[11px] font-black uppercase hover:scale-105 transition-all shadow-md">
                            <Icons.Play size={12} /> Preview Video
                          </button>
                        )}
                        {step === 3 && (isFailed || !s.audio_path) && (
                          <button onClick={() => handleSingleAudio(i)} className="flex items-center gap-2 px-6 py-2.5 bg-red-500 text-white rounded-full text-[11px] font-black uppercase hover:scale-105 transition-all shadow-md">
                            <Icons.RefreshCw size={12} /> {isFailed ? '재시도' : '오디오 생성'}
                          </button>
                        )}
                        {step === 3 && s.audio_path && !isFailed && (
                          <button onClick={() => handleSingleAudio(i)} className="flex items-center gap-2 px-6 py-2.5 bg-white border-2 border-brand-dark text-black rounded-full text-[11px] font-black uppercase hover:bg-brand-dark hover:text-white transition-all shadow-sm">
                            <Icons.Wand2 size={12} /> Regenerate Audio
                          </button>
                        )}
                        {step === 4 && (isFailed || !s.image_path) && (
                          <button onClick={() => handleSingleImage(i)} className="flex items-center gap-2 px-6 py-2.5 bg-red-500 text-white rounded-full text-[11px] font-black uppercase hover:scale-105 transition-all shadow-md">
                            <Icons.RefreshCw size={12} /> {isFailed ? '재시도' : '이미지 생성'}
                          </button>
                        )}
                        {step === 4 && s.image_path && !isFailed && (
                          <button onClick={() => handleSingleImage(i)} className="flex items-center gap-2 px-6 py-2.5 bg-white border-2 border-brand-dark text-black rounded-full text-[11px] font-black uppercase hover:bg-brand-dark hover:text-white transition-all shadow-sm">
                            <Icons.Wand2 size={12} /> Regenerate Image
                          </button>
                        )}
                        {(step === 4 || (step === 5 && !isPresentationMode)) && (
                          <button
                            onClick={() => setAiEditSceneIdx(i)}
                            className="flex items-center gap-2 px-6 py-2.5 bg-white border-2 border-brand-cyan text-teal-700 rounded-full text-[11px] font-black uppercase hover:bg-brand-cyan/10 transition-all shadow-sm"
                            title="AI에게 자연어로 씬 수정 지시"
                          >
                            <Icons.Sparkles size={12} /> AI 수정
                          </button>
                        )}
                        {s.promptChanged && (s.visual_prompt_original || s.script_segment_original) && (
                          <button
                            onClick={() => updateSceneAt(i, {
                              visual_prompt: s.visual_prompt_original ?? s.visual_prompt,
                              script_segment: s.script_segment_original ?? s.script_segment,
                              promptChanged: false,
                              visual_prompt_original: undefined,
                              script_segment_original: undefined,
                            } as Partial<Scene>)}
                            className="flex items-center gap-2 px-4 py-2.5 bg-white border-2 border-amber-300 text-amber-700 rounded-full text-[11px] font-black uppercase hover:bg-amber-50 transition-all shadow-sm"
                            title="AI 수정 전 원본으로 되돌리기"
                          >
                            <Icons.RotateCcw size={12} /> 되돌리기
                          </button>
                        )}
                        {step === 5 && !isPresentationMode && (isFailed || !s.video_path) && (
                          <button onClick={() => handleSingleVideo(i)} className="flex items-center gap-2 px-6 py-2.5 bg-red-500 text-white rounded-full text-[11px] font-black uppercase hover:scale-105 transition-all shadow-md">
                            <Icons.RefreshCw size={12} /> {isFailed ? '재시도' : '비디오 생성'}
                          </button>
                        )}
                        {step === 5 && !isPresentationMode && s.video_path && !isFailed && (
                          <button onClick={() => handleSingleVideo(i)} className="flex items-center gap-2 px-6 py-2.5 bg-white border-2 border-brand-dark text-black rounded-full text-[11px] font-black uppercase hover:bg-brand-dark hover:text-white transition-all shadow-sm">
                            <Icons.Video size={12} /> Re-Motion Scene
                          </button>
                        )}
                      </>
                    )}
                  </div>
                  </>
                )}
                {step === 5 && !isPresentationMode && selectedVideoIdx === i && s.video_path && (
                  <div className="mt-4 rounded-2xl overflow-hidden bg-black shadow-lg border-2 border-purple-400/30">
                    <video
                      key={`inline-preview-${i}-${s.video_path}`}
                      src={s.video_path}
                      poster={s.image_path}
                      autoPlay
                      controls
                      playsInline
                      className={`w-full ${aspectRatio === '9:16' ? 'max-h-[300px] mx-auto' : 'max-h-[240px]'} object-contain`}
                      ref={(el) => { if (el && s.audio_path && !useVeoAudio) syncAudioWithVideo(el, s.audio_path); }}
                    />
                  </div>
                )}
              </div>

              <div className={`shrink-0 bg-brand-dark rounded-[2.5rem] overflow-hidden shadow-2xl flex items-center justify-center border-4 relative transition-all duration-700 ${aspectRatio === '9:16' ? 'w-40 h-72' : 'w-72 h-40'} ${isActive ? 'border-brand-cyan scale-105' : isFailed ? 'border-red-400' : 'border-white'}`}>
                {step === 3 ? (
                  <div className="flex flex-col items-center gap-4">
                    {isActive ? (
                      <Icons.Loader2 className="animate-spin text-brand-cyan" size={40} />
                    ) : isFailed ? (
                      <Icons.AlertCircle className="text-red-400" size={40} />
                    ) : s.audio_path ? (
                      <Icons.Check className="text-brand-cyan" size={40} strokeWidth={4} />
                    ) : (
                      <Icons.Mic className="text-white/10" size={40} />
                    )}
                  </div>
                ) : (step === 4 || step === 5) ? (
                  <div className="relative w-full h-full group" onClick={() => { if (step === 5 && s.video_path) setSelectedVideoIdx(i); }}>
                    {s.video_path ? (
                      <>
                        <video src={s.video_path} autoPlay={false} loop muted playsInline className="w-full h-full object-cover" />
                        {step === 5 && (
                          <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                            <Icons.Maximize2 className="text-white" size={28} />
                          </div>
                        )}
                      </>
                    ) : s.image_path ? (
                      <img src={s.image_path} className="w-full h-full object-cover animate-in fade-in zoom-in-95 duration-700" key={s.image_path} alt="Scene Visual" />
                    ) : isFailed ? (
                      <Icons.AlertCircle className="text-red-400" size={40} />
                    ) : (
                      <Icons.ImageIcon className="text-white/10" size={40} />
                    )}
                    {isActive && (
                      <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center backdrop-blur-md z-10">
                        <Icons.Loader2 className="animate-spin text-brand-cyan mb-2" size={40} />
                        <span className="text-[10px] font-black text-brand-cyan uppercase tracking-widest animate-pulse">Rendering...</span>
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {/* AI Scene Edit Modal */}
      {aiEditSceneIdx !== null && (() => {
        const scene = scenes[aiEditSceneIdx];
        if (!scene) return null;
        const handleApply = (result: SceneRefineResult) => {
          updateSceneAt(aiEditSceneIdx, {
            visual_prompt: result.visual_prompt,
            script_segment: result.script_segment,
            ...(result.shotType ? { shotType: result.shotType as any } : {}),
            ...(result.cameraMovement ? { cameraMovement: result.cameraMovement as any } : {}),
            ...(result.characters ? { characters: result.characters } : {}),
            promptChanged: true,
            visual_prompt_original: scene.visual_prompt_original ?? scene.visual_prompt,
            script_segment_original: scene.script_segment_original ?? scene.script_segment,
          } as Partial<Scene>);
          sync();
          setAiEditSceneIdx(null);
        };
        return (
          <SceneAIEditModal
            scene={scene}
            sceneIndex={aiEditSceneIdx}
            context={{ topic, videoStyle }}
            onApply={handleApply}
            onClose={() => setAiEditSceneIdx(null)}
          />
        );
      })()}

      <div className="flex gap-4 mt-10">
        <button disabled={isProcessing} onClick={() => setStep((step - 1) as any)} className="px-10 py-6 rounded-full font-black text-gray-400 hover:text-black disabled:opacity-0 transition-all">Back</button>
        <button
          disabled={isProcessing || (step === 4 && !isImagesReady) || (step === 5 && !isPresentationMode && !isVideosReady)}
          onClick={() => { const ns = (step + 1) as any; setStep(ns); setMaxStep(prev => Math.max(prev, ns)); sync(ns); }}
          className={`flex-1 py-6 rounded-full font-black text-2xl shadow-2xl transition-all ${isProcessing || (step === 4 && !isImagesReady) || (step === 5 && !isPresentationMode && !isVideosReady) ? 'bg-gray-100 text-gray-300 cursor-not-allowed scale-95' : 'bg-brand-dark text-white hover:scale-[1.02] shadow-brand-cyan/20'}`}
        >
          {step === 4 && !isImagesReady ? '이미지를 모두 생성하세요' :
           step === 5 && !isPresentationMode && !isVideosReady ? '비디오를 모두 생성하세요' :
           'Proceed to Final Assembly'}
        </button>
      </div>
    </div>
  );
};
