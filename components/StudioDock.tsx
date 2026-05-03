import React, { useEffect, useRef, useState } from 'react';
import { jobManager, JobState } from '../services/jobManager';
import { Icons } from './Icons';

interface Props {
  onOpenProject?: (projectId: string) => void;
}

const formatDuration = (ms?: number): string => {
  if (!ms || ms <= 0) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}초`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r === 0 ? `${m}분` : `${m}분 ${r}초`;
};

const formatRelative = (ms: number): string => {
  const diff = Date.now() - ms;
  if (diff < 60_000) return '방금 전';
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}분 전`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}시간 전`;
  return `${Math.round(diff / 86_400_000)}일 전`;
};

interface ToastMessage {
  id: string;
  kind: 'success' | 'error' | 'info';
  text: string;
}

const statusBadge = (status: JobState['status']) => {
  switch (status) {
    case 'running':
      return { label: '진행 중', cls: 'bg-brand-cyan/20 text-brand-dark' };
    case 'queued':
      return { label: '대기 중', cls: 'bg-amber-100 text-amber-800' };
    case 'completed':
      return { label: '완료', cls: 'bg-emerald-100 text-emerald-800' };
    case 'failed':
      return { label: '실패', cls: 'bg-red-100 text-red-700' };
    case 'cancelled':
      return { label: '취소됨', cls: 'bg-gray-200 text-gray-700' };
    case 'paused':
      return { label: '일시중지', cls: 'bg-gray-200 text-gray-700' };
    case 'interrupted':
      return { label: '중단됨', cls: 'bg-orange-100 text-orange-700' };
    default:
      return { label: status, cls: 'bg-gray-100 text-gray-600' };
  }
};

export const StudioDock: React.FC<Props> = ({ onOpenProject }) => {
  const [jobs, setJobs] = useState<JobState[]>(jobManager.snapshot());
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('vibe_studio_dock_collapsed') === '1';
    } catch {
      return false;
    }
  });
  const [concurrency, setConcurrencyState] = useState<number>(
    jobManager.getConcurrency()
  );
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [resumingId, setResumingId] = useState<string | null>(null);
  // Tick once a second so elapsed timers refresh while a job is running.
  const [, setNow] = useState<number>(Date.now());
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Last-seen status per job, used to detect transitions and show toasts.
  const lastStatusRef = useRef<Map<string, JobState['status']>>(new Map());

  useEffect(() => {
    const unsub = jobManager.subscribe(next => {
      // Detect status transitions to terminal states and emit a toast.
      const prev = lastStatusRef.current;
      const fresh: ToastMessage[] = [];
      next.forEach(j => {
        const before = prev.get(j.id);
        if (before && before !== j.status) {
          if (j.status === 'completed') {
            fresh.push({
              id: `${j.id}-${j.endedAt || Date.now()}`,
              kind: j.failed > 0 ? 'info' : 'success',
              text:
                j.failed > 0
                  ? `${j.projectTitle} — ${j.completed}/${j.total} 완료, ${j.failed}개 실패`
                  : `${j.projectTitle} — 비디오 생성 완료 (${j.completed}/${j.total})`,
            });
          } else if (j.status === 'failed') {
            fresh.push({
              id: `${j.id}-${j.endedAt || Date.now()}`,
              kind: 'error',
              text: `${j.projectTitle} — 비디오 생성 실패${j.lastError ? `: ${j.lastError}` : ''}`,
            });
          } else if (j.status === 'cancelled' && before !== 'interrupted') {
            fresh.push({
              id: `${j.id}-${j.endedAt || Date.now()}`,
              kind: 'info',
              text: `${j.projectTitle} — 작업이 취소되었습니다`,
            });
          }
        }
        prev.set(j.id, j.status);
      });
      // Drop entries for jobs the manager no longer reports.
      const live = new Set(next.map(j => j.id));
      Array.from(prev.keys()).forEach(k => {
        if (!live.has(k)) prev.delete(k);
      });
      if (fresh.length > 0) {
        setToasts(t => [...t, ...fresh].slice(-4));
      }
      setJobs(next);
    });
    return () => unsub();
  }, []);

  // Auto-dismiss toasts after 6 seconds.
  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map(t =>
      setTimeout(() => {
        setToasts(prev => prev.filter(p => p.id !== t.id));
      }, 6000)
    );
    return () => timers.forEach(clearTimeout);
  }, [toasts]);

  const dismissToast = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  const handleResume = async (job: JobState) => {
    setResumingId(job.id);
    try {
      const newId = await jobManager.resumeInterrupted({
        projectId: job.projectId,
        userId: job.userId,
      });
      if (!newId) {
        setToasts(t => [
          ...t,
          {
            id: `resume-${job.projectId}-${Date.now()}`,
            kind: 'info',
            text: `${job.projectTitle} — 이어서 처리할 미완료 씬이 없습니다`,
          },
        ]);
      } else if (onOpenProject) {
        onOpenProject(job.projectId);
      }
    } catch (err: any) {
      setToasts(t => [
        ...t,
        {
          id: `resume-err-${job.projectId}-${Date.now()}`,
          kind: 'error',
          text: `재시작 실패: ${err?.message || err}`,
        },
      ]);
    } finally {
      setResumingId(null);
    }
  };

  useEffect(() => {
    const anyRunning = jobs.some(j => j.status === 'running' || j.status === 'queued');
    if (anyRunning && !tickRef.current) {
      tickRef.current = setInterval(() => setNow(Date.now()), 1000);
    } else if (!anyRunning && tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    return () => {
      if (tickRef.current && !anyRunning) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
    };
  }, [jobs]);

  const toggleCollapsed = () => {
    setCollapsed(c => {
      const next = !c;
      try {
        localStorage.setItem('vibe_studio_dock_collapsed', next ? '1' : '0');
      } catch {}
      return next;
    });
  };

  const updateConcurrency = (n: number) => {
    setConcurrencyState(n);
    jobManager.setConcurrency(n);
  };

  const visibleJobs = jobs;
  const activeCount = jobs.filter(
    j => j.status === 'running' || j.status === 'queued'
  ).length;
  const hasFinished = jobs.some(
    j =>
      j.status === 'completed' || j.status === 'failed' || j.status === 'cancelled'
  );

  // Hide entirely when there are no jobs and the dock is collapsed —
  // there's nothing useful to show.
  if (visibleJobs.length === 0 && collapsed) return null;

  if (collapsed) {
    return (
      <div className="fixed bottom-6 right-6 z-[60]">
        <button
          onClick={toggleCollapsed}
          className="bg-brand-dark text-white pl-4 pr-5 py-3 rounded-full shadow-2xl flex items-center gap-3 hover:scale-105 transition-transform"
        >
          <Icons.Layers size={18} className="text-brand-cyan" />
          <span className="font-black text-sm">Studio Dock</span>
          {activeCount > 0 && (
            <span className="bg-brand-cyan text-black text-[10px] font-black px-2 py-0.5 rounded-full">
              {activeCount} 작업 중
            </span>
          )}
        </button>
      </div>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 z-[60] w-[380px] max-w-[calc(100vw-2rem)] max-h-[70vh] flex flex-col bg-white rounded-3xl shadow-2xl border border-gray-100 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 bg-brand-dark text-white">
        <div className="flex items-center gap-2">
          <Icons.Layers size={18} className="text-brand-cyan" />
          <h3 className="font-black text-sm">Studio Dock</h3>
          {activeCount > 0 && (
            <span className="bg-brand-cyan text-black text-[10px] font-black px-2 py-0.5 rounded-full">
              {activeCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {hasFinished && (
            <button
              onClick={() => jobManager.clearFinished()}
              className="text-[10px] uppercase tracking-wider font-black text-gray-300 hover:text-white px-2 py-1 transition-colors"
              title="완료된 작업 비우기"
            >
              비우기
            </button>
          )}
          <button
            onClick={toggleCollapsed}
            className="p-1.5 hover:bg-white/10 rounded-lg transition-colors"
            title="접기"
          >
            <Icons.X size={16} />
          </button>
        </div>
      </div>

      <div className="px-5 py-3 bg-gray-50 border-b border-gray-100">
        <div className="flex items-center justify-between gap-3">
          <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
            동시 처리 수
          </label>
          <div className="flex items-center gap-2">
            {[1, 2, 3].map(n => (
              <button
                key={n}
                onClick={() => updateConcurrency(n)}
                className={`w-9 h-9 rounded-xl text-sm font-black transition-all ${
                  concurrency === n
                    ? 'bg-brand-dark text-brand-cyan'
                    : 'bg-white text-gray-500 hover:bg-gray-100'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
        <p className="text-[10px] text-gray-400 mt-1.5 leading-snug">
          여러 프로젝트를 동시에 실행할 수 있습니다 (최대 3). 모델별 분당 호출
          한도는 자동으로 분배됩니다.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {visibleJobs.length === 0 && (
          <div className="text-center py-10 text-gray-400 text-xs font-medium">
            진행 중인 작업이 없습니다.
            <br />
            위저드에서 비디오 생성을 시작하면 여기에 표시됩니다.
          </div>
        )}
        {visibleJobs.map(job => {
          const badge = statusBadge(job.status);
          const isInterrupted = job.status === 'interrupted';
          const elapsed =
            (job.endedAt || Date.now()) - job.startedAt;
          const currentScene = job.scenes.find(s => s.status === 'running');
          const progressPercent =
            job.total > 0
              ? Math.round(((job.completed + job.failed) / job.total) * 100)
              : 0;
          return (
            <div
              key={job.id}
              className={`bg-white border rounded-2xl p-3 transition-colors ${
                isInterrupted
                  ? 'border-orange-200 hover:border-orange-300'
                  : 'border-gray-100 hover:border-gray-200'
              }`}
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="min-w-0 flex-1">
                  <h4 className="font-black text-sm text-brand-dark line-clamp-1">
                    {job.projectTitle}
                  </h4>
                  <p className="text-[10px] text-gray-400 font-medium mt-0.5 line-clamp-1">
                    {job.modelLabel}
                    {currentScene
                      ? ` · 씬 ${currentScene.idx + 1} 생성 중`
                      : ''}
                  </p>
                  {job.contextPackName && (
                    <p className="text-[10px] text-brand-dark font-bold mt-0.5 line-clamp-1 flex items-center gap-1">
                      <Icons.Layers size={9} /> {job.contextPackName}
                    </p>
                  )}
                </div>
                <span
                  className={`text-[10px] font-black px-2 py-0.5 rounded-full whitespace-nowrap ${badge.cls}`}
                >
                  {badge.label}
                </span>
              </div>

              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mb-2">
                <div
                  className={`h-full transition-all ${
                    isInterrupted
                      ? 'bg-orange-400'
                      : job.failed > 0 && job.completed === 0
                        ? 'bg-red-400'
                        : 'bg-brand-cyan'
                  }`}
                  style={{ width: `${progressPercent}%` }}
                />
              </div>

              <div className="flex items-center justify-between text-[10px] font-bold text-gray-500 mb-2">
                <span>
                  {job.completed}/{job.total} 완료
                  {job.failed > 0 && (
                    <span className="text-red-500"> · {job.failed}개 실패</span>
                  )}
                </span>
                <span>
                  {isInterrupted
                    ? `${formatRelative(job.updatedAt)} 중단됨`
                    : `경과 ${formatDuration(elapsed)}`}
                </span>
              </div>

              {job.lastError && job.failed > 0 && (
                <p className="text-[10px] text-red-500 font-medium mb-2 line-clamp-2">
                  {job.lastError}
                </p>
              )}

              <div className="flex items-center gap-2">
                {(job.status === 'running' || job.status === 'queued') && (
                  <>
                    <button
                      onClick={() => jobManager.pause(job.id)}
                      className="flex-1 px-3 py-1.5 rounded-xl text-[11px] font-black bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors flex items-center justify-center gap-1.5"
                    >
                      <Icons.Square size={11} /> 일시중지
                    </button>
                    <button
                      onClick={() => jobManager.cancel(job.id)}
                      className="flex-1 px-3 py-1.5 rounded-xl text-[11px] font-black bg-red-50 text-red-600 hover:bg-red-100 transition-colors flex items-center justify-center gap-1.5"
                    >
                      <Icons.X size={11} /> 취소
                    </button>
                  </>
                )}
                {job.status === 'paused' && (
                  <button
                    onClick={() => jobManager.resume(job.id)}
                    className="flex-1 px-3 py-1.5 rounded-xl text-[11px] font-black bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors flex items-center justify-center gap-1.5"
                  >
                    <Icons.Play size={11} /> 이어서
                  </button>
                )}
                {isInterrupted && (
                  <button
                    onClick={() => handleResume(job)}
                    disabled={resumingId === job.id}
                    className="flex-1 px-3 py-1.5 rounded-xl text-[11px] font-black bg-orange-500 text-white hover:bg-orange-600 transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
                  >
                    {resumingId === job.id ? (
                      <>
                        <Icons.Loader2 size={11} className="animate-spin" /> 시작 중...
                      </>
                    ) : (
                      <>
                        <Icons.RotateCcw size={11} /> 이어서 진행
                      </>
                    )}
                  </button>
                )}
                {onOpenProject && (
                  <button
                    onClick={() => onOpenProject(job.projectId)}
                    className="flex-1 px-3 py-1.5 rounded-xl text-[11px] font-black bg-brand-dark text-white hover:bg-black transition-colors flex items-center justify-center gap-1.5"
                  >
                    <Icons.Film size={11} /> 열기
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {toasts.length > 0 && (
        <div className="absolute bottom-2 left-2 right-2 space-y-1.5 pointer-events-none">
          {toasts.map(t => (
            <div
              key={t.id}
              className={`pointer-events-auto px-3 py-2 rounded-xl shadow-lg text-[11px] font-bold flex items-start justify-between gap-2 ${
                t.kind === 'success'
                  ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                  : t.kind === 'error'
                    ? 'bg-red-50 border border-red-200 text-red-800'
                    : 'bg-gray-50 border border-gray-200 text-gray-700'
              }`}
            >
              <span className="flex-1 line-clamp-3">{t.text}</span>
              <button
                onClick={() => dismissToast(t.id)}
                className="text-current opacity-60 hover:opacity-100 -mt-0.5"
                aria-label="닫기"
              >
                <Icons.X size={11} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
