
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Project, ViewState } from '../types';
import { 
  getLocalProjectsList,
  getProjectsPage,
  getProjectsPageFromCache,
  getAllProjectIdsFromCloud,
  deleteProjectFromCloud, 
  duplicateProjectInCloud,
  subscribeToProjectsList,
  PaginatedResult,
  ProjectsListSubscription
} from '../services/storageService';
import { Icons } from './Icons';
import { clearStoredMode, cleanupOrphanedModePrefs } from './wizard/ModeGate';

const modePrefCleanupRanByUser = new Set<string>();

const MODE_PREF_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const MODE_PREF_CLEANUP_KEY = (uid: string) => `vibe_modepref_cleanup_${uid}`;

type IdleScheduler = (cb: () => void, opts?: { timeout: number }) => number;
type WithIdle = { requestIdleCallback?: IdleScheduler };

const runIdle = (cb: () => void, timeout: number = 4000) => {
  const ric = (globalThis as WithIdle).requestIdleCallback;
  if (typeof ric === 'function') {
    try { ric(cb, { timeout }); return; } catch {}
  }
  setTimeout(cb, 0);
};

interface ProjectManagementProps {
  userId: string;
  onNavigate: (view: ViewState) => void;
  onEditProject?: (id: string) => void;
}

type SyncState = 'idle' | 'syncing' | 'retrying' | 'failed';

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

const mergeUniqueByDate = (a: Project[], b: Project[]): Project[] => {
  const map = new Map<string, Project>();
  a.forEach(p => map.set(p.id, p));
  b.forEach(p => map.set(p.id, p));
  return Array.from(map.values()).sort((p1, p2) => {
    const d1 = new Date(p1.updated_at || p1.created_at).getTime();
    const d2 = new Date(p2.updated_at || p2.created_at).getTime();
    return d2 - d1;
  });
};

export const ProjectManagement: React.FC<ProjectManagementProps> = ({ userId, onNavigate, onEditProject }) => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [syncState, setSyncState] = useState<SyncState>('idle');
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const cursorRef = useRef<string | null>(null);
  const initialLoadDone = useRef(false);
  const mountedRef = useRef(true);
  const reloadTokenRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const runCleanupIdle = useCallback((uid: string) => {
    if (!uid || modePrefCleanupRanByUser.has(uid)) return;

    let last = 0;
    try { last = parseInt(localStorage.getItem(MODE_PREF_CLEANUP_KEY(uid)) || '0', 10); } catch {}
    if (Number.isFinite(last) && Date.now() - last < MODE_PREF_CLEANUP_INTERVAL_MS) {
      modePrefCleanupRanByUser.add(uid);
      return;
    }

    runIdle(() => {
      if (modePrefCleanupRanByUser.has(uid)) return;
      modePrefCleanupRanByUser.add(uid);
      getAllProjectIdsFromCloud(uid)
        .then(cloudIds => {
          const validIds = new Set<string>(cloudIds);
          getLocalProjectsList(uid).forEach(p => {
            if (p?.id) validIds.add(p.id);
          });
          const removed = cleanupOrphanedModePrefs(validIds);
          try { localStorage.setItem(MODE_PREF_CLEANUP_KEY(uid), String(Date.now())); } catch {}
          if (removed > 0) {
            console.log(`[ModeGate] 정리: 삭제된 프로젝트의 모드 설정 ${removed}개 제거 (idle)`);
          }
        })
        .catch(err => {
          modePrefCleanupRanByUser.delete(uid);
          console.warn('[ModeGate] 정리 건너뜀: 전체 프로젝트 목록 조회 실패', err?.message);
        });
    });
  }, []);

  const loadFromCloud = useCallback(async (uid: string, isRetry: boolean = false): Promise<boolean> => {
    const myToken = ++reloadTokenRef.current;
    setSyncState(isRetry ? 'retrying' : 'syncing');

    const tStart = performance.now();

    getProjectsPageFromCache(uid)
      .then(cacheResult => {
        if (!mountedRef.current || reloadTokenRef.current !== myToken) return;
        if (cacheResult.projects.length === 0) return;
        console.log(`[Sync Timing] cache 첫 페인트 ${(performance.now() - tStart).toFixed(0)}ms`);
        setProjects(prev => mergeUniqueByDate(prev, cacheResult.projects));
      })
      .catch(() => {});

    const backoffs = [0, 500, 1500];
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < backoffs.length; attempt++) {
      if (backoffs[attempt] > 0) {
        if (mountedRef.current && reloadTokenRef.current === myToken) {
          setSyncState('retrying');
        }
        await sleep(backoffs[attempt]);
        if (reloadTokenRef.current !== myToken) return false;
      }
      try {
        const result: PaginatedResult = await getProjectsPage(uid);
        if (!mountedRef.current || reloadTokenRef.current !== myToken) return false;
        console.log(
          `[Sync Timing] 서버 응답 ${(performance.now() - tStart).toFixed(0)}ms (attempt ${attempt + 1}, ${result.fromCloud ? 'cloud' : 'local'})`
        );

        if (result.fromCloud) {
          setProjects(prev => mergeUniqueByDate(prev, result.projects));
          cursorRef.current = result.cursor;
          setHasMore(result.hasMore);
          setSyncState('idle');
          runCleanupIdle(uid);
          return true;
        } else {
          lastError = new Error('fromCloud=false');
        }
      } catch (err) {
        const e = err as Error;
        lastError = e;
        console.warn(`[Sync] attempt ${attempt + 1} 실패:`, e?.message);
      }
    }

    if (!mountedRef.current || reloadTokenRef.current !== myToken) return false;
    console.warn('[Sync] 모든 재시도 실패, offline 상태로 전환:', lastError?.message);
    setSyncState('failed');
    return false;
  }, [runCleanupIdle]);

  useEffect(() => {
    if (!userId || initialLoadDone.current) return;
    initialLoadDone.current = true;

    const tMount = performance.now();
    const localData = getLocalProjectsList(userId);
    setProjects(localData);
    if (localData.length > 0) {
      console.log(`[Sync Timing] local 첫 페인트 ${(performance.now() - tMount).toFixed(0)}ms (${localData.length}개)`);
    }

    loadFromCloud(userId, false);
  }, [userId, loadFromCloud]);

  useEffect(() => {
    if (!userId) return;

    let active = true;
    let firstSnapshot = true;
    const sub: ProjectsListSubscription = subscribeToProjectsList(
      userId,
      (livePage) => {
        if (!active || !mountedRef.current) return;
        if (firstSnapshot) {
          firstSnapshot = false;
          console.log(`[Sync] 실시간 구독 활성화: ${livePage.length}개`);
        }
        setProjects(prev => {
          const liveIds = new Set(livePage.map(p => p.id));
          const liveCutoff = livePage.length > 0
            ? new Date(livePage[livePage.length - 1].updated_at || livePage[livePage.length - 1].created_at).getTime()
            : -Infinity;
          const retained = prev.filter(p => {
            if (liveIds.has(p.id)) return false;
            const t = new Date(p.updated_at || p.created_at).getTime();
            return t < liveCutoff;
          });
          return mergeUniqueByDate(retained, livePage);
        });
      },
      (err) => {
        console.warn('[Sync] 실시간 구독 오류 — 폴링 데이터로 폴백:', err?.message);
      }
    );

    return () => {
      active = false;
      sub.unsubscribe();
    };
  }, [userId]);

  const handleManualRetry = useCallback(() => {
    if (!userId) return;
    loadFromCloud(userId, true);
  }, [userId, loadFromCloud]);

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    try {
      const result = await getProjectsPage(userId, cursorRef.current);
      setProjects(prev => {
        const existingIds = new Set(prev.map(p => p.id));
        const newProjects = result.projects.filter(p => !existingIds.has(p.id));
        return [...prev, ...newProjects];
      });
      cursorRef.current = result.cursor;
      setHasMore(result.hasMore);
    } catch (err) {
      console.error("Load more failed:", err);
    } finally {
      setLoadingMore(false);
    }
  }, [userId, hasMore, loadingMore]);

  const deleteProject = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirm('이 프로젝트를 영구 삭제하시겠습니까?\n프로젝트와 관련된 모든 파일(이미지, 오디오, 비디오)이 함께 삭제됩니다.')) {
      try {
        await deleteProjectFromCloud(id, userId);
        clearStoredMode(id);
        setProjects(prev => prev.filter(p => p.id !== id));
      } catch (err) { alert("삭제에 실패했습니다."); }
    }
  };

  const duplicateProject = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      const newProject = await duplicateProjectInCloud(id);
      if (newProject) {
        setProjects(prev => [newProject, ...prev]);
      }
    } catch (err) { alert("복제에 실패했습니다."); }
  };

  const handleProjectClick = (project: Project) => {
    if (onEditProject) onEditProject(project.id);
  };

  const showOfflineBanner = syncState === 'failed' && projects.length > 0;
  const isFirstSync = syncState === 'syncing' && projects.length === 0;
  const isBackgroundSyncing = (syncState === 'syncing' || syncState === 'retrying') && projects.length > 0;

  let statusLine: React.ReactNode;
  if (isFirstSync) {
    statusLine = (
      <span className="flex items-center gap-2">
        <Icons.Loader2 className="animate-spin w-4 h-4" />
        클라우드와 동기화 중...
      </span>
    );
  } else if (isBackgroundSyncing) {
    statusLine = (
      <span className="flex items-center gap-2 text-gray-400">
        <Icons.Loader2 className="animate-spin w-3.5 h-3.5" />
        {syncState === 'retrying' ? '재시도 중...' : '백그라운드 동기화 중...'}
      </span>
    );
  } else if (showOfflineBanner) {
    statusLine = '오프라인 모드 - 로컬 프로젝트만 표시됩니다.';
  } else {
    statusLine = 'Real-time synced AI video projects on Google Cloud.';
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-12">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-10 gap-4">
        <div>
          <h1 className="text-4xl font-black tracking-tight">Cloud Workspace</h1>
          <p className="text-gray-500 mt-1">{statusLine}</p>
        </div>
        <button 
          onClick={() => onNavigate('create')}
          className="bg-black text-white px-8 py-3 rounded-full font-bold flex items-center gap-2 hover:scale-105 transition-transform shadow-xl"
        >
          <Icons.Wand2 size={20} /> Create New Video
        </button>
      </div>

      {showOfflineBanner && (
        <div className="mb-6 bg-yellow-50 border border-yellow-200 rounded-2xl p-4 text-sm text-yellow-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <span>클라우드 연결에 실패했습니다. 로컬에 저장된 프로젝트만 표시됩니다.</span>
          <button
            onClick={handleManualRetry}
            className="self-start sm:self-auto px-4 py-2 rounded-full bg-yellow-500 hover:bg-yellow-600 text-white text-xs font-bold transition-colors"
          >
            다시 시도
          </button>
        </div>
      )}

      {projects.length === 0 ? (
        <div className="bg-white rounded-[3rem] border-2 border-dashed border-gray-200 p-20 text-center">
          <Icons.Video size={60} className="mx-auto text-gray-200 mb-6" />
          <h3 className="text-2xl font-bold mb-2">Workspace Empty</h3>
          <p className="text-gray-500 mb-8">Start generating AI content to see them synced across devices.</p>
          <button onClick={() => onNavigate('create')} className="bg-brand-cyan px-10 py-3 rounded-full font-bold">Start First Project</button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
            {projects.map(project => (
              <div 
                key={project.id} 
                onClick={() => handleProjectClick(project)}
                className="group bg-white rounded-[2.5rem] border border-gray-100 overflow-hidden shadow-sm hover:shadow-2xl transition-all duration-500 cursor-pointer"
              >
                <div className="relative aspect-video bg-gray-50 overflow-hidden">
                  {project.thumbnail ? (
                    <img src={project.thumbnail} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" alt={project.title} loading="lazy" />
                  ) : (
                     <div className="w-full h-full flex items-center justify-center"><Icons.Video className="text-gray-200" /></div>
                  )}
                  <div className="absolute top-4 left-4 bg-black/60 backdrop-blur-md text-white text-[10px] font-black px-3 py-1.5 rounded-full uppercase">{project.aspect_ratio}</div>
                </div>
                <div className="p-6">
                  <div className="flex justify-between items-start mb-4">
                    <h3 className="font-black text-lg line-clamp-1">{project.title}</h3>
                    <div className="relative group/menu" onClick={e => e.stopPropagation()}>
                      <button className="p-2 text-gray-300 hover:text-black transition-colors"><Icons.Settings size={16} /></button>
                      <div className="absolute right-0 top-full mt-2 w-48 bg-white rounded-2xl shadow-2xl border border-gray-50 opacity-0 group-hover/menu:opacity-100 pointer-events-none group-hover/menu:pointer-events-auto transition-all z-20 p-2">
                          <button onClick={(e) => duplicateProject(e, project.id)} className="w-full text-left px-4 py-3 text-sm font-bold hover:bg-gray-50 rounded-xl flex items-center gap-2">Duplicate</button>
                          <button onClick={(e) => deleteProject(e, project.id)} className="w-full text-left px-4 py-3 text-sm font-bold text-red-500 hover:bg-red-50 rounded-xl flex items-center gap-2">Delete Permanently</button>
                      </div>
                    </div>
                  </div>
                  <div className="flex justify-between items-center text-[10px] font-black text-gray-400 uppercase tracking-widest">
                    <span>{new Date(project.updated_at || project.created_at).toLocaleDateString()}</span>
                    <span className="text-brand-cyan">Step {project.saved_step || 1}/7</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
          
          {hasMore && (
            <div className="mt-12 text-center">
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="px-10 py-4 bg-white border border-gray-200 rounded-full font-bold text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-all disabled:opacity-50"
              >
                {loadingMore ? (
                  <span className="flex items-center gap-2 justify-center">
                    <Icons.Loader2 className="animate-spin w-4 h-4" />
                    로딩 중...
                  </span>
                ) : (
                  '더 보기'
                )}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};
