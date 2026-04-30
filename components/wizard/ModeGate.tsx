import React from 'react';
import { Icons } from '../Icons';

const MODE_KEY = 'vibe_video_mode_pref';

export type WizardMode = 'quick' | 'pro';

export const getStoredMode = (): WizardMode | null => {
  try {
    const v = localStorage.getItem(MODE_KEY);
    if (v === 'quick' || v === 'pro') return v;
  } catch {}
  return null;
};

export const setStoredMode = (mode: WizardMode) => {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {}
};

export const clearStoredMode = () => {
  try {
    localStorage.removeItem(MODE_KEY);
  } catch {}
};

interface Props {
  onSelect: (mode: WizardMode) => void;
}

export const ModeGate: React.FC<Props> = ({ onSelect }) => {
  const choose = (mode: WizardMode) => {
    setStoredMode(mode);
    onSelect(mode);
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-16">
      <div className="text-center mb-12">
        <h1 className="text-5xl md:text-6xl font-black text-brand-dark mb-5 tracking-tighter">
          어떻게 만드시겠어요?
        </h1>
        <p className="text-lg text-gray-500 font-medium italic">
          한 번 선택하면 다음에도 같은 모드로 시작합니다 (언제든 바꿀 수 있어요).
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* QUICK MODE */}
        <button
          onClick={() => choose('quick')}
          className="group relative p-10 rounded-[3.5rem] bg-gradient-to-br from-brand-cyan/10 via-white to-emerald-50 border-4 border-brand-cyan/30 hover:border-brand-cyan hover:scale-[1.02] hover:shadow-[0_30px_70px_rgba(0,0,0,0.15)] transition-all text-left overflow-hidden"
        >
          <div className="absolute top-6 right-6 px-3 py-1 rounded-full bg-brand-cyan text-black text-[10px] font-black uppercase tracking-wider shadow-md">
            추천
          </div>
          <div className="w-16 h-16 rounded-3xl bg-brand-cyan flex items-center justify-center mb-6 shadow-xl group-hover:rotate-6 transition-transform">
            <Icons.Wand2 size={32} className="text-black" />
          </div>
          <h2 className="text-3xl font-black tracking-tight mb-3 text-brand-dark">Quick Mode</h2>
          <p className="text-sm text-gray-500 leading-relaxed mb-6 font-medium">
            주제만 입력하면 AI가 스크립트, 오디오, 이미지, 비디오를 한 번에 생성합니다.
            가장 빠른 길.
          </p>
          <ul className="space-y-2 text-xs font-bold text-gray-700">
            <li className="flex items-center gap-2"><Icons.Check size={14} className="text-brand-cyan" /> 단일 화면 입력</li>
            <li className="flex items-center gap-2"><Icons.Check size={14} className="text-brand-cyan" /> 자동 파이프라인 실행</li>
            <li className="flex items-center gap-2"><Icons.Check size={14} className="text-brand-cyan" /> 실패 시 1-클릭으로 Pro 모드로 이어가기</li>
          </ul>
        </button>

        {/* PRO MODE */}
        <button
          onClick={() => choose('pro')}
          className="group relative p-10 rounded-[3.5rem] bg-gradient-to-br from-purple-50 via-white to-pink-50 border-4 border-gray-100 hover:border-brand-dark hover:scale-[1.02] hover:shadow-[0_30px_70px_rgba(0,0,0,0.15)] transition-all text-left overflow-hidden"
        >
          <div className="w-16 h-16 rounded-3xl bg-brand-dark flex items-center justify-center mb-6 shadow-xl group-hover:-rotate-6 transition-transform">
            <Icons.SlidersHorizontal size={32} className="text-brand-cyan" />
          </div>
          <h2 className="text-3xl font-black tracking-tight mb-3 text-brand-dark">Pro Mode</h2>
          <p className="text-sm text-gray-500 leading-relaxed mb-6 font-medium">
            7단계 워크플로우로 모든 옵션을 직접 제어합니다. 캐스트, 스타일 시트, 품질 검수까지.
          </p>
          <ul className="space-y-2 text-xs font-bold text-gray-700">
            <li className="flex items-center gap-2"><Icons.Check size={14} className="text-brand-dark" /> 단계별 세밀한 컨트롤</li>
            <li className="flex items-center gap-2"><Icons.Check size={14} className="text-brand-dark" /> 캐스트, 캐릭터 참조, Vision Critic</li>
            <li className="flex items-center gap-2"><Icons.Check size={14} className="text-brand-dark" /> 씬마다 재생성 / 자막 / 전환 효과</li>
          </ul>
        </button>
      </div>
    </div>
  );
};
