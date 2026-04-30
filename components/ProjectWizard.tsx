import React, { useEffect, useState } from 'react';
import { ViewState } from '../types';
import { WizardProvider, useWizard } from './wizard/WizardContext';
import { WizardShell } from './wizard/WizardShell';
import { QuickMode } from './wizard/QuickMode';
import { ModeGate, getStoredMode, setStoredMode, type WizardMode } from './wizard/ModeGate';

interface ProjectWizardProps {
  userId: string;
  onNavigate: (view: ViewState) => void;
  onStartFreshProject?: () => void;
  initialProjectId?: string | null;
}

const WizardModeRouter: React.FC<{ initialProjectId?: string | null; onStartFreshProject?: () => void }> = ({ initialProjectId, onStartFreshProject }) => {
  const ctx = useWizard();
  const { loading, scenes, maxStep, step, projectId, savedMode, setSavedMode } = ctx;

  // Determine if this is an existing project (skip mode gate)
  const isExisting = !!initialProjectId;
  const projectHasProgress = (scenes && scenes.length > 0) || maxStep > 1 || step > 1;

  // For existing projects we wait for the cloud restore to complete before picking
  // a mode so we can prefer the project record (cross-device truth) over the local
  // per-project storage key.
  const [mode, setMode] = useState<WizardMode | null>(() => {
    if (isExisting) return null;
    // New project: per-project key won't exist yet, so falls back to global last-used
    return getStoredMode(projectId);
  });

  const persistMode = (m: WizardMode) => {
    setStoredMode(m, projectId);
    setSavedMode(m);
  };

  const switchMode = (m: WizardMode) => {
    setMode(m);
    persistMode(m);
  };

  // For existing projects, resolve mode after the wizard finishes loading the
  // project record. Priority: project record > per-project localStorage > global.
  useEffect(() => {
    if (!isExisting || loading || mode) return;
    const resolved: WizardMode = savedMode || getStoredMode(initialProjectId) || 'pro';
    setMode(resolved);
    persistMode(resolved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isExisting, loading, mode, savedMode, initialProjectId]);

  // Materialize the resolved mode under the per-project key on first open so the
  // project's default no longer drifts when the global last-used preference changes.
  useEffect(() => {
    if (mode) persistMode(mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // After restore: if existing project shows it has progressed, force pro mode
  useEffect(() => {
    if (!loading && projectHasProgress && mode && mode !== 'pro') {
      setMode('pro');
      persistMode('pro');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, projectHasProgress, mode, projectId]);

  if (loading && isExisting) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="bg-white rounded-[4rem] shadow-2xl p-12 min-h-[400px] flex items-center justify-center">
          <div className="text-center">
            <div className="w-16 h-16 border-4 border-gray-100 border-t-brand-cyan rounded-full animate-spin mx-auto mb-4" />
            <p className="text-sm font-bold text-gray-500">프로젝트 로딩 중...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!mode) {
    return <ModeGate projectId={projectId} onSelect={switchMode} />;
  }

  if (mode === 'quick') {
    return <QuickMode onSwitchMode={switchMode} />;
  }

  return <WizardShell onSwitchMode={switchMode} onStartFreshProject={onStartFreshProject} />;
};

export const ProjectWizard: React.FC<ProjectWizardProps> = ({ userId, onNavigate, onStartFreshProject, initialProjectId }) => {
  return (
    <WizardProvider userId={userId} onNavigate={onNavigate} initialProjectId={initialProjectId}>
      <WizardModeRouter initialProjectId={initialProjectId} onStartFreshProject={onStartFreshProject} />
    </WizardProvider>
  );
};
