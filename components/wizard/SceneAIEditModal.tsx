import React, { useState } from 'react';
import { Icons } from '../Icons';
import { refineSceneWithInstruction, type SceneRefineResult, type SceneRefineContext } from '../../services/geminiService';
import type { Scene } from '../../types';

// ── Diff row ────────────────────────────────────────────────────────────────

interface DiffRowProps {
  label: string;
  before: string;
  after: string;
}

const DiffRow: React.FC<DiffRowProps> = ({ label, before, after }) => {
  const changed = before !== after;
  return (
    <div className="mb-4">
      <div className={`text-[10px] font-black uppercase tracking-widest mb-1 ${changed ? 'text-brand-cyan' : 'text-gray-400'}`}>
        {label} {changed && <span className="ml-1 text-brand-cyan">✦ 변경됨</span>}
      </div>
      {changed ? (
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 rounded-2xl bg-red-50 border border-red-200 text-xs text-red-700 leading-relaxed whitespace-pre-wrap">
            <span className="block text-[9px] font-black uppercase tracking-widest text-red-400 mb-1">이전</span>
            {before || <span className="italic text-red-300">비어 있음</span>}
          </div>
          <div className="p-3 rounded-2xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 leading-relaxed whitespace-pre-wrap">
            <span className="block text-[9px] font-black uppercase tracking-widest text-emerald-500 mb-1">이후</span>
            {after || <span className="italic text-emerald-300">비어 있음</span>}
          </div>
        </div>
      ) : (
        <div className="p-3 rounded-2xl bg-gray-50 border border-gray-100 text-xs text-gray-500 leading-relaxed line-clamp-2">
          {before || <span className="italic text-gray-300">비어 있음</span>}
        </div>
      )}
    </div>
  );
};

// ── Main component ───────────────────────────────────────────────────────────

export interface SceneAIEditModalProps {
  scene: Partial<Scene>;
  sceneIndex: number;
  context?: SceneRefineContext;
  onApply: (result: SceneRefineResult) => void;
  onClose: () => void;
}

export const SceneAIEditModal: React.FC<SceneAIEditModalProps> = ({
  scene,
  sceneIndex,
  context = {},
  onApply,
  onClose,
}) => {
  const [instruction, setInstruction] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SceneRefineResult | null>(null);

  const handleRefine = async () => {
    if (!instruction.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const r = await refineSceneWithInstruction(scene, instruction.trim(), context);
      setResult(r);
    } catch (e: any) {
      setError(e?.message || '알 수 없는 오류');
    } finally {
      setLoading(false);
    }
  };

  const handleApply = () => {
    if (result) {
      onApply(result);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-8 pt-8 pb-4 border-b border-gray-100">
          <div>
            <h3 className="text-lg font-black text-brand-dark flex items-center gap-2">
              <Icons.Sparkles size={18} className="text-brand-cyan" />
              AI 씬 수정 — Scene {sceneIndex + 1}
            </h3>
            <p className="text-xs text-gray-400 font-medium mt-0.5">자연어로 지시하면 AI가 씬을 즉시 수정합니다</p>
          </div>
          <button onClick={onClose} className="text-gray-300 hover:text-gray-700 transition-colors p-2 rounded-full hover:bg-gray-100">
            <Icons.X size={20} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-8 py-6">
          {/* Instruction input */}
          <div className="mb-6">
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-2 block">편집 지시</label>
            <div className="flex gap-3">
              <textarea
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleRefine(); }}
                placeholder="예: 더 극적인 분위기로 바꿔줘 / 카메라를 dolly-in으로 변경 / 야외 장면으로 수정"
                rows={3}
                className="flex-1 p-4 bg-gray-50 rounded-2xl border-2 border-gray-200 text-sm font-medium outline-none resize-none focus:border-brand-cyan transition-colors"
                disabled={loading}
              />
              <button
                onClick={handleRefine}
                disabled={loading || !instruction.trim()}
                className="px-6 py-4 bg-brand-cyan text-black rounded-2xl font-black text-sm hover:scale-105 active:scale-95 transition-all shadow-lg disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 self-start"
              >
                {loading ? (
                  <Icons.Loader2 size={18} className="animate-spin" />
                ) : (
                  <Icons.Wand2 size={18} />
                )}
              </button>
            </div>
            {loading && (
              <p className="text-[11px] text-brand-cyan font-bold mt-2 flex items-center gap-1.5 animate-pulse">
                <Icons.Loader2 size={12} className="animate-spin" /> AI가 씬을 수정하고 있습니다…
              </p>
            )}
            {error && (
              <p className="text-[11px] text-red-500 font-bold mt-2 flex items-center gap-1.5">
                <Icons.AlertCircle size={12} /> {error}
              </p>
            )}
          </div>

          {/* Diff view */}
          {result && (
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-4">
                <div className="flex-1 h-px bg-gray-100" />
                <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">변경 전후 비교</span>
                <div className="flex-1 h-px bg-gray-100" />
              </div>
              <DiffRow
                label="비주얼 프롬프트"
                before={scene.visual_prompt || ''}
                after={result.visual_prompt}
              />
              <DiffRow
                label="스크립트 세그먼트"
                before={scene.script_segment || ''}
                after={result.script_segment}
              />
              {(result.shotType || scene.shotType) && result.shotType !== scene.shotType && (
                <DiffRow
                  label="샷 타입"
                  before={scene.shotType || ''}
                  after={result.shotType || ''}
                />
              )}
              {(result.cameraMovement || scene.cameraMovement) && result.cameraMovement !== scene.cameraMovement && (
                <DiffRow
                  label="카메라 무브먼트"
                  before={scene.cameraMovement || ''}
                  after={result.cameraMovement || ''}
                />
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {result && (
          <div className="flex items-center gap-3 px-8 py-6 border-t border-gray-100">
            <button
              onClick={onClose}
              className="flex-1 py-3 rounded-full border-2 border-gray-200 text-sm font-black text-gray-500 hover:bg-gray-50 transition-colors"
            >
              취소 (원본 유지)
            </button>
            <button
              onClick={handleApply}
              className="flex-1 py-3 rounded-full bg-brand-dark text-white text-sm font-black hover:bg-brand-dark/90 transition-colors shadow-lg"
            >
              ✓ 변경 사항 적용
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
