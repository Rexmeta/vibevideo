import React, { useState, useEffect, useCallback } from 'react';
import { AIModel, ModelType } from '../types';
import { getModels, saveModel } from '../services/modelService';
import { getProviderApiKey, setProviderApiKey, API_KEY_CHANGE_EVENT } from '../services/apiKeyService';
import { PROVIDER_META, PROVIDER_PRESETS, getProviderInitials, type ProviderMeta } from '../services/providerMeta';
import { Icons } from './Icons';

// ── Provider status helpers ─────────────────────────────────────────────────

type ProviderStatus = 'available' | 'needs-key' | 'coming-soon';

function getProviderStatus(meta: ProviderMeta, models: AIModel[]): ProviderStatus {
  if (meta.comingSoon) return 'coming-soon';
  const providerModels = models.filter(m => m.provider === meta.key);
  if (providerModels.length === 0) return 'coming-soon';
  // Google/NanoBanana keys may come from env
  const isGoogle = meta.key === 'Google' || meta.key === 'NanoBanana';
  const hasKey = !!(getProviderApiKey(meta.key));
  if (hasKey || isGoogle) return 'available';
  return 'needs-key';
}

const STATUS_CONFIG: Record<ProviderStatus, { label: string; badgeCls: string; dotCls: string }> = {
  'available':    { label: '사용 가능',     badgeCls: 'bg-green-50 text-green-700 border-green-200',  dotCls: 'bg-green-500' },
  'needs-key':   { label: 'API 키 필요',   badgeCls: 'bg-yellow-50 text-yellow-700 border-yellow-200', dotCls: 'bg-yellow-500' },
  'coming-soon': { label: '곧 지원 예정',   badgeCls: 'bg-gray-100 text-gray-500 border-gray-200',    dotCls: 'bg-gray-400' },
};

// ── ProviderDetailPanel ─────────────────────────────────────────────────────

interface ProviderDetailPanelProps {
  meta: ProviderMeta;
  models: AIModel[];
  onClose: () => void;
  onModelsRefresh: () => void;
}

const ProviderDetailPanel: React.FC<ProviderDetailPanelProps> = ({ meta, models, onClose, onModelsRefresh }) => {
  const providerModels = models.filter(m => m.provider === meta.key);
  const [apiKey, setApiKey] = useState(() => getProviderApiKey(meta.key) || '');
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);
  const [savingPreset, setSavingPreset] = useState(false);
  const [presetMsg, setPresetMsg] = useState('');

  const handleSaveKey = () => {
    setProviderApiKey(meta.key, apiKey);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleToggleActive = async (model: AIModel) => {
    await saveModel({ ...model, isActive: !model.isActive });
    onModelsRefresh();
  };

  const preset = PROVIDER_PRESETS.find(p => p.providerKey === meta.key);

  const handleAddPreset = async () => {
    if (!preset) return;
    setSavingPreset(true);
    setPresetMsg('');
    try {
      const existing = new Set(models.map(m => m.modelId));
      let added = 0;
      for (const pm of preset.models) {
        if (existing.has(pm.modelId)) continue;
        const typePrefix = pm.type === 'image' ? 'img' : pm.type === 'video' ? 'vid' : 'txt';
        await saveModel({
          id: `${typePrefix}-${pm.modelId.replace(/[^a-zA-Z0-9-]/g, '-')}`,
          name: pm.name,
          type: pm.type as ModelType,
          provider: meta.key,
          description: pm.description,
          modelId: pm.modelId,
          isActive: true,
          sortOrder: 99,
          supportsKorean: pm.supportsKorean,
        });
        added++;
      }
      setPresetMsg(added > 0 ? `${added}개 모델 추가됨` : '이미 모두 추가되어 있습니다');
      onModelsRefresh();
    } catch (e) {
      setPresetMsg('추가 실패: ' + String((e as any)?.message || e));
    } finally {
      setSavingPreset(false);
      setTimeout(() => setPresetMsg(''), 3000);
    }
  };

  const typeIcon = (type: ModelType) => {
    if (type === 'image') return <Icons.ImageIcon size={12} className="text-purple-500" />;
    if (type === 'video') return <Icons.Film size={12} className="text-blue-500" />;
    if (type === 'text') return <Icons.Type size={12} className="text-green-500" />;
    return <Icons.Zap size={12} className="text-gray-400" />;
  };

  const typeLabel = (type: ModelType) => {
    if (type === 'image') return '이미지';
    if (type === 'video') return '비디오';
    if (type === 'text') return '텍스트';
    return '오디오';
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div
        className="w-full max-w-md bg-white h-full shadow-2xl overflow-y-auto flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-5 border-b border-gray-100 sticky top-0 bg-white z-10">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-black ${meta.avatarBg} ${meta.avatarText}`}>
            {getProviderInitials(meta.displayName)}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-black text-base truncate">{meta.displayName}</h2>
            <p className="text-xs text-gray-400 truncate">{meta.tagline}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-xl transition-colors">
            <Icons.X size={18} />
          </button>
        </div>

        <div className="flex-1 p-6 space-y-6">
          {/* API key section */}
          {!meta.comingSoon && (
            <div>
              <h3 className="text-sm font-bold mb-3 flex items-center gap-2">
                <Icons.Key size={14} />
                API 키
                <a
                  href={meta.docsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-auto text-xs text-blue-500 hover:underline flex items-center gap-1"
                >
                  <Icons.ExternalLink size={11} />
                  키 발급하기
                </a>
              </h3>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={e => setApiKey(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleSaveKey(); }}
                    placeholder={`${meta.displayName} API 키를 입력하세요`}
                    className="w-full pl-3 pr-9 py-2.5 border border-gray-200 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-black/10"
                  />
                  <button
                    onClick={() => setShowKey(v => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showKey ? <Icons.EyeOff size={14} /> : <Icons.Eye size={14} />}
                  </button>
                </div>
                <button
                  onClick={handleSaveKey}
                  className="flex items-center gap-1.5 px-4 py-2.5 bg-black text-white rounded-xl text-xs font-semibold hover:bg-gray-800 transition-colors flex-shrink-0"
                >
                  {saved ? <><Icons.Check size={13} />저장됨</> : <><Icons.Save size={13} />저장</>}
                </button>
              </div>
            </div>
          )}

          {/* One-click preset */}
          {preset && (
            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-100 rounded-2xl p-4">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <p className="text-sm font-bold text-blue-800">원클릭 프리셋 추가</p>
                  <p className="text-xs text-blue-600 mt-0.5">{preset.models.length}개 대표 모델을 한 번에 등록합니다</p>
                </div>
                <button
                  onClick={handleAddPreset}
                  disabled={savingPreset}
                  className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white rounded-xl text-xs font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  {savingPreset ? <Icons.Loader2 size={13} className="animate-spin" /> : <Icons.Plus size={13} />}
                  {savingPreset ? '추가 중…' : '프리셋 추가'}
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {preset.models.map(pm => (
                  <span key={pm.modelId} className="inline-flex items-center gap-1 px-2 py-1 bg-white border border-blue-100 rounded-lg text-xs text-blue-700">
                    {typeIcon(pm.type as ModelType)}
                    {pm.name}
                  </span>
                ))}
              </div>
              {presetMsg && (
                <p className="mt-2 text-xs text-blue-700 font-semibold flex items-center gap-1">
                  <Icons.Check size={11} /> {presetMsg}
                </p>
              )}
            </div>
          )}

          {/* Model list */}
          <div>
            <h3 className="text-sm font-bold mb-3 flex items-center gap-2">
              <Icons.Layers size={14} />
              모델 목록
              <span className="ml-auto text-xs text-gray-400">{providerModels.length}개</span>
            </h3>
            {providerModels.length === 0 ? (
              <div className="text-center py-8 text-gray-400">
                <Icons.Package size={32} className="mx-auto mb-2 opacity-40" />
                <p className="text-sm">
                  {meta.comingSoon ? '아직 지원 준비 중입니다' : '등록된 모델이 없습니다'}
                </p>
                {meta.comingSoon && (
                  <p className="text-xs mt-1">곧 추가될 예정입니다</p>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {providerModels.map(model => (
                  <div key={model.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        {typeIcon(model.type)}
                        <span className="font-semibold text-sm truncate">{model.name}</span>
                        <span className="flex-shrink-0 px-1.5 py-0.5 bg-gray-200 text-gray-600 rounded text-[10px] font-medium">
                          {typeLabel(model.type)}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400 truncate">{model.description}</p>
                    </div>
                    <button
                      onClick={() => handleToggleActive(model)}
                      className={`relative flex-shrink-0 w-10 h-5 rounded-full transition-colors duration-200 ${model.isActive ? 'bg-green-500' : 'bg-gray-300'}`}
                      title={model.isActive ? '비활성화' : '활성화'}
                    >
                      <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200 ${model.isActive ? 'left-[22px]' : 'left-0.5'}`} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Docs link */}
          <a
            href={meta.docsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-xs text-gray-400 hover:text-gray-700 transition-colors"
          >
            <Icons.ExternalLink size={12} />
            {meta.displayName} 공식 문서 보기
          </a>
        </div>
      </div>
    </div>
  );
};

// ── ProviderCard ────────────────────────────────────────────────────────────

interface ProviderCardProps {
  meta: ProviderMeta;
  models: AIModel[];
  onClick: () => void;
}

const ProviderCard: React.FC<ProviderCardProps> = ({ meta, models, onClick }) => {
  const providerModels = models.filter(m => m.provider === meta.key);
  const status = getProviderStatus(meta, models);
  const { label, badgeCls, dotCls } = STATUS_CONFIG[status];
  const activeCount = providerModels.filter(m => m.isActive).length;

  const typeBreakdown = (() => {
    const img = providerModels.filter(m => m.type === 'image').length;
    const vid = providerModels.filter(m => m.type === 'video').length;
    const txt = providerModels.filter(m => m.type === 'text').length;
    const parts: string[] = [];
    if (txt > 0) parts.push(`텍스트 ${txt}`);
    if (img > 0) parts.push(`이미지 ${img}`);
    if (vid > 0) parts.push(`비디오 ${vid}`);
    return parts.join(' · ') || '모델 없음';
  })();

  return (
    <button
      onClick={onClick}
      disabled={false}
      className={`group flex flex-col gap-3 p-5 bg-white border rounded-2xl shadow-sm hover:shadow-md transition-all text-left w-full ${
        status === 'coming-soon' ? 'opacity-60 cursor-default' : 'hover:border-gray-300 cursor-pointer'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center text-base font-black flex-shrink-0 ${meta.avatarBg} ${meta.avatarText}`}>
          {getProviderInitials(meta.displayName)}
        </div>
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border ${badgeCls}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${dotCls}`} />
          {label}
        </span>
      </div>
      <div>
        <h3 className="font-bold text-sm mb-0.5">{meta.displayName}</h3>
        <p className="text-xs text-gray-400 line-clamp-2">{meta.tagline}</p>
      </div>
      <div className="flex items-center justify-between text-xs text-gray-400 mt-auto pt-2 border-t border-gray-50">
        <span>{typeBreakdown}</span>
        {providerModels.length > 0 && (
          <span className={`font-semibold ${activeCount > 0 ? 'text-green-600' : 'text-gray-400'}`}>
            {activeCount}/{providerModels.length} 활성
          </span>
        )}
      </div>
    </button>
  );
};

// ── ModelHubPanel ───────────────────────────────────────────────────────────

interface ModelHubPanelProps {
  /** When provided only shows one specific provider panel open by default */
  initialProvider?: string;
}

export const ModelHubPanel: React.FC<ModelHubPanelProps> = ({ initialProvider }) => {
  const [models, setModels] = useState<AIModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProvider, setSelectedProvider] = useState<ProviderMeta | null>(null);
  const [, setKeyVersion] = useState(0);

  const loadModels = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getModels();
      setModels(data);
      // If an initial provider was specified, open its panel
      if (initialProvider && !selectedProvider) {
        const meta = PROVIDER_META.find(m => m.key === initialProvider);
        if (meta) setSelectedProvider(meta);
      }
    } finally {
      setLoading(false);
    }
  }, [initialProvider]);

  useEffect(() => {
    loadModels();
  }, [loadModels]);

  // Re-render when API keys change
  useEffect(() => {
    const handler = () => setKeyVersion(v => v + 1);
    window.addEventListener(API_KEY_CHANGE_EVENT, handler);
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener(API_KEY_CHANGE_EVENT, handler);
      window.removeEventListener('storage', handler);
    };
  }, []);

  // Build the full provider list: known meta + any providers in models without meta
  const knownKeys = new Set(PROVIDER_META.map(m => m.key));
  const extraProviders = [...new Set(models.map(m => m.provider))].filter(p => !knownKeys.has(p));
  const extraMeta: ProviderMeta[] = extraProviders.map(p => ({
    key: p,
    displayName: p,
    tagline: '커스텀 프로바이더',
    avatarBg: 'bg-gray-100',
    avatarText: 'text-gray-700',
    docsUrl: '#',
  }));
  const allMeta = [...PROVIDER_META, ...extraMeta];

  const totalActive = models.filter(m => m.isActive).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Icons.Loader2 size={28} className="animate-spin text-gray-300" />
      </div>
    );
  }

  return (
    <div>
      {/* Summary strip */}
      <div className="flex items-center gap-4 mb-6 p-4 bg-gradient-to-r from-gray-50 to-blue-50 border border-gray-100 rounded-2xl">
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <Icons.Layers size={16} className="text-blue-500" />
          <span className="font-semibold">{models.length}개 모델</span>
          <span className="text-gray-400">·</span>
          <span className="text-green-600 font-semibold">{totalActive}개 활성</span>
        </div>
        <div className="flex items-center gap-3 ml-auto text-xs text-gray-400">
          <span className="flex items-center gap-1"><Icons.ImageIcon size={11} className="text-purple-400" />{models.filter(m => m.type === 'image').length} 이미지</span>
          <span className="flex items-center gap-1"><Icons.Film size={11} className="text-blue-400" />{models.filter(m => m.type === 'video').length} 비디오</span>
          <span className="flex items-center gap-1"><Icons.Type size={11} className="text-green-400" />{models.filter(m => m.type === 'text').length} 텍스트</span>
        </div>
      </div>

      {/* Provider card grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {allMeta.map(meta => (
          <ProviderCard
            key={meta.key}
            meta={meta}
            models={models}
            onClick={() => setSelectedProvider(meta)}
          />
        ))}
      </div>

      {/* Slide-over detail panel */}
      {selectedProvider && (
        <ProviderDetailPanel
          meta={selectedProvider}
          models={models}
          onClose={() => setSelectedProvider(null)}
          onModelsRefresh={loadModels}
        />
      )}
    </div>
  );
};
