import React, { useState } from 'react';
import { Icons } from '../Icons';
import { GENRES, PLATFORMS, applyPlatformDefaults } from '../../services/presets';
import { generateSceneImage } from '../../services/geminiService';
import { uploadFileToCloud, updateProjectFields } from '../../services/storageService';
import { useWizard } from './WizardContext';
import { SaveContextPackModal } from '../SaveContextPackModal';
import {
  applyPackToProjectFields,
  getPack,
} from '../../services/contextPackService';
import type { CreativeBriefPurpose, CreativeBriefTone } from '../../types';

export const Step1Setup: React.FC = () => {
  const w = useWizard();
  const {
    genre,
    setGenre,
    platform,
    setPlatform,
    aspectRatio,
    setAspectRatio,
    setDuration,
    setTargetSceneCount,
    videoStyle,
    setVideoStyle,
    sceneDurationMode,
    setSceneDurationMode,
    duration,
    targetSceneCount,
    characterProfile,
    setCharacterProfile,
    generatingReference,
    setGeneratingReference,
    characterReferenceImage,
    setCharacterReferenceImage,
    userId,
    projectId,
    sync,
    allModels,
    selectedImageModel,
    styleSheet,
    useReferenceImage,
    setUseReferenceImage,
    characterReferences,
    setCharacterReferences,
    generatingCharRefIdx,
    setGeneratingCharRefIdx,
    visionCriticEnabled,
    setVisionCriticEnabled,
    qualityThreshold,
    setQualityThreshold,
    negativePrompt,
    setNegativePrompt,
    useVeoAudio,
    setUseVeoAudio,
    videoMode,
    setVideoMode,
    setStep,
    setMaxStep,
    setCaptionStyle,
    creativeBrief,
    setCreativeBrief,
  } = w;
  // ContextPack — pulled separately so we don't widen the rest of the
  // destructure to `any`.
  const {
    linkedContextPackId,
    linkedContextPack,
    contextPackDirty,
    setContextPackDirty,
    setContextPackVersion,
    setStyleSheet,
    setSelectedImageModel,
    setSelectedVideoModel,
  } = w;
  const InheritedBadge = () =>
    linkedContextPack ? (
      <span
        title={`팩 '${linkedContextPack.name}'에서 상속됨`}
        className="inline-flex items-center gap-1 text-[9px] font-black px-1.5 py-0.5 rounded-full bg-brand-cyan/20 text-brand-dark uppercase tracking-wider align-middle"
      >
        <Icons.Layers size={9} /> 팩 상속
      </span>
    ) : null;

  const [showSavePack, setShowSavePack] = useState(false);
  const [applyingPack, setApplyingPack] = useState(false);
  const [briefExpanded, setBriefExpanded] = useState(false);

  const handleApplyPackChanges = async () => {
    if (!linkedContextPackId || !userId || !projectId) return;
    setApplyingPack(true);
    try {
      const pack = await getPack(userId, linkedContextPackId);
      if (!pack) {
        alert('연결된 팩을 찾을 수 없습니다. 팩이 삭제되었을 수 있습니다.');
        setContextPackDirty(false);
        return;
      }
      const fields = applyPackToProjectFields(pack);
      // Apply each field to wizard state if pack provides it.
      if (fields.character_profile !== undefined)
        setCharacterProfile(fields.character_profile || '');
      if (fields.character_reference_image !== undefined)
        setCharacterReferenceImage(fields.character_reference_image);
      if (fields.character_references !== undefined)
        setCharacterReferences(fields.character_references || []);
      if (fields.style_sheet !== undefined) setStyleSheet(fields.style_sheet);
      if (fields.style_template !== undefined) setVideoStyle(fields.style_template);
      if (fields.aspect_ratio !== undefined) setAspectRatio(fields.aspect_ratio);
      if (fields.selected_image_model !== undefined)
        setSelectedImageModel(fields.selected_image_model);
      if (fields.selected_video_model !== undefined)
        setSelectedVideoModel(fields.selected_video_model);
      if (fields.use_veo_audio !== undefined) setUseVeoAudio(fields.use_veo_audio);
      if (fields.negative_prompt !== undefined) setNegativePrompt(fields.negative_prompt || '');
      if (fields.vision_critic_enabled !== undefined)
        setVisionCriticEnabled(fields.vision_critic_enabled);
      if (typeof fields.quality_threshold === 'number')
        setQualityThreshold(fields.quality_threshold);
      if (fields.caption_style !== undefined) setCaptionStyle(fields.caption_style);
      if (fields.video_mode !== undefined) setVideoMode(fields.video_mode);
      if (fields.genre !== undefined) setGenre(fields.genre);
      if (fields.platform !== undefined) setPlatform(fields.platform);

      setContextPackVersion(pack.version);
      setContextPackDirty(false);

      try {
        await updateProjectFields(projectId, {
          context_pack_version: pack.version,
          context_pack_dirty: false,
        });
      } catch (e) {
        console.warn('[Step1Setup] reconcile dirty flag failed:', e);
      }

      alert('팩 변경사항이 적용되었습니다.');
    } catch (e: any) {
      alert(`팩 적용 실패: ${e?.message || e}`);
    } finally {
      setApplyingPack(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col max-w-4xl mx-auto w-full">
      <div className="text-center mb-16">
        <h2 className="text-5xl font-black text-brand-dark mb-4 tracking-tighter">Workspace Config</h2>
        <p className="text-gray-400 text-lg font-medium italic">비디오의 톤앤매너를 설정하세요.</p>
      </div>

      {/* ContextPack actions header. */}
      <div className="mb-10 flex flex-wrap items-center justify-between gap-3 p-4 rounded-3xl bg-gray-50">
        <div className="flex items-center gap-2 text-xs font-bold text-gray-500">
          <Icons.Layers size={14} className="text-brand-dark" />
          {linkedContextPackId ? (
            <span>
              컨텍스트 팩에 연결됨
              {contextPackDirty && (
                <span className="ml-2 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-black uppercase tracking-wider">
                  변경 있음
                </span>
              )}
            </span>
          ) : (
            <span className="text-gray-400">독립 프로젝트 (팩 미연결)</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {linkedContextPackId && contextPackDirty && (
            <button
              onClick={handleApplyPackChanges}
              disabled={applyingPack}
              className="text-xs font-black bg-amber-500 text-white px-3 py-2 rounded-xl hover:brightness-110 disabled:opacity-50 flex items-center gap-1"
            >
              {applyingPack ? (
                <Icons.Loader2 size={12} className="animate-spin" />
              ) : (
                <Icons.RotateCcw size={12} />
              )}
              팩 변경 적용
            </button>
          )}
          <button
            onClick={() => setShowSavePack(true)}
            className="text-xs font-black border-2 border-brand-dark text-brand-dark px-3 py-2 rounded-xl hover:bg-brand-dark hover:text-white transition-all flex items-center gap-1"
          >
            <Icons.Plus size={12} /> 컨텍스트 팩으로 저장
          </button>
        </div>
      </div>

      {showSavePack && <SaveContextPackModal onClose={() => setShowSavePack(false)} />}
      <div className="space-y-16">
        {/* ── Creative Brief (기획 브리핑) ── */}
        <section>
          <button
            onClick={() => setBriefExpanded(v => !v)}
            className="w-full flex items-center justify-between gap-3 group"
          >
            <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 flex items-center gap-2 group-hover:text-brand-dark transition-colors">
              <Icons.FileText size={14} /> 기획 브리핑
              <span className="text-gray-300 normal-case font-medium">(선택사항 · AI 스크립트 품질 향상)</span>
            </h3>
            <span className={`text-gray-400 transition-transform duration-200 ${briefExpanded ? 'rotate-180' : ''}`}>
              <Icons.ChevronDown size={16} />
            </span>
          </button>
          {!briefExpanded && (
            <p className="text-[10px] text-gray-400 italic mt-2">
              타겟·메시지·톤을 설정하면 AI가 목적에 맞는 전략적 스크립트를 생성합니다. 클릭해서 펼치세요.
            </p>
          )}
          {briefExpanded && (
            <div className="mt-5 space-y-5 p-6 bg-gradient-to-br from-indigo-50/60 to-purple-50/40 rounded-[2rem] border-2 border-indigo-100">
              {/* Audience */}
              <div>
                <label className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-700 block mb-2">
                  타겟 오디언스
                </label>
                <input
                  value={creativeBrief.audience || ''}
                  onChange={e => setCreativeBrief(prev => ({ ...prev, audience: e.target.value || undefined }))}
                  placeholder="예: 20대 여성 직장인, IT 스타트업 창업자, 초등학생 학부모"
                  className="w-full p-4 bg-white rounded-2xl outline-none text-sm font-medium shadow-inner border border-indigo-100 focus:border-indigo-300 transition-colors"
                />
              </div>
              {/* Key Message */}
              <div>
                <label className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-700 block mb-2">
                  핵심 메시지 <span className="text-gray-400 normal-case font-medium">(1문장)</span>
                </label>
                <input
                  value={creativeBrief.keyMessage || ''}
                  onChange={e => setCreativeBrief(prev => ({ ...prev, keyMessage: e.target.value || undefined }))}
                  placeholder="예: 우리 앱을 쓰면 하루 2시간을 절약할 수 있습니다"
                  className="w-full p-4 bg-white rounded-2xl outline-none text-sm font-medium shadow-inner border border-indigo-100 focus:border-indigo-300 transition-colors"
                />
              </div>
              {/* Purpose */}
              <div>
                <label className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-700 block mb-3">
                  영상 목적
                </label>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {([
                    { value: 'awareness', label: '브랜드 인지', emoji: '📢' },
                    { value: 'conversion', label: '전환/구매', emoji: '🎯' },
                    { value: 'education', label: '교육/정보', emoji: '📚' },
                    { value: 'entertainment', label: '엔터테인먼트', emoji: '🎬' },
                  ] as { value: CreativeBriefPurpose; label: string; emoji: string }[]).map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setCreativeBrief(prev => ({
                        ...prev,
                        purpose: prev.purpose === opt.value ? undefined : opt.value,
                      }))}
                      className={`p-3 rounded-2xl border-2 text-center transition-all ${
                        creativeBrief.purpose === opt.value
                          ? 'border-indigo-400 bg-indigo-50 shadow-md scale-[1.02]'
                          : 'border-white bg-white hover:border-indigo-200'
                      }`}
                    >
                      <span className="block text-lg mb-1">{opt.emoji}</span>
                      <span className="text-[10px] font-black text-gray-700">{opt.label}</span>
                    </button>
                  ))}
                </div>
              </div>
              {/* Tone & Voice */}
              <div>
                <label className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-700 block mb-3">
                  브랜드 톤 & 보이스
                </label>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {([
                    { value: 'formal', label: 'Formal', desc: '격식체·전문적' },
                    { value: 'casual', label: 'Casual', desc: '편안하고 친근함' },
                    { value: 'friendly', label: 'Friendly', desc: '따뜻하고 친절함' },
                    { value: 'expert', label: 'Expert', desc: '권위있는 전문가' },
                  ] as { value: CreativeBriefTone; label: string; desc: string }[]).map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setCreativeBrief(prev => ({
                        ...prev,
                        toneVoice: prev.toneVoice === opt.value ? undefined : opt.value,
                      }))}
                      className={`p-3 rounded-2xl border-2 text-left transition-all ${
                        creativeBrief.toneVoice === opt.value
                          ? 'border-indigo-400 bg-indigo-50 shadow-md scale-[1.02]'
                          : 'border-white bg-white hover:border-indigo-200'
                      }`}
                    >
                      <span className="text-[11px] font-black text-gray-800 block">{opt.label}</span>
                      <span className="text-[9px] text-gray-400 block mt-0.5">{opt.desc}</span>
                    </button>
                  ))}
                </div>
              </div>
              {/* Reference URLs */}
              <div>
                <label className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-700 block mb-2">
                  참고 영상 URL <span className="text-gray-400 normal-case font-medium">(최대 3개 · 스타일 힌트로만 사용)</span>
                </label>
                <div className="space-y-2">
                  {[0, 1, 2].map(idx => (
                    <input
                      key={idx}
                      value={(creativeBrief.referenceUrls || [])[idx] || ''}
                      onChange={e => {
                        const urls = [...(creativeBrief.referenceUrls || ['', '', ''])];
                        urls[idx] = e.target.value;
                        // Trim trailing empty entries
                        const trimmed = urls.map(u => u.trim());
                        const lastNonEmpty = trimmed.reduce((last, v, i) => v ? i : last, -1);
                        const cleaned = lastNonEmpty >= 0 ? trimmed.slice(0, lastNonEmpty + 1) : [];
                        setCreativeBrief(prev => ({ ...prev, referenceUrls: cleaned.length ? cleaned : undefined }));
                      }}
                      placeholder={`참고 URL ${idx + 1} (예: https://youtube.com/watch?v=...)`}
                      className="w-full p-3 bg-white rounded-xl outline-none text-xs font-medium shadow-inner border border-indigo-100 focus:border-indigo-300 transition-colors"
                      type="url"
                    />
                  ))}
                </div>
                <p className="text-[9px] text-gray-400 italic mt-2">URL을 실제로 방문하지 않고 스타일 힌트로만 AI 프롬프트에 포함합니다.</p>
              </div>
              {/* Active brief summary badge */}
              {(creativeBrief.audience || creativeBrief.keyMessage || creativeBrief.purpose || creativeBrief.toneVoice) && (
                <div className="flex items-center gap-2 pt-1">
                  <span className="w-2 h-2 rounded-full bg-green-400 inline-block" />
                  <span className="text-[10px] text-green-700 font-bold">
                    브리핑 활성화됨 — 스크립트 생성 시 자동 반영됩니다
                  </span>
                </div>
              )}
            </div>
          )}
        </section>

        <section>
          <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 mb-4 flex items-center gap-2">
            <Icons.Film size={14} /> Genre <span className="text-gray-300 normal-case font-medium">(선택사항)</span>
          </h3>
          <p className="text-xs text-gray-400 mb-4 italic">장르를 선택하면 AI가 적절한 구조와 후크 전략으로 스크립트를 작성합니다.</p>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {GENRES.map(g => (
              <button
                key={g.id}
                onClick={() => setGenre(genre === g.id ? undefined : g.id)}
                className={`p-4 rounded-[1.5rem] border-4 text-left transition-all ${genre === g.id ? 'border-brand-cyan bg-brand-cyan/5 shadow-xl scale-[1.02]' : 'border-gray-50 hover:border-gray-100'}`}
              >
                <span className="text-xs font-black block mb-1">{g.label}</span>
                <span className="text-[10px] text-gray-400 leading-tight block">{g.description}</span>
              </button>
            ))}
          </div>
        </section>
        <section>
          <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 mb-4 flex items-center gap-2">
            <Icons.Layers size={14} /> Platform <span className="text-gray-300 normal-case font-medium">(선택사항 · 비율·길이 자동 설정)</span>
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {PLATFORMS.map(pl => (
              <button
                key={pl.id}
                onClick={() => {
                  const next = platform === pl.id ? undefined : pl.id;
                  setPlatform(next);
                  if (next) {
                    const def = applyPlatformDefaults(next);
                    if (def.aspectRatio) setAspectRatio(def.aspectRatio as '16:9' | '9:16' | '1:1' | '3:4');
                    if (def.duration) setDuration(def.duration);
                    if (def.targetSceneCount) setTargetSceneCount(def.targetSceneCount);
                  }
                }}
                className={`p-4 rounded-[1.5rem] border-4 text-left transition-all ${platform === pl.id ? 'border-brand-cyan bg-brand-cyan/5 shadow-xl scale-[1.02]' : 'border-gray-50 hover:border-gray-100'}`}
              >
                <span className="text-xs font-black block mb-1">{pl.label}</span>
                <span className="text-[10px] text-gray-400 block">{pl.aspectRatio} · ~{pl.recommendedDurationSec}초</span>
                <span className="text-[9px] text-gray-300 block mt-0.5">Hook: {pl.hookIntensity}</span>
              </button>
            ))}
          </div>
        </section>
        <section>
          <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 mb-8 flex items-center gap-2">
            Aspect Ratio
            {linkedContextPack?.aspect_ratio === aspectRatio && <InheritedBadge />}
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {['16:9', '9:16', '1:1', '3:4'].map(r => (
              <button key={r} onClick={() => setAspectRatio(r as '16:9' | '9:16' | '1:1' | '3:4')} className={`p-8 rounded-[2.5rem] border-4 flex flex-col items-center gap-4 transition-all ${aspectRatio === r ? 'border-brand-cyan bg-brand-cyan/5 shadow-xl scale-[1.02]' : 'border-gray-50 hover:border-gray-100'}`}>
                <span className="font-black text-xl">{r}</span>
              </button>
            ))}
          </div>
        </section>
        <section>
          <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 mb-8 flex items-center gap-2">
            Visual Style
            {linkedContextPack?.video_style === videoStyle && <InheritedBadge />}
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {['Cute Stickman', 'Japanese Anime', 'Realistic Cinematic', '3D Pixar-like'].map(s => (
              <button key={s} onClick={() => setVideoStyle(s)} className={`p-6 rounded-[2.5rem] border-4 transition-all text-center ${videoStyle === s ? 'border-brand-cyan bg-brand-cyan/5 shadow-xl scale-[1.02]' : 'border-gray-50 hover:border-gray-100'}`}>
                <span className="text-xs font-black uppercase">{s}</span>
              </button>
            ))}
          </div>
        </section>
        <section>
          <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 mb-8 flex items-center gap-2">
            <Icons.Clock size={14} /> Scene Duration
          </h3>
          <div className="flex gap-4 mb-6">
            <button
              onClick={() => setSceneDurationMode('time')}
              className={`flex-1 p-5 rounded-[2rem] border-4 text-center transition-all ${sceneDurationMode === 'time' ? 'border-brand-cyan bg-brand-cyan/5 shadow-xl scale-[1.02]' : 'border-gray-50 hover:border-gray-100'}`}
            >
              <span className="text-xs font-black uppercase block mb-1">총 영상 시간</span>
              <span className="text-[10px] text-gray-400">초 단위로 설정</span>
            </button>
            <button
              onClick={() => setSceneDurationMode('scenes')}
              className={`flex-1 p-5 rounded-[2rem] border-4 text-center transition-all ${sceneDurationMode === 'scenes' ? 'border-brand-cyan bg-brand-cyan/5 shadow-xl scale-[1.02]' : 'border-gray-50 hover:border-gray-100'}`}
            >
              <span className="text-xs font-black uppercase block mb-1">씬(컷) 수</span>
              <span className="text-[10px] text-gray-400">8초 단위 컷</span>
            </button>
          </div>
          {sceneDurationMode === 'time' ? (
            <div>
              <div className="flex items-center gap-4">
                <input
                  type="range" min={8} max={600} step={8} value={duration}
                  onChange={e => { const v = Number(e.target.value); setDuration(v); setTargetSceneCount(Math.max(1, Math.round(v / 8))); }}
                  className="flex-1 h-2 accent-brand-cyan"
                />
                <span className="text-2xl font-black text-brand-dark w-24 text-right">{duration}초</span>
              </div>
              <p className="text-xs text-gray-400 mt-2 italic">
                약 {Math.max(1, Math.round(duration / 8))}개 씬 (8초/씬 기준)
                {duration >= 60 && ` · 약 ${Math.floor(duration / 60)}분 ${duration % 60 ? `${duration % 60}초` : ''}`}
              </p>
              {duration >= 180 && (
                <div className="mt-4 p-5 rounded-[1.75rem] border-2 border-purple-200 bg-gradient-to-br from-purple-50 via-white to-pink-50">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-purple-500 text-white flex items-center justify-center shrink-0 shadow-md">
                      <Icons.Film size={18} />
                    </div>
                    <div className="flex-1">
                      <h4 className="text-xs font-black text-purple-900 mb-1 flex items-center gap-2">
                        Long-form mode 활성화 ({Math.floor(duration / 60)}분 {duration % 60 ? `${duration % 60}초` : ''})
                      </h4>
                      <p className="text-[11px] text-purple-800 leading-relaxed">
                        총 길이가 3분을 넘어 자동으로 장편 모드로 전환됩니다. 약 {Math.ceil(duration / 75)}개 파트(60–90초)로 자동 분할되어
                        생성·렌더링되며, Step 7에서 한 편의 영상으로 다시 합칩니다.
                      </p>
                      <p className="text-[10px] text-purple-700 italic mt-1.5">
                        팁: 최대 10분(600초) · 약 75개 씬까지 지원 · 메모리 부담을 줄이기 위해 파트별로 렌더링됩니다.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-6">
                {[2, 3, 4, 5, 6, 8, 10].map(n => (
                  <button key={n} onClick={() => { setTargetSceneCount(n); setDuration(n * 8); }}
                    className={`w-14 h-14 rounded-2xl border-4 font-black text-lg transition-all ${targetSceneCount === n ? 'border-brand-cyan bg-brand-cyan/5 shadow-xl scale-110' : 'border-gray-50 hover:border-gray-100'}`}
                  >{n}</button>
                ))}
              </div>
              <p className="text-xs text-gray-400 mt-2 italic">총 약 {targetSceneCount * 8}초 영상 ({targetSceneCount}컷 × 8초)</p>
            </div>
          )}
        </section>
        <section>
          <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 mb-4 flex items-center gap-2">
            <Icons.User size={14} /> Character Profile <span className="text-gray-300 normal-case font-medium">(선택사항)</span>
          </h3>
          <p className="text-xs text-gray-400 mb-4 italic">주인공의 외형을 상세히 설명하면 모든 씬에서 일관된 캐릭터가 등장합니다.</p>
          <textarea
            value={characterProfile}
            onChange={e => setCharacterProfile(e.target.value)}
            placeholder="예: 30대 한국 남성, 짧은 검은 머리, 둥근 안경, 파란색 후드티를 입고 있음. 중간 체형, 밝고 친근한 표정."
            className="w-full p-6 bg-gray-50 rounded-[2rem] outline-none text-sm font-medium leading-relaxed shadow-inner resize-none h-24"
          />
          <div className="mt-6 p-5 bg-gradient-to-br from-amber-50 to-orange-50 rounded-[2rem] border-2 border-amber-100">
            <div className="flex items-start justify-between gap-4 mb-3">
              <div className="flex-1">
                <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-700 flex items-center gap-2">
                  <Icons.ImageIcon size={12} /> Character Reference Image
                </h4>
                <p className="text-[10px] text-amber-600 mt-1 italic leading-relaxed">
                  업로드하거나 자동 생성한 참조 이미지를 모든 씬 생성에 함께 전달합니다. 캐릭터 얼굴·복장·정체성이 씬마다 흔들리지 않습니다.
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                <label className="px-4 py-2 bg-white border border-amber-200 rounded-full text-[10px] font-bold text-amber-700 hover:bg-amber-50 cursor-pointer transition-all">
                  {generatingReference ? '업로드 중…' : '업로드'}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={generatingReference}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      if (file.size > 4 * 1024 * 1024) {
                        alert('참조 이미지는 4MB 이하여야 합니다.');
                        e.target.value = '';
                        return;
                      }
                      setGeneratingReference(true);
                      try {
                        const ext = (file.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
                        const storagePath = `users/${userId}/projects/${projectId}/character_ref.${ext}`;
                        const url = await uploadFileToCloud(storagePath, file, 'blob');
                        if (!url.startsWith('http')) {
                          throw new Error('Storage 업로드에 실패했습니다. Firebase Storage 설정을 확인해주세요.');
                        }
                        setCharacterReferenceImage(url);
                        sync();
                      } catch (err: any) {
                        alert(`참조 이미지 업로드 실패: ${err?.message || ''}`);
                      } finally {
                        setGeneratingReference(false);
                        e.target.value = '';
                      }
                    }}
                  />
                </label>
                <button
                  disabled={generatingReference || !characterProfile.trim()}
                  onClick={async () => {
                    setGeneratingReference(true);
                    try {
                      const imgModel = allModels.find(m => m.id === selectedImageModel);
                      const result = await generateSceneImage(
                        `Full-body character reference portrait of: ${characterProfile}. Neutral studio background, even lighting, character centered and clearly visible. Use this as a model sheet for downstream scenes.`,
                        videoStyle,
                        aspectRatio,
                        imgModel?.modelId,
                        imgModel?.provider,
                        characterProfile || undefined,
                        { styleSheet, visionCritic: false },
                      );
                      if (result) {
                        const ext = result.mimeType.includes('png') ? 'png' : 'jpg';
                        const storagePath = `users/${userId}/projects/${projectId}/character_ref.${ext}`;
                        const url = await uploadFileToCloud(storagePath, result.base64, 'base64');
                        if (!url.startsWith('http')) {
                          throw new Error('Storage 업로드에 실패했습니다. Firebase Storage 설정을 확인해주세요.');
                        }
                        setCharacterReferenceImage(url);
                        sync();
                      }
                    } catch (err: any) {
                      alert(`참조 이미지 생성 실패: ${err?.message || ''}`);
                    } finally {
                      setGeneratingReference(false);
                    }
                  }}
                  className="px-4 py-2 bg-amber-500 text-white rounded-full text-[10px] font-bold hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  {generatingReference ? '생성 중…' : 'AI로 자동 생성'}
                </button>
                {characterReferenceImage && (
                  <button
                    onClick={() => { setCharacterReferenceImage(undefined); sync(); }}
                    className="px-3 py-2 bg-white border border-red-200 rounded-full text-[10px] font-bold text-red-500 hover:bg-red-50 transition-all"
                  >
                    제거
                  </button>
                )}
              </div>
            </div>
            {characterReferenceImage ? (
              <div className="flex items-center gap-3 mt-2">
                <img
                  src={characterReferenceImage}
                  alt="Character reference"
                  className="w-24 h-24 rounded-2xl object-cover border-4 border-white shadow-md"
                />
                <p className="text-[10px] text-amber-600 font-medium leading-relaxed">
                  ✓ 이 이미지가 모든 씬 이미지 생성에 reference 로 함께 전달됩니다.<br/>
                  Vision Critic 도 이 이미지를 기준으로 캐릭터 일관성을 채점합니다.
                </p>
              </div>
            ) : (
              <p className="text-[10px] text-amber-500 italic mt-1">
                참조 이미지가 없으면 텍스트 설명만으로 매 씬을 그리므로 캐릭터가 흔들릴 수 있습니다.
              </p>
            )}
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={() => setUseReferenceImage(!useReferenceImage)}
              className={`w-12 h-7 rounded-full transition-all relative ${useReferenceImage ? 'bg-brand-cyan' : 'bg-gray-200'}`}
            >
              <div className={`w-5 h-5 bg-white rounded-full absolute top-1 transition-all shadow-sm ${useReferenceImage ? 'left-6' : 'left-1'}`} />
            </button>
            <span className="text-xs font-bold text-gray-700">매 씬에 참조 이미지를 함께 전달 (권장)</span>
          </div>
        </section>
        <section>
          <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 mb-4 flex items-center gap-2">
            <Icons.User size={14} /> Cast (Multi-Character) <span className="text-gray-300 normal-case font-medium">(선택사항 · 권장: 다인 등장 영상)</span>
          </h3>
          <p className="text-xs text-gray-400 mb-4 italic leading-relaxed">
            여러 캐릭터(예: 호스트 & 게스트, 주인공 & 악역)가 등장하는 스토리에서 캐릭터마다 이름과 참조 이미지를 등록하세요.
            스크립트 분석 시 각 씬에 등장하는 캐릭터가 자동으로 태깅되고, 이미지 생성 시 해당 캐릭터의 참조 이미지만 함께 전달됩니다.
          </p>
          <div className="space-y-3">
            {characterReferences.map((c, idx) => (
              <div key={idx} className="p-4 bg-gradient-to-br from-sky-50 to-indigo-50 rounded-3xl border-2 border-sky-100">
                <div className="flex gap-4">
                  <div className="shrink-0">
                    {c.imageUrl ? (
                      <img src={c.imageUrl} alt={c.name || 'character'} className="w-20 h-20 rounded-2xl object-cover border-4 border-white shadow-md" />
                    ) : (
                      <div className="w-20 h-20 rounded-2xl bg-white/70 border-2 border-dashed border-sky-200 flex items-center justify-center text-[9px] text-sky-400 font-bold text-center px-1">
                        No image
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0 space-y-2">
                    <input
                      value={c.name}
                      onChange={e => {
                        const v = e.target.value;
                        setCharacterReferences(prev => prev.map((x, i) => i === idx ? { ...x, name: v } : x));
                      }}
                      placeholder="캐릭터 이름 (예: Alex, 진행자, 악당 보스)"
                      className="w-full p-3 bg-white rounded-xl outline-none text-sm font-bold shadow-inner"
                    />
                    <textarea
                      value={c.description || ''}
                      onChange={e => {
                        const v = e.target.value;
                        setCharacterReferences(prev => prev.map((x, i) => i === idx ? { ...x, description: v } : x));
                      }}
                      placeholder="외형 설명 (선택) — 예: 20대 여성, 단발머리, 흰 셔츠"
                      className="w-full p-3 bg-white rounded-xl outline-none text-[11px] font-medium shadow-inner resize-none h-12"
                    />
                    <div className="flex flex-wrap gap-2">
                      <label className="px-3 py-1.5 bg-white border border-sky-200 rounded-full text-[10px] font-bold text-sky-700 hover:bg-sky-50 cursor-pointer transition-all">
                        {generatingCharRefIdx === idx ? '업로드 중…' : '이미지 업로드'}
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          disabled={generatingCharRefIdx !== null}
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            if (file.size > 4 * 1024 * 1024) {
                              alert('참조 이미지는 4MB 이하여야 합니다.');
                              e.target.value = '';
                              return;
                            }
                            setGeneratingCharRefIdx(idx);
                            try {
                              const ext = (file.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
                              const safeName = (c.name || `cast${idx}`).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32) || `cast${idx}`;
                              const storagePath = `users/${userId}/projects/${projectId}/cast/${safeName}_${idx}.${ext}`;
                              const url = await uploadFileToCloud(storagePath, file, 'blob');
                              if (!url.startsWith('http')) {
                                throw new Error('Storage 업로드 실패. Firebase Storage 설정을 확인해주세요.');
                              }
                              setCharacterReferences(prev => prev.map((x, i) => i === idx ? { ...x, imageUrl: url } : x));
                              sync();
                            } catch (err: any) {
                              alert(`업로드 실패: ${err?.message || ''}`);
                            } finally {
                              setGeneratingCharRefIdx(null);
                              e.target.value = '';
                            }
                          }}
                        />
                      </label>
                      <button
                        disabled={generatingCharRefIdx !== null || !(c.name && c.name.trim()) || !(c.description && c.description.trim())}
                        onClick={async () => {
                          setGeneratingCharRefIdx(idx);
                          try {
                            const imgModel = allModels.find(m => m.id === selectedImageModel);
                            const result = await generateSceneImage(
                              `Full-body character reference portrait of "${c.name}": ${c.description || ''}. Neutral studio background, even lighting, character centered and clearly visible. Use as a model sheet.`,
                              videoStyle,
                              aspectRatio,
                              imgModel?.modelId,
                              imgModel?.provider,
                              c.description || c.name,
                              { styleSheet, visionCritic: false },
                            );
                            if (result) {
                              const ext = result.mimeType.includes('png') ? 'png' : 'jpg';
                              const safeName = (c.name || `cast${idx}`).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32) || `cast${idx}`;
                              const storagePath = `users/${userId}/projects/${projectId}/cast/${safeName}_${idx}.${ext}`;
                              const url = await uploadFileToCloud(storagePath, result.base64, 'base64');
                              if (!url.startsWith('http')) {
                                throw new Error('Storage 업로드 실패. Firebase Storage 설정을 확인해주세요.');
                              }
                              setCharacterReferences(prev => prev.map((x, i) => i === idx ? { ...x, imageUrl: url } : x));
                              sync();
                            }
                          } catch (err: any) {
                            alert(`AI 생성 실패: ${err?.message || ''}`);
                          } finally {
                            setGeneratingCharRefIdx(null);
                          }
                        }}
                        className="px-3 py-1.5 bg-sky-500 text-white rounded-full text-[10px] font-bold hover:bg-sky-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                        title={!c.description?.trim() ? '외형 설명을 먼저 적어주세요' : 'AI로 캐릭터 시트 생성'}
                      >
                        {generatingCharRefIdx === idx ? '생성 중…' : 'AI 생성'}
                      </button>
                      <button
                        onClick={() => {
                          if (!confirm(`'${c.name || '이 캐릭터'}'를 캐스트에서 제거할까요?`)) return;
                          setCharacterReferences(prev => prev.filter((_, i) => i !== idx));
                          sync();
                        }}
                        className="px-3 py-1.5 bg-white border border-red-200 rounded-full text-[10px] font-bold text-red-500 hover:bg-red-50 transition-all"
                      >
                        <Icons.Trash2 size={10} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
            <button
              onClick={() => {
                setCharacterReferences(prev => ([...prev, { name: '', description: '', imageUrl: '' }]));
              }}
              className="w-full py-3 bg-white border-2 border-dashed border-sky-200 rounded-2xl text-xs font-bold text-sky-600 hover:bg-sky-50 hover:border-sky-300 transition-all flex items-center justify-center gap-2"
            >
              <Icons.Plus size={14} /> 캐릭터 추가
            </button>
            {characterReferences.length === 0 && (
              <p className="text-[10px] text-gray-400 italic">
                캐스트가 비어 있으면 위의 단일 'Character Reference Image'만 사용됩니다 (단일 주인공 영상에 적합).
              </p>
            )}
            {characterReferences.length > 0 && (
              <p className="text-[10px] text-sky-600 italic">
                ✓ {characterReferences.filter(c => c.name && c.imageUrl).length}/{characterReferences.length}명 등록 완료. 다음 단계의 씬 분석에서 자동 태깅됩니다.
              </p>
            )}
          </div>
        </section>
        <section>
          <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 mb-4 flex items-center gap-2">
            <Icons.Wand2 size={14} /> Director Pipeline
          </h3>
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setVisionCriticEnabled(!visionCriticEnabled)}
                className={`w-12 h-7 rounded-full transition-all relative ${visionCriticEnabled ? 'bg-brand-cyan' : 'bg-gray-200'}`}
              >
                <div className={`w-5 h-5 bg-white rounded-full absolute top-1 transition-all shadow-sm ${visionCriticEnabled ? 'left-6' : 'left-1'}`} />
              </button>
              <div className="flex-1">
                <span className="text-xs font-bold text-gray-700 block">Vision Critic 자동 품질 검수</span>
                <span className="text-[10px] text-gray-400 italic">생성된 이미지를 AI가 채점하고 {qualityThreshold}점 미만이면 1회 자동 재생성합니다 (생성 시간 약 2배).</span>
              </div>
            </div>
            {visionCriticEnabled && (
              <div className="pl-15 ml-15">
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 block mb-2 flex items-center justify-between">
                  <span>품질 기준 (Quality Threshold)</span>
                  <span className="text-brand-cyan font-black tabular-nums">{qualityThreshold}/10</span>
                </label>
                <input
                  type="range"
                  min={4}
                  max={8}
                  step={1}
                  value={qualityThreshold}
                  onChange={e => setQualityThreshold(parseInt(e.target.value, 10))}
                  className="w-full accent-brand-cyan"
                />
                <div className="flex justify-between text-[9px] text-gray-400 mt-1 font-bold">
                  <span>4 (관대)</span>
                  <span>6 (기본)</span>
                  <span>8 (엄격)</span>
                </div>
                <p className="text-[10px] text-gray-400 italic mt-2">기준이 높을수록 재생성이 잦아져 시간·비용이 늘어납니다.</p>
              </div>
            )}
            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 block mb-2">
                Negative Prompt <span className="text-gray-300 normal-case font-medium">(피하고 싶은 요소)</span>
              </label>
              <input
                value={negativePrompt}
                onChange={e => setNegativePrompt(e.target.value)}
                placeholder="예: blurry, low quality, distorted hands, watermark, text"
                className="w-full p-4 bg-gray-50 rounded-2xl outline-none text-xs font-medium shadow-inner"
              />
            </div>
          </div>
        </section>
        <section>
          <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 mb-4 flex items-center gap-2">
            <Icons.Mic size={14} /> Audio Source
          </h3>
          <div className="flex gap-4">
            <button
              onClick={() => setUseVeoAudio(true)}
              className={`flex-1 p-5 rounded-[2rem] border-4 text-left transition-all ${useVeoAudio ? 'border-brand-cyan bg-brand-cyan/5 shadow-xl scale-[1.02]' : 'border-gray-50 hover:border-gray-100'}`}
            >
              <span className="text-xs font-black uppercase block mb-1">Veo 3.1 내장 오디오</span>
              <span className="text-[10px] text-gray-400 leading-relaxed block">비디오에 대사·효과음·배경음이 자동 포함됩니다. 별도 오디오 단계를 건너뛸 수 있습니다.</span>
              <span className="inline-block mt-2 text-[9px] bg-green-50 text-green-600 px-2 py-0.5 rounded-full font-bold">추천 · 립싱크 지원</span>
            </button>
            <button
              onClick={() => setUseVeoAudio(false)}
              className={`flex-1 p-5 rounded-[2rem] border-4 text-left transition-all ${!useVeoAudio ? 'border-brand-cyan bg-brand-cyan/5 shadow-xl scale-[1.02]' : 'border-gray-50 hover:border-gray-100'}`}
            >
              <span className="text-xs font-black uppercase block mb-1">별도 TTS 나레이션</span>
              <span className="text-[10px] text-gray-400 leading-relaxed block">Gemini TTS로 나레이션을 별도 생성합니다. 음성 스타일을 세밀하게 제어할 수 있습니다.</span>
              <span className="inline-block mt-2 text-[9px] bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full font-bold">오디오 단계 필요</span>
            </button>
          </div>
        </section>
      </div>
      <div className="space-y-16">
        <section>
          <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 mb-4 flex items-center gap-2">
            <Icons.Film size={14} /> Video Creation Mode
          </h3>
          <p className="text-xs text-gray-400 mb-4 italic">비디오 제작 방식을 선택하세요.</p>
          <div className="flex gap-4">
            <button
              onClick={() => setVideoMode('ai')}
              className={`flex-1 p-5 rounded-[2rem] border-4 text-left transition-all ${videoMode === 'ai' ? 'border-brand-cyan bg-brand-cyan/5 shadow-xl scale-[1.02]' : 'border-gray-50 hover:border-gray-100'}`}
            >
              <span className="text-xs font-black uppercase block mb-1">AI Video (Veo)</span>
              <span className="text-[10px] text-gray-400 leading-relaxed block">AI가 각 씬을 동영상으로 직접 생성합니다. 가장 자연스러운 움직임과 애니메이션을 제공합니다.</span>
              <span className="inline-block mt-2 text-[9px] bg-purple-50 text-purple-600 px-2 py-0.5 rounded-full font-bold">고품질 AI 영상</span>
            </button>
            <button
              onClick={() => setVideoMode('presentation')}
              className={`flex-1 p-5 rounded-[2rem] border-4 text-left transition-all ${videoMode === 'presentation' ? 'border-brand-cyan bg-brand-cyan/5 shadow-xl scale-[1.02]' : 'border-gray-50 hover:border-gray-100'}`}
            >
              <span className="text-xs font-black uppercase block mb-1">Presentation Mode</span>
              <span className="text-[10px] text-gray-400 leading-relaxed block">이미지에 전환 효과(페이드, 슬라이드, 와이프 등), 모션(줌/팬), 텍스트 오버레이를 적용하여 프레젠테이션 스타일 영상을 만듭니다.</span>
              <span className="inline-block mt-2 text-[9px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full font-bold">전환 효과 · 텍스트 · 빠른 생성</span>
            </button>
          </div>
        </section>
      </div>
      <button onClick={() => { const ns = 2; setStep(ns); setMaxStep(prev => Math.max(prev, ns)); sync(ns); }} className="mt-20 bg-brand-dark text-white py-8 rounded-full font-black text-2xl shadow-2xl hover:brightness-110 transition-all">
        Initialize Vibe Script <Icons.ChevronRight className="inline" size={28} />
      </button>
    </div>
  );
};
