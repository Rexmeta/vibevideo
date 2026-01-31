
import React, { useState } from 'react';
import { Icons } from './Icons';
import { User, ViewState } from '../types';

interface ProfilePageProps {
    onNavigate?: (view: ViewState) => void;
}

export const ProfilePage: React.FC<ProfilePageProps> = ({ onNavigate }) => {
  const [activeTab, setActiveTab] = useState<'general' | 'billing' | 'preferences'>('general');
  
  const user: User = {
    id: 'u1',
    name: 'Felix Vibe',
    email: 'hello@felixvibe.ai',
    credit_balance: 850,
    tier: 'Pro',
    avatar_url: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Felix'
  };

  const handleLogout = () => {
      if (confirm("Are you sure you want to log out?")) {
          if (onNavigate) onNavigate('landing');
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
                <img src={user.avatar_url} alt={user.name} className="w-full h-full object-cover bg-brand-light" />
              </div>
              <button className="absolute -bottom-2 -right-2 bg-black text-white p-2 rounded-xl shadow-lg hover:scale-110 transition-transform">
                <Icons.ImageIcon size={16} />
              </button>
            </div>
            <h2 className="text-xl font-black">{user.name}</h2>
            <p className="text-gray-500 mb-6 text-sm">{user.email}</p>
            <div className="inline-block px-4 py-1 bg-brand-cyan text-black text-xs font-black uppercase tracking-widest rounded-full">
              {user.tier} Member
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
                        <input type="text" defaultValue={user.name} className="w-full p-4 bg-gray-50 border-2 border-gray-100 rounded-2xl focus:border-brand-cyan outline-none font-bold" />
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-bold ml-1 text-gray-500">Email Address</label>
                        <input type="email" defaultValue={user.email} className="w-full p-4 bg-gray-50 border-2 border-gray-100 rounded-2xl focus:border-brand-cyan outline-none font-bold" />
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
                            <p className="text-gray-400 text-sm">$29/month • Renews on Oct 24, 2024</p>
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
                        <span className="text-sm font-black">{user.credit_balance} / 1000 remaining</span>
                        </div>
                        <div className="h-4 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-brand-cyan animate-[width_1s_ease-out]" style={{ width: `${(user.credit_balance / 1000) * 100}%` }}></div>
                        </div>
                    </div>
                    </div>
                </div>

                <div className="bg-white rounded-[2.5rem] p-8 md:p-10 border border-gray-100 shadow-sm">
                    <h3 className="text-xl font-bold mb-6">Payment Method</h3>
                    <div className="flex items-center justify-between p-4 border-2 border-gray-100 rounded-2xl">
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-8 bg-gray-200 rounded-md flex items-center justify-center">
                                <div className="w-6 h-4 bg-red-500/50 rounded-sm"></div>
                            </div>
                            <div>
                                <p className="font-bold text-sm">Visa ending in 4242</p>
                                <p className="text-xs text-gray-500">Expires 12/25</p>
                            </div>
                        </div>
                        <button className="text-sm font-bold text-gray-400 hover:text-black">Edit</button>
                    </div>
                    <button className="mt-4 text-sm font-bold text-brand-cyan hover:underline">+ Add Payment Method</button>
                </div>
              </div>
          )}

          {activeTab === 'preferences' && (
              <div className="bg-white rounded-[2.5rem] p-8 md:p-10 border border-gray-100 shadow-sm animate-in fade-in slide-in-from-bottom-4 duration-500">
                 <h2 className="text-2xl font-black mb-8">App Preferences</h2>
                 
                 <div className="space-y-8">
                    <div className="flex items-center justify-between">
                        <div className="flex gap-4">
                            <div className="w-10 h-10 bg-brand-light rounded-full flex items-center justify-center text-gray-600">
                                <Icons.Bell size={20} />
                            </div>
                            <div>
                                <h4 className="font-bold">Email Notifications</h4>
                                <p className="text-sm text-gray-500">Receive updates about your video generation status.</p>
                            </div>
                        </div>
                        <div className="w-12 h-6 bg-black rounded-full relative cursor-pointer">
                            <div className="absolute right-1 top-1 w-4 h-4 bg-white rounded-full"></div>
                        </div>
                    </div>

                    <div className="flex items-center justify-between">
                        <div className="flex gap-4">
                            <div className="w-10 h-10 bg-brand-light rounded-full flex items-center justify-center text-gray-600">
                                <Icons.Mail size={20} />
                            </div>
                            <div>
                                <h4 className="font-bold">Marketing Emails</h4>
                                <p className="text-sm text-gray-500">Receive tips, trends, and promotional offers.</p>
                            </div>
                        </div>
                        <div className="w-12 h-6 bg-gray-200 rounded-full relative cursor-pointer">
                            <div className="absolute left-1 top-1 w-4 h-4 bg-white rounded-full"></div>
                        </div>
                    </div>

                    <div className="h-px bg-gray-100"></div>

                    <div className="space-y-4">
                        <h4 className="font-bold">Default Project Settings</h4>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-gray-400 uppercase">Aspect Ratio</label>
                                <select className="w-full p-3 bg-gray-50 rounded-xl border-r-8 border-transparent outline-none font-bold text-sm">
                                    <option>16:9 (YouTube)</option>
                                    <option>9:16 (TikTok)</option>
                                    <option>1:1 (Square)</option>
                                </select>
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-gray-400 uppercase">Resolution</label>
                                <select className="w-full p-3 bg-gray-50 rounded-xl border-r-8 border-transparent outline-none font-bold text-sm">
                                    <option>1080p HD</option>
                                    <option>4K UHD (Pro)</option>
                                </select>
                            </div>
                        </div>
                    </div>
                 </div>
                 <div className="flex justify-end mt-8">
                    <button className="bg-black text-white px-8 py-4 rounded-2xl font-bold hover:scale-105 transition-transform">Save Preferences</button>
                </div>
              </div>
          )}
        </div>
      </div>
    </div>
  );
};
