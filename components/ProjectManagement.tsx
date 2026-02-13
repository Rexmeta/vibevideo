
import React, { useState, useEffect, useRef } from 'react';
import { Project, ViewState } from '../types';
import { 
  getLocalProjectsList,
  syncProjectsFromCloud,
  deleteProjectFromCloud, 
  duplicateProjectInCloud 
} from '../services/storageService';
import { Icons } from './Icons';

interface ProjectManagementProps {
  userId: string;
  onNavigate: (view: ViewState) => void;
  onEditProject?: (id: string) => void;
}

export const ProjectManagement: React.FC<ProjectManagementProps> = ({ userId, onNavigate, onEditProject }) => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [isSyncing, setIsSyncing] = useState(true);
  const [syncFailed, setSyncFailed] = useState(false);
  const initialLoadDone = useRef(false);

  useEffect(() => {
    if (!userId || initialLoadDone.current) return;
    initialLoadDone.current = true;

    const localData = getLocalProjectsList(userId);
    setProjects(localData);

    setIsSyncing(true);
    syncProjectsFromCloud(userId, localData).then(({ projects: merged, fromCloud }) => {
      setProjects(merged);
      setSyncFailed(!fromCloud);
      setIsSyncing(false);
    }).catch(() => {
      setIsSyncing(false);
      setSyncFailed(true);
    });
  }, [userId]);

  const deleteProject = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirm('이 프로젝트를 영구 삭제하시겠습니까?')) {
      try {
        await deleteProjectFromCloud(id);
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

  return (
    <div className="max-w-7xl mx-auto px-4 py-12">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-10 gap-4">
        <div>
          <h1 className="text-4xl font-black tracking-tight">Cloud Workspace</h1>
          <p className="text-gray-500 mt-1">
            {isSyncing ? (
              <span className="flex items-center gap-2">
                <Icons.Loader2 className="animate-spin w-4 h-4" />
                클라우드와 동기화 중...
              </span>
            ) : syncFailed ? (
              '오프라인 모드 - 로컬 프로젝트만 표시됩니다.'
            ) : (
              'Real-time synced AI video projects on Google Cloud.'
            )}
          </p>
        </div>
        <button 
          onClick={() => onNavigate('create')}
          className="bg-black text-white px-8 py-3 rounded-full font-bold flex items-center gap-2 hover:scale-105 transition-transform shadow-xl"
        >
          <Icons.Wand2 size={20} /> Create New Video
        </button>
      </div>

      {syncFailed && !isSyncing && (
        <div className="mb-6 bg-yellow-50 border border-yellow-200 rounded-2xl p-4 text-sm text-yellow-800">
          클라우드 연결에 실패했습니다. 로컬에 저장된 프로젝트만 표시됩니다.
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
          {projects.map(project => (
            <div 
              key={project.id} 
              onClick={() => handleProjectClick(project)}
              className="group bg-white rounded-[2.5rem] border border-gray-100 overflow-hidden shadow-sm hover:shadow-2xl transition-all duration-500 cursor-pointer"
            >
              <div className="relative aspect-video bg-gray-50 overflow-hidden">
                {project.thumbnail ? (
                  <img src={project.thumbnail} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" alt={project.title} />
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
                  <span>{new Date(project.created_at).toLocaleDateString()}</span>
                  <span className="text-brand-cyan">Step {project.saved_step}/7</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
