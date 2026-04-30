import React, { useEffect, useState } from 'react';
import { ViewState } from '../types';
import { WizardProvider, useWizard } from './wizard/WizardContext';
import { WizardShell } from './wizard/WizardShell';
import { QuickMode } from './wizard/QuickMode';
import { ModeGate, getStoredMode, setStoredMode, type WizardMode } from './wizard/ModeGate';

interface ProjectWizardProps {
  userId: string;
  onNavigate: (view: ViewState) => void;
  initialProjectId?: string | null;
}

const WizardModeRouter: React.FC<{ initialProjectId?: string | null }> = ({ initialProjectId }) => {
  const ctx = useWizard();
  const { loading, scenes, maxStep, step, projectId } = ctx;

  // Determine if this is an existing project (skip mode gate)
  const isExisting = !!initialProjectId;
  const projectHasProgress = (scenes && scenes.length > 0) || maxStep > 1 || step > 1;

  const [mode, setMode] = useState<WizardMode | null>(() => {
    if (isExisting) {
      // Restore this project's last-used mode (falls back to global, then 'pro')
      return getStoredMode(initialProjectId) || 'pro';
    }
    // New project: per-project key won't exist yet, so falls back to global last-used
    return getStoredMode(projectId);
  });

  // Materialize the resolved mode under the per-project key on first open so the
  // project's default no longer drifts when the global last-used preference changes.
  useEffect(() => {
    if (mode) setStoredMode(mode, projectId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // After restore: if existing project shows it has progressed, force pro mode
  useEffect(() => {
    if (!loading && projectHasProgress && mode !== 'pro') {
      setMode('pro');
      setStoredMode('pro', projectId);
    }
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
    return <ModeGate projectId={projectId} onSelect={m => setMode(m)} />;
  }

  if (mode === 'quick') {
    return <QuickMode onSwitchMode={m => setMode(m)} />;
  }

  return <WizardShell onSwitchMode={m => setMode(m)} />;
};

export const ProjectWizard: React.FC<ProjectWizardProps> = ({ userId, onNavigate, initialProjectId }) => {
  return (
    <WizardProvider userId={userId} onNavigate={onNavigate} initialProjectId={initialProjectId}>
      <WizardModeRouter initialProjectId={initialProjectId} />
    </WizardProvider>
  );
};
