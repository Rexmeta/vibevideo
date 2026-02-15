
import React from 'react';
import { ViewState } from '../types';
import { Icons } from './Icons';
import { auth } from '../services/firebaseConfig';
import { signOut } from 'firebase/auth';

interface NavBarProps {
  onNavigate: (view: ViewState) => void;
  currentView: ViewState;
  isLoggedIn: boolean;
  isAdmin?: boolean;
}

export const NavBar: React.FC<NavBarProps> = ({ onNavigate, currentView, isLoggedIn, isAdmin }) => {
  const handleLogout = async () => {
    if (auth && confirm("로그아웃 하시겠습니까?")) {
      await signOut(auth);
      onNavigate('landing');
    }
  };

  return (
    <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-20">
          <div 
            className="flex items-center cursor-pointer" 
            onClick={() => onNavigate('landing')}
          >
            <div className="w-8 h-8 bg-black rounded-lg mr-2 flex items-center justify-center">
              <div className="w-4 h-4 bg-white rounded-full transform rotate-45"></div>
            </div>
            <span className="text-xl font-bold tracking-tight">VibeVideo</span>
          </div>

          <div className="hidden md:flex space-x-8">
            <button 
              onClick={() => onNavigate('landing')}
              className={`font-medium transition-colors ${currentView === 'landing' ? 'text-black' : 'text-gray-500 hover:text-black'}`}
            >
              Home
            </button>
            <button 
              onClick={() => onNavigate('projects')}
              className={`font-medium transition-colors ${currentView === 'projects' || currentView === 'create' ? 'text-black' : 'text-gray-500 hover:text-black'}`}
            >
              My Projects
            </button>
            <button 
              onClick={() => onNavigate('pricing')}
              className={`font-medium transition-colors ${currentView === 'pricing' ? 'text-black' : 'text-gray-500 hover:text-black'}`}
            >
              Pricing
            </button>
          </div>

          <div className="flex items-center space-x-4">
            {!isLoggedIn ? (
              <>
                <button 
                  onClick={() => onNavigate('login')}
                  className="text-gray-500 hover:text-black font-bold mr-2"
                >
                  Sign In
                </button>
                <button 
                  onClick={() => onNavigate('projects')}
                  className="bg-black text-white px-5 py-2.5 rounded-full font-medium hover:scale-105 transition-transform"
                >
                  Get Started
                </button>
              </>
            ) : (
              <div className="flex items-center gap-4">
                <button 
                  onClick={() => onNavigate('create')}
                  className="hidden sm:flex items-center gap-2 bg-brand-cyan text-black px-4 py-2 rounded-full font-bold text-sm hover:brightness-105 transition-all"
                >
                  <Icons.Wand2 size={16} /> Create
                </button>
                <div className="relative group/user">
                  <button 
                    onClick={() => onNavigate('profile')}
                    className={`flex items-center justify-center w-10 h-10 rounded-full border-2 overflow-hidden transition-all ${currentView === 'profile' ? 'border-brand-cyan ring-2 ring-brand-cyan/20' : 'border-gray-200 hover:border-gray-300'}`}
                  >
                    <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${auth?.currentUser?.uid || 'default'}`} alt="User Profile" />
                  </button>
                  <div className="absolute right-0 top-full mt-2 w-48 bg-white rounded-2xl shadow-2xl border border-gray-100 opacity-0 group-hover/user:opacity-100 pointer-events-none group-hover/user:pointer-events-auto transition-all p-2 z-50">
                    <button onClick={() => onNavigate('profile')} className="w-full text-left px-4 py-3 text-sm font-bold hover:bg-gray-50 rounded-xl flex items-center gap-2">
                       <Icons.User size={14} /> Profile
                    </button>
                    {isAdmin && (
                      <button onClick={() => onNavigate('admin')} className="w-full text-left px-4 py-3 text-sm font-bold hover:bg-gray-50 rounded-xl flex items-center gap-2">
                         <Icons.Settings size={14} /> AI 모델 관리
                      </button>
                    )}
                    <button onClick={handleLogout} className="w-full text-left px-4 py-3 text-sm font-bold text-red-500 hover:bg-red-50 rounded-xl flex items-center gap-2">
                       <Icons.LogOut size={14} /> Logout
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
};
