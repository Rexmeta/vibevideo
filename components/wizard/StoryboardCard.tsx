import React, { useState } from 'react';
import { Scene } from '../../types';
import { Icons } from '../Icons';

// ── Icon mappings ────────────────────────────────────────────────────────────

const SHOT_TYPE_ICONS: Record<string, string> = {
  'wide': '🌅',
  'wide_shot': '🌅',
  'full_shot': '🧍',
  'medium': '👤',
  'medium_shot': '👤',
  'closeup': '🔍',
  'close_up': '🔍',
  'close-up': '🔍',
  'extreme_closeup': '👁️',
  'extreme_close_up': '👁️',
  'overhead': '🔽',
  'birds_eye': '🦅',
  'low_angle': '⬆️',
  'dutch_angle': '↗️',
  'pov': '👀',
  'two_shot': '👫',
};

const CAMERA_MOVEMENT_ICONS: Record<string, string> = {
  'static': '🔒',
  'pan': '↔️',
  'tilt': '↕️',
  'dolly': '🚶',
  'dolly_in': '🔎',
  'dolly_out': '🔍',
  'zoom': '🔭',
  'zoom_in': '🔎',
  'zoom_out': '🔍',
  'handheld': '🤝',
  'tracking': '🎯',
  'crane': '🏗️',
  'aerial': '✈️',
  'orbit': '🔄',
  'push_in': '➡️',
  'pull_out': '⬅️',
};

function getShotIcon(shotType?: string): string | null {
  if (!shotType) return null;
  const key = shotType.toLowerCase().replace(/[\s-]/g, '_');
  return SHOT_TYPE_ICONS[key] ?? null;
}

function getCameraIcon(movement?: string): string | null {
  if (!movement || movement === 'static') return null;
  const key = movement.toLowerCase().replace(/[\s-]/g, '_');
  return CAMERA_MOVEMENT_ICONS[key] ?? '🎬';
}

// ── Beat role badge colours ──────────────────────────────────────────────────

const BEAT_COLORS: Record<string, string> = {
  'hook': 'bg-rose-100 text-rose-700',
  'rising_action': 'bg-orange-100 text-orange-700',
  'climax': 'bg-red-100 text-red-700',
  'resolution': 'bg-green-100 text-green-700',
  'cta': 'bg-brand-cyan/20 text-teal-700',
  'intro': 'bg-violet-100 text-violet-700',
  'outro': 'bg-purple-100 text-purple-700',
  'transition': 'bg-gray-100 text-gray-600',
};

function beatColor(role?: string): string {
  if (!role) return 'bg-gray-100 text-gray-500';
  return BEAT_COLORS[role.toLowerCase()] ?? 'bg-purple-100 text-purple-700';
}

// ── Component ────────────────────────────────────────────────────────────────

export interface StoryboardCardProps {
  scene: Partial<Scene>;
  index: number;
  // drag-and-drop
  dragging: boolean;
  dragOver: boolean;
  onDragStart: (e: React.DragEvent, i: number) => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent, i: number) => void;
  onDrop: (e: React.DragEvent, i: number) => void;
  // inline edit
  onSave: (idx: number, updates: { script_segment?: string; visual_prompt?: string }) => void;
}

export const StoryboardCard: React.FC<StoryboardCardProps> = ({
  scene: s,
  index: i,
  dragging,
  dragOver,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onSave,
}) => {
  const [editing, setEditing] = useState(false);
  const [editScript, setEditScript] = useState('');
  const [editPrompt, setEditPrompt] = useState('');

  const shotIcon = getShotIcon(s.shotType);
  const camIcon = getCameraIcon(s.cameraMovement);

  const handleEditOpen = () => {
    setEditScript(s.script_segment ?? '');
    setEditPrompt(s.visual_prompt ?? '');
    setEditing(true);
  };

  const handleSave = () => {
    onSave(i, { script_segment: editScript, visual_prompt: editPrompt });
    setEditing(false);
  };

  const handleCancel = () => setEditing(false);

  const characters = (s.characters ?? []).filter(
    (c): c is string => typeof c === 'string' && c.trim().length > 0
  );

  return (
    <div
      draggable
      onDragStart={e => onDragStart(e, i)}
      onDragEnd={onDragEnd}
      onDragOver={e => onDragOver(e, i)}
      onDrop={e => onDrop(e, i)}
      className={`
        group relative rounded-3xl overflow-hidden border-2 bg-white shadow-sm
        transition-all duration-200 cursor-grab active:cursor-grabbing
        ${dragging ? 'opacity-40 scale-95' : ''}
        ${dragOver ? 'border-brand-cyan ring-2 ring-brand-cyan/30 scale-[1.02] shadow-xl' : 'border-gray-100 hover:border-gray-200 hover:shadow-md'}
      `}
    >
      {/* Thumbnail */}
      <div className="relative w-full aspect-video bg-gray-100 overflow-hidden">
        {s.image_path ? (
          <img
            src={s.image_path}
            alt={`Scene ${i + 1}`}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-100 to-gray-200">
            <Icons.ImageIcon size={32} className="text-gray-300" />
          </div>
        )}
        {/* Scene number overlay */}
        <span className="absolute top-2 left-2 bg-black/60 text-white text-[10px] font-black px-2.5 py-1 rounded-full">
          {i + 1}
        </span>
        {/* Beat role badge */}
        {s.beatRole && (
          <span className={`absolute top-2 right-2 text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${beatColor(s.beatRole)}`}>
            {s.beatRole}
          </span>
        )}
        {/* Drag handle hint */}
        <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-70 transition-opacity">
          <Icons.GripVertical size={16} className="text-white drop-shadow" />
        </div>
      </div>

      {/* Body */}
      <div className="p-4 flex flex-col gap-2">
        {/* Shot type + camera movement icons */}
        <div className="flex items-center gap-2 flex-wrap min-h-[20px]">
          {shotIcon && (
            <span className="flex items-center gap-1 text-[11px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-bold" title={`Shot: ${s.shotType}`}>
              {shotIcon} <span className="hidden sm:inline">{s.shotType}</span>
            </span>
          )}
          {camIcon && (
            <span className="flex items-center gap-1 text-[11px] bg-cyan-50 text-cyan-700 px-2 py-0.5 rounded-full font-bold" title={`Camera: ${s.cameraMovement}`}>
              {camIcon} <span className="hidden sm:inline">{s.cameraMovement}</span>
            </span>
          )}
          {s.durationSec != null && (
            <span className="ml-auto text-[11px] text-gray-400 font-bold flex items-center gap-1">
              <Icons.Clock size={11} />
              {s.durationSec}s
            </span>
          )}
        </div>

        {/* Script segment preview */}
        <p className="text-[12px] text-brand-dark/80 leading-relaxed line-clamp-2 italic">
          "{s.script_segment || '—'}"
        </p>

        {/* Visual prompt preview */}
        {s.visual_prompt && (
          <p className="text-[11px] text-gray-500 leading-relaxed line-clamp-2">
            {s.visual_prompt}
          </p>
        )}

        {/* Characters */}
        {characters.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {characters.map(name => (
              <span
                key={name}
                className="text-[10px] bg-violet-50 text-violet-700 px-2 py-0.5 rounded-full font-bold"
              >
                {name}
              </span>
            ))}
          </div>
        )}

        {/* Edit button */}
        <button
          onClick={handleEditOpen}
          className="mt-2 text-[11px] text-gray-400 hover:text-brand-dark font-bold flex items-center gap-1 self-end transition-colors"
        >
          <Icons.Edit3 size={11} /> 편집
        </button>
      </div>

      {/* Inline edit overlay */}
      {editing && (
        <div
          className="absolute inset-0 bg-white/98 backdrop-blur-sm rounded-3xl p-5 flex flex-col gap-3 z-10 overflow-y-auto"
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] font-black uppercase tracking-widest text-gray-500">씬 {i + 1} 편집</span>
            <button onClick={handleCancel} className="text-gray-400 hover:text-gray-700 transition-colors">
              <Icons.X size={16} />
            </button>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">스크립트</label>
            <textarea
              value={editScript}
              onChange={e => setEditScript(e.target.value)}
              rows={3}
              className="w-full text-sm p-3 bg-gray-50 rounded-2xl border border-gray-200 outline-none resize-none focus:border-brand-cyan transition-colors"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">비주얼 프롬프트</label>
            <textarea
              value={editPrompt}
              onChange={e => setEditPrompt(e.target.value)}
              rows={3}
              className="w-full text-sm p-3 bg-gray-50 rounded-2xl border border-gray-200 outline-none resize-none focus:border-brand-cyan transition-colors"
            />
          </div>

          <div className="flex gap-2 mt-auto">
            <button
              onClick={handleCancel}
              className="flex-1 py-2 rounded-full border border-gray-200 text-sm font-bold text-gray-500 hover:bg-gray-50 transition-colors"
            >
              취소
            </button>
            <button
              onClick={handleSave}
              className="flex-1 py-2 rounded-full bg-brand-dark text-white text-sm font-bold hover:bg-brand-dark/90 transition-colors"
            >
              저장
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
