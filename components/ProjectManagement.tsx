
import React, { useState, useEffect } from 'react';
import { Project, ProjectStatus, ViewState } from '../types';
import { getAllProjectsFromDB, deleteProjectFromDB, saveProjectToDB } from '../services/storageService';
import { Icons } from './Icons';

interface ProjectManagementProps {
  onNavigate: (view: ViewState) => void;
  onEditProject?: (id: string) => void;
}

export const ProjectManagement: React.FC<ProjectManagementProps> = ({ onNavigate, onEditProject }) => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadProjects = async () => {
      try {
        const loaded = await getAllProjectsFromDB();
        
        if (loaded.length === 0) {
          // Seed sample data to IndexedDB if empty
          const sampleProjects: Project[] = [
            {
              id: '1',
              user_id: 'u1',
              title: 'Morning Meditation Guide',
              aspect_ratio: '9:16',
              style_template: 'Minimal Info',
              status: ProjectStatus.COMPLETED,
              created_at: new Date(Date.now() - 86400000).toISOString(),
              thumbnail: 'https://picsum.photos/seed/meditate/400/700'
            },
            {
              id: '2',
              user_id: 'u1',
              title: 'Cyberpunk Short Story',
              aspect_ratio: '16:9',
              style_template: 'Japanese Anime',
              status: ProjectStatus.COMPLETED,
              created_at: new Date(Date.now() - 172800000).toISOString(),
              thumbnail: 'https://picsum.photos/seed/cyber/700/400'
            }
          ];
          for (const p of sampleProjects) {
            await saveProjectToDB(p);
          }
          setProjects(sampleProjects);
        } else {
          setProjects(loaded);
        }
      } catch (e) {
        console.error("Failed to load projects from DB", e);
      } finally {
        setIsLoading(false);
      }
    };
    loadProjects();
  }, []);

  const deleteProject = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirm('Are you sure you want to delete this project?')) {
      try {
        await deleteProjectFromDB(id);
        setProjects(prev => prev.filter(p => p.id !== id));
      } catch (err) {
        alert("Failed to delete project");
      }
    }
  };

  const handleProjectClick = (project: Project) => {
    if (onEditProject) {
      onEditProject(project.id);
    }
  };

  if (isLoading) {
    return (
        <div className="max-w-7xl mx-auto px-4 py-12 flex justify-center items-center">
            <Icons.Loader2 className="animate-spin w-10 h-10 text-brand-cyan" />
        </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-12">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-10 gap-4">
        <div>
          <h1 className="text-4xl font-black tracking-tight">My Projects</h1>
          <p className="text-gray-500 mt-1">Manage and export your AI generated videos.</p>
        </div>
        <button 
          onClick={() => onNavigate('create')}
          className="bg-black text-white px-6 py-3 rounded-full font-bold flex items-center gap-2 hover:scale-105 transition-transform"
        >
          <Icons.Wand2 size={20} /> Create New Video
        </button>
      </div>

      {projects.length === 0 ? (
        <div className="bg-white rounded-[2.5rem] border-2 border-dashed border-gray-200 p-20 text-center">
          <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-6 text-gray-300">
            <Icons.Video size={40} />
          </div>
          <h3 className="text-xl font-bold mb-2">No projects yet</h3>
          <p className="text-gray-500 mb-8 max-w-xs mx-auto">Start your first AI video generation and bring your stories to life.</p>
          <button 
            onClick={() => onNavigate('create')}
            className="bg-brand-cyan text-black px-8 py-3 rounded-full font-bold"
          >
            Create My First Video
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {projects.map(project => (
            <div 
              key={project.id} 
              onClick={() => handleProjectClick(project)}
              className="group bg-white rounded-3xl border border-gray-100 overflow-hidden shadow-sm hover:shadow-xl transition-all duration-300 cursor-pointer"
            >
              <div className="relative aspect-video bg-gray-100 overflow-hidden">
                <img 
                  src={project.thumbnail || `https://picsum.photos/seed/${project.id}/400/300`} 
                  alt={project.title} 
                  className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                />
                <div className="absolute top-3 left-3 bg-black/60 backdrop-blur-md text-white text-[10px] font-bold px-2 py-1 rounded-md uppercase tracking-wider">
                  {project.aspect_ratio}
                </div>
                {project.status === ProjectStatus.DRAFT && (
                   <div className="absolute top-3 right-3 bg-brand-cyan text-black text-[10px] font-bold px-2 py-1 rounded-md uppercase tracking-wider animate-pulse">
                      Draft
                   </div>
                )}
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                  {project.status === ProjectStatus.DRAFT ? (
                    <span className="bg-white text-black px-4 py-2 rounded-full font-bold text-xs flex items-center gap-2">
                      <Icons.Wand2 size={14} /> Resume
                    </span>
                  ) : (
                    <button className="w-10 h-10 bg-white rounded-full flex items-center justify-center text-black hover:scale-110 transition-transform">
                      <Icons.Play size={20} fill="currentColor" />
                    </button>
                  )}
                </div>
              </div>
              <div className="p-5">
                <div className="flex justify-between items-start mb-2">
                  <h3 className="font-bold text-lg leading-tight line-clamp-1">{project.title || 'Untitled Project'}</h3>
                  <div className="relative group/menu" onClick={(e) => e.stopPropagation()}>
                    <button className="text-gray-400 hover:text-black p-1">
                      <Icons.LayoutTemplate size={16} />
                    </button>
                    <div className="absolute right-0 top-full mt-2 w-32 bg-white rounded-xl shadow-xl border border-gray-100 opacity-0 group-hover/menu:opacity-100 pointer-events-none group-hover/menu:pointer-events-auto transition-all z-10 p-1">
                      <button 
                        onClick={(e) => deleteProject(e, project.id)}
                        className="w-full text-left px-3 py-2 text-red-500 text-sm font-medium hover:bg-red-50 rounded-lg flex items-center gap-2"
                      >
                        <Icons.Scissors size={14} /> Delete
                      </button>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 mb-4">
                  <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-500 rounded-md font-medium">{project.style_template}</span>
                  <span className={`text-[10px] font-bold uppercase tracking-widest ${project.status === ProjectStatus.COMPLETED ? 'text-green-500' : 'text-gray-400'}`}>
                    {project.status}
                  </span>
                </div>
                <div className="flex justify-between items-center text-[10px] text-gray-400 font-medium">
                  <span>{new Date(project.created_at).toLocaleDateString()}</span>
                  {project.saved_step && <span className="text-brand-cyan">Step {project.saved_step}/7</span>}
                </div>
              </div>
            </div>
          ))}
          {/* Add Project Card */}
          <button 
            onClick={() => onNavigate('create')}
            className="group flex flex-col items-center justify-center bg-gray-50 border-2 border-dashed border-gray-200 rounded-3xl p-6 hover:bg-white hover:border-brand-cyan transition-all min-h-[300px]"
          >
            <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center text-gray-300 group-hover:text-brand-cyan group-hover:scale-110 transition-all mb-4 shadow-sm">
              <Icons.Wand2 size={24} />
            </div>
            <span className="font-bold text-gray-400 group-hover:text-black">New Project</span>
          </button>
        </div>
      )}
    </div>
  );
};
