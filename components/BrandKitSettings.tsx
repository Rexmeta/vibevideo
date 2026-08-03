import React, { useState, useEffect, useRef } from 'react';
import { Icons } from './Icons';
import { BrandKit, LogoPosition } from '../types';
import { loadBrandKit, saveBrandKit, uploadLogo, deleteLogo, DEFAULT_BRAND_KIT } from '../services/brandKitService';

interface BrandKitSettingsProps {
  userId: string;
  onNavigateBack: () => void;
}

const LOGO_POSITIONS: { id: LogoPosition; label: string }[] = [
  { id: 'top-left', label: '좌상단' },
  { id: 'top-right', label: '우상단' },
  { id: 'bottom-left', label: '좌하단' },
  { id: 'bottom-right', label: '우하단' },
  { id: 'center', label: '중앙' },
];

const ColorSwatch: React.FC<{
  label: string;
  value: string;
  onChange: (v: string) => void;
}> = ({ label, value, onChange }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-col items-center gap-2">
      <button
        onClick={() => inputRef.current?.click()}
        className="w-14 h-14 rounded-2xl border-4 border-white shadow-lg hover:scale-105 transition-all"
        style={{ background: value }}
        title={label}
      />
      <input
        ref={inputRef}
        type="color"
        value={value}
        onChange={e => onChange(e.target.value)}
        className="sr-only"
      />
      <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">{label}</span>
      <input
        type="text"
        value={value}
        onChange={e => {
          const v = e.target.value;
          if (/^#[0-9a-fA-F]{0,6}$/.test(v)) onChange(v);
        }}
        className="w-20 text-center text-[10px] font-mono border border-gray-200 rounded-lg p-1 outline-none focus:border-brand-cyan"
      />
    </div>
  );
};

const IntroOutroForm: React.FC<{
  label: string;
  value?: BrandKit['introConfig'];
  onChange: (v: BrandKit['introConfig']) => void;
}> = ({ label, value, onChange }) => {
  const [enabled, setEnabled] = useState(!!value);

  const toggleEnabled = (on: boolean) => {
    setEnabled(on);
    if (!on) onChange(undefined);
    else onChange(value || { text: '', bgColor: '#1a1a2e', durationSec: 2 });
  };

  return (
    <div className="p-5 bg-gray-50 rounded-[2rem] border border-gray-100">
      <div className="flex items-center justify-between mb-4">
        <h4 className="text-xs font-black uppercase tracking-widest text-gray-500">{label}</h4>
        <button
          onClick={() => toggleEnabled(!enabled)}
          className={`w-12 h-7 rounded-full transition-all relative ${enabled ? 'bg-brand-cyan' : 'bg-gray-200'}`}
        >
          <div className={`w-5 h-5 bg-white rounded-full absolute top-1 transition-all shadow-sm ${enabled ? 'left-6' : 'left-1'}`} />
        </button>
      </div>
      {enabled && value && (
        <div className="space-y-3">
          <div>
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">
              타이틀 텍스트
            </label>
            <input
              type="text"
              value={value.text}
              onChange={e => onChange({ ...value, text: e.target.value })}
              placeholder="예: VibeVideo Studio"
              className="w-full p-3 bg-white rounded-xl outline-none text-sm font-medium shadow-inner border border-gray-100 focus:border-brand-cyan"
            />
          </div>
          <div>
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">
              부제목 (선택)
            </label>
            <input
              type="text"
              value={value.subtext || ''}
              onChange={e => onChange({ ...value, subtext: e.target.value || undefined })}
              placeholder="예: AI Video Creator"
              className="w-full p-3 bg-white rounded-xl outline-none text-sm font-medium shadow-inner border border-gray-100 focus:border-brand-cyan"
            />
          </div>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">
                배경 색상
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={value.bgColor}
                  onChange={e => onChange({ ...value, bgColor: e.target.value })}
                  className="w-10 h-10 rounded-xl border border-gray-200 cursor-pointer"
                />
                <input
                  type="text"
                  value={value.bgColor}
                  onChange={e => {
                    const v = e.target.value;
                    if (/^#[0-9a-fA-F]{0,6}$/.test(v)) onChange({ ...value, bgColor: v });
                  }}
                  className="flex-1 p-2 bg-white rounded-xl outline-none text-xs font-mono border border-gray-100 focus:border-brand-cyan"
                />
              </div>
            </div>
            <div className="flex-1">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">
                재생 시간
              </label>
              <div className="flex items-center gap-2">
                {[1, 2, 3, 5].map(d => (
                  <button
                    key={d}
                    onClick={() => onChange({ ...value, durationSec: d })}
                    className={`px-3 py-2 rounded-xl text-xs font-black transition-all ${value.durationSec === d ? 'bg-brand-cyan text-black' : 'bg-white border border-gray-200 text-gray-600 hover:border-gray-300'}`}
                  >
                    {d}초
                  </button>
                ))}
              </div>
            </div>
          </div>
          {/* Preview swatch */}
          <div
            className="w-full h-16 rounded-xl flex flex-col items-center justify-center gap-1 mt-1"
            style={{ background: value.bgColor }}
          >
            {value.text && (
              <span className="text-white font-black text-sm drop-shadow">{value.text}</span>
            )}
            {value.subtext && (
              <span className="text-white/70 text-xs">{value.subtext}</span>
            )}
            {!value.text && (
              <span className="text-white/30 text-xs italic">미리보기</span>
            )}
          </div>
        </div>
      )}
      {!enabled && (
        <p className="text-xs text-gray-400 italic">비활성 — 이 클립을 삽입하지 않습니다.</p>
      )}
    </div>
  );
};

export const BrandKitSettings: React.FC<BrandKitSettingsProps> = ({ userId, onNavigateBack }) => {
  const [kit, setKit] = useState<BrandKit>({ ...DEFAULT_BRAND_KIT });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!userId) { setLoading(false); return; }
    loadBrandKit(userId)
      .then(k => setKit(k))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [userId]);

  const handleSave = async () => {
    if (!userId) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      await saveBrandKit(userId, kit);
      setSaveMsg('저장되었습니다!');
      setTimeout(() => setSaveMsg(null), 3000);
    } catch (e: any) {
      setSaveMsg(`저장 실패: ${e?.message || ''}`);
    } finally {
      setSaving(false);
    }
  };

  const handleLogoUpload = async (file: File) => {
    if (!userId) return;
    if (file.size > 4 * 1024 * 1024) {
      alert('로고 이미지는 4MB 이하여야 합니다.');
      return;
    }
    setUploadingLogo(true);
    try {
      const { url, storagePath } = await uploadLogo(userId, file, kit.logoStoragePath);
      setKit(prev => ({ ...prev, logoUrl: url, logoStoragePath: storagePath }));
    } catch (e: any) {
      alert(`업로드 실패: ${e?.message || ''}`);
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleLogoDelete = async () => {
    if (!userId || !kit.logoStoragePath) return;
    if (!confirm('로고를 삭제하시겠습니까?')) return;
    setUploadingLogo(true);
    try {
      await deleteLogo(userId, kit.logoStoragePath);
      setKit(prev => ({ ...prev, logoUrl: undefined, logoStoragePath: undefined }));
    } catch (e: any) {
      alert(`삭제 실패: ${e?.message || ''}`);
    } finally {
      setUploadingLogo(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <Icons.Loader2 className="animate-spin text-brand-cyan" size={36} />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <div className="flex items-center gap-4 mb-10">
        <button
          onClick={onNavigateBack}
          className="w-10 h-10 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-all"
        >
          <Icons.ChevronLeft size={20} />
        </button>
        <div>
          <h1 className="text-3xl font-black tracking-tighter">브랜드 키트</h1>
          <p className="text-gray-400 text-sm font-medium italic mt-0.5">
            로고 워터마크 · 인트로/아웃트로 · 컬러 팔레트
          </p>
        </div>
      </div>

      <div className="space-y-10">
        {/* Logo Watermark */}
        <section>
          <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 mb-4 flex items-center gap-2">
            <Icons.ImageIcon size={14} /> 로고 워터마크
          </h2>
          <div className="p-6 bg-gray-50 rounded-[2rem] border border-gray-100 space-y-5">
            {/* Upload area */}
            <div className="flex items-start gap-4">
              <div
                className="w-24 h-24 rounded-2xl border-2 border-dashed border-gray-200 flex items-center justify-center bg-white overflow-hidden shrink-0 cursor-pointer hover:border-brand-cyan transition-all"
                onClick={() => logoInputRef.current?.click()}
              >
                {kit.logoUrl ? (
                  <img
                    src={kit.logoUrl}
                    alt="Logo"
                    className="w-full h-full object-contain p-2"
                  />
                ) : (
                  <div className="flex flex-col items-center gap-1 text-gray-300">
                    <Icons.Upload size={20} />
                    <span className="text-[9px] font-bold uppercase">업로드</span>
                  </div>
                )}
              </div>
              <input
                ref={logoInputRef}
                type="file"
                accept="image/png,image/svg+xml,image/jpeg,image/webp"
                className="hidden"
                disabled={uploadingLogo}
                onChange={e => {
                  const file = e.target.files?.[0];
                  if (file) handleLogoUpload(file);
                  e.target.value = '';
                }}
              />
              <div className="flex-1">
                <p className="text-xs font-bold text-gray-600 mb-2">
                  PNG · SVG · JPEG (최대 4MB)
                </p>
                <p className="text-[11px] text-gray-400 leading-relaxed mb-3">
                  로고가 설정되면 내보내기 시 모든 씬 비디오에 투명도 있게 오버레이됩니다.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => logoInputRef.current?.click()}
                    disabled={uploadingLogo}
                    className="px-4 py-2 bg-brand-dark text-white rounded-full text-xs font-black hover:opacity-90 disabled:opacity-50 flex items-center gap-1 transition-all"
                  >
                    {uploadingLogo ? (
                      <><Icons.Loader2 size={12} className="animate-spin" /> 업로드 중…</>
                    ) : (
                      <><Icons.Upload size={12} /> 로고 업로드</>
                    )}
                  </button>
                  {kit.logoUrl && (
                    <button
                      onClick={handleLogoDelete}
                      disabled={uploadingLogo}
                      className="px-4 py-2 bg-white border border-red-200 text-red-500 rounded-full text-xs font-black hover:bg-red-50 disabled:opacity-50 transition-all"
                    >
                      제거
                    </button>
                  )}
                </div>
              </div>
            </div>

            {kit.logoUrl && (
              <>
                {/* Position */}
                <div>
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-2">
                    위치
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {LOGO_POSITIONS.map(p => (
                      <button
                        key={p.id}
                        onClick={() => setKit(prev => ({ ...prev, logoPosition: p.id }))}
                        className={`px-3 py-2 rounded-xl text-xs font-black transition-all ${kit.logoPosition === p.id ? 'bg-brand-cyan text-black' : 'bg-white border border-gray-200 text-gray-600 hover:border-gray-300'}`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Opacity */}
                <div>
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-2">
                    불투명도 ({Math.round(kit.logoOpacity * 100)}%)
                  </label>
                  <input
                    type="range"
                    min={0.1}
                    max={1}
                    step={0.05}
                    value={kit.logoOpacity}
                    onChange={e => setKit(prev => ({ ...prev, logoOpacity: Number(e.target.value) }))}
                    className="w-full h-2 accent-brand-cyan"
                  />
                </div>
              </>
            )}
          </div>
        </section>

        {/* Intro / Outro */}
        <section>
          <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 mb-4 flex items-center gap-2">
            <Icons.Film size={14} /> 인트로 / 아웃트로
          </h2>
          <p className="text-xs text-gray-400 mb-4 italic leading-relaxed">
            활성화하면 FFmpeg가 첫 씬 앞(인트로)과 마지막 씬 뒤(아웃트로)에 짧은 타이틀 클립을 자동 삽입합니다.
          </p>
          <div className="space-y-4">
            <IntroOutroForm
              label="인트로"
              value={kit.introConfig}
              onChange={v => setKit(prev => ({ ...prev, introConfig: v }))}
            />
            <IntroOutroForm
              label="아웃트로"
              value={kit.outroConfig}
              onChange={v => setKit(prev => ({ ...prev, outroConfig: v }))}
            />
          </div>
        </section>

        {/* Colour Palette */}
        <section>
          <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 mb-4 flex items-center gap-2">
            <Icons.Palette size={14} /> 컬러 팔레트
          </h2>
          <p className="text-xs text-gray-400 mb-5 italic leading-relaxed">
            브랜드 컬러를 설정하면 새 프로젝트 생성 시 StyleSheet 초기값으로 자동 반영됩니다.
          </p>
          <div className="p-6 bg-gray-50 rounded-[2rem] border border-gray-100">
            <div className="flex items-center gap-8 justify-center">
              <ColorSwatch
                label="Primary"
                value={kit.palette.primary}
                onChange={v => setKit(prev => ({ ...prev, palette: { ...prev.palette, primary: v } }))}
              />
              <ColorSwatch
                label="Secondary"
                value={kit.palette.secondary}
                onChange={v => setKit(prev => ({ ...prev, palette: { ...prev.palette, secondary: v } }))}
              />
              <ColorSwatch
                label="Accent"
                value={kit.palette.accent}
                onChange={v => setKit(prev => ({ ...prev, palette: { ...prev.palette, accent: v } }))}
              />
            </div>
            <p className="text-center text-[10px] text-gray-400 mt-4 italic">
              스와치를 클릭하거나 HEX 값을 직접 입력하세요.
            </p>
          </div>
        </section>
      </div>

      {/* Save bar */}
      <div className="mt-12 flex items-center gap-4">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex-1 py-5 rounded-full font-black text-lg bg-brand-dark text-white hover:opacity-90 disabled:opacity-50 transition-all flex items-center justify-center gap-3"
        >
          {saving ? (
            <><Icons.Loader2 size={20} className="animate-spin" /> 저장 중…</>
          ) : (
            <><Icons.Check size={20} /> 브랜드 키트 저장</>
          )}
        </button>
        {saveMsg && (
          <span className={`text-sm font-bold ${saveMsg.startsWith('저장') ? 'text-emerald-600' : 'text-red-500'}`}>
            {saveMsg}
          </span>
        )}
      </div>

      <p className="text-center text-xs text-gray-400 mt-4 italic">
        브랜드 키트 없이도 기존 영상 생성 플로우는 전혀 영향받지 않습니다.
      </p>
    </div>
  );
};
