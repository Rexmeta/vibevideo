import React, { useState, useEffect, useCallback } from 'react';
import { AIModel, ModelType, ViewState } from '../types';
import { getModels, saveModel, deleteModel, seedDefaultModels, isAdminUser } from '../services/modelService';
import { getModelApiKey, setModelApiKey, getModelEndpoint, setModelEndpoint, getProviderApiKey, setProviderApiKey } from '../services/apiKeyService';
import { Icons } from './Icons';

interface AdminPageProps {
  userId: string;
  onNavigate: (view: ViewState) => void;
}

const emptyModel = (type: ModelType): AIModel => ({
  id: '',
  name: '',
  type,
  provider: '',
  description: '',
  modelId: '',
  isActive: true,
  sortOrder: 0,
  supportsKorean: false,
});

const KNOWN_PROVIDERS = ['Google', 'OpenAI', 'ByteDance', 'Kuaishou', 'Minimax', 'Alibaba', 'Midjourney', 'xAI', 'Black Forest Labs', 'Ideogram', 'NanoBanana', 'Vidu'];

export const AdminPage: React.FC<AdminPageProps> = ({ userId, onNavigate }) => {
  const [models, setModels] = useState<AIModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'image' | 'video' | 'api'>('image');
  const [editingModel, setEditingModel] = useState<AIModel | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newModel, setNewModel] = useState<AIModel>(emptyModel('image'));
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showApiKeys, setShowApiKeys] = useState<Record<string, boolean>>({});
  const [editApiKeys, setEditApiKeys] = useState<Record<string, string>>({});
  const [editEndpoints, setEditEndpoints] = useState<Record<string, string>>({});
  const [providerKeys, setProviderKeys] = useState<Record<string, string>>({});
  const [showProviderKeys, setShowProviderKeys] = useState<Record<string, boolean>>({});
  const [apiSaveMsg, setApiSaveMsg] = useState<Record<string, string>>({});

  const loadModels = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getModels();
      setModels(data);
      const keys: Record<string, string> = {};
      const endpoints: Record<string, string> = {};
      data.forEach(m => {
        keys[m.id] = getModelApiKey(m.id) || (m.modelId ? getModelApiKey(m.modelId) : '') || '';
        endpoints[m.id] = getModelEndpoint(m.id) || (m.modelId ? getModelEndpoint(m.modelId) : '') || '';
      });
      setEditApiKeys(keys);
      setEditEndpoints(endpoints);
      const pKeys: Record<string, string> = {};
      KNOWN_PROVIDERS.forEach(p => {
        pKeys[p] = getProviderApiKey(p) || '';
      });
      setProviderKeys(pKeys);
    } catch (e) {
      console.error('Failed to load models:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadModels();
  }, [loadModels]);

  const filteredModels = models
    .filter(m => m.type === activeTab)
    .filter(m =>
      searchQuery === '' ||
      m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.provider.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.description.toLowerCase().includes(searchQuery.toLowerCase())
    )
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const handleToggleActive = async (model: AIModel) => {
    setSaving(true);
    const updated = { ...model, isActive: !model.isActive };
    await saveModel(updated);
    setModels(prev => prev.map(m => m.id === model.id ? updated : m));
    setSaving(false);
  };

  const handleSaveEdit = async () => {
    if (!editingModel) return;
    setSaving(true);
    await saveModel(editingModel);
    setModels(prev => prev.map(m => m.id === editingModel.id ? editingModel : m));
    setEditingModel(null);
    setSaving(false);
  };

  const handleAddModel = async () => {
    if (!newModel.name || !newModel.modelId) return;
    setSaving(true);
    const modelToSave = {
      ...newModel,
      id: `${newModel.type === 'image' ? 'img' : 'vid'}-${newModel.modelId.replace(/[^a-zA-Z0-9-]/g, '-')}`,
      type: activeTab === 'api' ? 'image' as ModelType : activeTab as ModelType,
    };
    await saveModel(modelToSave);
    setModels(prev => [...prev, modelToSave]);
    setNewModel(emptyModel(activeTab === 'api' ? 'image' : activeTab));
    setShowAddForm(false);
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    setSaving(true);
    await deleteModel(id);
    setModels(prev => prev.filter(m => m.id !== id));
    setDeleteConfirmId(null);
    setSaving(false);
  };

  const handleResetDefaults = async () => {
    if (!confirm('기본 모델로 초기화하시겠습니까? 모든 변경사항이 사라집니다.')) return;
    setSaving(true);
    await seedDefaultModels();
    await loadModels();
    setSaving(false);
  };

  const handleSaveModelApiKey = (modelId: string) => {
    const value = editApiKeys[modelId] || '';
    const endpointValue = editEndpoints[modelId] || '';
    setModelApiKey(modelId, value);
    setModelEndpoint(modelId, endpointValue);
    const target = models.find(m => m.id === modelId);
    if (target?.modelId && target.modelId !== modelId) {
      setModelApiKey(target.modelId, value);
      setModelEndpoint(target.modelId, endpointValue);
    }
    setApiSaveMsg(prev => ({ ...prev, [modelId]: '저장됨' }));
    setTimeout(() => setApiSaveMsg(prev => ({ ...prev, [modelId]: '' })), 2000);
  };

  const handleSaveProviderKey = (provider: string) => {
    setProviderApiKey(provider, providerKeys[provider] || '');
    setApiSaveMsg(prev => ({ ...prev, [`prov_${provider}`]: '저장됨' }));
    setTimeout(() => setApiSaveMsg(prev => ({ ...prev, [`prov_${provider}`]: '' })), 2000);
  };

  const toggleShowApiKey = (id: string) => {
    setShowApiKeys(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const getProviderModels = (provider: string) => models.filter(m => m.provider === provider);
  const activeProviders = [...new Set(models.map(m => m.provider))].sort();

  if (!isAdminUser(userId)) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20 text-center">
        <Icons.Shield size={48} className="mx-auto mb-4 text-red-400" />
        <h2 className="text-2xl font-bold mb-2">접근 권한이 없습니다</h2>
        <p className="text-gray-500 mb-6">관리자만 접근할 수 있는 페이지입니다.</p>
        <button onClick={() => onNavigate('projects')} className="px-6 py-3 bg-black text-white rounded-xl font-semibold hover:bg-gray-800 transition-colors">
          돌아가기
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Icons.Loader2 size={32} className="animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-10">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <button onClick={() => onNavigate('projects')} className="p-2 hover:bg-gray-100 rounded-xl transition-colors">
            <Icons.ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-3xl font-black">AI 모델 관리</h1>
            <p className="text-gray-500 text-sm mt-1">모델을 추가, 수정, 삭제하고 API 키를 관리할 수 있습니다</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleResetDefaults}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2.5 border border-gray-200 text-gray-600 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            <Icons.RotateCcw size={16} />
            기본값 초기화
          </button>
          {activeTab !== 'api' && (
            <button
              onClick={() => { setNewModel(emptyModel(activeTab)); setShowAddForm(true); }}
              className="flex items-center gap-2 px-4 py-2.5 bg-black text-white rounded-xl text-sm font-semibold hover:bg-gray-800 transition-colors"
            >
              <Icons.Plus size={16} />
              모델 추가
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-4 mb-6">
        <div className="flex bg-gray-100 rounded-xl p-1">
          <button
            onClick={() => setActiveTab('image')}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-all ${activeTab === 'image' ? 'bg-white text-black shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            <Icons.ImageIcon size={16} />
            이미지 모델
            <span className={`ml-1 px-2 py-0.5 rounded-full text-xs ${activeTab === 'image' ? 'bg-black text-white' : 'bg-gray-200 text-gray-600'}`}>
              {models.filter(m => m.type === 'image').length}
            </span>
          </button>
          <button
            onClick={() => setActiveTab('video')}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-all ${activeTab === 'video' ? 'bg-white text-black shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            <Icons.Film size={16} />
            비디오 모델
            <span className={`ml-1 px-2 py-0.5 rounded-full text-xs ${activeTab === 'video' ? 'bg-black text-white' : 'bg-gray-200 text-gray-600'}`}>
              {models.filter(m => m.type === 'video').length}
            </span>
          </button>
          <button
            onClick={() => setActiveTab('api')}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-all ${activeTab === 'api' ? 'bg-white text-black shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            <Icons.Key size={16} />
            API 설정
            <span className={`ml-1 px-2 py-0.5 rounded-full text-xs ${activeTab === 'api' ? 'bg-black text-white' : 'bg-gray-200 text-gray-600'}`}>
              {activeProviders.length}
            </span>
          </button>
        </div>
        {activeTab !== 'api' && (
          <>
            <div className="flex-1" />
            <div className="relative">
              <Icons.Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="모델 검색..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-black/10 focus:border-gray-300 w-64"
              />
            </div>
          </>
        )}
      </div>

      {activeTab === 'api' ? (
        <div className="space-y-6">
          <div className="bg-blue-50 border border-blue-200 rounded-2xl p-5">
            <div className="flex items-start gap-3">
              <Icons.AlertCircle size={20} className="text-blue-500 mt-0.5 flex-shrink-0" />
              <div>
                <h3 className="font-bold text-sm text-blue-800 mb-1">API 키 관리 안내</h3>
                <p className="text-xs text-blue-600 leading-relaxed">
                  각 AI 프로바이더의 API 키를 설정하면 해당 프로바이더의 모든 모델에 적용됩니다.
                  개별 모델에 별도의 API 키를 설정하면 프로바이더 키보다 우선 적용됩니다.
                  API 키는 브라우저 로컬 저장소에만 저장되며 서버로 전송되지 않습니다.
                </p>
              </div>
            </div>
          </div>

          <div>
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
              <Icons.Shield size={18} />
              프로바이더별 API 키
            </h2>
            <div className="grid grid-cols-1 gap-3">
              {activeProviders.map(provider => {
                const provModels = getProviderModels(provider);
                const hasKey = !!(providerKeys[provider]?.trim());
                return (
                  <div key={provider} className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold ${hasKey ? 'bg-green-50 text-green-600' : 'bg-gray-50 text-gray-400'}`}>
                          {provider.charAt(0)}
                        </div>
                        <div>
                          <h3 className="font-bold text-sm">{provider}</h3>
                          <p className="text-xs text-gray-400">
                            {provModels.length}개 모델 ({provModels.filter(m => m.type === 'image').length} 이미지, {provModels.filter(m => m.type === 'video').length} 비디오)
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {hasKey ? (
                          <span className="flex items-center gap-1 px-2.5 py-1 bg-green-50 text-green-600 rounded-lg text-xs font-semibold">
                            <Icons.Check size={12} />
                            설정됨
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 px-2.5 py-1 bg-gray-100 text-gray-400 rounded-lg text-xs font-medium">
                            미설정
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <Icons.Key size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300" />
                        <input
                          type={showProviderKeys[provider] ? 'text' : 'password'}
                          value={providerKeys[provider] || ''}
                          onChange={e => setProviderKeys(prev => ({ ...prev, [provider]: e.target.value }))}
                          placeholder={`${provider} API 키를 입력하세요`}
                          className="w-full pl-9 pr-10 py-2.5 border border-gray-200 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-black/10"
                        />
                        <button
                          onClick={() => setShowProviderKeys(prev => ({ ...prev, [provider]: !prev[provider] }))}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                        >
                          {showProviderKeys[provider] ? <Icons.EyeOff size={14} /> : <Icons.Eye size={14} />}
                        </button>
                      </div>
                      <button
                        onClick={() => handleSaveProviderKey(provider)}
                        className="flex items-center gap-1.5 px-4 py-2.5 bg-black text-white rounded-xl text-xs font-semibold hover:bg-gray-800 transition-colors flex-shrink-0"
                      >
                        <Icons.Save size={13} />
                        저장
                      </button>
                    </div>
                    {apiSaveMsg[`prov_${provider}`] && (
                      <p className="text-xs text-green-500 font-medium mt-2 flex items-center gap-1">
                        <Icons.Check size={12} /> {apiSaveMsg[`prov_${provider}`]}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
              <Icons.Settings size={18} />
              개별 모델 API 설정
            </h2>
            <p className="text-xs text-gray-400 mb-4">프로바이더 키와 다른 별도의 API 키나 엔드포인트가 필요한 모델만 설정하세요.</p>
            <div className="grid grid-cols-1 gap-3">
              {models.sort((a, b) => a.provider.localeCompare(b.provider) || a.sortOrder - b.sortOrder).map(model => {
                const modelKey = editApiKeys[model.id] || '';
                const modelEndpoint = editEndpoints[model.id] || '';
                const provKey = providerKeys[model.provider] || '';
                const effectiveKey = modelKey || provKey;
                const hasOwnKey = !!modelKey.trim();
                const hasEffectiveKey = !!effectiveKey.trim();
                const isExpanded = showApiKeys[model.id];
                return (
                  <div key={model.id} className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
                    <div
                      className="flex items-center gap-3 p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                      onClick={() => toggleShowApiKey(model.id)}
                    >
                      <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center">
                        {model.type === 'image' ? <Icons.ImageIcon size={14} className="text-gray-500" /> : <Icons.Film size={14} className="text-gray-500" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm truncate">{model.name}</span>
                          <span className="px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded text-xs">{model.provider}</span>
                        </div>
                        <p className="text-xs text-gray-300 mt-0.5 font-mono">{model.modelId}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {hasOwnKey ? (
                          <span className="flex items-center gap-1 px-2 py-0.5 bg-blue-50 text-blue-600 rounded-md text-xs font-medium">
                            <Icons.Key size={10} /> 개별 키
                          </span>
                        ) : hasEffectiveKey ? (
                          <span className="flex items-center gap-1 px-2 py-0.5 bg-green-50 text-green-600 rounded-md text-xs font-medium">
                            <Icons.Check size={10} /> 프로바이더 키
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 px-2 py-0.5 bg-orange-50 text-orange-500 rounded-md text-xs font-medium">
                            <Icons.AlertCircle size={10} /> 키 없음
                          </span>
                        )}
                        <Icons.ChevronDown size={16} className={`text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                      </div>
                    </div>
                    {isExpanded && (
                      <div className="px-4 pb-4 pt-0 border-t border-gray-50">
                        <div className="space-y-3 mt-3">
                          <div>
                            <label className="block text-xs font-semibold text-gray-500 mb-1.5">API 키 (선택사항 - 프로바이더 키와 다른 경우만)</label>
                            <div className="relative">
                              <input
                                type={showApiKeys[`val_${model.id}`] ? 'text' : 'password'}
                                value={editApiKeys[model.id] || ''}
                                onChange={e => setEditApiKeys(prev => ({ ...prev, [model.id]: e.target.value }))}
                                placeholder={provKey ? `프로바이더 키 사용 중 (${provKey.slice(0, 8)}...)` : 'API 키를 입력하세요'}
                                className="w-full pr-10 px-3 py-2.5 border border-gray-200 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-black/10"
                              />
                              <button
                                onClick={(e) => { e.stopPropagation(); setShowApiKeys(prev => ({ ...prev, [`val_${model.id}`]: !prev[`val_${model.id}`] })); }}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                              >
                                {showApiKeys[`val_${model.id}`] ? <Icons.EyeOff size={14} /> : <Icons.Eye size={14} />}
                              </button>
                            </div>
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-gray-500 mb-1.5">API 엔드포인트 (선택사항)</label>
                            <input
                              type="text"
                              value={editEndpoints[model.id] || ''}
                              onChange={e => setEditEndpoints(prev => ({ ...prev, [model.id]: e.target.value }))}
                              placeholder="예: https://api.example.com/v1/generate"
                              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-black/10"
                            />
                          </div>
                          <div className="flex items-center justify-between">
                            <div>
                              {apiSaveMsg[model.id] && (
                                <span className="text-xs text-green-500 font-medium flex items-center gap-1">
                                  <Icons.Check size={12} /> {apiSaveMsg[model.id]}
                                </span>
                              )}
                            </div>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleSaveModelApiKey(model.id); }}
                              className="flex items-center gap-1.5 px-4 py-2 bg-black text-white rounded-xl text-xs font-semibold hover:bg-gray-800 transition-colors"
                            >
                              <Icons.Save size={13} />
                              저장
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <>
          {showAddForm && (
            <div className="bg-white border border-gray-200 rounded-2xl p-6 mb-6 shadow-sm">
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-lg font-bold">새 모델 추가</h3>
                <button onClick={() => setShowAddForm(false)} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
                  <Icons.X size={18} />
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1.5">모델 이름</label>
                  <input
                    type="text"
                    value={newModel.name}
                    onChange={e => setNewModel(prev => ({ ...prev, name: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-black/10"
                    placeholder="예: GPT Image 2.0"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1.5">제공자</label>
                  <input
                    type="text"
                    value={newModel.provider}
                    onChange={e => setNewModel(prev => ({ ...prev, provider: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-black/10"
                    placeholder="예: OpenAI"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1.5">모델 ID</label>
                  <input
                    type="text"
                    value={newModel.modelId}
                    onChange={e => setNewModel(prev => ({ ...prev, modelId: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-black/10"
                    placeholder="예: gpt-image-2.0"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1.5">정렬 순서</label>
                  <input
                    type="number"
                    value={newModel.sortOrder}
                    onChange={e => setNewModel(prev => ({ ...prev, sortOrder: parseInt(e.target.value) || 0 }))}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-black/10"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-semibold text-gray-500 mb-1.5">설명</label>
                  <input
                    type="text"
                    value={newModel.description}
                    onChange={e => setNewModel(prev => ({ ...prev, description: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-black/10"
                    placeholder="모델에 대한 간단한 설명"
                  />
                </div>
                <div className="flex items-center gap-6">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newModel.supportsKorean}
                      onChange={e => setNewModel(prev => ({ ...prev, supportsKorean: e.target.checked }))}
                      className="w-4 h-4 rounded border-gray-300 accent-black"
                    />
                    <span className="text-sm font-medium">한국어 지원</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newModel.isActive}
                      onChange={e => setNewModel(prev => ({ ...prev, isActive: e.target.checked }))}
                      className="w-4 h-4 rounded border-gray-300 accent-black"
                    />
                    <span className="text-sm font-medium">활성화</span>
                  </label>
                </div>
              </div>
              <div className="flex justify-end gap-3 mt-5">
                <button onClick={() => setShowAddForm(false)} className="px-4 py-2.5 border border-gray-200 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors">
                  취소
                </button>
                <button
                  onClick={handleAddModel}
                  disabled={!newModel.name || !newModel.modelId || saving}
                  className="flex items-center gap-2 px-5 py-2.5 bg-black text-white rounded-xl text-sm font-semibold hover:bg-gray-800 transition-colors disabled:opacity-50"
                >
                  <Icons.Save size={16} />
                  저장
                </button>
              </div>
            </div>
          )}

          {filteredModels.length === 0 ? (
            <div className="text-center py-20">
              <Icons.AlertCircle size={40} className="mx-auto mb-3 text-gray-300" />
              <p className="text-gray-400 font-medium">
                {searchQuery ? '검색 결과가 없습니다' : '등록된 모델이 없습니다'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {filteredModels.map(model => {
                const modelKey = editApiKeys[model.id] || '';
                const provKey = providerKeys[model.provider] || '';
                const hasEffectiveKey = !!(modelKey.trim() || provKey.trim());
                return (
                  <div key={model.id} className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow">
                    {editingModel?.id === model.id ? (
                      <div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-semibold text-gray-500 mb-1.5">모델 이름</label>
                            <input
                              type="text"
                              value={editingModel.name}
                              onChange={e => setEditingModel(prev => prev ? { ...prev, name: e.target.value } : null)}
                              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-black/10"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-gray-500 mb-1.5">제공자</label>
                            <input
                              type="text"
                              value={editingModel.provider}
                              onChange={e => setEditingModel(prev => prev ? { ...prev, provider: e.target.value } : null)}
                              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-black/10"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-gray-500 mb-1.5">모델 ID</label>
                            <input
                              type="text"
                              value={editingModel.modelId}
                              onChange={e => setEditingModel(prev => prev ? { ...prev, modelId: e.target.value } : null)}
                              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-black/10"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-gray-500 mb-1.5">정렬 순서</label>
                            <input
                              type="number"
                              value={editingModel.sortOrder}
                              onChange={e => setEditingModel(prev => prev ? { ...prev, sortOrder: parseInt(e.target.value) || 0 } : null)}
                              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-black/10"
                            />
                          </div>
                          <div className="md:col-span-2">
                            <label className="block text-xs font-semibold text-gray-500 mb-1.5">설명</label>
                            <input
                              type="text"
                              value={editingModel.description}
                              onChange={e => setEditingModel(prev => prev ? { ...prev, description: e.target.value } : null)}
                              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-black/10"
                            />
                          </div>
                          <div className="flex items-center gap-6">
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={editingModel.supportsKorean}
                                onChange={e => setEditingModel(prev => prev ? { ...prev, supportsKorean: e.target.checked } : null)}
                                className="w-4 h-4 rounded border-gray-300 accent-black"
                              />
                              <span className="text-sm font-medium">한국어 지원</span>
                            </label>
                          </div>
                        </div>
                        <div className="flex justify-end gap-3 mt-4">
                          <button onClick={() => setEditingModel(null)} className="px-4 py-2 border border-gray-200 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors">
                            취소
                          </button>
                          <button
                            onClick={handleSaveEdit}
                            disabled={saving}
                            className="flex items-center gap-2 px-5 py-2 bg-black text-white rounded-xl text-sm font-semibold hover:bg-gray-800 transition-colors disabled:opacity-50"
                          >
                            <Icons.Save size={14} />
                            저장
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-4">
                        <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center">
                          {model.type === 'image' ? <Icons.ImageIcon size={18} className="text-gray-500" /> : <Icons.Film size={18} className="text-gray-500" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <h3 className="font-bold text-sm truncate">{model.name}</h3>
                            <span className="flex-shrink-0 px-2 py-0.5 bg-gray-100 text-gray-500 rounded-md text-xs font-medium">{model.provider}</span>
                            {model.supportsKorean && (
                              <span className="flex-shrink-0 flex items-center gap-1 px-2 py-0.5 bg-blue-50 text-blue-600 rounded-md text-xs font-medium">
                                <Icons.Globe size={10} />
                                한국어
                              </span>
                            )}
                            {hasEffectiveKey ? (
                              <span className="flex-shrink-0 flex items-center gap-1 px-2 py-0.5 bg-green-50 text-green-600 rounded-md text-xs font-medium">
                                <Icons.Key size={10} />
                                API 연결됨
                              </span>
                            ) : (
                              <span className="flex-shrink-0 flex items-center gap-1 px-2 py-0.5 bg-orange-50 text-orange-500 rounded-md text-xs font-medium">
                                <Icons.AlertCircle size={10} />
                                API 미설정
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-400 truncate">{model.description}</p>
                          <p className="text-xs text-gray-300 mt-0.5">ID: {model.modelId}</p>
                        </div>
                        <div className="flex items-center gap-3 flex-shrink-0">
                          <span className="text-xs text-gray-400 font-medium">#{model.sortOrder}</span>
                          <button
                            onClick={() => handleToggleActive(model)}
                            disabled={saving}
                            className={`relative w-11 h-6 rounded-full transition-colors duration-200 ${model.isActive ? 'bg-green-500' : 'bg-gray-300'}`}
                          >
                            <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${model.isActive ? 'left-[22px]' : 'left-0.5'}`} />
                          </button>
                          <button
                            onClick={() => setEditingModel({ ...model })}
                            className="p-2 hover:bg-gray-100 rounded-lg transition-colors text-gray-400 hover:text-gray-700"
                          >
                            <Icons.Edit3 size={16} />
                          </button>
                          {deleteConfirmId === model.id ? (
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => handleDelete(model.id)}
                                disabled={saving}
                                className="px-3 py-1.5 bg-red-500 text-white rounded-lg text-xs font-semibold hover:bg-red-600 transition-colors"
                              >
                                삭제
                              </button>
                              <button
                                onClick={() => setDeleteConfirmId(null)}
                                className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs font-medium hover:bg-gray-50 transition-colors"
                              >
                                취소
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setDeleteConfirmId(model.id)}
                              className="p-2 hover:bg-red-50 rounded-lg transition-colors text-gray-400 hover:text-red-500"
                            >
                              <Icons.Trash2 size={16} />
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      <div className="mt-8 text-center text-xs text-gray-300">
        전체 모델: {models.length}개 | 이미지: {models.filter(m => m.type === 'image').length}개 | 비디오: {models.filter(m => m.type === 'video').length}개
      </div>
    </div>
  );
};
