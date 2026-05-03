
import React, { useState, useEffect, useRef } from 'react';
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
import { uploadQueue } from './services/uploadQueue';
import { SAMPLE_PROJECT_ID } from './services/sampleProject';

const AISTUDIO_CHECK_TIMEOUT_MS = 1500;

const isAiStudioEnv = (): boolean => {
  try { return typeof window !== 'undefined' && !!(window as any).aistudio; } catch { return false; }
};

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<ViewState>('landing');
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [wizardSessionKey, setWizardSessionKey] = useState(0);
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);
  const [expressMode, setExpressMode] = useState(false);
  const [hasApiKey, setHasApiKey] = useState<boolean>(() => hasAnyGoogleApiKey());
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const pendingPostAuthRef = useRef(false);
  const setPendingPostAuth = (v: boolean) => { pendingPostAuthRef.current = v; };

  // 1. Non-blocking API key probe. We never gate the whole app on this —
  //    the result only powers an inline banner / "Select Key" CTA. Veo and
  //    other paid calls already throw their own friendly errors at call time.
  useEffect(() => {
    let cancelled = false;

    const checkKey = async () => {
      // Local store first — instant, no network.
      if (hasAnyGoogleApiKey()) {
        if (!cancelled) setHasApiKey(true);
        return;
      }
      // AI Studio embedded environment may have a host-selected key.
      // Guard with a timeout so a hung host bridge never freezes UI.
      if (isAiStudioEnv()) {
        try {
          const selected = await Promise.race<boolean>([
            Promise.resolve((window as any).aistudio.hasSelectedApiKey()).then(v => !!v),
            new Promise<boolean>(resolve => setTimeout(() => resolve(false), AISTUDIO_CHECK_TIMEOUT_MS)),
          ]);
          if (!cancelled) setHasApiKey(selected || hasAnyGoogleApiKey());
        } catch (err) {
          console.warn("[App] aistudio.hasSelectedApiKey failed:", err);
          if (!cancelled) setHasApiKey(hasAnyGoogleApiKey());
        }
      } else {
        if (!cancelled) setHasApiKey(hasAnyGoogleApiKey());
      }
    };

    checkKey();

    const handleKeyChange = () => {
      if (hasAnyGoogleApiKey()) setHasApiKey(true);
      else checkKey();
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
      if (!user) {
        // Task #95: Sample sessions are anonymous-friendly (no cloud
        // calls), so don't bounce signed-out users out of the wizard
        // when the active project is the bundled sample.
        const inSampleSession =
          currentView === 'create' && editingProjectId === SAMPLE_PROJECT_ID;
        if (
          !inSampleSession &&
          (currentView === 'projects' || currentView === 'create' || currentView === 'profile' || currentView === 'admin' || currentView === 'api-keys')
        ) {
          setCurrentView('landing');
        }
      } else {
        // Defer post-auth navigation until the user object is in state, so
        // the projects screen mounts with a populated uid in one shot.
        if (pendingPostAuthRef.current) {
          pendingPostAuthRef.current = false;
          setCurrentView('projects');
        }
        // Task #83: recovery first. Replay the durable upload queue and
        // auto-resume Veo polling for projects with in-flight ops BEFORE
        // hydrating phantom 'interrupted' cards, so resumed jobs claim
        // their slots and aren't masked by stale UI entries.
        uploadQueue.resumeAll().catch(err =>
          console.warn('[App] uploadQueue.resumeAll failed:', err)
        );
        jobManager
          .autoResumePendingOperations(user.uid)
          .catch(err => console.warn('[App] autoResumePendingOperations failed:', err))
          .finally(() => {
            // Then hydrate phantom cards for any *other* interrupted
            // projects (those without persisted operations).
            jobManager.loadInterruptedFromProjects(user.uid).catch(err =>
              console.warn('[App] loadInterruptedFromProjects failed:', err)
            );
          });
      }
    });
    return () => unsubscribe();
  }, [currentView, editingProjectId]);

  const handleSelectKey = async () => {
    if (isAiStudioEnv()) {
      try {
        await (window as any).aistudio.openSelectKey();
        const selected = await Promise.race<boolean>([
          Promise.resolve((window as any).aistudio.hasSelectedApiKey()).then(v => !!v),
          new Promise<boolean>(resolve => setTimeout(() => resolve(false), AISTUDIO_CHECK_TIMEOUT_MS)),
        ]);
        setHasApiKey(selected || hasAnyGoogleApiKey());
      } catch {
        setHasApiKey(hasAnyGoogleApiKey());
      }
    } else {
      // Outside AI Studio there is no host picker — direct user to the
      // admin / settings page where they can paste a Google Cloud key.
      setHasApiKey(hasAnyGoogleApiKey());
      if (currentUser) setCurrentView('api-keys');
    }
  };

  const handleNavigate = (view: ViewState) => {
    if (!currentUser && (view === 'projects' || view === 'create' || view === 'profile' || view === 'admin' || view === 'api-keys')) {
      setCurrentView('login');
      return;
    }
    if (view === 'create') {
      // Nav "Create" always means "start a new project". If a project is
      // currently open, drop it so the modal's blank/clone/pack flow
      // governs the next step instead of silently keeping the old one.
      setEditingProjectId(null);
      setExpressMode(false);
      setShowNewProjectModal(true);
      return;
    }
    setCurrentView(view);
    setEditingProjectId(null);
    setExpressMode(false);
  };

  const handleEditProject = (id: string) => {
    setEditingProjectId(id);
    setExpressMode(false);
    setCurrentView('create');
  };

  const handleStartFreshProject = () => {
    setEditingProjectId(null);
    setExpressMode(false);
    setShowNewProjectModal(true);
  };

  const handleNewProjectCreated = (id: string) => {
    setShowNewProjectModal(false);
    setEditingProjectId(id);
    setExpressMode(false);
    setCurrentView('create');
    setWizardSessionKey(k => k + 1);
  };

  // Task #95: When a sample is cloned to a real project mid-session, swap
  // editingProjectId silently so a later remount lands on the new id (no
  // wizardSessionKey bump — we want to keep the existing wizard state).
  const handleProjectIdChange = (newId: string) => {
    setEditingProjectId(newId);
  };

  // Task #95: 1-click sample project. Loads a pre-bundled demo straight to
  // Step 6 without any cloud calls. Works for signed-out users too.
  const handleStartSample = () => {
    setExpressMode(false);
    setEditingProjectId(SAMPLE_PROJECT_ID);
    setCurrentView('create');
    setWizardSessionKey(k => k + 1);
  };

  // Task #95: Express Quick Mode preset. Forces Quick mode + Presentation
  // pipeline for a 1-2 minute end-to-end run. Requires login because it
  // triggers real generation.
  const handleStartExpress = () => {
    if (!currentUser) {
      setCurrentView('login');
      return;
    }
    setExpressMode(true);
    setEditingProjectId(null);
    setCurrentView('create');
    setWizardSessionKey(k => k + 1);
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Icons.Loader2 className="animate-spin text-brand-cyan" size={48} />
      </div>
    );
  }

  // Surface the key banner on every authenticated working surface so users
  // who haven't registered a key always have a one-click path into the API
  // key settings page. Hide it on landing/login/signup (pre-auth) and on the
  // api-keys / admin screens themselves where the same CTA would be redundant.
  const bannerHiddenViews: ViewState[] = ['landing', 'login', 'signup', 'api-keys', 'admin'];
  const showApiKeyBanner = !hasApiKey && !!currentUser && !bannerHiddenViews.includes(currentView);
  const aistudioMode = isAiStudioEnv();

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans selection:bg-brand-cyan selection:text-black">
      <NavBar 
        currentView={currentView}
        onNavigate={handleNavigate} 
        isLoggedIn={!!currentUser}
        isAdmin={!!currentUser && isAdminUser(currentUser.uid)}
      />

      {showApiKeyBanner && (
        <div className="bg-sky-50 border-b border-sky-200 px-4 py-3">
          <div className="container mx-auto flex flex-col sm:flex-row sm:items-center gap-3 text-sm">
            <Icons.Key size={16} className="text-sky-600 flex-shrink-0" />
            <p className="text-sky-900 flex-1">
              <span className="font-bold">
                {aistudioMode ? 'Google AI Studio API 키가 선택되지 않았습니다.' : 'Google Cloud API 키가 설정되지 않았습니다.'}
              </span>{' '}
              {aistudioMode
                ? '비디오 생성을 시작하기 전에 결제가 활성화된 키를 선택해주세요.'
                : '비디오 생성을 시작하기 전에 결제가 활성화된 Google Cloud 프로젝트의 키를 등록해주세요.'}
            </p>
            <button
              onClick={handleSelectKey}
              className="self-start sm:self-auto px-4 py-2 rounded-full bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold transition-colors whitespace-nowrap"
            >
              {aistudioMode ? 'Select API Key' : '키 설정으로 이동'}
            </button>
          </div>
        </div>
      )}

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
          <LandingPage
            onNavigate={handleNavigate}
            onStartSample={handleStartSample}
            onStartExpress={handleStartExpress}
          />
        )}

        {currentView === 'projects' && (
          <ProjectManagement 
            userId={currentUser?.uid || ''}
            onNavigate={handleNavigate} 
            onEditProject={handleEditProject}
            onStartSample={handleStartSample}
            onStartExpress={handleStartExpress}
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
              onRequestSelectKey={handleSelectKey}
              expressMode={expressMode}
              onProjectIdChange={handleProjectIdChange}
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

        {currentView === 'api-keys' && (
          <AdminPage
            userId={currentUser?.uid || ''}
            onNavigate={handleNavigate}
            initialTab="api"
            apiKeysOnly
          />
        )}

        {(currentView === 'login' || currentView === 'signup') && (
          <AuthPage 
            onNavigate={handleNavigate} 
            initialMode={currentView === 'login' ? 'login' : 'signup'}
            onAuthSuccess={() => setPendingPostAuth(true)}
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
