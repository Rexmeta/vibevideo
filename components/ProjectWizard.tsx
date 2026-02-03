
import React, { useState, useRef, useEffect } from 'react';
import { 
  generateScript, 
  segmentScriptIntoScenes, 
  generateSceneAudio, 
  generateSceneImage, 
  generateSceneVideo, 
  decodeBase64, 
  decodeAudioData 
} from '../services/geminiService';
import { 
  saveProjectToCloud, 
  getProjectFromCloud, 
  uploadFileToCloud 
} from '../services/storageService';
import { Icons } from './Icons';
import { Scene, Project, ProjectStatus, ViewState } from '../types';

interface ProjectWizardProps {
  onNavigate: (view: ViewState) => void;
  initialProjectId?: string | null;
}

export const ProjectWizard: React.FC<ProjectWizardProps> = ({ onNavigate, initialProjectId }) => {
  const [projectId, setProjectId] = useState<string>(initialProjectId || `proj-${Date.now()}`);
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5 | 6 | 7>(1);
  const [maxStep, setMaxStep] = useState<number>(1);
  
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16' | '1:1' | '3:4'>('16:9');
  const [videoStyle, setVideoStyle] = useState('Cute Stickman');
  const [customStyle, setCustomStyle] = useState('');
  const [selectedVoice, setSelectedVoice] = useState<string>('Puck');
  const [topic, setTopic] = useState('');
  const [duration, setDuration] = useState(30);
  const [script, setScript] = useState('');
  const [scenes, setScenes] = useState<Partial<Scene>[]>([]);
  
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [syncing, setSyncing] = useState(false);

  const audioContextRef = useRef<AudioContext | null>(null);
  const activeSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const [playingIdx, setPlayingIdx] = useState<number | null>(null);

  // Load Project from Cloud
  useEffect(() => {
    const loadProject = async () => {
      if (initialProjectId) {
        setLoading(true);
        setLoadingMessage("Fetching project from cloud...");
        try {
          const project = await getProjectFromCloud(initialProjectId);
          if (project) {
            setProjectId(project.id);
            setTopic(project.title || '');
            setAspectRatio(project.aspect_ratio as any);
            setVideoStyle(project.style_template);
            setStep((project.saved_step || 1) as any);
            setMaxStep(project.saved_step || 1);
            if (project.saved_script) setScript(project.saved_script);
            if (project.saved_scenes) setScenes(project.saved_scenes);
            if (project.saved_duration) setDuration(project.saved_duration);
          }
        } catch (e) {
          console.error("Cloud load error", e);
        } finally {
          setLoading(false);
        }
      }
    };
    loadProject();
  }, [initialProjectId]);

  // Sync with Firestore
  const syncWithCloud = async () => {
    setSyncing(true);
    const currentProject: Project = {
      id: projectId,
      user_id: 'u1',
      title: topic || 'Untitled AI Project',
      aspect_ratio: aspectRatio,
      style_template: videoStyle,
      status: ProjectStatus.DRAFT,
      created_at: new Date().toISOString(),
      thumbnail: scenes.find(s => s.image_path)?.image_path || undefined,
      saved_step: Math.max(step, maxStep),
      saved_script: script,
      saved_scenes: scenes as Scene[],
      saved_topic: topic,
      saved_duration: duration
    };
    try {
      await saveProjectToCloud(currentProject);
    } catch (e) {
      console.error("Cloud sync failed");
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    if (step > maxStep) setMaxStep(step);
    const timer = setTimeout(() => syncWithCloud(), 2000);
    return () => clearTimeout(timer);
  }, [step, scenes, script, topic, aspectRatio, videoStyle, duration]);

  const playSceneAudio = async (idx: number) => {
    if (playingIdx === idx) { stopAllAudio(); return; }
    stopAllAudio();
    const audioUrl = scenes[idx]?.audio_path;
    if (!audioUrl) return;

    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    }

    setPlayingIdx(idx);
    try {
        const response = await fetch(audioUrl);
        const arrayBuffer = await response.arrayBuffer();
        const buffer = await audioContextRef.current.decodeAudioData(arrayBuffer);
        const source = audioContextRef.current.createBufferSource();
        source.buffer = buffer;
        source.connect(audioContextRef.current.destination);
        source.onended = () => setPlayingIdx(null);
        activeSourceRef.current = source;
        source.start();
    } catch (e) {
        console.error("Audio playback error", e);
        setPlayingIdx(null);
    }
  };

  const stopAllAudio = () => {
    if (activeSourceRef.current) {
      try { activeSourceRef.current.stop(); } catch(e) {}
      activeSourceRef.current = null;
    }
    setPlayingIdx(null);
  };

  const handleGenerateAllAudio = async () => {
    setLoading(true);
    try {
      for (let i = 0; i < scenes.length; i++) {
        setLoadingMessage(`Synthesizing Scene ${i + 1}/${scenes.length}...`);
        if (scenes[i].script_segment) {
            const styleToUse = videoStyle === 'Custom' ? customStyle : videoStyle;
            const base64Audio = await generateSceneAudio(scenes[i].script_segment!, styleToUse, selectedVoice);
            if (base64Audio) {
              const cloudUrl = await uploadFileToCloud(`${projectId}/audio/scene-${i}.wav`, base64Audio, 'base64');
              setScenes(prev => {
                const next = [...prev];
                next[i] = { ...next[i], audio_path: cloudUrl };
                return next;
              });
            }
        }
      }
    } catch (e: any) { alert(`Audio Error: ${e.message}`); }
    finally { setLoading(false); }
  };

  const handleGenerateAllImages = async () => {
    setLoading(true);
    try {
      for (let i = 0; i < scenes.length; i++) {
        setLoadingMessage(`Generating Keyframe ${i + 1}/${scenes.length}...`);
        if (scenes[i].visual_prompt) {
          const styleToUse = videoStyle === 'Custom' ? customStyle : videoStyle;
          const base64Img = await generateSceneImage(scenes[i].visual_prompt!, styleToUse, aspectRatio);
          if (base64Img) {
            const cloudUrl = await uploadFileToCloud(`${projectId}/images/scene-${i}.jpg`, base64Img, 'base64');
            setScenes(prev => {
              const next = [...prev];
              next[i] = { ...next[i], image_path: cloudUrl, video_path: undefined };
              return next;
            });
          }
        }
      }
    } catch (e: any) { alert(`Image Error: ${e.message}`); }
    finally { setLoading(false); }
  };

  const handleGenerateAllVideos = async () => {
    setLoading(true);
    try {
        for (let i = 0; i < scenes.length; i++) {
            if (scenes[i].video_path) continue;
            setLoadingMessage(`Veo Rendering Scene ${i + 1}/${scenes.length}...`);
            const promptToUse = scenes[i].visual_prompt || scenes[i].script_segment;
            if (promptToUse) {
                const videoUrl = await generateSceneVideo(promptToUse, scenes[i].image_path, aspectRatio);
                if (videoUrl) {
                    // Upload the video to Cloud Storage for permanence
                    const videoResponse = await fetch(videoUrl);
                    const videoBlob = await videoResponse.blob();
                    const cloudUrl = await uploadFileToCloud(`${projectId}/videos/scene-${i}.mp4`, videoBlob, 'blob');
                    setScenes(prev => {
                        const next = [...prev];
                        next[i] = { ...next[i], video_path: cloudUrl };
                        return next;
                    });
                }
            }
        }
    } catch (e: any) { alert(`Video Error: ${e.message}`); }
    finally { setLoading(false); }
  };

  const handleFinalRender = async (saveAsNew: boolean = false) => {
    setLoading(true);
    setLoadingMessage("Finalizing and saving to cloud...");
    if (saveAsNew) {
        const newId = `proj-copy-${Date.now()}`;
        setProjectId(newId);
    }
    await syncWithCloud();
    setLoading(false);
    onNavigate('projects');
  };

  const canNavigateTo = (targetStep: number) => targetStep <= Math.max(step, maxStep);

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 relative">
      {/* Cloud Sync Status Indicator */}
      <div className={`absolute top-0 right-8 flex items-center gap-2 text-xs font-bold transition-opacity ${syncing ? 'opacity-100' : 'opacity-0'}`}>
         <Icons.Loader2 size={12} className="animate-spin text-brand-cyan" />
         <span className="text-gray-400 uppercase tracking-widest">Cloud Syncing...</span>
      </div>

      <div className="flex justify-between mb-16 relative max-w-6xl mx-auto">
        <div className="absolute top-1/2 left-0 w-full h-1 bg-gray-100 -z-10 -translate-y-1/2 rounded-full"></div>
        <div className="absolute top-1/2 left-0 h-1 bg-brand-cyan -z-10 -translate-y-1/2 rounded-full transition-all duration-700" style={{ width: `${((step - 1) / 6) * 100}%` }}></div>
        {['Setup', 'Script', 'Audio', 'Images', 'Motion', 'Assembly', 'Export'].map((label, idx) => (
            <div key={label} onClick={() => canNavigateTo(idx+1) && setStep((idx+1) as any)} className={`flex flex-col items-center bg-white px-3 cursor-pointer ${canNavigateTo(idx+1) ? 'opacity-100' : 'opacity-30'}`}>
                <div className={`w-10 h-10 rounded-full flex items-center justify-center font-black mb-2 transition-all border-2 ${step >= (idx+1) ? 'bg-brand-cyan text-brand-dark border-brand-cyan' : 'bg-white text-gray-200 border-gray-100'}`}>
                    {step > (idx+1) ? <Icons.Check size={16} /> : (idx+1)}
                </div>
                <span className="text-[10px] font-black uppercase tracking-widest">{label}</span>
            </div>
        ))}
      </div>

      <div className="bg-white rounded-[3rem] shadow-2xl border border-gray-50 min-h-[700px] p-8 relative flex flex-col">
        {loading && (
            <div className="absolute inset-0 bg-white/95 z-50 flex flex-col items-center justify-center text-center p-8 rounded-[3rem]">
                <Icons.Loader2 className="animate-spin text-brand-cyan w-20 h-20 mb-8" />
                <p className="text-3xl font-black text-brand-dark mb-4">{loadingMessage}</p>
                <div className="px-6 py-2 bg-brand-cyan/10 text-brand-cyan rounded-full text-[10px] font-black uppercase tracking-widest">Google Cloud Integrated</div>
            </div>
        )}

        {step === 1 && (
            <div className="flex-1 flex flex-col max-w-4xl mx-auto w-full">
                <h2 className="text-4xl font-black text-center mb-10">Project Configuration</h2>
                <div className="flex justify-center gap-4 mb-12">
                    {['16:9', '9:16', '1:1', '3:4'].map(r => (
                        <button key={r} onClick={() => setAspectRatio(r as any)} className={`px-8 py-4 rounded-2xl border-2 font-black transition-all ${aspectRatio === r ? 'border-brand-cyan bg-brand-cyan/5 shadow-lg' : 'border-gray-50'}`}>{r}</button>
                    ))}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-12">
                   {['Stickman', 'Anime', 'Real', '3D'].map(s => (
                       <button key={s} onClick={() => setVideoStyle(s)} className={`p-6 rounded-3xl border-2 font-black aspect-square flex items-center justify-center ${videoStyle === s ? 'border-brand-cyan shadow-xl' : 'border-gray-50'}`}>{s}</button>
                   ))}
                </div>
                <button onClick={() => setStep(2)} className="mt-auto bg-brand-dark text-white py-6 rounded-full font-black text-xl">Next: Script Engine</button>
            </div>
        )}

        {step === 2 && (
            <div className="flex-1 flex flex-col max-w-4xl mx-auto w-full gap-8">
                <h2 className="text-4xl font-black text-center">Scripting & Voice</h2>
                <div className="flex gap-4">
                    <input type="text" value={topic} onChange={e => setTopic(e.target.value)} className="flex-1 p-6 bg-gray-50 rounded-3xl outline-none border-2 border-transparent focus:border-brand-cyan" placeholder="Topic for AI generation..." />
                    <button onClick={async () => {
                        setLoading(true);
                        setLoadingMessage("AI Drafting...");
                        const s = await generateScript(topic, videoStyle, duration);
                        setScript(s);
                        setLoading(false);
                    }} className="bg-brand-cyan px-8 rounded-3xl font-black"><Icons.Wand2 /></button>
                </div>
                <textarea value={script} onChange={e => setScript(e.target.value)} className="flex-1 p-8 bg-gray-50 rounded-[2.5rem] outline-none font-serif text-xl leading-relaxed resize-none shadow-inner" />
                <button onClick={async () => {
                    setLoading(true);
                    setLoadingMessage("Segmenting scenes...");
                    const segs = await segmentScriptIntoScenes(script, videoStyle, aspectRatio);
                    setScenes(segs);
                    setStep(3);
                    setLoading(false);
                }} className="bg-brand-dark text-white py-6 rounded-full font-black">Confirm & Generate Scenes</button>
            </div>
        )}

        {step >= 3 && step <= 5 && (
            <div className="flex-1 flex flex-col h-full overflow-hidden">
                <div className="flex justify-between items-center mb-8">
                    <h2 className="text-3xl font-black">{step === 3 ? 'Sonic' : step === 4 ? 'Visuals' : 'Motion'} Generation</h2>
                    <button onClick={step === 3 ? handleGenerateAllAudio : step === 4 ? handleGenerateAllImages : handleGenerateAllVideos} className="bg-brand-cyan px-8 py-3 rounded-full font-black shadow-lg">
                        {step === 3 ? 'Synth All Audio' : step === 4 ? 'Generate All Keyframes' : 'Render All Clips'}
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto pr-2 space-y-6">
                    {scenes.map((scene, idx) => (
                        <div key={idx} className="p-8 bg-gray-50 rounded-[3rem] flex gap-8 items-center border border-gray-100">
                            <div className="flex-1">
                                <span className="text-[10px] font-black text-brand-cyan uppercase">Scene {idx+1}</span>
                                <p className="text-gray-600 font-medium italic mt-2">"{scene.script_segment}"</p>
                                {step >= 3 && scene.audio_path && <button onClick={() => playSceneAudio(idx)} className="mt-4 text-xs font-black bg-white px-4 py-2 rounded-xl shadow-sm flex items-center gap-2"><Icons.Play size={12} /> {playingIdx === idx ? 'Playing...' : 'Preview Audio'}</button>}
                            </div>
                            <div className={`shrink-0 bg-white rounded-3xl overflow-hidden shadow-inner flex items-center justify-center border-4 border-white ${aspectRatio === '9:16' ? 'w-40 h-72' : 'w-72 h-40'}`}>
                                {step === 4 && scene.image_path ? <img src={scene.image_path} className="w-full h-full object-cover" /> : 
                                 step === 5 && scene.video_path ? <video src={scene.video_path} autoPlay loop muted className="w-full h-full object-cover" /> :
                                 <Icons.Loader2 className="text-gray-100 animate-spin" size={40} />}
                            </div>
                        </div>
                    ))}
                </div>
                <button onClick={() => setStep((step + 1) as any)} className="mt-8 bg-brand-dark text-white py-6 rounded-full font-black">Next Stage</button>
            </div>
        )}

        {step === 6 && (
            <div className="flex-1 flex flex-col items-center justify-center text-center animate-in zoom-in">
                <Icons.LayoutTemplate size={80} className="text-brand-cyan mb-8 animate-pulse" />
                <h2 className="text-5xl font-black mb-4">Cloud Assembly Complete</h2>
                <p className="text-gray-500 max-w-lg mb-12">All assets are synced with Google Cloud Storage. Your master video is ready for final preview.</p>
                <button onClick={() => setStep(7)} className="bg-brand-dark text-white px-16 py-6 rounded-full font-black text-2xl shadow-2xl">View Final Master</button>
            </div>
        )}

        {step === 7 && (
            <div className="flex-1 flex flex-col items-center justify-center py-10 animate-in zoom-in">
                <div className={`relative rounded-[3rem] border-[16px] border-white shadow-2xl overflow-hidden bg-brand-dark mb-10 ${aspectRatio === '9:16' ? 'w-64 h-[28rem]' : 'w-[40rem] h-[22rem]'}`}>
                    {scenes[0]?.video_path && <video src={scenes[0].video_path} autoPlay loop muted playsInline className="w-full h-full object-cover" />}
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40"><Icons.Play className="text-white fill-white" size={60} /></div>
                </div>
                <div className="flex gap-4">
                    <button onClick={() => handleFinalRender(true)} className="px-10 py-5 rounded-full font-bold bg-white text-black border-2 border-gray-100 shadow-xl">Duplicate & Edit New Ver.</button>
                    <button onClick={() => handleFinalRender(false)} className="bg-brand-dark text-white px-16 py-6 rounded-full font-black text-2xl shadow-2xl">Finish & Save to Studio</button>
                </div>
            </div>
        )}
      </div>
    </div>
  );
};
