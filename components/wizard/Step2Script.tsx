import React, { useState } from 'react';
import { Icons } from '../Icons';
import { generateScript, segmentScriptIntoScenes, generateStyleSheet, refineAllScenesWithInstruction } from '../../services/geminiService';
import { generateRemixedScenes } from '../../services/youtubeAnalysisService';
import { useWizard } from './WizardContext';
import type { CreativeBrief, Scene } from '../../types';
import { StoryboardCard } from './StoryboardCard';
import { useInstructionPresets } from '../../hooks/useInstructionPresets';

function alertGeminiError(prefix: string, e: any) {
  const msg = String(e?.message || '');
  if (msg.includes('API key') || msg.includes('API 키가 설정되지 않았습니다')) {
    alert('API 키가 설정되지 않았습니다. 관리 페이지에서 Gemini API 키를 설정해주세요.');
  } else if (msg.startsWith('Gemini ')) {
    alert(msg);
  } else {
    alert(`${prefix}: ${msg || '알 수 없는 오류'}`);
  }
}

type Tab = 'script' | 'storyboard';

const PURPOSE_LABELS: Record<string, string> = {
  awareness: '인지도 제고',
  conversion: '전환·구매 유도',
  education: '교육·정보 전달',
  entertainment: '엔터테인먼트',
};

const TONE_LABELS: Record<string, string> = {
  formal: '격식체',
  casual: '캐주얼',
  friendly: '친근함',
  expert: '전문적',
};

function hasBriefContent(b: CreativeBrief): boolean {
  return !!(b.audience || b.purpose || b.toneVoice || b.keyMessage);
}

interface BriefBannerProps {
  brief: CreativeBrief;
  onGoToStep1: () => void;
}

const BriefBanner: React.FC<BriefBannerProps> = ({ brief, onGoToStep1 }) => {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || !hasBriefContent(brief)) return null;

  const chips: { label: string; value: string }[] = [];
  if (brief.audience) chips.push({ label: '타겟', value: brief.audience });
  if (brief.purpose) chips.push({ label: '목적', value: PURPOSE_LABELS[brief.purpose] ?? brief.purpose });
  if (brief.toneVoice) chips.push({ label: '톤', value: TONE_LABELS[brief.toneVoice] ?? brief.toneVoice });

  return (
    <div className="flex items-start gap-3 px-5 py-3 bg-indigo-50 border border-indigo-100 rounded-2xl text-sm text-indigo-700">
      <Icons.Sparkles size={16} className="mt-0.5 shrink-0 text-indigo-400" />
      <div className="flex-1 min-w-0">
        <span className="font-semibold mr-2">크리에이티브 브리프</span>
        <span className="inline-flex flex-wrap gap-2 items-center">
          {chips.map(c => (
            <span key={c.label} className="inline-flex items-center gap-1">
              <span className="text-indigo-400">{c.label}:</span>
              <span className="font-medium text-indigo-800">{c.value}</span>
            </span>
          ))}
        </span>
        {brief.keyMessage && (
          <p className="mt-1 text-indigo-600 italic truncate">"{brief.keyMessage}"</p>
        )}
      </div>
      <button
        onClick={onGoToStep1}
        className="shrink-0 text-indigo-400 hover:text-indigo-700 underline underline-offset-2 transition-colors"
        title="Step 1에서 브리프 편집"
      >
        편집
      </button>
      <button
        onClick={() => setDismissed(true)}
        className="shrink-0 text-indigo-300 hover:text-indigo-600 transition-colors"
        title="닫기"
        aria-label="브리프 배너 닫기"
      >
        <Icons.X size={14} />
      </button>
    </div>
  );
};

export const Step2Script: React.FC = () => {
  const w = useWizard();
  const {
    topic,
    setTopic,
    setLoading,
    setLoadingMessage,
    videoStyle,
    duration,
    targetSceneCount,
    genre,
    platform,
    creativeBrief,
    setScript,
    script,
    setStep,
    setMaxStep,
    setScenes,
    scenes,
    aspectRatio,
    characterProfile,
    characterReferences,
    styleSheet,
    setStyleSheet,
    sync,
    maxStep,
    updateSceneAt,
    remixSource,
    backgroundReplacements,
  } = w;

  // Side-by-side comparison toggle (only shown when remix scenes are present)
  const [showComparison, setShowComparison] = useState(false);
  const hasRemixScenes = scenes.some(s => (s as any).remix_original_script);

  const [activeTab, setActiveTab] = useState<Tab>('script');
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  // Bulk AI instruction state
  const [bulkInstruction, setBulkInstruction] = useState('');
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const { presets: instructionPresets, addPreset: addInstructionPreset, removePreset: removeInstructionPreset } = useInstructionPresets();

  const hasScenes = scenes.length > 0;

  // ── Drag and drop handlers ─────────────────────────────────────────────────

  const handleDragStart = (e: React.DragEvent, i: number) => {
    setDragIdx(i);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragEnd = () => {
    setDragIdx(null);
    setDragOverIdx(null);
  };

  const handleDragOver = (e: React.DragEvent, i: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverIdx !== i) setDragOverIdx(i);
  };

  const handleDrop = (e: React.DragEvent, targetIdx: number) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === targetIdx) {
      setDragIdx(null);
      setDragOverIdx(null);
      return;
    }

    const next = [...scenes];
    const [moved] = next.splice(dragIdx, 1);
    next.splice(targetIdx, 0, moved);

    // Renumber scene_number to match new order (1-based)
    const renumbered = next.map((sc, idx) => ({ ...sc, scene_number: idx + 1 }));
    setScenes(renumbered);
    sync(undefined, renumbered);

    setDragIdx(null);
    setDragOverIdx(null);
  };

  // ── Inline edit handler ────────────────────────────────────────────────────

  const handleCardSave = (idx: number, updates: Partial<Scene>) => {
    updateSceneAt(idx, updates);
    sync();
  };

  // ── Bulk AI instruction handler ────────────────────────────────────────────

  const handleBulkApply = async () => {
    if (!bulkInstruction.trim() || scenes.length === 0) return;
    setBulkLoading(true);
    setBulkError(null);
    setBulkProgress({ done: 0, total: scenes.length });
    try {
      const results = await refineAllScenesWithInstruction(
        scenes,
        bulkInstruction.trim(),
        { topic, videoStyle },
        (done, total) => setBulkProgress({ done, total }),
      );
      const next = scenes.map((s, i) => ({
        ...s,
        visual_prompt: results[i].visual_prompt,
        script_segment: results[i].script_segment,
        ...(results[i].shotType ? { shotType: results[i].shotType as any } : {}),
        ...(results[i].cameraMovement ? { cameraMovement: results[i].cameraMovement as any } : {}),
        ...(results[i].characters ? { characters: results[i].characters } : {}),
        promptChanged: true,
        visual_prompt_original: s.visual_prompt_original ?? s.visual_prompt,
        script_segment_original: s.script_segment_original ?? s.script_segment,
      }));
      setScenes(next);
      sync(undefined, next);
      addInstructionPreset(bulkInstruction.trim());
      setBulkInstruction('');
    } catch (e: any) {
      setBulkError(e?.message || '알 수 없는 오류');
    } finally {
      setBulkLoading(false);
      setBulkProgress(null);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex-1 flex flex-col max-w-4xl mx-auto w-full gap-8">
      {hasBriefContent(creativeBrief) && (
        <BriefBanner brief={creativeBrief} onGoToStep1={() => setStep(1)} />
      )}
      {/* Topic input + generate button */}
      <div className="flex gap-4">
        <input
          value={topic}
          onChange={e => setTopic(e.target.value)}
          placeholder="비디오 주제를 입력하세요 (예: 2024년 파리 올림픽 요약)..."
          className="flex-1 p-8 bg-gray-50 rounded-[2.5rem] outline-none text-2xl font-bold shadow-inner"
        />
        <button
          onClick={async () => {
            setLoading(true);
            setLoadingMessage('AI가 창의적인 스크립트를 빌드 중입니다...');
            try {
              const result = await generateScript(topic, videoStyle, duration, targetSceneCount, { genre, platform, creativeBrief });
              setScript(result);
            } catch (e: any) {
              console.error('Script generation failed:', e);
              alertGeminiError('스크립트 생성 실패', e);
            } finally {
              setLoading(false);
            }
          }}
          className="bg-brand-cyan text-black px-10 rounded-[2.5rem] shadow-xl hover:scale-105 transition-all"
        >
          <Icons.Wand2 size={28} />
        </button>
      </div>

      {/* Tabs — only shown when scenes exist */}
      {hasScenes && (
        <div className="flex gap-2 p-1.5 bg-gray-100 rounded-2xl w-fit">
          <button
            onClick={() => setActiveTab('script')}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-black transition-all ${
              activeTab === 'script'
                ? 'bg-white shadow-sm text-brand-dark'
                : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            <Icons.List size={15} />
            상세 보기
          </button>
          <button
            onClick={() => setActiveTab('storyboard')}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-black transition-all ${
              activeTab === 'storyboard'
                ? 'bg-white shadow-sm text-brand-dark'
                : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            <Icons.LayoutGrid size={15} />
            스토리보드
            <span className="bg-brand-cyan/20 text-teal-700 text-[10px] font-black px-1.5 py-0.5 rounded-full">
              {scenes.length}
            </span>
          </button>
        </div>
      )}

      {/* Script textarea — shown in script tab or when no scenes yet */}
      {(activeTab === 'script' || !hasScenes) && (
        <textarea
          value={script}
          onChange={e => setScript(e.target.value)}
          className="flex-1 p-10 bg-gray-50 rounded-[3rem] outline-none font-serif text-xl leading-relaxed shadow-inner min-h-[320px]"
          placeholder="AI가 작성한 스크립트..."
        />
      )}

      {/* Storyboard grid */}
      {activeTab === 'storyboard' && hasScenes && (
        <div className="flex-1 flex flex-col gap-4">
          <div className="flex items-center gap-4 flex-wrap">
            <p className="text-xs text-gray-400 font-medium flex items-center gap-1.5">
              <Icons.GripVertical size={12} />
              카드를 드래그해 씬 순서를 바꿀 수 있습니다. 카드를 클릭하면 인라인 편집이 가능합니다.
            </p>
            {/* Remix comparison toggle — shown when any scene has remix_original_script */}
            {hasRemixScenes && (
              <button
                onClick={() => setShowComparison(v => !v)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-black transition-all border-2 ${
                  showComparison
                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                    : 'bg-white text-indigo-600 border-indigo-200 hover:border-indigo-400'
                }`}
              >
                <Icons.List size={11} />
                {showComparison ? '비교 보기 끄기' : '원본 비교 보기'}
              </button>
            )}
          </div>

          {/* Bulk AI instruction bar */}
          <div className="p-5 bg-gradient-to-r from-teal-50 to-cyan-50 rounded-[2rem] border-2 border-teal-100">
            <div className="flex items-center gap-2 mb-3">
              <Icons.Sparkles size={14} className="text-brand-cyan" />
              <span className="text-[11px] font-black uppercase tracking-widest text-teal-700">전체 씬 AI 일괄 수정</span>
              {scenes.some(s => s.promptChanged) && (
                <span className="ml-auto text-[10px] bg-amber-100 text-amber-700 border border-amber-300 px-2 py-0.5 rounded-full font-bold">
                  {scenes.filter(s => s.promptChanged).length}개 씬 변경됨
                </span>
              )}
            </div>
            {instructionPresets.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3">
                {instructionPresets.map(preset => (
                  <div key={preset} className="group flex items-center gap-1 bg-white border border-teal-200 rounded-full text-xs font-medium text-teal-700 pl-3 pr-1.5 py-1 hover:border-brand-cyan hover:bg-teal-50 transition-colors">
                    <button
                      onClick={() => setBulkInstruction(preset)}
                      disabled={bulkLoading}
                      className="truncate max-w-[180px] text-left disabled:opacity-50"
                      title={preset}
                    >
                      {preset}
                    </button>
                    <button
                      onClick={() => removeInstructionPreset(preset)}
                      className="shrink-0 text-teal-300 hover:text-red-400 transition-colors ml-0.5"
                      title="프리셋 삭제"
                      aria-label="프리셋 삭제"
                    >
                      <Icons.X size={10} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-3">
              <input
                value={bulkInstruction}
                onChange={e => setBulkInstruction(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleBulkApply(); }}
                placeholder="예: 전체를 따뜻한 황금빛 조명으로 / 모든 씬 카메라를 dolly-in으로 / 전체 톤을 밝고 긍정적으로"
                disabled={bulkLoading}
                className="flex-1 px-4 py-2.5 bg-white rounded-2xl border-2 border-teal-200 text-sm font-medium outline-none focus:border-brand-cyan transition-colors disabled:opacity-50"
              />
              <button
                onClick={handleBulkApply}
                disabled={bulkLoading || !bulkInstruction.trim()}
                className="px-5 py-2.5 bg-brand-cyan text-black rounded-2xl font-black text-sm hover:scale-105 active:scale-95 transition-all shadow-md disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 flex items-center gap-2"
              >
                {bulkLoading ? (
                  <>
                    <Icons.Loader2 size={14} className="animate-spin" />
                    {bulkProgress ? `${bulkProgress.done}/${bulkProgress.total}` : '처리 중…'}
                  </>
                ) : (
                  <>
                    <Icons.Wand2 size={14} />
                    전체 적용
                  </>
                )}
              </button>
            </div>
            {bulkError && (
              <p className="mt-2 text-[11px] text-red-500 font-bold flex items-center gap-1">
                <Icons.AlertCircle size={11} /> {bulkError}
              </p>
            )}
            {bulkLoading && bulkProgress && (
              <div className="mt-3">
                <div className="h-1.5 bg-teal-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-brand-cyan rounded-full transition-all duration-300"
                    style={{ width: `${(bulkProgress.done / bulkProgress.total) * 100}%` }}
                  />
                </div>
                <p className="text-[10px] text-teal-600 font-bold mt-1">
                  {bulkProgress.done}/{bulkProgress.total}개 씬 처리 중…
                </p>
              </div>
            )}
          </div>

          {/* Side-by-side comparison view for remix projects */}
          {showComparison && hasRemixScenes ? (
            <div className="space-y-3 pb-4">
              {scenes.map((s, i) => (
                <div key={s.id ?? i} className="grid grid-cols-2 gap-3 p-4 bg-gray-50 rounded-2xl border border-gray-100">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-wider text-gray-400 mb-2 flex items-center gap-1">
                      <Icons.Film size={10} /> 씬 {i + 1} — 원본
                    </p>
                    <p className="text-xs text-gray-500 leading-relaxed italic whitespace-pre-wrap">
                      {(s as any).remix_original_script || '(원본 없음)'}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-wider text-indigo-600 mb-2 flex items-center gap-1">
                      <Icons.Sparkles size={10} /> 리믹스 버전
                    </p>
                    <textarea
                      value={s.script_segment || ''}
                      onChange={e => updateSceneAt(i, { script_segment: e.target.value })}
                      onBlur={() => sync()}
                      className="w-full text-xs text-gray-800 leading-relaxed font-medium bg-white border border-indigo-100 rounded-xl p-3 outline-none resize-none min-h-[120px] focus:border-indigo-300 transition-colors"
                      placeholder="(생성 중)"
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 pb-4">
              {scenes.map((s, i) => (
                <StoryboardCard
                  key={s.id ?? i}
                  scene={s}
                  index={i}
                  dragging={dragIdx === i}
                  dragOver={dragOverIdx === i}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                  onSave={handleCardSave}
                  aiContext={{ topic, videoStyle }}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Navigation buttons */}
      <div className="flex gap-4">
        <button onClick={() => setStep(1)} className="px-10 py-6 rounded-full font-black text-gray-400 hover:text-black transition-colors">
          Back
        </button>
        <button
          onClick={async () => {
            setLoading(true);
            setLoadingMessage(
              remixSource
                ? 'AI가 원본 씬을 최적화 팁에 맞게 리믹스하고 있습니다…'
                : '스크립트를 씬 단위로 분석하고 있습니다...',
            );
            try {
              let s: Partial<Scene>[];
              if (remixSource) {
                // Build character replacement map from current characterReferences
                const charReplacements: Record<string, string> = {};
                remixSource.detectedCharacters.forEach((dc, i) => {
                  const ref = characterReferences[i];
                  if (ref) {
                    const nameChanged = ref.name && ref.name !== dc.name;
                    const descChanged = ref.description && ref.description !== dc.description;
                    if (nameChanged || descChanged) {
                      charReplacements[dc.name] =
                        `${ref.name || dc.name}${ref.description ? ': ' + ref.description : ''}`;
                    }
                  }
                });
                s = await generateRemixedScenes(remixSource, {
                  characterReplacements:
                    Object.keys(charReplacements).length > 0 ? charReplacements : undefined,
                  backgroundReplacements:
                    Object.keys(backgroundReplacements).length > 0
                      ? backgroundReplacements
                      : undefined,
                });
              } else {
                s = await segmentScriptIntoScenes(
                  script,
                  videoStyle,
                  aspectRatio,
                  characterProfile || undefined,
                  targetSceneCount,
                  { genre, platform, characterReferences, creativeBrief },
                );
              }
              setScenes(s);
              if (!styleSheet) {
                try {
                  setLoadingMessage('비주얼 스타일 시트를 추출하는 중...');
                  const sheet = await generateStyleSheet(topic, script, videoStyle, { genre });
                  setStyleSheet(sheet);
                } catch (sheetErr) {
                  console.warn('[StyleSheet] auto-generation failed, continuing:', sheetErr);
                }
              }
              setStep(3);
              setMaxStep(prev => Math.max(prev, 3));
              setLoading(false);
              await sync(3, s, {}, { script, topic, maxStep: Math.max(maxStep, 3) });
            } catch (e: any) {
              console.error('Scene segmentation / remix failed:', e);
              alertGeminiError(remixSource ? '리믹스 씬 생성 실패' : '스토리보드 구성 실패', e);
              setLoading(false);
            }
          }}
          className="flex-1 bg-brand-dark text-white py-6 rounded-full font-black text-2xl shadow-2xl hover:scale-[1.01] transition-all"
        >
          {remixSource ? '🎬 Remix Storyboard' : 'Construct Storyboard'}
        </button>
      </div>
    </div>
  );
};
