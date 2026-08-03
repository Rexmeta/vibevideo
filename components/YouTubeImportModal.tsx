import React, { useEffect, useRef, useState } from 'react';
import { Icons } from './Icons';
import { analyzeYoutubeVideo } from '../services/youtubeAnalysisService';
import type { YoutubeAnalysis, YoutubeScene, DetectedCharacter, AnalysisFinding, OptimizationTip } from '../types';

// ─── Analysis cache (localStorage) ───────────────────────────────────────────

interface GaugeProps {
  score: number; // 0–10
  size?: number;
}

const CircularGauge: React.FC<GaugeProps> = ({ score, size = 120 }) => {
  const pct = Math.max(0, Math.min(100, (score / 10) * 100));
  const r = (size - 16) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - pct / 100);

  const color =
    pct >= 75 ? '#22c55e' : pct >= 50 ? '#f59e0b' : '#ef4444';

  const [animated, setAnimated] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setAnimated(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="block">
      {/* Track */}
      <circle
        cx={size / 2} cy={size / 2} r={r}
        fill="none" stroke="#e5e7eb" strokeWidth={10}
      />
      {/* Progress */}
      <circle
        cx={size / 2} cy={size / 2} r={r}
        fill="none"
        stroke={color}
        strokeWidth={10}
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={animated ? offset : circ}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dashoffset 1s ease-out' }}
      />
      {/* Label */}
      <text
        x="50%" y="44%"
        textAnchor="middle" dominantBaseline="middle"
        fontSize={size * 0.22} fontWeight="900" fill={color}
      >
        {score.toFixed(1)}
      </text>
      <text
        x="50%" y="66%"
        textAnchor="middle" dominantBaseline="middle"
        fontSize={size * 0.1} fontWeight="700" fill="#9ca3af"
      >
        / 10
      </text>
    </svg>
  );
};

// ─── Score bar ───────────────────────────────────────────────────────────────

const ScoreBar: React.FC<{ label: string; value: number }> = ({ label, value }) => {
  const pct = (value / 10) * 100;
  const color = pct >= 75 ? 'bg-green-500' : pct >= 50 ? 'bg-amber-400' : 'bg-red-400';
  return (
    <div className="flex items-center gap-3">
      <span className="text-[10px] font-bold text-gray-500 w-28 shrink-0">{label}</span>
      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs font-black text-gray-700 w-8 text-right">{value}</span>
    </div>
  );
};

// ─── Skeleton loader ─────────────────────────────────────────────────────────

const Skeleton: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`animate-pulse bg-gray-100 rounded-2xl ${className}`} />
);

const AnalysisSkeleton: React.FC = () => (
  <div className="space-y-6 p-2">
    <div className="flex justify-center"><Skeleton className="w-28 h-28 rounded-full" /></div>
    <div className="space-y-3">
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-4 w-2/3" />
    </div>
    <div className="grid grid-cols-2 gap-3">
      {[0,1,2,3].map(i => <Skeleton key={i} className="h-20" />)}
    </div>
    <Skeleton className="h-12" />
  </div>
);

// ─── Impact chip ─────────────────────────────────────────────────────────────

const ImpactChip: React.FC<{ level: 1 | 2 | 3 }> = ({ level }) => {
  const config = {
    3: { label: '높음', cls: 'bg-red-100 text-red-700 border-red-200' },
    2: { label: '중간', cls: 'bg-amber-100 text-amber-700 border-amber-200' },
    1: { label: '낮음', cls: 'bg-gray-100 text-gray-600 border-gray-200' },
  }[level];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-black uppercase tracking-wide ${config.cls}`}>
      {level === 3 ? '🔥' : level === 2 ? '⚡' : '💡'} {config.label}
    </span>
  );
};

// ─── Tab types ───────────────────────────────────────────────────────────────

type Tab = 'breakdown' | 'swot' | 'tips';

// ─── Props ───────────────────────────────────────────────────────────────────

export interface YouTubeImportModalProps {
  onClose: () => void;
  /**
   * Called when the user clicks "이 영상 리믹스하기 →".
   * Receives the full analysis result and the user's selected optimisation tips.
   */
  onRemix: (analysis: YoutubeAnalysis, selectedTips: OptimizationTip[]) => void;
}

// ─── Main component ──────────────────────────────────────────────────────────

export const YouTubeImportModal: React.FC<YouTubeImportModalProps> = ({ onClose, onRemix }) => {
  const [url, setUrl] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<YoutubeAnalysis | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('breakdown');
  const [selectedTips, setSelectedTips] = useState<Set<number>>(new Set());
  const [expandedTip, setExpandedTip] = useState<number | null>(null);
  const [markedChips, setMarkedChips] = useState<{ chars: Set<string>; bgs: Set<string> }>({
    chars: new Set(),
    bgs: new Set(),
  });
  const [scriptCopied, setScriptCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [copiedSceneIdx, setCopiedSceneIdx] = useState<number | null>(null);
  const [cacheEntry, setCacheEntry] = useState<CacheEntry | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input on open
  useEffect(() => { inputRef.current?.focus(); }, []);

  const validateUrl = (val: string): boolean => {
    const trimmed = val.trim();
    if (!trimmed) {
      setUrlError('YouTube URL을 입력해주세요.');
      return false;
    }
    const valid = /^https?:\/\/(www\.)?(youtube\.com\/(watch|shorts|embed|live)|youtu\.be\/)/.test(trimmed);
    if (!valid) {
      setUrlError('유효한 YouTube URL을 입력해주세요. (youtube.com 또는 youtu.be)');
      return false;
    }
    setUrlError(null);
    return true;
  };

  const handleAnalyze = async (forceRefresh = false) => {
    if (!validateUrl(url)) return;

    // Return cached result immediately unless the user explicitly forces a refresh
    if (!forceRefresh) {
      const hit = getCachedAnalysis(url);
      if (hit) {
        setAnalysis(hit.analysis);
        setCacheEntry(hit);
        setActiveTab('breakdown');
        setSelectedTips(new Set());
        setMarkedChips({ chars: new Set(), bgs: new Set() });
        setApiError(null);
        return;
      }
    }

    setLoading(true);
    setApiError(null);
    setAnalysis(null);
    setCacheEntry(null);
    setSelectedTips(new Set());
    setMarkedChips({ chars: new Set(), bgs: new Set() });
    try {
      const result = await analyzeYoutubeVideo(url.trim());
      setCachedAnalysis(url, result);
      const newEntry = getCachedAnalysis(url);
      setAnalysis(result);
      setCacheEntry(newEntry);
      setActiveTab('breakdown');
    } catch (e: any) {
      setApiError(e?.message || '분석 중 오류가 발생했습니다. 다시 시도해주세요.');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleAnalyze(false);
  };

  const toggleTip = (idx: number) =>
    setSelectedTips(prev => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });

  const toggleChar = (name: string) =>
    setMarkedChips(prev => {
      const chars = new Set(prev.chars);
      chars.has(name) ? chars.delete(name) : chars.add(name);
      return { ...prev, chars };
    });

  const toggleBg = (bg: string) =>
    setMarkedChips(prev => {
      const bgs = new Set(prev.bgs);
      bgs.has(bg) ? bgs.delete(bg) : bgs.add(bg);
      return { ...prev, bgs };
    });

  const handleRemix = () => {
    if (!analysis) return;
    const tips = [...selectedTips].map(i => analysis.viewOptimizationTips[i]).filter(Boolean);
    onRemix(analysis, tips);
    onClose();
  };

  const handleCopySceneLine = (scene: YoutubeScene, idx: number) => {
    if (!scene.scriptText) return;
    navigator.clipboard.writeText(scene.scriptText).then(() => {
      setCopiedSceneIdx(idx);
      setTimeout(() => setCopiedSceneIdx(prev => (prev === idx ? null : prev)), 2000);
    });
  };

  const handleCopyScript = (a: YoutubeAnalysis) => {
    const text = a.scenes
      .map((s: YoutubeScene) => s.scriptText)
      .filter(Boolean)
      .join('\n\n');

    const onSuccess = () => {
      setCopyError(null);
      setScriptCopied(true);
      setTimeout(() => setScriptCopied(false), 2000);
    };

    const onFailure = () => {
      // Fallback: execCommand for older environments / blocked clipboard API
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        if (ok) { onSuccess(); return; }
      } catch {
        // execCommand also failed
      }
      setCopyError('복사 실패 — 수동으로 선택하세요');
      setTimeout(() => setCopyError(null), 3000);
    };

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(onSuccess).catch(onFailure);
    } else {
      onFailure();
    }
  };

  // ── Render helpers ──────────────────────────────────────────────────────

  const renderBreakdownTab = (a: YoutubeAnalysis) => (
    <div className="space-y-8">
      {/* Scene breakdown */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 flex items-center gap-2">
            <Icons.Film size={12} /> 씬 분석 ({a.scenes.length}개 씬)
          </h3>
          <div className="flex items-center gap-2">
            {copyError && (
              <span className="text-[10px] font-bold text-red-500">{copyError}</span>
            )}
            <button
              onClick={() => handleCopyScript(a)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-black transition-all border ${
                copyError
                  ? 'bg-red-50 text-red-600 border-red-200'
                  : scriptCopied
                  ? 'bg-green-50 text-green-600 border-green-200'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
              }`}
            >
              {copyError ? (
                <><Icons.X size={11} /> 복사 실패</>
              ) : scriptCopied ? (
                <><Icons.Check size={11} /> 복사됨 ✓</>
              ) : (
                <><Icons.Copy size={11} /> 스크립트 복사</>
              )}
            </button>
          </div>
        </div>
        <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
          {a.scenes.map((scene: YoutubeScene, i: number) => (
            <div key={i} className="bg-gray-50 rounded-2xl p-4 flex gap-4">
              <div className="shrink-0 text-center">
                <span className="inline-flex items-center justify-center w-7 h-7 rounded-xl bg-brand-dark text-white text-xs font-black">
                  {i + 1}
                </span>
                <p className="text-[9px] text-gray-400 mt-1 font-bold">
                  {Math.floor(scene.startSec)}s–{Math.floor(scene.endSec)}s
                </p>
              </div>
              <div className="flex-1 min-w-0">
                {scene.scriptText && (
                  <p className="text-xs font-medium text-gray-800 leading-relaxed mb-1.5 line-clamp-2">
                    "{scene.scriptText}"
                  </p>
                )}
                <p className="text-[10px] text-gray-500 italic leading-relaxed line-clamp-2">
                  {scene.visualDescription}
                </p>
              </div>
              {scene.scriptText && (
                <button
                  onClick={() => handleCopySceneLine(scene, i)}
                  title="스크립트 복사"
                  className={`shrink-0 self-start mt-0.5 inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-black transition-all border ${
                    copiedSceneIdx === i
                      ? 'bg-green-50 text-green-600 border-green-200'
                      : 'bg-white text-gray-400 border-gray-200 hover:text-gray-600 hover:border-gray-400'
                  }`}
                >
                  {copiedSceneIdx === i ? (
                    <><Icons.Check size={10} /> 복사됨 ✓</>
                  ) : (
                    <Icons.Copy size={10} />
                  )}
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Characters */}
      {a.characters.length > 0 && (
        <section>
          <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 mb-3 flex items-center gap-2">
            <Icons.User size={12} /> 등장인물
            <span className="text-gray-300 normal-case font-medium">(클릭하면 리믹스 대상으로 표시)</span>
          </h3>
          <div className="flex flex-wrap gap-2">
            {a.characters.map((c: DetectedCharacter, i: number) => (
              <button
                key={i}
                onClick={() => toggleChar(c.name)}
                title={c.description}
                className={`inline-flex items-center gap-2 px-3 py-2 rounded-2xl border-2 text-xs font-bold transition-all ${
                  markedChips.chars.has(c.name)
                    ? 'bg-brand-dark text-white border-brand-dark shadow-md scale-105'
                    : 'bg-white text-gray-700 border-gray-100 hover:border-gray-300'
                }`}
              >
                <Icons.User size={11} />
                {c.name}
                <span className="text-[9px] opacity-60">
                  {Math.round(c.screenTimeFraction * 100)}%
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Backgrounds */}
      {a.backgrounds.length > 0 && (
        <section>
          <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 mb-3 flex items-center gap-2">
            <Icons.ImageIcon size={12} /> 배경 / 환경
            <span className="text-gray-300 normal-case font-medium">(클릭하면 리믹스 대상으로 표시)</span>
          </h3>
          <div className="flex flex-wrap gap-2">
            {a.backgrounds.map((bg: string, i: number) => (
              <button
                key={i}
                onClick={() => toggleBg(bg)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border-2 text-[11px] font-bold transition-all ${
                  markedChips.bgs.has(bg)
                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-md'
                    : 'bg-white text-gray-600 border-gray-100 hover:border-gray-300'
                }`}
              >
                <Icons.Layers size={10} />
                {bg}
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );

  const renderSwotTab = (a: YoutubeAnalysis) => (
    <div className="space-y-6">
      {/* Score bars */}
      <section className="bg-gray-50 rounded-3xl p-5 space-y-3">
        <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 mb-4">참여도 점수</h3>
        <ScoreBar label="후크 강도" value={a.scores.hookStrength} />
        <ScoreBar label="페이싱 리듬" value={a.scores.pacing} />
        <ScoreBar label="CTA 효과" value={a.scores.ctaEffectiveness} />
        <ScoreBar label="썸네일 매력" value={a.scores.thumbnailAppeal} />
        <ScoreBar label="시청 지속력" value={a.scores.retentionCurve} />
      </section>

      {/* Side-by-side strengths / weaknesses */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Strengths */}
        <section>
          <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-green-600 mb-3 flex items-center gap-1.5">
            <span className="text-base">✅</span> 강점
          </h3>
          <div className="space-y-2">
            {a.strengths.map((s: AnalysisFinding, i: number) => (
              <div key={i} className="bg-green-50 border border-green-100 rounded-2xl p-3.5">
                <p className="text-xs font-black text-green-800 mb-1">{s.label}</p>
                <p className="text-[11px] text-green-700 leading-relaxed">{s.rationale}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Weaknesses */}
        <section>
          <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-red-500 mb-3 flex items-center gap-1.5">
            <span className="text-base">⚠️</span> 약점
          </h3>
          <div className="space-y-2">
            {a.weaknesses.map((w: AnalysisFinding, i: number) => (
              <div key={i} className="bg-red-50 border border-red-100 rounded-2xl p-3.5">
                <p className="text-xs font-black text-red-800 mb-1">{w.label}</p>
                <p className="text-[11px] text-red-700 leading-relaxed">{w.rationale}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );

  const renderTipsTab = (a: YoutubeAnalysis) => (
    <div className="space-y-3">
      <p className="text-[11px] text-gray-400 italic mb-4">
        팁을 선택하면 리믹스 시 자동으로 반영됩니다. 영향도 높은 순으로 정렬됩니다.
      </p>
      {a.viewOptimizationTips.map((tip: OptimizationTip, i: number) => {
        const selected = selectedTips.has(i);
        const expanded = expandedTip === i;
        return (
          <div
            key={i}
            className={`rounded-3xl border-2 transition-all overflow-hidden ${
              selected
                ? 'border-brand-dark bg-brand-dark/5 shadow-md'
                : 'border-gray-100 bg-white hover:border-gray-200'
            }`}
          >
            <div className="flex items-start gap-3 p-4">
              {/* Order badge */}
              <span className="shrink-0 w-6 h-6 rounded-lg bg-gray-100 text-gray-600 text-[11px] font-black flex items-center justify-center mt-0.5">
                {i + 1}
              </span>

              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <p className={`text-sm font-black leading-snug ${selected ? 'text-brand-dark' : 'text-gray-800'}`}>
                    {tip.tip}
                  </p>
                  <ImpactChip level={tip.impactLevel} />
                </div>

                {/* Expandable reasoning */}
                {expanded && (
                  <p className="text-[11px] text-gray-500 leading-relaxed mt-2 mb-2">
                    {tip.reasoning}
                  </p>
                )}

                <div className="flex items-center gap-2 mt-2">
                  <button
                    onClick={() => setExpandedTip(expanded ? null : i)}
                    className="text-[10px] text-gray-400 font-bold hover:text-gray-700 transition-colors flex items-center gap-1"
                  >
                    {expanded ? <Icons.ChevronDown size={11} className="rotate-180" /> : <Icons.ChevronDown size={11} />}
                    {expanded ? '접기' : '이유 보기'}
                  </button>

                  <button
                    onClick={() => toggleTip(i)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black transition-all border ${
                      selected
                        ? 'bg-brand-dark text-white border-brand-dark'
                        : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                    }`}
                  >
                    {selected ? <Icons.Check size={10} /> : <Icons.Plus size={10} />}
                    {selected ? '리믹스에 포함됨' : '리믹스에 포함'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );

  // ── Layout ──────────────────────────────────────────────────────────────

  const tabs: { id: Tab; label: string }[] = [
    { id: 'breakdown', label: '영상 분석' },
    { id: 'swot', label: '장단점 비교' },
    { id: 'tips', label: '조회수 극대화 팁' },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Modal */}
      <div
        className="relative w-full sm:max-w-2xl max-h-[96dvh] sm:max-h-[90vh] flex flex-col bg-white rounded-t-[2.5rem] sm:rounded-[2.5rem] shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 shrink-0 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-2xl bg-red-500 flex items-center justify-center shrink-0">
              <Icons.Play size={16} className="text-white fill-white" />
            </div>
            <div>
              <h2 className="text-base font-black text-gray-900 leading-tight">YouTube 분석 & 리믹스</h2>
              <p className="text-[10px] text-gray-400 font-medium">URL을 붙여넣고 AI 분석을 시작하세요</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors"
          >
            <Icons.X size={15} className="text-gray-600" />
          </button>
        </div>

        {/* URL input */}
        <div className="px-6 py-4 shrink-0 border-b border-gray-50">
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <input
                ref={inputRef}
                type="url"
                value={url}
                onChange={e => { setUrl(e.target.value); setUrlError(null); setApiError(null); }}
                onKeyDown={handleKeyDown}
                placeholder="https://youtube.com/watch?v=... 또는 https://youtu.be/..."
                className={`w-full pl-4 pr-4 py-3 rounded-2xl text-sm font-medium outline-none border-2 transition-colors ${
                  urlError
                    ? 'border-red-300 bg-red-50 focus:border-red-400'
                    : 'border-gray-100 bg-gray-50 focus:border-brand-cyan'
                }`}
                disabled={loading}
              />
              {urlError && (
                <p className="absolute left-0 -bottom-5 text-[10px] text-red-500 font-bold">{urlError}</p>
              )}
            </div>
            <button
              onClick={handleAnalyze}
              disabled={loading || !url.trim()}
              className="px-5 py-3 rounded-2xl bg-brand-dark text-white text-sm font-black disabled:opacity-50 disabled:cursor-not-allowed hover:brightness-110 transition-all flex items-center gap-2 shrink-0"
            >
              {loading ? (
                <>
                  <Icons.Loader2 size={14} className="animate-spin" />
                  분석 중...
                </>
              ) : (
                <>
                  <Icons.Search size={14} />
                  분석 시작
                </>
              )}
            </button>
          </div>
          {urlError && <div className="h-5" />}
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">
          {/* Loading skeleton */}
          {loading && (
            <div className="px-6 py-6">
              <p className="text-center text-sm font-bold text-gray-500 mb-6 flex items-center justify-center gap-2">
                <Icons.Loader2 size={16} className="animate-spin text-brand-cyan" />
                Gemini AI가 영상을 분석하고 있습니다…
              </p>
              <AnalysisSkeleton />
            </div>
          )}

          {/* API error */}
          {!loading && apiError && (
            <div className="px-6 py-8 text-center">
              <div className="w-14 h-14 rounded-3xl bg-red-100 flex items-center justify-center mx-auto mb-4">
                <Icons.AlertCircle size={24} className="text-red-500" />
              </div>
              <p className="text-sm font-bold text-gray-800 mb-2">분석에 실패했습니다</p>
              <p className="text-xs text-gray-500 mb-6 max-w-xs mx-auto leading-relaxed">{apiError}</p>
              <button
                onClick={handleAnalyze}
                className="px-6 py-2.5 rounded-full bg-brand-dark text-white text-xs font-black hover:brightness-110 transition-all flex items-center gap-2 mx-auto"
              >
                <Icons.RotateCcw size={13} /> 다시 시도
              </button>
            </div>
          )}

          {/* Analysis results */}
          {!loading && analysis && (
            <div className="px-6 py-5 space-y-5">
              {/* Overall score + meta */}
              <div className="flex items-center gap-5 bg-gradient-to-br from-gray-50 to-white rounded-3xl p-5 border border-gray-100">
                <CircularGauge score={analysis.overallScore} size={100} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">종합 점수</p>
                    {cacheEntry && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-600 text-[9px] font-black shrink-0">
                        <Icons.Clock size={8} />
                        캐시됨 · {formatCacheAge(cacheEntry.cachedAt)}
                      </span>
                    )}
                  </div>
                  <h3 className="text-base font-black text-gray-900 leading-tight line-clamp-2 mb-1.5">
                    {analysis.detectedTitle || '(제목 감지 중)'}
                  </h3>
                  <div className="flex flex-wrap gap-2 items-center">
                    {analysis.format && (
                      <span className="px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 text-[10px] font-black">
                        {analysis.format}
                      </span>
                    )}
                    {analysis.detectedDurationSec > 0 && (
                      <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-[10px] font-bold flex items-center gap-1">
                        <Icons.Clock size={9} />
                        {Math.floor(analysis.detectedDurationSec / 60)}분
                        {analysis.detectedDurationSec % 60 > 0 ? ` ${Math.floor(analysis.detectedDurationSec % 60)}초` : ''}
                      </span>
                    )}
                    <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-[10px] font-bold">
                      씬 {analysis.scenes.length}개
                    </span>
                    {cacheEntry && (
                      <button
                        onClick={() => handleAnalyze(true)}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-gray-200 bg-white text-gray-500 text-[9px] font-black hover:border-gray-400 hover:text-gray-700 transition-all"
                      >
                        <Icons.RotateCcw size={8} />
                        새로 분석
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Tabs */}
              <div className="flex gap-1 bg-gray-50 rounded-2xl p-1">
                {tabs.map(t => (
                  <button
                    key={t.id}
                    onClick={() => setActiveTab(t.id)}
                    className={`flex-1 px-2 py-2 rounded-xl text-[11px] font-black transition-all ${
                      activeTab === t.id
                        ? 'bg-white text-brand-dark shadow-sm'
                        : 'text-gray-400 hover:text-gray-600'
                    }`}
                  >
                    {t.label}
                    {t.id === 'tips' && selectedTips.size > 0 && (
                      <span className="ml-1.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-brand-dark text-white text-[9px] font-black">
                        {selectedTips.size}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              <div>
                {activeTab === 'breakdown' && renderBreakdownTab(analysis)}
                {activeTab === 'swot' && renderSwotTab(analysis)}
                {activeTab === 'tips' && renderTipsTab(analysis)}
              </div>
            </div>
          )}
        </div>

        {/* Footer CTA */}
        {analysis && !loading && (
          <div className="px-6 py-4 border-t border-gray-100 shrink-0 bg-white">
            <button
              onClick={handleRemix}
              className="w-full py-4 rounded-3xl bg-brand-dark text-white font-black text-sm flex items-center justify-center gap-2 hover:brightness-110 transition-all shadow-lg shadow-brand-dark/20 active:scale-[0.98]"
            >
              <Icons.Wand2 size={16} />
              이 영상 리믹스하기
              <Icons.ArrowRight size={16} />
            </button>
            {selectedTips.size > 0 && (
              <p className="text-center text-[10px] text-gray-400 mt-2 font-medium">
                선택한 팁 {selectedTips.size}개가 리믹스에 반영됩니다
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const CACHE_KEY = 'yt_analysis_cache_v1';

function readCache(): CacheEntry[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return [];
    const parsed: CacheEntry[] = JSON.parse(raw);
    const now = Date.now();
    return parsed.filter(e => now - e.cachedAt < CACHE_TTL_MS);
  } catch {
    return [];
  }
}

function getCachedAnalysis(url: string): CacheEntry | null {
  const entries = readCache();
  return entries.find(e => e.url === url.trim()) ?? null;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

const CACHE_MAX_ENTRIES = 5;

function setCachedAnalysis(url: string, analysis: YoutubeAnalysis): void {
  try {
    let entries = readCache().filter(e => e.url !== url.trim());
    entries = [{ url: url.trim(), analysis, cachedAt: Date.now() }, ...entries].slice(0, CACHE_MAX_ENTRIES);
    localStorage.setItem(CACHE_KEY, JSON.stringify(entries));
  } catch {
    // Storage full or unavailable — silently skip
  }
}

interface CacheEntry {
  url: string;
  analysis: YoutubeAnalysis;
  cachedAt: number; // Unix ms
}

function formatCacheAge(cachedAt: number): string {
  const diffMs = Date.now() - cachedAt;
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHr = Math.floor(diffMs / 3_600_000);
  if (diffMin < 1) return '방금 전';
  if (diffHr < 1) return `${diffMin}분 전`;
  if (diffHr < 24) return `${diffHr}시간 전`;
  return `${Math.floor(diffHr / 24)}일 전`;
}
