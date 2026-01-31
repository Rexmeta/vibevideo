
import React, { useState } from 'react';
import { ViewState } from '../types';
import { Icons } from './Icons';

interface AuthPageProps {
  onNavigate: (view: ViewState) => void;
  initialMode?: 'login' | 'signup';
}

export const AuthPage: React.FC<AuthPageProps> = ({ onNavigate, initialMode = 'login' }) => {
  const [mode, setMode] = useState<'login' | 'signup'>(initialMode);
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Simulate auth
    setTimeout(() => {
        onNavigate('projects');
    }, 800);
  };

  return (
    <div className="min-h-[calc(100vh-80px)] flex flex-col md:flex-row">
      {/* Left Side - Visual */}
      <div className="hidden md:flex flex-1 bg-black text-white p-12 flex-col justify-between relative overflow-hidden">
        <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-brand-cyan/20 rounded-full blur-[100px] -translate-y-1/2 translate-x-1/3"></div>
        <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-brand-pink/20 rounded-full blur-[80px] translate-y-1/3 -translate-x-1/3"></div>
        
        <div className="relative z-10">
            <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center mb-8">
                <div className="w-6 h-6 bg-black rounded-full transform rotate-45"></div>
            </div>
            <h2 className="text-5xl font-black leading-tight mb-6">
                Turn your ideas into <br/>
                <span className="text-brand-cyan">cinematic reality.</span>
            </h2>
            <p className="text-gray-400 text-lg max-w-md">Join over 100,000 creators using VibeVideo AI to generate professional content in seconds.</p>
        </div>

        <div className="relative z-10 bg-white/10 backdrop-blur-md p-6 rounded-3xl border border-white/10">
            <div className="flex gap-1 mb-4">
                {[1,2,3,4,5].map(i => <Icons.Check key={i} size={16} className="text-brand-green fill-brand-green" />)}
            </div>
            <p className="font-medium text-lg italic mb-4">"This tool completely changed our marketing workflow. What used to take days now takes minutes."</p>
            <div className="flex items-center gap-4">
                <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=Sarah" className="w-10 h-10 rounded-full bg-brand-light" />
                <div>
                    <p className="font-bold text-sm">Sarah Jenkins</p>
                    <p className="text-xs text-gray-400">CMO at TechFlow</p>
                </div>
            </div>
        </div>
      </div>

      {/* Right Side - Form */}
      <div className="flex-1 bg-white p-8 md:p-20 flex flex-col justify-center">
        <div className="max-w-md mx-auto w-full">
            <h1 className="text-4xl font-black mb-2">{mode === 'login' ? 'Welcome back' : 'Create an account'}</h1>
            <p className="text-gray-500 mb-8">
                {mode === 'login' ? 'Enter your details to access your workspace.' : 'Start your 14-day free trial today.'}
            </p>

            <form onSubmit={handleSubmit} className="space-y-6">
                {mode === 'signup' && (
                    <div className="space-y-2">
                        <label className="text-sm font-bold ml-1">Full Name</label>
                        <div className="relative">
                            <Icons.User className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                            <input type="text" className="w-full pl-12 pr-4 py-4 bg-gray-50 border-2 border-gray-100 rounded-2xl focus:border-brand-cyan focus:bg-white transition-all outline-none font-medium" placeholder="John Doe" />
                        </div>
                    </div>
                )}
                
                <div className="space-y-2">
                    <label className="text-sm font-bold ml-1">Email Address</label>
                    <div className="relative">
                        <Icons.Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                        <input type="email" className="w-full pl-12 pr-4 py-4 bg-gray-50 border-2 border-gray-100 rounded-2xl focus:border-brand-cyan focus:bg-white transition-all outline-none font-medium" placeholder="name@company.com" />
                    </div>
                </div>

                <div className="space-y-2">
                    <label className="text-sm font-bold ml-1">Password</label>
                    <div className="relative">
                        <Icons.Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                        <input type={showPassword ? "text" : "password"} className="w-full pl-12 pr-12 py-4 bg-gray-50 border-2 border-gray-100 rounded-2xl focus:border-brand-cyan focus:bg-white transition-all outline-none font-medium" placeholder="••••••••" />
                        <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-black">
                            {showPassword ? <Icons.EyeOff size={20} /> : <Icons.Eye size={20} />}
                        </button>
                    </div>
                </div>

                {mode === 'login' && (
                    <div className="flex justify-end">
                        <button type="button" className="text-sm font-bold text-gray-500 hover:text-brand-cyan">Forgot password?</button>
                    </div>
                )}

                <button type="submit" className="w-full bg-black text-white py-4 rounded-2xl font-bold text-lg hover:brightness-110 shadow-xl transition-all">
                    {mode === 'login' ? 'Sign In' : 'Create Account'}
                </button>
            </form>

            <div className="my-8 flex items-center gap-4">
                <div className="h-px bg-gray-100 flex-1"></div>
                <span className="text-xs font-bold text-gray-400 uppercase">Or continue with</span>
                <div className="h-px bg-gray-100 flex-1"></div>
            </div>

            <div className="grid grid-cols-2 gap-4">
                <button className="flex items-center justify-center gap-2 py-3 border-2 border-gray-100 rounded-2xl font-bold hover:bg-gray-50 transition-all">
                    <Icons.Github size={20} /> GitHub
                </button>
                <button className="flex items-center justify-center gap-2 py-3 border-2 border-gray-100 rounded-2xl font-bold hover:bg-gray-50 transition-all">
                    <span className="font-serif font-bold text-xl">G</span> Google
                </button>
            </div>

            <p className="mt-8 text-center text-sm font-medium text-gray-500">
                {mode === 'login' ? "Don't have an account? " : "Already have an account? "}
                <button onClick={() => setMode(mode === 'login' ? 'signup' : 'login')} className="text-black font-bold hover:underline">
                    {mode === 'login' ? 'Sign up' : 'Log in'}
                </button>
            </p>
        </div>
      </div>
    </div>
  );
};
