import React, { useRef, useState, useCallback, useEffect } from 'react';
import { Icons } from '../Icons';
import { TransitionType } from '../../types';

interface TimelineScene {
  id?: string;
  scene_number?: number;
  script_segment?: string;
  image_path?: string;
  durationSec?: number;
  audio_duration?: number;
  transitionTo?: TransitionType;
  hidden?: boolean;
}

interface TimelineEditorProps {
  scenes: TimelineScene[];
  activeIdx: number;
  TRANSITION_OPTIONS: { value: TransitionType; label: string }[];
  onSelectScene: (idx: number) => void;
  onReorder: (fromIdx: number, toIdx: number) => void;
  onResizeDuration: (idx: number, newDuration: number) => void;
  onSetTransition: (idx: number, t: TransitionType) => void;
  onToggleHidden: (idx: number) => void;
}

const MIN_DURATION = 1;
const MAX_DURATION = 60;
const PX_PER_SEC = 40;
const MIN_CARD_PX = 60;

export const TimelineEditor: React.FC<TimelineEditorProps> = ({
  scenes,
  activeIdx,
  TRANSITION_OPTIONS,
  onSelectScene,
  onReorder,
  onResizeDuration,
  onSetTransition,
  onToggleHidden,
}) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [resizingIdx, setResizingIdx] = useState<number | null>(null);
  const [transitionPopoverIdx, setTransitionPopoverIdx] = useState<number | null>(null);
  const resizeStartX = useRef(0);
  const resizeStartDur = useRef(0);

  const getDuration = (s: TimelineScene, fallback: number) =>
    s.durationSec || s.audio_duration || fallback;

  const fallback = scenes.length > 0 ? 6 : 6;
  const totalDur = scenes.reduce((acc, s) => acc + getDuration(s, fallback), 0) || 1;

  // ── Drag-to-reorder ──────────────────────────────────────────────────────
  const handleDragStart = (e: React.DragEvent, idx: number) => {
    e.dataTransfer.effectAllowed = 'move';
    setDragIdx(idx);
  };

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIdx(idx);
  };

  const handleDrop = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragIdx !== null && dragIdx !== idx) {
      onReorder(dragIdx, idx);
    }
    setDragIdx(null);
    setDragOverIdx(null);
  };

  const handleDragEnd = () => {
    setDragIdx(null);
    setDragOverIdx(null);
  };

  // ── Resize handle ────────────────────────────────────────────────────────
  const handleResizeMouseDown = (e: React.MouseEvent, idx: number) => {
    e.stopPropagation();
    e.preventDefault();
    resizeStartX.current = e.clientX;
    resizeStartDur.current = getDuration(scenes[idx], fallback);
    setResizingIdx(idx);
  };

  useEffect(() => {
    if (resizingIdx === null) return;

    const onMove = (e: MouseEvent) => {
      const dx = e.clientX - resizeStartX.current;
      const deltaSec = dx / PX_PER_SEC;
      const raw = resizeStartDur.current + deltaSec;
      const audioLock = scenes[resizingIdx]?.audio_duration;
      const minDur = audioLock ? audioLock : MIN_DURATION;
      const snapped = Math.round(raw / 0.5) * 0.5;
      const clamped = Math.max(minDur, Math.min(MAX_DURATION, snapped));
      onResizeDuration(resizingIdx, clamped);
    };

    const onUp = () => setResizingIdx(null);

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [resizingIdx, scenes, onResizeDuration]);

  // ── Close transition popover on outside click ────────────────────────────
  useEffect(() => {
    if (transitionPopoverIdx === null) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-transition-popover]')) {
        setTransitionPopoverIdx(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [transitionPopoverIdx]);

  if (scenes.length === 0) return null;

  return (
    <div className="mt-6 rounded-3xl border-2 border-gray-100 bg-gray-50 p-4 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <Icons.Layers size={14} className="text-gray-400" />
        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">
          Timeline Editor
        </span>
        <span className="text-[10px] text-gray-400 ml-auto">
          총 {totalDur.toFixed(1)}초 · {scenes.filter(s => !s.hidden).length}/{scenes.length}개 활성
        </span>
      </div>

      {/* Track */}
      <div
        ref={trackRef}
        className="overflow-x-auto pb-2 hide-scrollbar"
        style={{ cursor: resizingIdx !== null ? 'ew-resize' : 'default' }}
      >
        <div className="flex items-stretch gap-0 min-w-max" style={{ height: 84 }}>
          {scenes.map((scene, idx) => {
            const dur = getDuration(scene, fallback);
            const cardPx = Math.max(MIN_CARD_PX, dur * PX_PER_SEC);
            const isActive = idx === activeIdx;
            const isDragging = dragIdx === idx;
            const isDragOver = dragOverIdx === idx && dragIdx !== idx;
            const isHidden = !!scene.hidden;
            const hasAudioLock = !!scene.audio_duration;
            const showTransitionBtn = idx < scenes.length - 1;

            return (
              <div key={scene.id || idx} className="flex items-stretch shrink-0">
                {/* Scene card */}
                <div
                  draggable
                  onDragStart={(e) => handleDragStart(e, idx)}
                  onDragOver={(e) => handleDragOver(e, idx)}
                  onDrop={(e) => handleDrop(e, idx)}
                  onDragEnd={handleDragEnd}
                  onClick={() => onSelectScene(idx)}
                  className={`
                    relative flex flex-col rounded-2xl border-2 overflow-hidden cursor-pointer select-none
                    transition-all duration-200 shrink-0
                    ${isActive
                      ? 'border-brand-cyan shadow-lg shadow-brand-cyan/20'
                      : 'border-gray-200 hover:border-gray-300'}
                    ${isDragging ? 'opacity-40 scale-95' : ''}
                    ${isDragOver ? 'border-brand-cyan/60 scale-[1.02]' : ''}
                    ${isHidden ? 'opacity-40' : ''}
                  `}
                  style={{ width: cardPx, minWidth: MIN_CARD_PX }}
                >
                  {/* Thumbnail */}
                  <div className="relative flex-1 bg-gray-900 overflow-hidden" style={{ height: 48 }}>
                    {scene.image_path ? (
                      <img
                        src={scene.image_path}
                        className="w-full h-full object-cover"
                        alt={`Scene ${idx + 1}`}
                        draggable={false}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Icons.Video size={14} className="text-white/20" />
                      </div>
                    )}
                    {/* Scene number badge */}
                    <div className="absolute top-1 left-1 bg-black/60 text-white text-[9px] font-black px-1.5 py-0.5 rounded-full leading-none">
                      {idx + 1}
                    </div>
                    {/* Hidden overlay */}
                    {isHidden && (
                      <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                        <Icons.EyeOff size={16} className="text-white/70" />
                      </div>
                    )}
                  </div>

                  {/* Bottom bar */}
                  <div className="flex items-center justify-between px-1.5 py-1 bg-white gap-1" style={{ height: 28 }}>
                    <span className="text-[9px] font-bold text-gray-500 shrink-0">
                      {dur.toFixed(1)}s
                    </span>
                    <div className="flex items-center gap-0.5 shrink-0">
                      {/* Hide toggle */}
                      <button
                        onClick={(e) => { e.stopPropagation(); onToggleHidden(idx); }}
                        className={`w-5 h-5 rounded flex items-center justify-center transition-colors ${isHidden ? 'bg-gray-200 text-gray-500' : 'hover:bg-gray-100 text-gray-400'}`}
                        title={isHidden ? '씬 활성화' : '씬 숨기기'}
                      >
                        {isHidden
                          ? <Icons.EyeOff size={10} />
                          : <Icons.Eye size={10} />}
                      </button>
                      {/* Audio lock indicator */}
                      {hasAudioLock && (
                        <span
                          className="w-5 h-5 rounded flex items-center justify-center text-amber-400"
                          title="오디오 길이에 고정됨"
                        >
                          <Icons.Lock size={10} />
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Resize handle */}
                  <div
                    onMouseDown={(e) => handleResizeMouseDown(e, idx)}
                    onClick={(e) => e.stopPropagation()}
                    className={`absolute right-0 top-0 bottom-0 w-3 flex items-center justify-center cursor-ew-resize z-10 group/resize ${hasAudioLock ? 'opacity-30 cursor-not-allowed' : ''}`}
                    title={hasAudioLock ? '오디오가 있어 길이가 고정됩니다' : '드래그해 길이 조정'}
                  >
                    <div className="w-1 h-8 bg-gray-300 rounded-full group-hover/resize:bg-brand-cyan transition-colors" />
                  </div>
                </div>

                {/* Transition connector */}
                {showTransitionBtn && (
                  <div className="relative flex items-center justify-center shrink-0" style={{ width: 28 }} data-transition-popover>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setTransitionPopoverIdx(transitionPopoverIdx === idx ? null : idx);
                      }}
                      className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all text-[9px] font-black z-10
                        ${scene.transitionTo && scene.transitionTo !== 'none'
                          ? 'bg-brand-cyan border-brand-cyan text-black'
                          : 'bg-white border-gray-200 text-gray-400 hover:border-gray-400'}`}
                      title="트랜지션 선택"
                    >
                      <Icons.Sparkles size={10} />
                    </button>

                    {/* Connecting line */}
                    <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-0.5 bg-gray-200 -z-0" />

                    {/* Transition popover */}
                    {transitionPopoverIdx === idx && (
                      <div
                        className="absolute top-full mt-2 left-1/2 -translate-x-1/2 bg-white border-2 border-gray-100 rounded-2xl shadow-2xl p-2 z-50 min-w-[160px]"
                        data-transition-popover
                        onClick={(e) => e.stopPropagation()}
                      >
                        <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 px-2 pb-1">
                          트랜지션
                        </p>
                        <div className="grid grid-cols-2 gap-1 max-h-52 overflow-y-auto">
                          {TRANSITION_OPTIONS.map((opt) => (
                            <button
                              key={opt.value}
                              onClick={() => {
                                onSetTransition(idx, opt.value);
                                setTransitionPopoverIdx(null);
                              }}
                              className={`px-2 py-1.5 rounded-xl text-[10px] font-bold text-left transition-all
                                ${scene.transitionTo === opt.value
                                  ? 'bg-brand-cyan text-black'
                                  : 'hover:bg-gray-50 text-gray-700'}`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-2 flex-wrap">
        <span className="text-[9px] text-gray-400 flex items-center gap-1">
          <Icons.Move size={10} /> 드래그로 순서 변경
        </span>
        <span className="text-[9px] text-gray-400 flex items-center gap-1">
          <Icons.ArrowLeftRight size={10} /> 오른쪽 끝 드래그로 길이 조정
        </span>
        <span className="text-[9px] text-gray-400 flex items-center gap-1">
          <Icons.Layout size={10} /> 씬 사이 버튼으로 트랜지션 선택
        </span>
        <span className="text-[9px] text-gray-400 flex items-center gap-1">
          <Icons.Eye size={10} /> 눈 아이콘으로 씬 숨기기/표시
        </span>
      </div>
    </div>
  );
};
