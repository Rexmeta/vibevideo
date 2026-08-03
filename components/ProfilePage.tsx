
import React, { useEffect, useState } from 'react';
import { Icons } from './Icons';
import { ViewState } from '../types';
import { auth } from '../services/firebaseConfig';
import { signOut, User } from 'firebase/auth';
import {
  getGoogleApiKey,
  getGoogleApiKeySource,
  GoogleApiKeySource,
  API_KEY_CHANGE_EVENT,
} from '../services/apiKeyService';
import {
  isCloudSyncEnabled,
  setCloudSyncEnabled,
  CLOUD_SYNC_CHANGE_EVENT,
} from '../services/cloudSyncSettings';
import {
  backfillLocalProjectsToCloud,
  pingFirestoreHealth,
  resetFirestoreHealthCheck,
  getFirebaseProjectId,
  getLocalProjects,
} from '../services/storageService';

interface ProfilePageProps {
    currentUser: User | null;
    onNavigate: (view: ViewState) => void;
}

const SOURCE_LABEL: Record<GoogleApiKeySource, string> = {
  provider: '프로바이더 키',
  model: '개별 모델 키',
  env: '환경변수',
  none: '미설정',
};

const SOURCE_DESCRIPTION: Record<GoogleApiKeySource, string> = {
  provider: '관리자 페이지에 저장된 Google 프로바이더 키를 사용합니다.',
  model: '개별 모델에 저장된 Google API 키를 사용합니다.',
  env: '서버 환경변수 API_KEY 값을 사용합니다.',
  none: 'Google API 키가 아직 설정되지 않았습니다. 키를 등록하면 이미지/비디오 생성을 사용할 수 있습니다.',
};

function maskApiKey(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return `${key.slice(0, 2)}…${key.slice(-2)}`;
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

interface GoogleApiKeyCardProps {
  source: GoogleApiKeySource;
  maskedKey: string;
  onGoToSettings: () => void;
}

const GoogleApiKeyCard: React.FC<GoogleApiKeyCardProps> = ({ source, maskedKey, onGoToSettings }) => {
  const isSet = source !== 'none';
  const tone = isSet
    ? 'bg-green-50 border-green-200 text-green-700'
    : 'bg-orange-50 border-orange-200 text-orange-700';
  const badgeTone = isSet ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700';
  const Icon = isSet ? Icons.Check : Icons.AlertCircle;

  return (
    <div className={`flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8 px-5 py-4 border rounded-2xl ${tone}`}>
      <div className="flex items-start gap-3 min-w-0">
        <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold flex-shrink-0 ${badgeTone}`}>
          <Icon size={14} />
          Google API 키: {SOURCE_LABEL[source]}
        </span>
        <div className="min-w-0">
          <p className="text-xs leading-snug">{SOURCE_DESCRIPTION[source]}</p>
          {isSet && maskedKey && (
            <p className="text-xs font-mono mt-1 opacity-80">{maskedKey}</p>
          )}
        </div>
      </div>
      <button
        onClick={onGoToSettings}
        className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold flex-shrink-0 transition-colors ${
          isSet ? 'bg-white text-green-700 hover:bg-green-100 border border-green-200' : 'bg-black text-white hover:bg-gray-800'
        }`}
      >
        <Icons.Key size={13} />
        {isSet ? '변경' : 'API 키 설정으로 이동'}
      </button>
    </div>
  );
};

const RULES_VERIFIED_KEY = 'vibe_firebase_rules_verified';

export const ProfilePage: React.FC<ProfilePageProps> = ({ currentUser, onNavigate }) => {
  const [activeTab, setActiveTab] = useState<'general' | 'billing' | 'preferences'>('general');
  const [googleKeySource, setGoogleKeySource] = useState<GoogleApiKeySource>(() => getGoogleApiKeySource());
  const [googleKeyMasked, setGoogleKeyMasked] = useState<string>(() => maskApiKey(getGoogleApiKey()));
  const [cloudSync, setCloudSync] = useState(() => isCloudSyncEnabled());
  const [cloudTogglePending, setCloudTogglePending] = useState(false);
  const [cloudToggleMsg, setCloudToggleMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [showSetupCard, setShowSetupCard] = useState(false);
  const [setupVerified, setSetupVerified] = useState(() => !!localStorage.getItem(RULES_VERIFIED_KEY));
  const [pingStatus, setPingStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [pingError, setPingError] = useState<string | null>(null);
  const [copiedCmd, setCopiedCmd] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [syncCount, setSyncCount] = useState<number>(0);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [localProjectCount, setLocalProjectCount] = useState<number | null>(null);

  useEffect(() => {
    const update = () => {
      setGoogleKeySource(getGoogleApiKeySource());
      setGoogleKeyMasked(maskApiKey(getGoogleApiKey()));
    };
    update();
    if (typeof window !== 'undefined') {
      window.addEventListener(API_KEY_CHANGE_EVENT, update);
      window.addEventListener('storage', update);
      return () => {
        window.removeEventListener(API_KEY_CHANGE_EVENT, update);
        window.removeEventListener('storage', update);
      };
    }
    return undefined;
  }, []);

  // On mount: if cloud sync is already ON, show the setup card (verified or not)
  useEffect(() => {
    if (isCloudSyncEnabled() && currentUser) {
      setShowSetupCard(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load local project count for the sync prompt
  useEffect(() => {
    if (currentUser) {
      setLocalProjectCount(getLocalProjects(currentUser.uid).length);
    }
  }, [currentUser]);

  const handleCloudSyncToggle = async (enable: boolean) => {
    if (cloudTogglePending) return;
    setCloudTogglePending(true);
    setCloudToggleMsg(null);
    try {
      setCloudSyncEnabled(enable);
      setCloudSync(enable);
      if (enable && currentUser) {
        setShowSetupCard(true);
        setSetupVerified(false);
        setPingStatus('idle');
        setPingError(null);
      } else {
        setShowSetupCard(false);
        setSetupVerified(false);
        localStorage.removeItem(RULES_VERIFIED_KEY);
        setCloudToggleMsg({ kind: 'success', text: '로컬 전용 모드로 전환됐습니다. 모든 데이터는 이 기기에만 저장됩니다.' });
      }
    } catch {
      setCloudToggleMsg({ kind: 'error', text: '설정을 저장하지 못했습니다.' });
    } finally {
      setCloudTogglePending(false);
    }
  };

  const handleTestConnection = async () => {
    if (pingStatus === 'loading') return;
    setPingStatus('loading');
    setPingError(null);
    resetFirestoreHealthCheck(true);
    try {
      const info = await pingFirestoreHealth();
      if (info.disabled) {
        const reasonMap: Record<string, string> = {
          service_disabled: 'Cloud Firestore API가 비활성화돼 있습니다. GCP 콘솔에서 Firestore API를 활성화하세요.',
          permission_denied: '권한이 거부됐습니다. 보안 규칙이 올바르게 배포됐는지 확인하세요.',
          database_not_found: 'Firestore 기본 데이터베이스를 찾을 수 없습니다. GCP 콘솔에서 Firestore를 초기화하세요.',
          project_id_mismatch: 'Firebase 프로젝트 ID가 일치하지 않습니다. 환경변수 FIREBASE_PROJECT_ID를 확인하세요.',
        };
        const msg = (info.reason && reasonMap[info.reason]) || `연결 실패 (${info.reason ?? 'unknown'})`;
        setPingStatus('error');
        setPingError(msg);
      } else {
        setPingStatus('success');
        setSetupVerified(true);
        localStorage.setItem(RULES_VERIFIED_KEY, '1');
      }
    } catch (e: any) {
      setPingStatus('error');
      setPingError(e?.message ?? '알 수 없는 오류가 발생했습니다.');
    }
  };

  const handleSyncNow = async () => {
    if (syncStatus === 'loading' || !currentUser) return;
    setSyncStatus('loading');
    setSyncError(null);
    try {
      const count = await backfillLocalProjectsToCloud(currentUser.uid, { force: true });
      setSyncCount(count);
      setSyncStatus('done');
    } catch (e: any) {
      setSyncError(e?.message ?? '알 수 없는 오류가 발생했습니다.');
      setSyncStatus('error');
    }
  };

  const deployProjectId = getFirebaseProjectId() || 'YOUR_PROJECT_ID';
  const deployCommand = `firebase deploy --project ${deployProjectId} --only firestore:rules,storage`;

  if (!currentUser) return null;

  const handleLogout = async () => {
      if (auth && confirm("Are you sure you want to log out?")) {
          await signOut(auth);
          onNavigate('landing');
      }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-12">
      <h1 className="text-4xl font-black mb-6">Account Settings</h1>

      <GoogleApiKeyCard
        source={googleKeySource}
        maskedKey={googleKeyMasked}
        onGoToSettings={() => onNavigate('api-keys')}
      />

      <div className="grid grid-cols-1 md:grid-cols-12 gap-8">
        {/* Profile Sidebar */}
        <div className="md:col-span-4 lg:col-span-3">
          <div className="bg-white rounded-[2.5rem] p-8 border border-gray-100 shadow-sm text-center mb-6">
            <div className="relative inline-block mb-6">
              <div className="w-32 h-32 rounded-[2rem] overflow-hidden border-4 border-white shadow-xl mx-auto">
                <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${currentUser.uid}`} alt={currentUser.displayName || 'User'} className="w-full h-full object-cover bg-brand-light" />
              </div>
              <button className="absolute -bottom-2 -right-2 bg-black text-white p-2 rounded-xl shadow-lg hover:scale-110 transition-transform">
                <Icons.ImageIcon size={16} />
              </button>
            </div>
            <h2 className="text-xl font-black">{currentUser.displayName || 'Creator'}</h2>
            <p className="text-gray-500 mb-6 text-sm">{currentUser.email}</p>
            <div className="inline-block px-4 py-1 bg-brand-cyan text-black text-xs font-black uppercase tracking-widest rounded-full">
              Pro Member
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <button 
                onClick={() => setActiveTab('general')}
                className={`w-full flex items-center gap-3 px-6 py-4 rounded-2xl font-bold transition-all ${activeTab === 'general' ? 'bg-black text-white shadow-lg' : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-100'}`}
            >
              <Icons.User size={18} /> Profile Details
            </button>
            <button 
                onClick={() => setActiveTab('billing')}
                className={`w-full flex items-center gap-3 px-6 py-4 rounded-2xl font-bold transition-all ${activeTab === 'billing' ? 'bg-black text-white shadow-lg' : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-100'}`}
            >
              <Icons.CreditCard size={18} /> Billing & Plans
            </button>
            <button 
                onClick={() => setActiveTab('preferences')}
                className={`w-full flex items-center gap-3 px-6 py-4 rounded-2xl font-bold transition-all ${activeTab === 'preferences' ? 'bg-black text-white shadow-lg' : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-100'}`}
            >
              <Icons.Settings size={18} /> Preferences
            </button>
            <button 
                onClick={handleLogout}
                className="w-full flex items-center gap-3 px-6 py-4 rounded-2xl bg-white border border-gray-100 text-red-500 font-bold hover:bg-red-50 transition-all mt-4"
            >
              <Icons.LogOut size={18} /> Logout
            </button>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="md:col-span-8 lg:col-span-9 space-y-6">
          
          {activeTab === 'general' && (
              <div className="bg-white rounded-[2.5rem] p-8 md:p-10 border border-gray-100 shadow-sm animate-in fade-in slide-in-from-bottom-4 duration-500">
                <h2 className="text-2xl font-black mb-8">Personal Information</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                    <div className="space-y-2">
                        <label className="text-sm font-bold ml-1 text-gray-500">Full Name</label>
                        <input type="text" defaultValue={currentUser.displayName || ''} className="w-full p-4 bg-gray-50 border-2 border-gray-100 rounded-2xl focus:border-brand-cyan outline-none font-bold" />
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-bold ml-1 text-gray-500">Email Address</label>
                        <input type="email" readOnly value={currentUser.email || ''} className="w-full p-4 bg-gray-100 border-2 border-gray-100 rounded-2xl outline-none font-bold text-gray-500 cursor-not-allowed" />
                    </div>
                    <div className="space-y-2 md:col-span-2">
                        <label className="text-sm font-bold ml-1 text-gray-500">Bio</label>
                        <textarea rows={3} className="w-full p-4 bg-gray-50 border-2 border-gray-100 rounded-2xl focus:border-brand-cyan outline-none font-medium resize-none" placeholder="Tell us a bit about yourself..."></textarea>
                    </div>
                </div>
                <div className="flex justify-end">
                    <button className="bg-black text-white px-8 py-4 rounded-2xl font-bold hover:scale-105 transition-transform">Save Changes</button>
                </div>
              </div>
          )}

          {activeTab === 'billing' && (
              <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="bg-brand-dark text-white rounded-[2.5rem] p-8 md:p-10 shadow-xl relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-brand-cyan/20 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2"></div>
                    <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                        <div>
                            <p className="text-gray-400 font-bold uppercase tracking-widest text-xs mb-2">Current Plan</p>
                            <h2 className="text-4xl font-black mb-2">Pro Plan</h2>
                            <p className="text-gray-400 text-sm">$29/month • Renews on next month</p>
                        </div>
                        <button className="bg-white text-black px-6 py-3 rounded-xl font-bold hover:brightness-90 transition-all">Manage Subscription</button>
                    </div>
                </div>

                <div className="bg-white rounded-[2.5rem] p-8 md:p-10 border border-gray-100 shadow-sm">
                    <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
                    <Icons.Wand2 size={20} className="text-brand-cyan" /> Usage & Credits
                    </h3>
                    <div className="space-y-6">
                    <div>
                        <div className="flex justify-between mb-2">
                        <span className="text-sm font-bold text-gray-600">Monthly Credits</span>
                        <span className="text-sm font-black">850 / 1000 remaining</span>
                        </div>
                        <div className="h-4 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-brand-cyan animate-[width_1s_ease-out]" style={{ width: `85%` }}></div>
                        </div>
                    </div>
                    </div>
                </div>
              </div>
          )}

          {activeTab === 'preferences' && (
              <div className="bg-white rounded-[2.5rem] p-8 md:p-10 border border-gray-100 shadow-sm animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-8">
                <h2 className="text-2xl font-black">App Preferences</h2>

                {/* Cloud Sync Toggle */}
                <div className="flex flex-col gap-4">
                  <h3 className="text-base font-black text-gray-800 flex items-center gap-2">
                    <Icons.Cloud size={18} className="text-brand-cyan" />
                    데이터 저장 방식
                  </h3>

                  <div className={`flex items-start justify-between gap-4 p-5 rounded-2xl border-2 transition-colors ${cloudSync ? 'border-brand-cyan bg-cyan-50' : 'border-gray-100 bg-gray-50'}`}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-black text-sm">클라우드 동기화</span>
                        <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full ${cloudSync ? 'bg-brand-cyan text-black' : 'bg-gray-200 text-gray-600'}`}>
                          {cloudSync ? 'ON' : 'OFF'}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 leading-relaxed">
                        {cloudSync
                          ? '프로젝트가 Firebase에 실시간 저장됩니다. 여러 기기에서 접근 가능합니다. Firebase 보안 규칙 배포가 필요합니다.'
                          : '모든 데이터가 이 기기의 로컬 저장소에만 저장됩니다. Firebase 설정 없이 즉시 사용 가능합니다.'}
                      </p>
                    </div>
                    <button
                      onClick={() => handleCloudSyncToggle(!cloudSync)}
                      disabled={cloudTogglePending}
                      className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors flex-shrink-0 mt-0.5 disabled:opacity-60 ${cloudSync ? 'bg-brand-cyan' : 'bg-gray-300'}`}
                      aria-label="클라우드 동기화 토글"
                    >
                      <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${cloudSync ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                  </div>

                  {/* Descriptions */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className={`p-4 rounded-xl border ${!cloudSync ? 'border-black bg-gray-50' : 'border-gray-100'}`}>
                      <div className="flex items-center gap-2 mb-2">
                        <Icons.Monitor size={15} className={!cloudSync ? 'text-black' : 'text-gray-400'} />
                        <span className={`text-xs font-black ${!cloudSync ? 'text-black' : 'text-gray-400'}`}>로컬 전용 (기본값)</span>
                        {!cloudSync && <span className="text-[9px] font-black bg-black text-white px-1.5 py-0.5 rounded-full ml-auto">현재</span>}
                      </div>
                      <ul className="text-[11px] text-gray-500 space-y-1">
                        <li>✓ Firebase 규칙 배포 불필요</li>
                        <li>✓ 즉시 사용 가능</li>
                        <li>✓ 네트워크 오류 없음</li>
                        <li>✗ 이 기기에서만 접근 가능</li>
                      </ul>
                    </div>
                    <div className={`p-4 rounded-xl border ${cloudSync ? 'border-brand-cyan bg-cyan-50' : 'border-gray-100'}`}>
                      <div className="flex items-center gap-2 mb-2">
                        <Icons.Cloud size={15} className={cloudSync ? 'text-brand-cyan' : 'text-gray-400'} />
                        <span className={`text-xs font-black ${cloudSync ? 'text-brand-dark' : 'text-gray-400'}`}>클라우드 동기화</span>
                        {cloudSync && <span className="text-[9px] font-black bg-brand-cyan text-black px-1.5 py-0.5 rounded-full ml-auto">현재</span>}
                      </div>
                      <ul className="text-[11px] text-gray-500 space-y-1">
                        <li>✓ 여러 기기에서 접근</li>
                        <li>✓ 자동 백업</li>
                        <li>✗ Firebase 보안 규칙 배포 필요</li>
                        <li>✗ 인터넷 연결 필요</li>
                      </ul>
                    </div>
                  </div>

                  {cloudToggleMsg && (
                    <div className={`flex items-start gap-3 p-4 rounded-xl text-sm ${cloudToggleMsg.kind === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
                      {cloudToggleMsg.kind === 'success' ? <Icons.Check size={16} className="shrink-0 mt-0.5" /> : <Icons.AlertCircle size={16} className="shrink-0 mt-0.5" />}
                      <span>{cloudToggleMsg.text}</span>
                    </div>
                  )}

                  {/* Firebase Rules Setup Card — shown when cloud sync just turned ON */}
                  {showSetupCard && (
                    <div className="border-2 border-amber-300 bg-amber-50 rounded-2xl overflow-hidden">
                      {/* Header */}
                      <div className="flex items-center justify-between px-5 py-3 bg-amber-100 border-b border-amber-200">
                        <div className="flex items-center gap-2">
                          <Icons.Shield size={16} className="text-amber-700" />
                          <span className="text-sm font-black text-amber-800">Firebase 보안 규칙 배포 필요</span>
                          {setupVerified && (
                            <span className="text-[10px] font-black bg-emerald-500 text-white px-2 py-0.5 rounded-full">✓ 완료</span>
                          )}
                        </div>
                        {setupVerified && (
                          <button
                            onClick={() => setShowSetupCard(false)}
                            className="text-amber-600 hover:text-amber-800 transition-colors"
                            aria-label="닫기"
                          >
                            <Icons.X size={16} />
                          </button>
                        )}
                      </div>

                      {setupVerified ? (
                        /* Verified state */
                        <div className="px-5 py-4 space-y-4">
                          <div className="flex items-start gap-3">
                            <Icons.Check size={18} className="text-emerald-600 shrink-0 mt-0.5" />
                            <div>
                              <p className="text-sm font-black text-emerald-800">연결 확인 완료!</p>
                              <p className="text-xs text-emerald-700 mt-0.5">Firebase 보안 규칙이 정상 배포됐습니다. "내 프로젝트"에서 클라우드 데이터를 바로 사용할 수 있습니다.</p>
                            </div>
                          </div>

                          {/* Post-setup sync prompt */}
                          {syncStatus !== 'done' && localProjectCount !== 0 && (
                            <div className="flex items-center justify-between gap-3 p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-black text-emerald-800">로컬 프로젝트를 클라우드에 동기화할까요?</p>
                                <p className="text-[11px] text-emerald-700 mt-0.5 leading-snug">
                                  {localProjectCount !== null
                                    ? `이 기기의 로컬 프로젝트 ${localProjectCount}개를 클라우드에 백업합니다.`
                                    : '이 기기에 저장된 프로젝트를 클라우드로 한 번에 백업합니다.'}
                                </p>
                              </div>
                              <button
                                onClick={handleSyncNow}
                                disabled={syncStatus === 'loading'}
                                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60 transition-colors flex-shrink-0"
                              >
                                {syncStatus === 'loading' ? (
                                  <><Icons.Loader2 size={13} className="animate-spin" />동기화 중…</>
                                ) : (
                                  <><Icons.Cloud size={13} />지금 동기화</>
                                )}
                              </button>
                            </div>
                          )}

                          {syncStatus === 'done' && (
                            <div className="flex items-start gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
                              <Icons.Check size={14} className="text-emerald-600 shrink-0 mt-0.5" />
                              <p className="text-xs text-emerald-800">
                                {syncCount > 0
                                  ? `${syncCount}개 프로젝트가 클라우드에 동기화됐습니다.`
                                  : '동기화할 새 프로젝트가 없습니다. 이미 최신 상태입니다.'}
                              </p>
                            </div>
                          )}

                          {syncStatus === 'error' && syncError && (
                            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl">
                              <Icons.AlertCircle size={14} className="text-red-500 shrink-0 mt-0.5" />
                              <p className="text-xs text-red-700 leading-snug">{syncError}</p>
                            </div>
                          )}
                        </div>
                      ) : (
                        /* Setup steps */
                        <div className="px-5 py-4 space-y-4">
                          <p className="text-xs text-amber-800 leading-relaxed">
                            클라우드 동기화를 사용하려면 Firebase 보안 규칙을 먼저 배포해야 합니다. 아래 단계를 따라 진행하세요.
                          </p>

                          {/* Step 1 */}
                          <div className="flex gap-3">
                            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-amber-700 text-white text-xs font-black flex items-center justify-center">1</span>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-black text-amber-900 mb-1.5">배포 명령어 복사</p>
                              <div className="flex items-center gap-2 bg-gray-900 rounded-xl px-3 py-2.5 overflow-hidden">
                                <code className="text-xs text-green-400 font-mono flex-1 min-w-0 truncate">{deployCommand}</code>
                                <button
                                  onClick={() => {
                                    navigator.clipboard.writeText(deployCommand).then(() => {
                                      setCopiedCmd(true);
                                      setTimeout(() => setCopiedCmd(false), 2000);
                                    });
                                  }}
                                  className="flex-shrink-0 flex items-center gap-1 text-[10px] font-bold text-gray-300 hover:text-white transition-colors bg-gray-700 hover:bg-gray-600 px-2 py-1 rounded-lg"
                                  title="클립보드에 복사"
                                >
                                  {copiedCmd ? (
                                    <><Icons.Check size={11} className="text-green-400" /><span className="text-green-400">복사됨</span></>
                                  ) : (
                                    <><Icons.FileText size={11} /><span>복사</span></>
                                  )}
                                </button>
                              </div>
                            </div>
                          </div>

                          {/* Step 2 */}
                          <div className="flex gap-3">
                            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-amber-700 text-white text-xs font-black flex items-center justify-center">2</span>
                            <div className="flex-1">
                              <p className="text-xs font-black text-amber-900 mb-1">Google Cloud Shell에서 실행</p>
                              <p className="text-xs text-amber-700 leading-relaxed">
                                <a
                                  href={`https://console.cloud.google.com/cloudshell?project=${deployProjectId}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="underline font-bold hover:text-amber-900"
                                >
                                  Google Cloud Shell 열기 ↗
                                </a>
                                {' '}에서 위 명령어를 붙여넣고 실행하세요. Firebase CLI가 없으면{' '}
                                <code className="bg-amber-200 px-1 rounded text-[11px]">npm i -g firebase-tools</code> 먼저 설치하세요.
                              </p>
                            </div>
                          </div>

                          {/* Step 3 */}
                          <div className="flex gap-3">
                            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-amber-700 text-white text-xs font-black flex items-center justify-center">3</span>
                            <div className="flex-1">
                              <p className="text-xs font-black text-amber-900 mb-2">연결 테스트</p>
                              <button
                                onClick={handleTestConnection}
                                disabled={pingStatus === 'loading'}
                                className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black bg-amber-700 text-white hover:bg-amber-800 disabled:opacity-60 transition-colors"
                              >
                                {pingStatus === 'loading' ? (
                                  <><Icons.Loader2 size={13} className="animate-spin" />확인 중…</>
                                ) : (
                                  <><Icons.RefreshCw size={13} />연결 테스트</>
                                )}
                              </button>
                              {pingStatus === 'error' && pingError && (
                                <div className="mt-2 flex items-start gap-2 p-2.5 bg-red-50 border border-red-200 rounded-xl">
                                  <Icons.AlertCircle size={13} className="text-red-500 shrink-0 mt-0.5" />
                                  <p className="text-[11px] text-red-700 leading-snug">{pingError}</p>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
          )}
        </div>
      </div>
    </div>
  );
};
