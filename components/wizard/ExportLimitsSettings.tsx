import React, { useState } from 'react';
import { Icons } from '../Icons';
import {
  DEFAULT_THRESHOLDS,
  ResolvedThresholds,
  getEffectiveBaseThresholds,
  resetUserThresholdOverrides,
  setUserThresholdOverrides,
} from '../../services/ffmpegLimits';

interface Props {
  onChanged: () => void;
}

type FieldKey = keyof ResolvedThresholds;

const FIELDS: Array<{
  key: FieldKey;
  label: string;
  hint: string;
  unit: string;
  min: number;
  max: number;
  step: number;
}> = [
  {
    key: 'warnDurationSec',
    label: '경고 길이',
    hint: '총 길이가 이 값 이상이면 "주의" 배너가 표시됩니다.',
    unit: '초',
    min: 20,
    max: 600,
    step: 5,
  },
  {
    key: 'blockDurationSec',
    label: '차단 길이',
    hint: '총 길이가 이 값 이상이면 내보내기가 차단됩니다.',
    unit: '초',
    min: 40,
    max: 1200,
    step: 10,
  },
  {
    key: 'warnScenes',
    label: '경고 씬 수',
    hint: '씬 수가 이 값 이상이면 "주의" 배너가 표시됩니다.',
    unit: '개',
    min: 3,
    max: 60,
    step: 1,
  },
  {
    key: 'blockScenes',
    label: '차단 씬 수',
    hint: '씬 수가 이 값 이상이면 내보내기가 차단됩니다.',
    unit: '개',
    min: 5,
    max: 100,
    step: 1,
  },
];

export const ExportLimitsSettings: React.FC<Props> = ({ onChanged }) => {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<ResolvedThresholds>(() => getEffectiveBaseThresholds());
  const [savedAt, setSavedAt] = useState<number | null>(null);

  React.useEffect(() => {
    if (open) setValues(getEffectiveBaseThresholds());
  }, [open]);

  const updateField = (key: FieldKey, raw: string) => {
    const num = Number(raw);
    if (!Number.isFinite(num)) return;
    setValues(v => ({ ...v, [key]: num }));
  };

  const validationError = (() => {
    if (values.warnDurationSec >= values.blockDurationSec) {
      return '경고 길이는 차단 길이보다 작아야 합니다.';
    }
    if (values.warnScenes >= values.blockScenes) {
      return '경고 씬 수는 차단 씬 수보다 작아야 합니다.';
    }
    for (const f of FIELDS) {
      const v = values[f.key];
      if (v < f.min || v > f.max) {
        return `${f.label}은 ${f.min}~${f.max} ${f.unit} 사이여야 합니다.`;
      }
    }
    return null;
  })();

  const handleSave = () => {
    if (validationError) return;
    setUserThresholdOverrides(values);
    setSavedAt(Date.now());
    onChanged();
  };

  const handleReset = () => {
    resetUserThresholdOverrides();
    setValues(DEFAULT_THRESHOLDS);
    setSavedAt(Date.now());
    onChanged();
  };

  return (
    <div className="mb-6 rounded-3xl border-2 border-gray-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left"
      >
        <div className="flex items-center gap-3">
          <Icons.SlidersHorizontal size={18} className="text-gray-500" />
          <div>
            <div className="text-sm font-black text-brand-dark">내보내기 한도 설정</div>
            <div className="text-xs text-gray-500 font-medium">
              브라우저/PC 성능에 맞춰 경고·차단 한도를 조정하세요.
            </div>
          </div>
        </div>
        <Icons.ChevronRight
          size={18}
          className={`text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`}
        />
      </button>

      {open && (
        <div className="px-5 pb-5 pt-1 border-t border-gray-100">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
            {FIELDS.map(f => (
              <label key={f.key} className="flex flex-col gap-1">
                <span className="text-[11px] font-black uppercase tracking-widest text-gray-500">
                  {f.label}{' '}
                  <span className="text-gray-400 font-semibold normal-case tracking-normal">
                    (기본 {DEFAULT_THRESHOLDS[f.key]} {f.unit})
                  </span>
                </span>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={f.min}
                    max={f.max}
                    step={f.step}
                    value={values[f.key]}
                    onChange={e => updateField(f.key, e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border-2 border-gray-200 focus:border-brand-cyan outline-none text-sm font-bold"
                  />
                  <span className="text-xs text-gray-500 font-semibold">{f.unit}</span>
                </div>
                <span className="text-[11px] text-gray-400 leading-snug">{f.hint}</span>
              </label>
            ))}
          </div>

          <p className="mt-3 text-[11px] text-gray-400 italic leading-snug">
            * 모바일/저메모리 기기 또는 1080p 이상 해상도에서는 설정값에 자동 보정 계수가 곱해져 더 보수적으로 적용됩니다.
          </p>

          {validationError && (
            <p className="mt-2 text-xs text-red-500 font-semibold">{validationError}</p>
          )}

          <div className="flex items-center gap-2 mt-4">
            <button
              type="button"
              onClick={handleSave}
              disabled={!!validationError}
              className={`px-5 py-2 rounded-full font-black text-sm transition-all flex items-center gap-2 ${
                validationError
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-brand-dark text-white hover:scale-105'
              }`}
            >
              <Icons.Save size={14} /> 저장
            </button>
            <button
              type="button"
              onClick={handleReset}
              className="px-5 py-2 rounded-full font-black text-sm bg-white border-2 border-gray-200 text-gray-600 hover:border-brand-dark hover:text-black transition-all flex items-center gap-2"
            >
              <Icons.RotateCcw size={14} /> 기본값으로 되돌리기
            </button>
            {savedAt && (
              <span className="text-xs text-emerald-600 font-semibold ml-1">저장됨</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
