
import React, { useState, useRef, useEffect } from 'react';
import { 
  generateScript, 
  segmentScriptIntoScenes, 
  generateSceneAudio, 
  generateSceneImage, 
  generateSceneVideo 
} from '../services/geminiService';
import { 
  saveProjectToCloud, 
  getProjectFromCloud, 
  uploadFileToCloud 
} from '../services/storageService';
import { Icons } from './Icons';
import { Scene, Project, ProjectStatus, ViewState } from '../types';

interface ProjectWizardProps {
  userId: string;
  onNavigate: (view: ViewState) => void;
  initialProjectId?: string | null;
}

export const ProjectWizard: React.FC<ProjectWizardProps> = ({ userId, onNavigate, initialProjectId }) => {
  const [projectId, setProjectId] = useState<string>(initialProjectId || `proj-${Date.now()}`);
  const [createdAt, setCreatedAt] = useState<string>(new Date().toISOString());
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5 | 6 | 7>(1);
  const [maxStep, setMaxStep] = useState<number>(1);
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16' | '1:1' | '3:4'>('16:9');
  const [videoStyle, setVideoStyle] = useState('Cute Stickman');
  const [topic, setTopic] = useState('');
  const [duration, setDuration] = useState(30);
  const [script, setScript] = useState('');
  const [scenes, setScenes] = useState<Partial<Scene>[]>([]);
  const [thumbnail, setThumbnail] = useState<string | undefined>(undefined);
  
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [processingIdx, setProcessingIdx] = useState<number | null>(null);
  const [processingType, setProcessingType] = useState<'audio' | 'image' | 'video' | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingAudioIdx, setPlayingAudioIdx] = useState<number | null>(null);
  const [activePreviewIdx, setActivePreviewIdx] = useState(0);

  // Restore project on mount
  useEffect(() => {
    if (!userId) return;
    const load = async () => {
      setLoading(true);
      setLoadingMessage("Cloud Workspace 로딩 중...");
      try {
        let p: Project | undefined;
        if (initialProjectId) p = await getProjectFromCloud(initialProjectId);
        
        if (!p) {
          const localData = localStorage.getItem(`vibe_video_backup_${initialProjectId || projectId}`);
          if (localData) p = JSON.parse(localData);
        }

        if (p) {
          setProjectId(p.id);
          setCreatedAt(p.created_at || new Date().toISOString());
          setTopic(p.saved_topic || '');
          setAspectRatio(p.aspect_ratio as any);
          setVideoStyle(p.style_template);
          setStep((p.saved_step || 1) as any);
          setMaxStep(p.saved_step || 1);
          setScript(p.saved_script || '');
          setScenes(p.saved_scenes || []);
          setDuration(p.saved_duration || 30);
          setThumbnail(p.thumbnail);
        }
      } catch (err) {
        console.error("Restore failed:", err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [initialProjectId, userId, projectId]);

  const sync = async (targetStep?: number, scenesOverride?: Partial<Scene>[], extraData: Partial<Project> = {}) => {
    if (!userId) return;
    const currentStep = targetStep || step;
    const currentScenes = (scenesOverride || scenes) as Scene[];
    
    const proj: Project = {
      id: projectId,
      user_id: userId,
      title: topic || '새 비디오 프로젝트',
      aspect_ratio: aspectRatio,
      style_template: videoStyle,
      status: ProjectStatus.DRAFT,
      created_at: createdAt,
      updated_at: new Date().toISOString(),
      saved_step: currentStep,
      saved_script: script,
      saved_scenes: currentScenes,
      saved_topic: topic,
      saved_duration: duration,
      thumbnail: extraData.thumbnail || thumbnail,
      ...extraData
    };

    localStorage.setItem(`vibe_video_backup_${projectId}`, JSON.stringify(proj));

    try {
      setSyncing(true);
      setSyncError(false);
      await saveProjectToCloud(proj);
    } catch (e) {
      console.error("Sync error:", e);
      setSyncError(true);
    } finally {
      setSyncing(false);
    }
  };

  const handlePlayAudio = (url: string, idx: number) => {
    if (playingAudioIdx === idx) {
      audioRef.current?.pause();
      setPlayingAudioIdx(null);
    } else {
      if (audioRef.current) {
        audioRef.current.src = url;
        audioRef.current.play();
        setPlayingAudioIdx(idx);
      }
    }
  };

  const handleBatchAudio = async () => {
    setProcessingType('audio');
    const updatedScenes = [...scenes];
    for (let i = 0; i < updatedScenes.length; i++) {
      if (updatedScenes[i].audio_path && !updatedScenes[i].audio_path.startsWith('data:')) continue;
      setProcessingIdx(i);
      try {
        const res = await generateSceneAudio(updatedScenes[i].script_segment!, videoStyle);
        if (res) {
          updatedScenes[i].audio_path = res.audio_path;
          updatedScenes[i].audio_duration = res.duration;
          setScenes([...updatedScenes]);
          // Include userId in path for security/organization
          const url = await uploadFileToCloud(`users/${userId}/projects/${projectId}/audio/s${i}.wav`, res.audio_path, 'base64');
          updatedScenes[i].audio_path = url;
          setScenes([...updatedScenes]);
          await sync(undefined, updatedScenes);
        }
      } catch (e) { console.error(e); }
    }
    setProcessingIdx(null); setProcessingType(null);
  };

  const handleBatchImages = async () => {
    setProcessingType('image');
    const updatedScenes = [...scenes];
    let firstImgUrl = thumbnail;
    for (let i = 0; i < updatedScenes.length; i++) {
      if (updatedScenes[i].image_path && !updatedScenes[i].image_path.startsWith('data:')) continue;
      setProcessingIdx(i);
      try {
        const base64 = await generateSceneImage(updatedScenes[i].visual_prompt!, videoStyle, aspectRatio);
        if (base64) {
          const previewUrl = `data:image/jpeg;base64,${base64}`;
          updatedScenes[i].image_path = previewUrl;
          setScenes([...updatedScenes]);
          
          const url = await uploadFileToCloud(`users/${userId}/projects/${projectId}/images/s${i}.jpg`, base64, 'base64');
          updatedScenes[i].image_path = url;
          if (i === 0) {
            firstImgUrl = url;
            setThumbnail(url);
          }
          setScenes([...updatedScenes]);
          await sync(undefined, updatedScenes, { thumbnail: firstImgUrl });
        }
      } catch (e) { console.error(e); }
    }
    setProcessingIdx(null); setProcessingType(null);
  };

  const handleSingleImage = async (idx: number) => {
    setProcessingType('image'); setProcessingIdx(idx);
    const updatedScenes = [...scenes];
    try {
      const base64 = await generateSceneImage(updatedScenes[idx].visual_prompt!, videoStyle, aspectRatio);
      if (base64) {
        const previewUrl = `data:image/jpeg;base64,${base64}`;
        updatedScenes[idx].image_path = previewUrl;
        setScenes([...updatedScenes]);
        
        const url = await uploadFileToCloud(`users/${userId}/projects/${projectId}/images/s${idx}.jpg`, base64, 'base64');
        updatedScenes[idx].image_path = url;
        let newThumbnail = thumbnail;
        if (idx === 0) {
          newThumbnail = url;
          setThumbnail(url);
        }
        setScenes([...updatedScenes]);
        await sync(undefined, updatedScenes, { thumbnail: newThumbnail });
      }
    } catch (e) { console.error(e); }
    setProcessingIdx(null); setProcessingType(null);
  };

  const handleBatchVideos = async () => {
    setProcessingType('video');
    const updatedScenes = [...scenes];
    for (let i = 0; i < updatedScenes.length; i++) {
      if (updatedScenes[i].video_path && !updatedScenes[i].video_path.startsWith('blob:')) continue;
      setProcessingIdx(i);
      try {
        const videoUrl = await generateSceneVideo(updatedScenes[i].visual_prompt!, updatedScenes[i].image_path, aspectRatio);
        if (videoUrl) {
          updatedScenes[i].video_path = videoUrl;
          setScenes([...updatedScenes]);
          const blob = await fetch(videoUrl).then(r => r.blob());
          const url = await uploadFileToCloud(`users/${userId}/projects/${projectId}/videos/s${i}.mp4`, blob, 'blob');
          updatedScenes[i].video_path = url;
          setScenes([...updatedScenes]);
          await sync(undefined, updatedScenes);
        }
      } catch (e) { console.error(e); }
    }
    setProcessingIdx(null); setProcessingType(null);
  };

  const handleSingleVideo = async (idx: number) => {
    setProcessingType('video'); setProcessingIdx(idx);
    const updatedScenes = [...scenes];
    try {
      const videoUrl = await generateSceneVideo(updatedScenes[idx].visual_prompt!, updatedScenes[idx].image_path, aspectRatio);
      if (videoUrl) {
        updatedScenes[idx].video_path = videoUrl;
        setScenes([...updatedScenes]);
        const blob = await fetch(videoUrl).then(r => r.blob());
        const url = await uploadFileToCloud(`users/${userId}/projects/${projectId}/videos/s${idx}.mp4`, blob, 'blob');
        updatedScenes[idx].video_path = url;
        setScenes([...updatedScenes]);
        await sync(undefined, updatedScenes);
      }
    } catch (e) { console.error(e); }
    setProcessingIdx(null); setProcessingType(null);
  };

  const isImagesReady = scenes.length > 0 && scenes.every(s => !!s.image_path);
  const isVideosReady = scenes.length > 0 && scenes.every(s => !!s.video_path);

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 relative">
      <audio ref={audioRef} onEnded={() => setPlayingAudioIdx(null)} className="hidden" />

      {/* Persistence Bar */}
      <div className={`fixed bottom-10 left-1/2 -translate-x-1/2 z-[110] pointer-events-none transition-all duration-500 ${syncing || syncError ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-20'}`}>
         <div className={`px-10 py-4 rounded-full shadow-[0_20px_50px_rgba(0,0,0,0.3)] flex items-center gap-4 border-2 ${syncError ? 'bg-red-500 border-red-400' : 'bg-brand-dark border-brand-cyan/20 backdrop-blur-xl'}`}>
            {syncing ? <Icons.Loader2 className="animate-spin text-brand-cyan" size={20} /> : <Icons.Cloud className="text-brand-cyan" size={20} />}
            <span className="text-sm font-black uppercase text-white tracking-[0.2em]">
              {syncError ? 'Cloud Offline - Retrying...' : syncing ? 'Saving Workspace...' : 'Project Synced'}
            </span>
         </div>
      </div>

      {/* Stepper */}
      <div className="flex justify-between mb-16 relative max-w-5xl mx-auto">
        {['Vibe', 'Script', 'Audio', 'Storyboard', 'Motion', 'Preview', 'Export'].map((l, i) => (
          <div key={l} onClick={() => i+1 <= maxStep && !syncing && setStep((i+1) as any)} className={`flex flex-col items-center z-10 cursor-pointer transition-all ${step >= i+1 ? 'opacity-100' : 'opacity-20'}`}>
            <div className={`w-12 h-12 rounded-full flex items-center justify-center font-black border-4 transition-all ${step === i+1 ? 'bg-brand-cyan border-white shadow-2xl scale-110' : 'bg-white border-gray-100'}`}>
              {step > i+1 ? <Icons.Check size={20} /> : i+1}
            </div>
            <span className="mt-2 text-[10px] font-black uppercase tracking-tight">{l}</span>
          </div>
        ))}
        <div className="absolute top-6 left-0 w-full h-1 bg-gray-100 -z-0 rounded-full"></div>
        <div className="absolute top-6 left-0 h-1 bg-brand-cyan -z-0 rounded-full transition-all duration-700" style={{ width: `${((step-1)/6)*100}%` }}></div>
      </div>

      <div className="bg-white rounded-[4rem] shadow-2xl p-12 min-h-[750px] flex flex-col relative border border-gray-50 overflow-hidden">
        {loading && (
          <div className="absolute inset-0 bg-white/95 backdrop-blur-xl z-[150] flex flex-col items-center justify-center text-center p-10">
            <div className="relative mb-12">
               <div className="w-24 h-24 border-8 border-gray-100 border-t-brand-cyan rounded-full animate-spin"></div>
               <Icons.Cloud className="absolute inset-0 m-auto text-brand-dark" size={32} />
            </div>
            <p className="text-3xl font-black text-brand-dark mb-4">{loadingMessage}</p>
            <p className="text-gray-400 font-medium tracking-tight italic">당신의 모든 창작물은 구글 클라우드에서 안전하게 관리됩니다.</p>
          </div>
        )}

        {step === 1 && (
          <div className="flex-1 flex flex-col max-w-4xl mx-auto w-full">
            <div className="text-center mb-16">
              <h2 className="text-5xl font-black text-brand-dark mb-4 tracking-tighter">Workspace Config</h2>
              <p className="text-gray-400 text-lg font-medium italic">비디오의 톤앤매너를 설정하세요.</p>
            </div>
            <div className="space-y-16">
              <section>
                <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 mb-8 flex items-center gap-2">Aspect Ratio</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                  {['16:9', '9:16', '1:1', '3:4'].map(r => (
                    <button key={r} onClick={() => setAspectRatio(r as any)} className={`p-8 rounded-[2.5rem] border-4 flex flex-col items-center gap-4 transition-all ${aspectRatio === r ? 'border-brand-cyan bg-brand-cyan/5 shadow-xl scale-[1.02]' : 'border-gray-50 hover:border-gray-100'}`}>
                      <span className="font-black text-xl">{r}</span>
                    </button>
                  ))}
                </div>
              </section>
              <section>
                <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 mb-8 flex items-center gap-2">Visual Style</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                  {['Cute Stickman', 'Japanese Anime', 'Realistic Cinematic', '3D Pixar-like'].map(s => (
                    <button key={s} onClick={() => setVideoStyle(s)} className={`p-6 rounded-[2.5rem] border-4 transition-all text-center ${videoStyle === s ? 'border-brand-cyan bg-brand-cyan/5 shadow-xl scale-[1.02]' : 'border-gray-50 hover:border-gray-100'}`}>
                      <span className="text-xs font-black uppercase">{s}</span>
                    </button>
                  ))}
                </div>
              </section>
            </div>
            <button onClick={() => { setStep(2); sync(2); }} className="mt-20 bg-brand-dark text-white py-8 rounded-full font-black text-2xl shadow-2xl hover:brightness-110 transition-all">
              Initialize Vibe Script <Icons.ChevronRight className="inline" size={28} />
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="flex-1 flex flex-col max-w-4xl mx-auto w-full gap-8">
            <div className="flex gap-4">
              <input value={topic} onChange={e => setTopic(e.target.value)} placeholder="비디오 주제를 입력하세요 (예: 2024년 파리 올림픽 요약)..." className="flex-1 p-8 bg-gray-50 rounded-[2.5rem] outline-none text-2xl font-bold shadow-inner" />
              <button onClick={async () => {
                setLoading(true); setLoadingMessage("AI가 창의적인 스크립트를 빌드 중입니다...");
                const result = await generateScript(topic, videoStyle);
                setScript(result); setLoading(false);
              }} className="bg-brand-cyan text-black px-10 rounded-[2.5rem] shadow-xl hover:scale-105 transition-all"><Icons.Wand2 size={28} /></button>
            </div>
            <textarea value={script} onChange={e => setScript(e.target.value)} className="flex-1 p-10 bg-gray-50 rounded-[3rem] outline-none font-serif text-xl leading-relaxed shadow-inner" placeholder="AI가 작성한 스크립트..." />
            <div className="flex gap-4">
               <button onClick={() => setStep(1)} className="px-10 py-6 rounded-full font-black text-gray-400 hover:text-black transition-colors">Back</button>
               <button onClick={async () => {
                  setLoading(true); setLoadingMessage("스크립트를 씬 단위로 분석하고 있습니다...");
                  const s = await segmentScriptIntoScenes(script, videoStyle, aspectRatio);
                  setScenes(s); setStep(3); setMaxStep(Math.max(maxStep, 3)); setLoading(false);
                  await sync(3, s);
                }} className="flex-1 bg-brand-dark text-white py-6 rounded-full font-black text-2xl shadow-2xl hover:scale-[1.01] transition-all">
                Construct Storyboard
              </button>
            </div>
          </div>
        )}

        {(step >= 3 && step <= 5) && (
          <div className="flex-1 flex flex-col h-full">
            <div className="flex justify-between items-center mb-10">
              <div>
                <h2 className="text-4xl font-black tracking-tight">
                  {step === 3 ? 'AI Audio Synthesis' : step === 4 ? 'Visual Storyboard' : 'AI Motion Engine'}
                </h2>
                <p className="text-gray-400 font-medium italic">
                  {step === 4 ? '모든 이미지가 생성되어야 다음 단계로 진행할 수 있습니다.' : '오토 제너레이트 버튼을 클릭하여 모든 씬을 한 번에 완성하세요.'}
                </p>
              </div>
              <button 
                disabled={processingIdx !== null}
                onClick={step === 3 ? handleBatchAudio : step === 4 ? handleBatchImages : handleBatchVideos} 
                className={`px-12 py-5 rounded-full font-black text-lg shadow-xl transition-all ${processingIdx !== null ? 'bg-gray-100 text-gray-300' : 'bg-brand-cyan text-black hover:scale-105 active:scale-95'}`}
              >
                {processingIdx !== null ? <Icons.Loader2 className="animate-spin" size={20} /> : `Auto-Generate All`}
              </button>
            </div>

            <div className="flex-1 overflow-y-auto pr-4 space-y-6 hide-scrollbar">
              {scenes.map((s, i) => (
                <div key={i} className={`p-8 rounded-[3.5rem] flex flex-col md:flex-row gap-8 items-center border transition-all duration-500 relative ${processingIdx === i ? 'bg-brand-cyan/10 border-brand-cyan scale-[1.01] shadow-2xl' : 'bg-gray-50 border-gray-100 shadow-sm'}`}>
                  <div className="flex-1">
                    <span className="bg-brand-dark/5 text-brand-dark/40 px-4 py-1.5 rounded-full text-[10px] font-black uppercase mb-3 inline-block tracking-widest">Scene {i+1}</span>
                    <p className="text-brand-dark text-lg font-medium leading-relaxed italic mb-5 line-clamp-2">"{s.script_segment}"</p>
                    
                    <div className="flex flex-wrap gap-4">
                      {processingIdx === null && (
                        <>
                          {s.audio_path && (
                            <button onClick={() => handlePlayAudio(s.audio_path!, i)} className="flex items-center gap-2 px-6 py-2.5 bg-brand-dark text-white rounded-full text-[11px] font-black uppercase hover:scale-105 transition-all shadow-md">
                              {playingAudioIdx === i ? <Icons.Loader2 className="animate-spin" size={12} /> : <Icons.Play size={12} />} Preview Audio
                            </button>
                          )}
                          {step === 4 && (
                            <button onClick={() => handleSingleImage(i)} className="flex items-center gap-2 px-6 py-2.5 bg-white border-2 border-brand-dark text-black rounded-full text-[11px] font-black uppercase hover:bg-brand-dark hover:text-white transition-all shadow-sm">
                              <Icons.Wand2 size={12} /> Regenerate Image
                            </button>
                          )}
                          {step === 5 && (
                            <button onClick={() => handleSingleVideo(i)} className="flex items-center gap-2 px-6 py-2.5 bg-white border-2 border-brand-dark text-black rounded-full text-[11px] font-black uppercase hover:bg-brand-dark hover:text-white transition-all shadow-sm">
                               <Icons.Video size={12} /> Re-Motion Scene
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  
                  <div className={`shrink-0 bg-brand-dark rounded-[2.5rem] overflow-hidden shadow-2xl flex items-center justify-center border-4 relative transition-all duration-700 ${aspectRatio === '9:16' ? 'w-40 h-72' : 'w-72 h-40'} ${processingIdx === i ? 'border-brand-cyan scale-105' : 'border-white'}`}>
                    {step === 3 ? (
                       <div className="flex flex-col items-center gap-4">
                          {processingIdx === i ? (
                             <Icons.Loader2 className="animate-spin text-brand-cyan" size={40} />
                          ) : s.audio_path ? (
                             <Icons.Check className="text-brand-cyan" size={40} strokeWidth={4} />
                          ) : (
                             <Icons.Mic className="text-white/10" size={40} />
                          )}
                       </div>
                    ) : (step === 4 || step === 5) ? (
                      <div className="relative w-full h-full group">
                        {s.video_path ? (
                          <video src={s.video_path} autoPlay loop muted playsInline className="w-full h-full object-cover" />
                        ) : s.image_path ? (
                          <img src={s.image_path} className="w-full h-full object-cover animate-in fade-in zoom-in-95 duration-700" key={s.image_path} alt="Scene Visual" />
                        ) : (
                          <Icons.ImageIcon className="text-white/10" size={40} />
                        )}
                        {processingIdx === i && (
                          <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center backdrop-blur-md z-10">
                            <Icons.Loader2 className="animate-spin text-brand-cyan mb-2" size={40} />
                            <span className="text-[10px] font-black text-brand-cyan uppercase tracking-widest animate-pulse">Rendering...</span>
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex gap-4 mt-10">
               <button disabled={processingIdx !== null} onClick={() => setStep((step - 1) as any)} className="px-10 py-6 rounded-full font-black text-gray-400 hover:text-black disabled:opacity-0 transition-all">Back</button>
               <button 
                  disabled={processingIdx !== null || (step === 4 && !isImagesReady) || (step === 5 && !isVideosReady)} 
                  onClick={() => { setStep((step + 1) as any); sync(step+1); }} 
                  className={`flex-1 py-6 rounded-full font-black text-2xl shadow-2xl transition-all ${processingIdx !== null || (step === 4 && !isImagesReady) || (step === 5 && !isVideosReady) ? 'bg-gray-100 text-gray-300 cursor-not-allowed scale-95' : 'bg-brand-dark text-white hover:scale-[1.02] shadow-brand-cyan/20'}`}
               >
                {step === 4 && !isImagesReady ? '이미지를 모두 생성하세요' : 
                 step === 5 && !isVideosReady ? '비디오를 모두 생성하세요' : 
                 'Proceed to Final Assembly'}
              </button>
            </div>
          </div>
        )}

        {/* STEP 6: Composition Preview */}
        {step === 6 && (
           <div className="flex-1 flex flex-col h-full animate-in fade-in duration-700">
              <div className="mb-10 text-center">
                <h2 className="text-5xl font-black text-brand-dark mb-4 tracking-tighter">Director's Preview</h2>
                <p className="text-gray-400 font-medium italic">모든 씬이 유기적으로 연결된 최종 결과물을 확인하세요.</p>
              </div>

              <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-10">
                 <div className="lg:col-span-2 bg-brand-dark rounded-[3.5rem] overflow-hidden shadow-[0_40px_100px_rgba(0,0,0,0.5)] relative border-[12px] border-white group">
                    {scenes.length > 0 && scenes[activePreviewIdx] ? (
                       <div className="w-full h-full bg-black relative">
                         <video 
                            key={`preview-${activePreviewIdx}-${scenes[activePreviewIdx]?.video_path || 'loading'}`} 
                            src={scenes[activePreviewIdx]?.video_path} 
                            poster={scenes[activePreviewIdx]?.image_path}
                            autoPlay 
                            playsInline
                            controls 
                            className="w-full h-full object-contain" 
                            onEnded={() => {
                              if (activePreviewIdx < scenes.length - 1) {
                                setActivePreviewIdx(activePreviewIdx + 1);
                              }
                            }}
                          />
                          {!scenes[activePreviewIdx]?.video_path && (
                             <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40 backdrop-blur-sm pointer-events-none">
                                <Icons.Loader2 className="animate-spin text-brand-cyan mb-4" size={48} />
                                <span className="text-white font-black uppercase tracking-widest text-xs">Video Loading...</span>
                             </div>
                          )}
                       </div>
                    ) : (
                       <div className="w-full h-full flex flex-col items-center justify-center text-white/10 gap-6">
                          <Icons.VideoOff size={100} />
                          <p className="font-black uppercase tracking-[0.3em] text-sm">Preview Initialization Failed</p>
                       </div>
                    )}
                    
                    {/* Scene Navigation HUD */}
                    <div className="absolute bottom-10 left-1/2 -translate-x-1/2 bg-black/60 backdrop-blur-2xl px-10 py-4 rounded-full flex gap-6 text-white text-[11px] font-black uppercase opacity-0 group-hover:opacity-100 transition-all duration-700 scale-90 group-hover:scale-100 z-30 shadow-2xl">
                       {scenes.map((_, i) => (
                         <button 
                            key={i} 
                            onClick={() => setActivePreviewIdx(i)} 
                            className={`w-12 h-12 rounded-full transition-all flex items-center justify-center border-2 ${activePreviewIdx === i ? 'bg-brand-cyan border-brand-cyan text-black scale-125 shadow-2xl shadow-brand-cyan/40' : 'border-white/20 hover:bg-white/10'}`}
                          >
                           {i+1}
                         </button>
                       ))}
                    </div>
                 </div>

                 {/* Sidebar Navigation */}
                 <div className="space-y-4 overflow-y-auto hide-scrollbar max-h-[550px] pr-2">
                    <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 mb-6 flex items-center gap-2">
                       <Icons.Layout size={14} /> Assembly Timeline
                    </h4>
                    {scenes.map((s, i) => (
                       <div 
                          key={i} 
                          onClick={() => setActivePreviewIdx(i)} 
                          className={`p-5 rounded-[2.5rem] border-2 cursor-pointer transition-all duration-500 ${activePreviewIdx === i ? 'border-brand-cyan bg-brand-cyan/5 shadow-2xl -translate-x-3' : 'border-gray-50 bg-gray-50 opacity-40 hover:opacity-100 hover:border-gray-200'}`}
                        >
                          <div className="flex items-center gap-5">
                             <div className="w-28 h-16 bg-black rounded-2xl overflow-hidden shrink-0 shadow-xl border-2 border-white/10">
                                {s.image_path ? (
                                  <img src={s.image_path} className="w-full h-full object-cover" alt="Timeline Thumbnail" />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center bg-gray-900"><Icons.Video size={16} className="text-white/20" /></div>
                                )}
                             </div>
                             <div className="flex-1">
                                <p className="text-[11px] font-black uppercase tracking-tight text-brand-dark line-clamp-2 italic leading-tight">
                                  Scene {i+1}: {s.script_segment}
                                </p>
                             </div>
                          </div>
                       </div>
                    ))}
                 </div>
              </div>

              <div className="flex gap-4 mt-12">
                 <button onClick={() => setStep(5)} className="px-12 py-6 rounded-full font-black text-gray-400 hover:text-black transition-all">Back</button>
                 <button onClick={() => { setStep(7); sync(7); }} className="flex-1 bg-brand-dark text-white py-6 rounded-full font-black text-2xl shadow-2xl hover:scale-[1.02] shadow-brand-cyan/10 transition-all">Export Mastery</button>
              </div>
           </div>
        )}

        {/* STEP 7: Export */}
        {step === 7 && (
          <div className="flex-1 flex flex-col items-center justify-center py-20 animate-in fade-in zoom-in-95 duration-1000">
             <div className="w-40 h-40 bg-brand-cyan/20 rounded-full flex items-center justify-center mb-10 animate-bounce shadow-[0_0_80px_rgba(0,194,255,0.2)]">
                <Icons.Check className="text-brand-cyan" size={80} strokeWidth={4} />
             </div>
             <h2 className="text-7xl font-black mb-6 text-brand-dark tracking-tighter">PROJECT COMPLETE</h2>
             <p className="text-gray-400 font-medium text-xl mb-16 text-center max-w-xl leading-relaxed italic">
                축하합니다! 당신의 창작물이 구글 클라우드와 완벽하게 동기화되었습니다.<br/>
                워크스페이스에서 언제든 결과물을 확인하고 공유할 수 있습니다.
             </p>
             <button 
                onClick={() => onNavigate('projects')} 
                className="bg-brand-dark text-white px-20 py-8 rounded-full font-black text-3xl shadow-[0_30px_70px_rgba(0,0,0,0.3)] hover:scale-105 active:scale-95 transition-all flex items-center gap-6"
              >
                Go to Workspace <Icons.ChevronRight size={36} />
              </button>
          </div>
        )}
      </div>
    </div>
  );
};
