
import React, { useState, useEffect } from 'react';
import { NavBar } from './components/NavBar';
import { LandingPage } from './components/LandingPage';
import { ProjectWizard } from './components/ProjectWizard';
import { ProjectManagement } from './components/ProjectManagement';
import { ProfilePage } from './components/ProfilePage';
import { PricingPage } from './components/PricingPage';
import { AuthPage } from './components/AuthPage';
import { AdminPage } from './components/AdminPage';
import { StudioDock } from './components/StudioDock';
import { NewProjectModal } from './components/NewProjectModal';
import { ViewState } from './types';
import { Icons } from './components/Icons';
import { auth, isFirebaseConfigured } from './services/firebaseConfig';
import { onAuthStateChanged, User } from 'firebase/auth';
import { isAdminUser } from './services/modelService';
import { hasAnyGoogleApiKey, API_KEY_CHANGE_EVENT } from './services/apiKeyService';
import { jobManager } from './services/jobManager';

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<ViewState>('landing');
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [wizardSessionKey, setWizardSessionKey] = useState(0);
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // 1. Mandatory check for billing-enabled API key for Veo models
  useEffect(() => {
    let cancelled = false;

    const checkKey = async () => {
      try {
        if (hasAnyGoogleApiKey()) {
          if (!cancelled) setHasApiKey(true);
          return;
        }
        if ((window as any).aistudio) {
          const selected = await (window as any).aistudio.hasSelectedApiKey();
          if (!cancelled) setHasApiKey(!!selected || hasAnyGoogleApiKey());
        } else {
          if (!cancelled) setHasApiKey(false);
        }
      } catch (err) {
        console.error("API Key check failed:", err);
        if (!cancelled) setHasApiKey(hasAnyGoogleApiKey());
      }
    };

    checkKey();

    const handleKeyChange = () => {
      if (hasAnyGoogleApiKey()) {
        setHasApiKey(true);
      } else {
        checkKey();
      }
    };
    const handleStorage = (e: StorageEvent) => {
      if (!e.key || e.key === 'vibe_model_api_keys' || e.key === 'vibe_ai_models') handleKeyChange();
    };
    window.addEventListener(API_KEY_CHANGE_EVENT, handleKeyChange);
    window.addEventListener('storage', handleStorage);

    return () => {
      cancelled = true;
      window.removeEventListener(API_KEY_CHANGE_EVENT, handleKeyChange);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  // 2. Track Authentication State
  useEffect(() => {
    if (!auth) {
      setAuthLoading(false);
      return;
    }
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setAuthLoading(false);
      if (!user && (currentView === 'projects' || currentView === 'create' || currentView === 'profile')) {
        setCurrentView('landing');
      }
      // On sign-in, hydrate the Studio Dock with phantom cards for any
      // project whose persisted generation_run is 'interrupted', so a
      // refresh during a batch leaves visible "이어서 진행" entries.
      if (user) {
        jobManager.loadInterruptedFromProjects(user.uid).catch(err =>
          console.warn('[App] loadInterruptedFromProjects failed:', err)
        );
      }
    });
    return () => unsubscribe();
  }, [currentView]);

  const handleSelectKey = async () => {
    if ((window as any).aistudio) {
      await (window as any).aistudio.openSelectKey();
      try {
        const selected = await (window as any).aistudio.hasSelectedApiKey();
        setHasApiKey(!!selected || hasAnyGoogleApiKey());
      } catch {
        setHasApiKey(hasAnyGoogleApiKey());
      }
    } else {
      setHasApiKey(hasAnyGoogleApiKey());
    }
  };

  const handleNavigate = (view: ViewState) => {
    if (!currentUser && (view === 'projects' || view === 'create' || view === 'profile' || view === 'admin')) {
      setCurrentView('login');
      return;
    }
    if (view === 'create') {
      // Nav "Create" always means "start a new project". If a project is
      // currently open, drop it so the modal's blank/clone/pack flow
      // governs the next step instead of silently keeping the old one.
      setEditingProjectId(null);
      setShowNewProjectModal(true);
      return;
    }
    setCurrentView(view);
    setEditingProjectId(null);
  };

  const handleEditProject = (id: string) => {
    setEditingProjectId(id);
    setCurrentView('create');
  };

  const handleStartFreshProject = () => {
    setEditingProjectId(null);
    setShowNewProjectModal(true);
  };

  const handleNewProjectCreated = (id: string) => {
    setShowNewProjectModal(false);
    setEditingProjectId(id);
    setCurrentView('create');
    setWizardSessionKey(k => k + 1);
  };

  if (authLoading || hasApiKey === null) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Icons.Loader2 className="animate-spin text-brand-cyan" size={48} />
      </div>
    );
  }

  if (hasApiKey === false) {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-6 text-center">
        <div className="max-w-md w-full">
          <div className="w-20 h-20 bg-brand-cyan/20 rounded-3xl flex items-center justify-center mx-auto mb-8">
            <div className="w-10 h-10 bg-brand-cyan rounded-full animate-pulse shadow-[0_0_30px_rgba(0,255,255,0.5)]"></div>
          </div>
          <h1 className="text-4xl font-black mb-4 tracking-tight">API Key Required</h1>
          <p className="text-gray-400 mb-10 leading-relaxed font-medium">
            VibeVideo requires a billing-enabled API key from a paid Google Cloud project to generate professional AI videos with Veo 3.1.
          </p>
          <div className="space-y-4">
            <button 
              onClick={handleSelectKey}
              className="w-full bg-brand-cyan text-black py-4 rounded-full font-black text-lg hover:scale-[1.02] active:scale-95 transition-all shadow-[0_10px_40px_rgba(0,255,255,0.3)]"
            >
              Select Paid API Key
            </button>
            <a 
              href="https://ai.google.dev/gemini-api/docs/billing" 
              target="_blank" 
              rel="noreferrer"
              className="block text-sm font-bold text-gray-500 hover:text-white transition-colors"
            >
              View Billing Documentation
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans selection:bg-brand-cyan selection:text-black">
      <NavBar 
        currentView={currentView}
        onNavigate={handleNavigate} 
        isLoggedIn={!!currentUser}
        isAdmin={!!currentUser && isAdminUser(currentUser.uid)}
      />

      {!isFirebaseConfigured() && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-3">
          <div className="container mx-auto flex items-center gap-3 text-sm">
            <Icons.VideoOff size={16} className="text-amber-600 flex-shrink-0" />
            <p className="text-amber-800">
              <span className="font-bold">Firebase 설정이 필요합니다.</span>{' '}
              로그인, 프로젝트 저장 등의 기능을 사용하려면 Firebase 환경 변수를 설정해주세요.
              (FIREBASE_API_KEY, FIREBASE_AUTH_DOMAIN, FIREBASE_PROJECT_ID, FIREBASE_APP_ID)
            </p>
          </div>
        </div>
      )}
      
      <main>
        {currentView === 'landing' && (
          <LandingPage onNavigate={handleNavigate} />
        )}

        {currentView === 'projects' && (
          <ProjectManagement 
            userId={currentUser?.uid || ''}
            onNavigate={handleNavigate} 
            onEditProject={handleEditProject}
          />
        )}

        {currentView === 'create' && (
          <div className="container mx-auto px-4 py-8">
            <div className="flex justify-between items-end mb-8 max-w-5xl mx-auto">
              <div>
                <h1 className="text-3xl font-black tracking-tight">
                  {editingProjectId ? 'Resume Project' : 'New Generation'}
                </h1>
                <p className="text-gray-500 font-medium italic">AI Vibe Coding Workspace</p>
              </div>
              <button 
                onClick={() => handleNavigate('projects')}
                className="text-gray-400 hover:text-black text-sm font-bold transition-colors"
              >
                Back to Projects
              </button>
            </div>
            <ProjectWizard 
              key={`${editingProjectId || 'new'}:${wizardSessionKey}`}
              userId={currentUser?.uid || ''}
              onNavigate={handleNavigate} 
              onStartFreshProject={handleStartFreshProject}
              initialProjectId={editingProjectId}
            />
          </div>
        )}

        {currentView === 'profile' && (
          <ProfilePage currentUser={currentUser} onNavigate={handleNavigate} />
        )}

        {currentView === 'pricing' && (
          <PricingPage />
        )}

        {currentView === 'admin' && (
          <AdminPage userId={currentUser?.uid || ''} onNavigate={handleNavigate} />
        )}

        {(currentView === 'login' || currentView === 'signup') && (
          <AuthPage 
            onNavigate={handleNavigate} 
            initialMode={currentView === 'login' ? 'login' : 'signup'} 
          />
        )}
      </main>

      {currentUser && (
        <StudioDock onOpenProject={handleEditProject} />
      )}

      {currentUser && showNewProjectModal && (
        <NewProjectModal
          userId={currentUser.uid}
          onClose={() => setShowNewProjectModal(false)}
          onCreated={handleNewProjectCreated}
        />
      )}
    </div>
  );
};

export default App;
