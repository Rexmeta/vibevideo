import React, { useEffect, useState } from 'react';
import { ViewState } from '../types';
import { WizardProvider, useWizard } from './wizard/WizardContext';
import { WizardShell } from './wizard/WizardShell';
import { QuickMode } from './wizard/QuickMode';
import { ModeGate, getStoredMode, setStoredMode, type WizardMode } from './wizard/ModeGate';
import { Icons } from './Icons';
import { isSampleProjectId } from '../services/sampleProject';

interface ProjectWizardProps {
  userId: string;
  onNavigate: (view: ViewState) => void;
  onStartFreshProject?: () => void;
  initialProjectId?: string | null;
  onRequestSelectKey?: () => void | Promise<void>;
  /** Task #95: Express Quick Mode preset entry. Forces quick mode + preset. */
  expressMode?: boolean;
  /** Task #95: Notified when a sample is cloned to a real project so the
   *  parent can update its editingProjectId. */
  onProjectIdChange?: (newId: string) => void;
}

const WizardModeRouter: React.FC<{
  initialProjectId?: string | null;
  onStartFreshProject?: () => void;
  onNavigate: (view: ViewState) => void;
  expressMode?: boolean;
}> = ({ initialProjectId, onStartFreshProject, onNavigate, expressMode }) => {
  const ctx = useWizard();
  const { loading, scenes, maxStep, step, projectId, savedMode, setSavedMode, restoreError, restoreSlow, retryRestore } = ctx;

  // Determine if this is an existing project (skip mode gate)
  const isSample = isSampleProjectId(initialProjectId);
  const isExisting = !!initialProjectId && !isSample;
  const projectHasProgress = (scenes && scenes.length > 0) || maxStep > 1 || step > 1;

  // For existing projects we wait for the cloud restore to complete before picking
  // a mode so we can prefer the project record (cross-device truth) over the local
  // per-project storage key.
  const [mode, setMode] = useState<WizardMode | null>(() => {
    // Task #95: Sample lands on Step 6 (Pro shell). Express forces Quick.
    if (isSample) return 'pro';
    if (expressMode) return 'quick';
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
            <p className="text-sm font-bold text-gray-500">
              {restoreSlow ? '클라우드 응답이 느립니다, 캐시본을 사용 중...' : '프로젝트 로딩 중...'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (restoreError && isExisting) {
    const isNoScenes = restoreError.kind === 'no_scenes';
    const title = isNoScenes
      ? '이 프로젝트의 씬 데이터를 찾을 수 없습니다'
      : '프로젝트를 불러올 수 없습니다';
    const description = isNoScenes
      ? (restoreError.cloudOk
          ? '클라우드에 프로젝트 기록은 있지만 씬 데이터가 비어 있고, 로컬/캐시에서도 복구하지 못했습니다. 과거 저장 시 클라우드 쓰기가 실패했을 수 있어요. 새로 작업하거나 기기에 남은 백업을 먼저 복원해 주세요.'
          : '클라우드와 로컬 캐시 어디에서도 씬 데이터를 찾지 못했습니다. 다시 시도하거나 마이 프로젝트로 돌아가 다른 항목을 선택해 주세요.')
      : (restoreError.firestoreDisabled
          ? 'Firestore 설정 점검이 필요합니다. 환경 변수 FIREBASE_PROJECT_ID와 실제 Firestore가 활성화된 GCP 프로젝트가 일치하는지 확인해 주세요.'
          : '클라우드 응답이 늦거나 실패했습니다. 잠시 후 다시 시도해 주세요.');

    return (
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="bg-white rounded-[4rem] shadow-2xl p-12 border border-gray-50">
          <div className="flex items-start gap-4 mb-6">
            <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
              <Icons.VideoOff size={24} className="text-amber-600" />
            </div>
            <div>
              <h2 className="text-2xl font-black text-brand-dark mb-2">{title}</h2>
              <p className="text-gray-600 leading-relaxed">{description}</p>
              {restoreError.firestoreDisabled && (
                <p className="text-xs text-gray-400 mt-3 font-mono break-all">
                  Firestore REST가 영구 실패 상태로 표시되었습니다 (세션 동안). 페이지를 새로고침하면 다시 시도합니다.
                </p>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-3 mt-8">
            <button
              onClick={retryRestore}
              className="px-6 py-3 rounded-full bg-brand-cyan text-brand-dark font-black hover:scale-105 transition-transform shadow"
            >
              다시 시도
            </button>
            <button
              onClick={() => onNavigate('projects')}
              className="px-6 py-3 rounded-full bg-gray-100 text-gray-700 font-bold hover:bg-gray-200 transition-colors"
            >
              마이 프로젝트로 돌아가기
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!mode) {
    return <ModeGate projectId={projectId} onSelect={switchMode} />;
  }

  if (mode === 'quick') {
    return <QuickMode onSwitchMode={switchMode} expressMode={expressMode} />;
  }

  return <WizardShell onSwitchMode={switchMode} onStartFreshProject={onStartFreshProject} />;
};

export const ProjectWizard: React.FC<ProjectWizardProps> = ({ userId, onNavigate, onStartFreshProject, initialProjectId, onRequestSelectKey, expressMode, onProjectIdChange }) => {
  return (
    <WizardProvider userId={userId} onNavigate={onNavigate} initialProjectId={initialProjectId} onRequestSelectKey={onRequestSelectKey} expressMode={expressMode} onProjectIdChange={onProjectIdChange}>
      <WizardModeRouter initialProjectId={initialProjectId} onStartFreshProject={onStartFreshProject} onNavigate={onNavigate} expressMode={expressMode} />
    </WizardProvider>
  );
};
