
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

export const ProfilePage: React.FC<ProfilePageProps> = ({ currentUser, onNavigate }) => {
  const [activeTab, setActiveTab] = useState<'general' | 'billing' | 'preferences'>('general');
  const [googleKeySource, setGoogleKeySource] = useState<GoogleApiKeySource>(() => getGoogleApiKeySource());
  const [googleKeyMasked, setGoogleKeyMasked] = useState<string>(() => maskApiKey(getGoogleApiKey()));

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
              <div className="bg-white rounded-[2.5rem] p-8 md:p-10 border border-gray-100 shadow-sm animate-in fade-in slide-in-from-bottom-4 duration-500">
                 <h2 className="text-2xl font-black mb-8">App Preferences</h2>
                 <p className="text-gray-500 italic font-medium">Coming soon: Customize your AI workspace environment.</p>
              </div>
          )}
        </div>
      </div>
    </div>
  );
};
