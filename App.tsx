
import React, { useState } from 'react';
import { NavBar } from './components/NavBar';
import { LandingPage } from './components/LandingPage';
import { ProjectWizard } from './components/ProjectWizard';
import { ProjectManagement } from './components/ProjectManagement';
import { ProfilePage } from './components/ProfilePage';
import { PricingPage } from './components/PricingPage';
import { AuthPage } from './components/AuthPage';
import { ViewState } from './types';

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<ViewState>('landing');
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);

  const handleNavigate = (view: ViewState) => {
    setCurrentView(view);
    if (view !== 'create') {
      setEditingProjectId(null);
    }
  };

  const handleEditProject = (id: string) => {
    setEditingProjectId(id);
    setCurrentView('create');
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans selection:bg-brand-cyan selection:text-black">
      <NavBar 
        currentView={currentView}
        onNavigate={handleNavigate} 
      />
      
      <main>
        {currentView === 'landing' && (
          <LandingPage onNavigate={handleNavigate} />
        )}

        {currentView === 'projects' && (
          <ProjectManagement 
            onNavigate={handleNavigate} 
            onEditProject={handleEditProject}
          />
        )}

        {currentView === 'create' && (
          <div className="container mx-auto px-4 py-8">
            <div className="flex justify-between items-end mb-8 max-w-5xl mx-auto">
              <div>
                <h1 className="text-3xl font-black">
                  {editingProjectId ? 'Resume Project' : 'New Generation'}
                </h1>
                <p className="text-gray-500">AI Vibe Coding Workspace</p>
              </div>
              <button 
                onClick={() => handleNavigate('projects')}
                className="text-gray-400 hover:text-black text-sm font-bold transition-colors"
              >
                Back to Projects
              </button>
            </div>
            <ProjectWizard 
              onNavigate={handleNavigate} 
              initialProjectId={editingProjectId}
            />
          </div>
        )}

        {currentView === 'profile' && (
          <ProfilePage onNavigate={handleNavigate} />
        )}

        {currentView === 'pricing' && (
          <PricingPage />
        )}

        {(currentView === 'login' || currentView === 'signup') && (
          <AuthPage 
            onNavigate={handleNavigate} 
            initialMode={currentView === 'login' ? 'login' : 'signup'} 
          />
        )}
      </main>
    </div>
  );
};

export default App;
