import React, { useState } from 'react';
import { Icons } from './Icons';
import { setProviderApiKey } from '../services/apiKeyService';

interface ApiKeyRequiredModalProps {
  open: boolean;
  aistudioMode: boolean;
  onSelectKey: () => void;
  onClose: () => void;
}

export const ApiKeyRequiredModal: React.FC<ApiKeyRequiredModalProps> = ({
  open,
  aistudioMode,
  onSelectKey,
  onClose,
}) => {
  const [inlineKey, setInlineKey] = useState('');
  const [savingInline, setSavingInline] = useState(false);

  if (!open) return null;

  const handleSaveInline = () => {
    const trimmed = inlineKey.trim();
    if (!trimmed) return;
    setSavingInline(true);
    try {
      // Persist as the Google provider key. This fires API_KEY_CHANGE_EVENT,
      // which the wizard's waiter listens to and uses to auto-resume the
      // pending video action without requiring a second click.
      setProviderApiKey('Google', trimmed);
      setInlineKey('');
    } finally {
      setSavingInline(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-[2rem] shadow-2xl max-w-md w-full p-8 relative"
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-300 hover:text-gray-700 transition-colors"
          aria-label="닫기"
        >
          <Icons.X size={20} />
        </button>
        <div className="w-14 h-14 rounded-2xl bg-sky-50 flex items-center justify-center mb-5">
          <Icons.Key size={26} className="text-sky-600" />
        </div>
        <h3 className="text-2xl font-black tracking-tight mb-2">
          Google Cloud 결제 키가 필요합니다
        </h3>
        <p className="text-sm text-gray-500 leading-relaxed mb-6">
          {aistudioMode
            ? 'Veo 비디오 생성을 시작하려면 결제가 활성화된 Google AI Studio API 키를 먼저 선택해주세요. 키가 등록되면 곧바로 생성을 이어갑니다.'
            : '비디오 생성을 시작하려면 결제가 활성화된 Google Cloud 프로젝트의 API 키가 필요합니다. 아래에 키를 붙여넣으면 곧바로 생성을 이어갑니다.'}
        </p>

        {!aistudioMode && (
          <div className="mb-5">
            <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 mb-2">
              Google API Key
            </label>
            <div className="flex items-center gap-2">
              <div className="flex-1 relative">
                <Icons.Key
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300"
                />
                <input
                  type="password"
                  value={inlineKey}
                  onChange={e => setInlineKey(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleSaveInline();
                  }}
                  placeholder="AIza..."
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl border-2 border-gray-100 text-sm font-mono focus:outline-none focus:border-sky-400"
                  autoFocus
                />
              </div>
              <button
                onClick={handleSaveInline}
                disabled={!inlineKey.trim() || savingInline}
                className="px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:bg-gray-200 disabled:text-gray-400 text-white text-xs font-bold transition-colors whitespace-nowrap"
              >
                저장 후 계속
              </button>
            </div>
            <p className="text-[10px] text-gray-400 mt-2 leading-relaxed">
              키는 이 브라우저에만 저장됩니다. 관리 페이지에서 언제든 변경/삭제할 수 있습니다.
            </p>
          </div>
        )}

        <div className="flex flex-col sm:flex-row-reverse gap-2">
          <button
            onClick={onSelectKey}
            className="px-5 py-3 rounded-full bg-sky-600 hover:bg-sky-700 text-white text-sm font-bold transition-colors"
          >
            {aistudioMode ? 'Select API Key' : '관리 페이지에서 설정'}
          </button>
          <button
            onClick={onClose}
            className="px-5 py-3 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-bold transition-colors"
          >
            나중에
          </button>
        </div>
      </div>
    </div>
  );
};
