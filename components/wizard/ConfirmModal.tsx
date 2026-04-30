import React, { useEffect, useRef } from 'react';
import { Icons } from '../Icons';

export type ConfirmModalTone = 'default' | 'danger';

interface ConfirmModalProps {
  open: boolean;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmModalTone;
  icon?: React.ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  open,
  title,
  description,
  confirmLabel = '확인',
  cancelLabel = '취소',
  tone = 'default',
  icon,
  onConfirm,
  onCancel,
}) => {
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const t = window.setTimeout(() => confirmBtnRef.current?.focus(), 50);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      window.clearTimeout(t);
    };
  }, [open, onCancel]);

  if (!open) return null;

  const isDanger = tone === 'danger';
  const confirmClasses = isDanger
    ? 'bg-red-500 hover:bg-red-600 text-white border-red-500'
    : 'bg-brand-dark hover:brightness-125 text-white border-brand-dark';
  const accentBg = isDanger ? 'bg-red-50' : 'bg-brand-cyan/10';
  const accentText = isDanger ? 'text-red-500' : 'text-brand-cyan';

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-brand-dark/60 backdrop-blur-md animate-[fadeIn_0.15s_ease-out]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
      aria-describedby={description ? 'confirm-modal-desc' : undefined}
      onClick={onCancel}
    >
      <style>{`
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes popIn { from { opacity: 0; transform: scale(0.95) translateY(8px); } to { opacity: 1; transform: scale(1) translateY(0); } }
      `}</style>
      <div
        className="relative w-full max-w-md bg-white rounded-[2rem] shadow-2xl border border-gray-100 overflow-hidden animate-[popIn_0.2s_ease-out]"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onCancel}
          aria-label="Close"
          className="absolute top-4 right-4 w-9 h-9 rounded-full flex items-center justify-center text-gray-400 hover:text-brand-dark hover:bg-gray-100 transition-all"
        >
          <Icons.X size={18} />
        </button>

        <div className="p-8 pt-10">
          <div className={`w-14 h-14 rounded-2xl ${accentBg} flex items-center justify-center mb-5`}>
            <span className={accentText}>{icon ?? <Icons.AlertCircle size={24} />}</span>
          </div>

          <h2
            id="confirm-modal-title"
            className="text-2xl font-black text-brand-dark tracking-tight mb-3"
          >
            {title}
          </h2>

          {description && (
            <div
              id="confirm-modal-desc"
              className="text-sm text-gray-600 leading-relaxed whitespace-pre-line"
            >
              {description}
            </div>
          )}
        </div>

        <div className="px-8 pb-8 pt-2 flex flex-col-reverse sm:flex-row gap-3 sm:justify-end">
          <button
            onClick={onCancel}
            className="px-6 py-3 rounded-full bg-white border-2 border-gray-100 hover:border-gray-200 hover:bg-gray-50 text-brand-dark text-[11px] font-black uppercase tracking-widest transition-all"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmBtnRef}
            onClick={onConfirm}
            className={`px-6 py-3 rounded-full border-2 text-[11px] font-black uppercase tracking-widest transition-all shadow-lg ${confirmClasses}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
