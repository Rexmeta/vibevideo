
import React, { useState } from 'react';
import { Icons } from './Icons';
import { ViewState } from '../types';
import { auth } from '../services/firebaseConfig';
import { signOut, User } from 'firebase/auth';

interface ProfilePageProps {
    currentUser: User | null;
    onNavigate: (view: ViewState) => void;
}

export const ProfilePage: React.FC<ProfilePageProps> = ({ currentUser, onNavigate }) => {
  const [activeTab, setActiveTab] = useState<'general' | 'billing' | 'preferences'>('general');
  
  if (!currentUser) return null;

  const handleLogout = async () => {
      if (auth && confirm("Are you sure you want to log out?")) {
          await signOut(auth);
          onNavigate('landing');
      }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-12">
      <h1 className="text-4xl font-black mb-10">Account Settings</h1>

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
