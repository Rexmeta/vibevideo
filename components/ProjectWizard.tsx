
import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  generateScript,
  segmentScriptIntoScenes,
  generateSceneAudio,
  generateSceneImage,
  generateSceneVideo,
  extractCharacterDescription,
  decodeBase64,
  decodeAudioData
} from '../services/geminiService';
import { saveProjectToDB, getProjectFromDB, getAllProjectsFromDB } from '../services/storageService';
import { Icons } from './Icons';
import { Scene, Project, ProjectStatus, ViewState } from '../types';

interface ProjectWizardProps {
  onNavigate: (view: ViewState) => void;
  initialProjectId?: string | null;
}

export const ProjectWizard: React.FC<ProjectWizardProps> = ({ onNavigate, initialProjectId }) => {
  const [projectId, setProjectId] = useState<string>(initialProjectId || Date.now().toString());
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5 | 6 | 7>(1);
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

  // Character consistency state
  const [characterDescription, setCharacterDescription] = useState<string>('');

  // Per-scene video generation state
  const [videoGeneratingScenes, setVideoGeneratingScenes] = useState<{ [key: number]: boolean }>({});
  const [videoErrorScenes, setVideoErrorScenes] = useState<{ [key: number]: string }>({});

  const audioContextRef = useRef<AudioContext | null>(null);
  const activeSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const [playingIdx, setPlayingIdx] = useState<number | null>(null);
  const [audioProgress, setAudioProgress] = useState<{ [key: number]: number }>({});
  const progressTimerRef = useRef<number | null>(null);

  const [currentPlaybackScene, setCurrentPlaybackScene] = useState(0);
  const [isPlayingFinal, setIsPlayingFinal] = useState(false);
  const videoPreviewRef = useRef<HTMLVideoElement | null>(null);

  // Ref to hold the latest state for saving without dependency cycles
  const projectStateRef = useRef({
    projectId, step, topic, script, scenes, aspectRatio, videoStyle, duration, characterDescription
  });

  useEffect(() => {
    projectStateRef.current = {
        projectId, step, topic, script, scenes, aspectRatio, videoStyle, duration, characterDescription
    };
  }, [projectId, step, topic, script, scenes, aspectRatio, videoStyle, duration, characterDescription]);

  // Load Project from IndexedDB
  useEffect(() => {
    const loadProject = async () => {
      if (initialProjectId) {
        try {
          const project = await getProjectFromDB(initialProjectId);
          if (project) {
            setTopic(project.title || '');
            setAspectRatio(project.aspect_ratio as any);
            setVideoStyle(project.style_template);
            if (project.saved_step) setStep(project.saved_step as any);
            if (project.saved_script) setScript(project.saved_script);
            if (project.saved_scenes) setScenes(project.saved_scenes);
            if (project.saved_duration) setDuration(project.saved_duration);
            if (project.saved_character_description) setCharacterDescription(project.saved_character_description);
          }
        } catch (e) {
          console.error("Failed to load project from DB", e);
        }
      } else {
        // New project: save initial draft to DB immediately
        saveProjectToDBAsync();
      }
    };
    loadProject();
  }, [initialProjectId]);

  // Async Save Function using IndexedDB
  const saveProjectToDBAsync = async () => {
    const { projectId, step, topic, script, scenes, aspectRatio, videoStyle, duration, characterDescription } = projectStateRef.current;

    let createdAt = new Date().toISOString();
    try {
        const existing = await getProjectFromDB(projectId);
        if (existing) createdAt = existing.created_at;
    } catch (e) {}

    const currentData: Project = {
      id: projectId,
      user_id: 'u1',
      title: topic || 'Untitled Draft',
      aspect_ratio: aspectRatio,
      style_template: videoStyle,
      status: ProjectStatus.DRAFT,
      created_at: createdAt,
      thumbnail: scenes.find(s => s.image_path)?.image_path || undefined,

      saved_step: step,
      saved_script: script,
      saved_scenes: scenes as Scene[],
      saved_topic: topic,
      saved_duration: duration,
      saved_character_description: characterDescription
    };

    try {
      await saveProjectToDB(currentData);
      console.log("Project saved to IndexedDB");
    } catch (e) {
      console.error("Failed to save to IndexedDB", e);
    }
  };

  // Auto-save effect
  useEffect(() => {
    const timer = setTimeout(() => {
        saveProjectToDBAsync();
    }, 1000);
    return () => clearTimeout(timer);
  }, [step, scenes, script, topic, aspectRatio, videoStyle, duration, characterDescription]);

  // Cleanup on unmount (attempt to save one last time)
  useEffect(() => {
    return () => {
        saveProjectToDBAsync();
    };
  }, []);

  const styles = [
    { id: 'stickman', name: 'Cute Stickman', img: 'https://images.unsplash.com/photo-1541364983171-a8ba01e95cfc?auto=format&fit=crop&q=80&w=400', desc: 'Simple & Fun' },
    { id: 'anime', name: 'Japanese Anime', img: 'https://images.unsplash.com/photo-1578632292335-df3abbb0d586?auto=format&fit=crop&q=80&w=400', desc: 'Emotional' },
    { id: 'minimal', name: 'Minimal Info', img: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&q=80&w=400', desc: 'Clean' },
    { id: '3d', name: '3D Animation', img: 'https://images.unsplash.com/photo-1633356122544-f134324a6cee?auto=format&fit=crop&q=80&w=400', desc: 'Modern' },
    { id: 'real', name: 'Real Photo', img: 'https://images.unsplash.com/photo-1492691523569-f23b46e5de3a?auto=format&fit=crop&q=80&w=400', desc: 'Realistic' },
    { id: 'movie', name: 'Movie Still', img: 'https://images.unsplash.com/photo-1485846234645-a62644f84728?auto=format&fit=crop&q=80&w=400', desc: 'Cinematic' },
    { id: 'docu', name: 'Documentary', img: 'https://images.unsplash.com/photo-1433086966358-54859d0ed716?auto=format&fit=crop&q=80&w=400', desc: 'Nature' },
    { id: 'cartoon', name: 'Cartoon Commentary', img: 'https://images.unsplash.com/photo-1535970793482-07de93762dc4?auto=format&fit=crop&q=80&w=400', desc: 'Playful' },
    { id: 'pixel', name: 'Pixel Art', img: 'https://images.unsplash.com/photo-1550684848-fac1c5b4e853?auto=format&fit=crop&q=80&w=400', desc: 'Retro' },
    { id: 'webtoon', name: 'Webtoon', img: 'https://images.unsplash.com/photo-1612152605332-952c75d4d3a1?auto=format&fit=crop&q=80&w=400', desc: 'Sketch' },
    { id: 'sketch', name: 'Chalkboard', img: 'https://images.unsplash.com/photo-1516962215378-7fa2e137ae93?auto=format&fit=crop&q=80&w=400', desc: 'Educational' },
    { id: 'american', name: 'American Cartoon', img: 'https://plus.unsplash.com/premium_photo-1664112065879-c5c88b222955?auto=format&fit=crop&q=80&w=400', desc: 'Vibrant' },
    { id: 'flat', name: 'Flat Illustration', img: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&q=80&w=400', desc: 'Modern' },
    { id: 'custom', name: 'Custom', img: '', desc: 'Your Style' }
  ];

  const aspectRatios = [
    { id: '16:9', icon: Icons.Monitor, label: '16:9', desc: 'YouTube, Desktop' },
    { id: '1:1', icon: Icons.Square, label: '1:1', desc: 'Instagram, Social' },
    { id: '3:4', icon: Icons.Layout, label: '3:4', desc: 'Feed + Captions' },
    { id: '9:16', icon: Icons.Smartphone, label: '9:16', desc: 'TikTok, Reels' },
  ];

  useEffect(() => {
    const voiceMap: Record<string, string> = {
      'Cute Stickman': 'Puck',
      'Japanese Anime': 'Kore',
      'Minimal Info': 'Charon',
      '3D Animation': 'Zephyr',
      'Real Photo': 'Fenrir',
      'Cinematic': 'Fenrir'
    };
    setSelectedVoice(voiceMap[videoStyle] || 'Kore');
  }, [videoStyle]);

  const stopAllAudio = () => {
    if (activeSourceRef.current) {
      try { activeSourceRef.current.stop(); } catch(e) {}
      activeSourceRef.current = null;
    }
    if (progressTimerRef.current) {
      window.clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
    setPlayingIdx(null);
  };

  const playSceneAudio = async (idx: number): Promise<void> => {
    if (playingIdx === idx) {
        stopAllAudio();
        return;
    }
    stopAllAudio();
    const audioData = scenes[idx]?.audio_path;
    if (!audioData) return;

    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    }

    return new Promise((resolve) => {
      try {
        setPlayingIdx(idx);
        const decoded = decodeBase64(audioData);
        decodeAudioData(decoded, audioContextRef.current!).then(buffer => {
          const source = audioContextRef.current!.createBufferSource();
          source.buffer = buffer;
          source.connect(audioContextRef.current!.destination);
          const dur = buffer.duration;
          const startTime = audioContextRef.current!.currentTime;
          progressTimerRef.current = window.setInterval(() => {
            const elapsed = audioContextRef.current!.currentTime - startTime;
            const percent = Math.min((elapsed / dur) * 100, 100);
            setAudioProgress(prev => ({ ...prev, [idx]: percent }));
          }, 30);
          source.onended = () => {
            stopAllAudio();
            setAudioProgress(prev => ({ ...prev, [idx]: 0 }));
            resolve();
          };
          activeSourceRef.current = source;
          source.start();
        });
      } catch (e) {
        stopAllAudio();
        resolve();
      }
    });
  };

  const mergeScenes = (newScenes: Partial<Scene>[], oldScenes: Partial<Scene>[]): Partial<Scene>[] => {
    return newScenes.map((newScene, index) => {
      const oldScene = oldScenes[index];
      if (oldScene) {
        return {
          ...newScene,
          audio_path: oldScene.audio_path,
          image_path: oldScene.image_path,
          video_path: oldScene.video_path,
          id: oldScene.id || newScene.id
        };
      }
      return newScene;
    });
  };

  const handleAIRequestScript = async () => {
    if (!topic) return;
    setLoading(true);
    setLoadingMessage(`AI is drafting your story...`);
    try {
      const styleToUse = videoStyle === 'Custom' ? customStyle : videoStyle;
      const generated = await generateScript(topic, styleToUse, duration);
      setScript(generated);
    } catch (e: any) {
      alert(`Script Error: ${e.message || "Failed to call AI"}`);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmScript = async () => {
    setLoading(true);
    setLoadingMessage("Analyzing characters and converting script to visual scenes...");
    try {
      const styleToUse = videoStyle === 'Custom' ? customStyle : videoStyle;

      // Extract character description for consistency
      const charDesc = await extractCharacterDescription(script, styleToUse);
      setCharacterDescription(charDesc);

      setLoadingMessage("Converting script to visual motion scenes...");
      const segmented = await segmentScriptIntoScenes(script, styleToUse, aspectRatio);
      const merged = mergeScenes(segmented, scenes);
      setScenes(merged);
      setStep(3);
    } catch (e: any) {
      alert(`Segmentation Error: ${e.message || "Failed to split scenes"}`);
    } finally {
      setLoading(false);
    }
  };

  const handleApplyScriptChanges = async () => {
    setLoading(true);
    setLoadingMessage("Re-analyzing characters and updating scenes...");
    try {
      const styleToUse = videoStyle === 'Custom' ? customStyle : videoStyle;

      // Re-extract character descriptions when script changes
      const charDesc = await extractCharacterDescription(script, styleToUse);
      setCharacterDescription(charDesc);

      setLoadingMessage("Updating motion segments...");
      const segmented = await segmentScriptIntoScenes(script, styleToUse, aspectRatio);
      const merged = mergeScenes(segmented, scenes);
      setScenes(merged);
    } catch (e: any) {
      alert(`Update Error: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateAllAudio = async () => {
    setLoading(true);
    let failedScenes: number[] = [];
    try {
      for (let i = 0; i < scenes.length; i++) {
        setLoadingMessage(`Synthesizing Scene ${i + 1}/${scenes.length}...`);
        if (scenes[i].script_segment) {
          try {
            if (i > 0) await new Promise(r => setTimeout(r, 1000));
            const styleToUse = videoStyle === 'Custom' ? customStyle : videoStyle;
            const audio = await generateSceneAudio(scenes[i].script_segment!, styleToUse, selectedVoice);
            if (audio) {
              setScenes(prev => {
                const next = [...prev];
                next[i] = { ...next[i], audio_path: audio };
                return next;
              });
            }
          } catch (innerError: any) {
            console.error(`Failed to generate audio for scene ${i+1}:`, innerError);
            failedScenes.push(i + 1);
          }
        }
      }
      if (failedScenes.length > 0) {
        alert(`Finished with issues. Audio generation failed for scenes: ${failedScenes.join(', ')}.`);
      }
    } catch (e: any) {
      if (e.message === "API_KEY_RESELECT_REQUIRED") {
        alert("API Key session expired or Permission Denied.");
        if ((window as any).aistudio) await (window as any).aistudio.openSelectKey();
      } else {
        alert(`System Audio Error: ${e.message}`);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateAllImages = async () => {
    setLoading(true);
    try {
      const styleToUse = videoStyle === 'Custom' ? customStyle : videoStyle;

      for (let i = 0; i < scenes.length; i++) {
        setLoadingMessage(`Generating Keyframe ${i + 1}/${scenes.length}... (with character consistency)`);
        if (scenes[i].visual_prompt) {
          const base64 = await generateSceneImage(
            scenes[i].visual_prompt!,
            styleToUse,
            aspectRatio,
            characterDescription || undefined
          );
          if (base64) {
            setScenes(prev => {
              const next = [...prev];
              next[i] = { ...next[i], image_path: base64 };
              return next;
            });
          }
        }
      }
    } catch (e: any) {
      if (e.message === "API_KEY_RESELECT_REQUIRED") {
        alert("Image generation requires a fresh API session.");
        if ((window as any).aistudio) await (window as any).aistudio.openSelectKey();
      } else {
        alert(`Image Error: ${e.message}`);
      }
    } finally {
      setLoading(false);
    }
  };

  /**
   * Generate video for a single scene individually.
   * Updates state immediately when done so the user can see the result.
   */
  const handleGenerateSingleVideo = async (idx: number) => {
    // Prevent duplicate generation
    if (videoGeneratingScenes[idx]) return;

    setVideoGeneratingScenes(prev => ({ ...prev, [idx]: true }));
    setVideoErrorScenes(prev => {
      const next = { ...prev };
      delete next[idx];
      return next;
    });

    try {
      // API Key Check (Best Effort)
      try {
        if ((window as any).aistudio && (window as any).aistudio.hasSelectedApiKey) {
          const hasKey = await (window as any).aistudio.hasSelectedApiKey().catch(() => true);
          if (!hasKey) {
            await (window as any).aistudio.openSelectKey();
          }
        }
      } catch (keyError) {
        console.warn("API Key check skipped:", keyError);
      }

      const promptToUse = scenes[idx].visual_prompt || scenes[idx].script_segment;

      if (promptToUse) {
        const videoUrl = await generateSceneVideo(
          promptToUse,
          scenes[idx].image_path,
          aspectRatio,
          characterDescription || undefined
        );
        if (videoUrl) {
          setScenes(prev => {
            const next = [...prev];
            next[idx] = { ...next[idx], video_path: videoUrl };
            return next;
          });
        }
      }
    } catch (e: any) {
      console.error(`Scene ${idx + 1} video generation failed:`, e);
      if (e.message === "API_KEY_RESELECT_REQUIRED") {
        alert("Veo Permission Denied. Please ensure your project has billing enabled.");
        try {
          if ((window as any).aistudio) await (window as any).aistudio.openSelectKey();
        } catch (dialogError) { console.error("Failed to open key dialog", dialogError); }
      }
      setVideoErrorScenes(prev => ({ ...prev, [idx]: e.message || "Generation failed" }));
    } finally {
      setVideoGeneratingScenes(prev => {
        const next = { ...prev };
        delete next[idx];
        return next;
      });
    }
  };

  /**
   * Generate all scene videos sequentially, one at a time.
   * Each video is shown immediately upon completion.
   * No full-screen loading overlay - per-scene indicators instead.
   */
  const handleGenerateAllVideos = async () => {
    if (!scenes || scenes.length === 0) {
      alert("No scenes available to generate video.");
      return;
    }

    for (let i = 0; i < scenes.length; i++) {
      // Skip scenes that already have a video
      if (scenes[i].video_path) continue;
      await handleGenerateSingleVideo(i);
    }
  };

  const isAnyVideoGenerating = Object.keys(videoGeneratingScenes).length > 0;

  const startFullPreview = async () => {
    if (isPlayingFinal) return;
    setIsPlayingFinal(true);
    for (let i = 0; i < scenes.length; i++) {
      setCurrentPlaybackScene(i);
      const audioPromise = playSceneAudio(i);
      if (videoPreviewRef.current) {
        videoPreviewRef.current.currentTime = 0;
        videoPreviewRef.current.play().catch(() => {});
      }
      await audioPromise;
      await new Promise(r => setTimeout(r, 200));
    }
    setIsPlayingFinal(false);
    setCurrentPlaybackScene(0);
  };

  const handleFinalRender = async () => {
    setLoading(true);
    setLoadingMessage("Finalizing and consolidating video master...");

    // Final save to IndexedDB
    await saveProjectToDBAsync();

    // Retrieve current project to get correct creation time
    let createdAt = new Date().toISOString();
    try {
        const existing = await getProjectFromDB(projectId);
        if (existing) createdAt = existing.created_at;
    } catch (e) {}

    const finalProject: Project = {
        id: projectId,
        user_id: 'u1',
        title: topic || 'Untitled AI Video',
        aspect_ratio: aspectRatio,
        style_template: videoStyle,
        status: ProjectStatus.COMPLETED,
        created_at: createdAt,
        thumbnail: scenes[0]?.video_path || scenes[0]?.image_path,
        saved_step: 7,
        saved_script: script,
        saved_scenes: scenes as Scene[],
        saved_topic: topic,
        saved_duration: duration,
        saved_character_description: characterDescription
    };

    await saveProjectToDB(finalProject);

    setLoading(false);
    onNavigate('projects');
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Progress Stepper */}
      <div className="flex justify-between mb-16 relative max-w-6xl mx-auto">
        <div className="absolute top-1/2 left-0 w-full h-1 bg-gray-100 -z-10 -translate-y-1/2 rounded-full"></div>
        <div className="absolute top-1/2 left-0 h-1 bg-brand-cyan -z-10 -translate-y-1/2 rounded-full transition-all duration-700" style={{ width: `${((step - 1) / 6) * 100}%` }}></div>
        {['Setup', 'Script', 'Audio', 'Images', 'Motion', 'Assembly', 'Export'].map((label, idx) => {
            const stepNum = idx + 1;
            const active = step >= stepNum;
            const current = step === stepNum;
            return (
                <div key={label} className="flex flex-col items-center bg-white px-3">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center font-black mb-2 transition-all border-2 ${active ? 'bg-brand-cyan text-brand-dark border-brand-cyan shadow-lg' : 'bg-white text-gray-200 border-gray-100'} ${current ? 'scale-125 ring-8 ring-brand-cyan/5' : ''}`}>
                        {active && !current ? <Icons.Check size={16} /> : stepNum}
                    </div>
                    <span className={`text-[10px] font-black uppercase tracking-widest ${active ? 'text-brand-dark' : 'text-gray-300'}`}>{label}</span>
                </div>
            )
        })}
      </div>

      <div className="bg-white rounded-[3rem] shadow-2xl border border-gray-50 min-h-[780px] p-6 relative overflow-hidden flex flex-col">
        {loading && (
            <div className="absolute inset-0 bg-white/95 z-50 flex flex-col items-center justify-center text-center p-8">
                <Icons.Loader2 className="animate-spin text-brand-cyan w-24 h-24 mb-10" />
                <p className="text-4xl font-black text-brand-dark mb-4">{loadingMessage}</p>
                <p className="text-gray-400 font-medium">Veo & Flash are dreaming up your content...</p>
                <div className="mt-8 px-8 py-2 bg-yellow-50 border border-yellow-100 rounded-full text-xs text-yellow-600 font-bold uppercase tracking-widest">Generating cinematic assets takes a few moments</div>
            </div>
        )}

        {step === 1 && (
          <div className="flex-1 flex flex-col animate-in fade-in duration-500 max-w-6xl mx-auto w-full">
            <h2 className="text-4xl font-black text-center mb-4">Video Settings</h2>
            <p className="text-center text-gray-500 mb-12">Select your aspect ratio and visual style to begin.</p>

            <div className="mb-12">
               <h3 className="text-sm font-black text-gray-400 uppercase tracking-widest mb-6 text-center">Select Aspect Ratio</h3>
               <div className="flex justify-center gap-6 flex-wrap">
                  {aspectRatios.map(opt => (
                    <button
                      key={opt.id}
                      onClick={() => setAspectRatio(opt.id as any)}
                      className={`group relative w-40 h-40 rounded-[2rem] border-2 transition-all flex flex-col items-center justify-center gap-3 bg-white hover:-translate-y-1 ${aspectRatio === opt.id ? 'border-brand-cyan ring-4 ring-brand-cyan/10 shadow-xl' : 'border-gray-100 shadow-sm hover:shadow-md'}`}
                    >
                      <opt.icon size={32} className={aspectRatio === opt.id ? 'text-brand-cyan' : 'text-gray-300'} />
                      <div className="text-center">
                        <span className={`block font-black text-lg ${aspectRatio === opt.id ? 'text-brand-dark' : 'text-gray-400'}`}>{opt.label}</span>
                        <span className="text-[10px] text-gray-400 font-medium">{opt.desc}</span>
                      </div>
                      {aspectRatio === opt.id && (
                        <div className="absolute -top-3 -right-3 w-8 h-8 bg-brand-cyan rounded-full flex items-center justify-center shadow-lg">
                           <Icons.Check className="text-white w-4 h-4 stroke-[4]" />
                        </div>
                      )}
                    </button>
                  ))}
               </div>
            </div>

            <div>
              <h3 className="text-sm font-black text-gray-400 uppercase tracking-widest mb-6 text-center">Select Visual Style</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {styles.map(style => (
                  <div
                    key={style.id}
                    onClick={() => setVideoStyle(style.name)}
                    className={`group relative cursor-pointer rounded-[1.5rem] overflow-hidden border-4 transition-all aspect-[4/3] ${videoStyle === style.name ? 'border-brand-cyan ring-4 ring-brand-cyan/10 shadow-xl transform scale-105 z-10' : 'border-transparent hover:scale-105'}`}
                  >
                    {style.img ? (
                      <img src={style.img} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-brand-pink to-brand-cyan flex items-center justify-center">
                         <Icons.Wand2 className="text-white w-10 h-10" />
                      </div>
                    )}
                    <div className={`absolute inset-0 flex flex-col items-center justify-center p-2 text-center transition-all ${videoStyle === style.name ? 'bg-black/60' : 'bg-black/40 group-hover:bg-black/50'}`}>
                      <span className="text-white font-black text-sm uppercase tracking-wider mb-1 drop-shadow-md">{style.name}</span>
                      {style.id !== 'custom' && <span className="text-white/80 text-[10px] font-medium">{style.desc}</span>}
                    </div>
                     {videoStyle === style.name && (
                        <div className="absolute top-2 right-2 w-6 h-6 bg-brand-cyan rounded-full flex items-center justify-center shadow-md">
                           <Icons.Check className="text-white w-3 h-3 stroke-[4]" />
                        </div>
                      )}
                  </div>
                ))}
              </div>
              {videoStyle === 'Custom' && (
                <div className="mt-8 max-w-lg mx-auto animate-in slide-in-from-bottom-4">
                   <label className="text-xs font-black text-gray-400 uppercase mb-2 block text-center">Describe Your Custom Style</label>
                   <input
                      type="text"
                      value={customStyle}
                      onChange={(e) => setCustomStyle(e.target.value)}
                      placeholder="e.g. 90s Cyberpunk Anime with neon lights..."
                      className="w-full p-4 bg-gray-50 border-2 border-brand-cyan rounded-2xl outline-none text-center font-bold shadow-inner"
                      autoFocus
                   />
                </div>
              )}
            </div>

            <div className="mt-16 flex justify-center">
               <button onClick={() => setStep(2)} className="bg-brand-dark text-white px-16 py-5 rounded-full font-black text-xl shadow-2xl hover:scale-105 transition-all flex items-center gap-3">
                  Next Step <Icons.ArrowRight size={24} />
               </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="flex-1 flex flex-col animate-in slide-in-from-right-8 duration-500 max-w-5xl mx-auto w-full">
            <h2 className="text-4xl font-black text-center mb-8">Story Engine</h2>
            <div className="flex-1 flex flex-col space-y-8">
              <div className="flex flex-col md:flex-row gap-6 items-end">
                <div className="flex-1 w-full">
                  <label className="text-[10px] font-black text-gray-400 uppercase mb-3 block px-2">Topic / Narrator prompt</label>
                  <input type="text" value={topic} onChange={e => setTopic(e.target.value)} className="w-full p-6 bg-gray-50 border-2 border-gray-100 rounded-3xl outline-none focus:border-brand-cyan transition-colors" placeholder="Explain how to make a perfect coffee..." />
                </div>
                <div className="w-full md:w-56">
                  <label className="text-[10px] font-black text-gray-400 uppercase mb-3 block px-2">Duration ({duration}s)</label>
                  <input type="range" min="15" max="60" step="5" value={duration} onChange={e => setDuration(parseInt(e.target.value))} className="w-full h-12 accent-brand-cyan" />
                </div>
                <button onClick={handleAIRequestScript} disabled={!topic} className="bg-brand-cyan text-brand-dark px-10 py-5 rounded-3xl font-black flex items-center gap-3 shadow-xl h-[72px] disabled:opacity-50">
                   <Icons.Wand2 size={24} /> AI Draft
                </button>
              </div>
              <textarea value={script} onChange={e => setScript(e.target.value)} className="flex-1 w-full p-10 bg-gray-50 border-2 border-gray-100 rounded-[3rem] outline-none font-serif text-2xl leading-relaxed resize-none shadow-inner" placeholder="Your screenplay will appear here..." />
            </div>
            <div className="mt-8 flex justify-between">
              <button onClick={() => setStep(1)} className="text-gray-400 font-black hover:text-brand-dark uppercase tracking-widest text-xs">Setup</button>
              <button onClick={handleConfirmScript} disabled={!script} className="bg-brand-dark text-white px-12 py-5 rounded-full font-black text-xl shadow-2xl">Confirm Script</button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="flex-1 flex flex-col animate-in slide-in-from-right-8 duration-500 h-full overflow-hidden">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-3xl font-black text-brand-dark">Sonic Review</h2>
              <div className="flex gap-4">
                <button onClick={handleGenerateAllAudio} className="bg-brand-cyan text-brand-dark px-8 py-3 rounded-full font-black text-sm shadow-lg flex items-center gap-2">
                  <Icons.Mic size={18} /> Synth Voices
                </button>
                <button onClick={() => setStep(4)} disabled={!scenes.some(s => s.audio_path)} className="bg-brand-dark text-white px-8 py-3 rounded-full font-black text-sm shadow-xl disabled:opacity-20">
                  Generate Keyframes
                </button>
              </div>
            </div>
            {/* Character Description Preview */}
            {characterDescription && (
              <div className="mb-4 p-4 bg-brand-cyan/5 border border-brand-cyan/20 rounded-2xl">
                <div className="flex items-center gap-2 mb-2">
                  <Icons.User size={14} className="text-brand-cyan" />
                  <span className="text-[10px] font-black text-brand-cyan uppercase tracking-widest">Character Reference (Auto-extracted)</span>
                </div>
                <p className="text-xs text-gray-500 line-clamp-3">{characterDescription}</p>
              </div>
            )}
            <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 overflow-hidden">
              <div className="lg:col-span-5 flex flex-col bg-gray-50 rounded-[2.5rem] p-6 overflow-hidden">
                <textarea value={script} onChange={(e) => setScript(e.target.value)} className="flex-1 w-full p-6 bg-white rounded-3xl outline-none font-serif text-lg shadow-sm" />
                <button onClick={handleApplyScriptChanges} className="mt-4 bg-white border-2 border-brand-dark py-4 rounded-2xl font-black text-xs uppercase">Update Scenes</button>
              </div>
              <div className="lg:col-span-7 flex flex-col overflow-hidden">
                <div className="flex-1 overflow-y-auto space-y-4">
                  {scenes.map((scene, idx) => (
                    <div key={idx} className={`p-6 bg-white border-2 rounded-3xl ${playingIdx === idx ? 'border-brand-cyan bg-brand-cyan/5' : 'border-gray-50'}`}>
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-[10px] font-black text-gray-400 tracking-widest uppercase">Scene {idx+1}</span>
                        {scene.audio_path ? (
                          <button onClick={() => playSceneAudio(idx)} className="bg-brand-cyan text-brand-dark px-4 py-1.5 rounded-lg font-black text-[10px] uppercase">Preview</button>
                        ) : (
                          <span className="text-[10px] font-black text-gray-300 italic">No Audio Synthesized</span>
                        )}
                      </div>
                      <p className="text-sm font-medium italic text-gray-700">"{scene.script_segment}"</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="flex-1 flex flex-col animate-in slide-in-from-right-8 duration-500 h-full overflow-hidden">
             <div className="flex justify-between items-center mb-10">
              <h2 className="text-4xl font-black text-brand-dark">Keyframe Generation</h2>
              <div className="flex gap-4">
                <button onClick={handleGenerateAllImages} className="bg-brand-cyan text-brand-dark px-10 py-4 rounded-full font-black text-xl shadow-lg">
                  <Icons.ImageIcon size={24} className="inline mr-2" /> Generate All Images
                </button>
                <button onClick={() => setStep(5)} disabled={!scenes.some(s => s.image_path)} className="bg-brand-dark text-white px-10 py-4 rounded-full font-black text-xl shadow-xl disabled:opacity-20">
                  Next: Motion
                </button>
              </div>
            </div>
            {/* Character consistency indicator */}
            {characterDescription && (
              <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-2xl flex items-center gap-3">
                <Icons.Check size={18} className="text-green-500 shrink-0" />
                <div>
                  <span className="text-xs font-black text-green-700 uppercase tracking-widest">Character Consistency Active</span>
                  <p className="text-[10px] text-green-600 mt-1 line-clamp-1">{characterDescription.substring(0, 150)}...</p>
                </div>
              </div>
            )}
            <div className="flex-1 overflow-y-auto pr-4 space-y-10 custom-scrollbar">
               <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                  {scenes.map((scene, idx) => (
                    <div key={idx} className="bg-white border border-gray-100 rounded-[2.5rem] p-6 shadow-sm flex flex-col group hover:shadow-xl transition-all">
                       <div className={`bg-gray-50 rounded-[2rem] overflow-hidden relative mb-4 ring-4 ring-white shadow-inner ${aspectRatio === '9:16' ? 'aspect-[9/16]' : 'aspect-video'}`}>
                          {scene.image_path ? (
                            <img src={`data:image/jpeg;base64,${scene.image_path}`} className="w-full h-full object-cover" />
                          ) : (
                            <div className="flex flex-col items-center justify-center h-full text-gray-200">
                               <Icons.ImageIcon size={40} className="mb-2 opacity-10" />
                               <span className="font-black text-[10px] uppercase tracking-widest">No Image</span>
                            </div>
                          )}
                       </div>
                       <h4 className="font-black text-[10px] text-brand-cyan mb-2 uppercase tracking-widest">Scene {idx+1}</h4>
                       <p className="text-xs text-gray-500 font-medium line-clamp-2 italic mb-2">"{scene.script_segment}"</p>
                       <div className="text-[9px] text-gray-300 font-mono overflow-hidden whitespace-nowrap text-ellipsis">Prompt: {scene.visual_prompt}</div>
                    </div>
                  ))}
               </div>
            </div>
          </div>
        )}

        {step === 5 && (
          <div className="flex-1 flex flex-col animate-in slide-in-from-right-8 duration-500 h-full overflow-hidden">
            <div className="flex justify-between items-center mb-10">
              <h2 className="text-4xl font-black text-brand-dark">AI Motion Generation (Veo)</h2>
              <div className="flex gap-4 items-center">
                {isAnyVideoGenerating && (
                  <div className="flex items-center gap-2 text-brand-pink">
                    <Icons.Loader2 size={18} className="animate-spin" />
                    <span className="text-xs font-black uppercase tracking-widest">Processing...</span>
                  </div>
                )}
                <button
                  onClick={handleGenerateAllVideos}
                  disabled={isAnyVideoGenerating}
                  className="bg-brand-pink text-brand-dark px-10 py-4 rounded-full font-black text-xl shadow-lg disabled:opacity-50"
                >
                  <Icons.Video size={24} className="inline mr-2" /> Generate All Clips
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto pr-4 space-y-10 custom-scrollbar">
              {scenes.map((scene, idx) => {
                const isGenerating = videoGeneratingScenes[idx] || false;
                const error = videoErrorScenes[idx];

                return (
                  <div key={idx} className={`p-10 bg-white border rounded-[3rem] shadow-sm flex flex-col md:flex-row gap-10 group transition-all ${isGenerating ? 'border-brand-pink/50 bg-brand-pink/5' : error ? 'border-red-200 bg-red-50/30' : scene.video_path ? 'border-green-200 bg-green-50/20' : 'border-gray-100'}`}>
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-4">
                        <h4 className="font-black text-[10px] text-brand-pink uppercase tracking-[0.4em]">Scene {idx+1}</h4>
                        {scene.video_path && (
                          <span className="text-[9px] font-black text-green-500 bg-green-100 px-3 py-1 rounded-full uppercase">Complete</span>
                        )}
                        {isGenerating && (
                          <span className="text-[9px] font-black text-brand-pink bg-brand-pink/10 px-3 py-1 rounded-full uppercase flex items-center gap-1">
                            <Icons.Loader2 size={10} className="animate-spin" /> Generating...
                          </span>
                        )}
                        {error && !isGenerating && (
                          <span className="text-[9px] font-black text-red-500 bg-red-100 px-3 py-1 rounded-full uppercase">Failed</span>
                        )}
                      </div>
                      <p className="text-gray-600 mb-8 font-medium italic text-lg leading-relaxed">"{scene.script_segment}"</p>
                      <div className="bg-brand-light/50 p-6 rounded-2xl text-[10px] text-gray-400 font-mono italic mb-4">Prompt: {scene.visual_prompt}</div>
                      {scene.image_path && (
                        <div className="flex items-center gap-2 mb-4">
                          <div className="w-12 h-12 rounded-lg overflow-hidden border-2 border-brand-cyan">
                             <img src={`data:image/jpeg;base64,${scene.image_path}`} className="w-full h-full object-cover" />
                          </div>
                          <span className="text-[10px] font-black text-brand-cyan uppercase">Used as Reference</span>
                        </div>
                      )}
                      {/* Per-scene generate button */}
                      {!scene.video_path && !isGenerating && (
                        <button
                          onClick={() => handleGenerateSingleVideo(idx)}
                          className="mt-2 bg-brand-pink/10 text-brand-pink px-6 py-3 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-brand-pink/20 transition-all flex items-center gap-2"
                        >
                          <Icons.Video size={14} /> Generate This Scene
                        </button>
                      )}
                      {/* Retry button on error */}
                      {error && !isGenerating && (
                        <div className="mt-2">
                          <p className="text-[10px] text-red-400 mb-2">Error: {error}</p>
                          <button
                            onClick={() => handleGenerateSingleVideo(idx)}
                            className="bg-red-100 text-red-600 px-6 py-3 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-red-200 transition-all flex items-center gap-2"
                          >
                            <Icons.RefreshCw size={14} /> Retry
                          </button>
                        </div>
                      )}
                    </div>
                    <div className={`bg-gray-50 rounded-[2.8rem] overflow-hidden relative shrink-0 shadow-2xl ring-8 ring-white ${aspectRatio === '9:16' ? 'w-48 h-80' : 'w-[380px] h-[214px]'}`}>
                      {scene.video_path ? (
                          <video src={scene.video_path} autoPlay loop muted className="w-full h-full object-cover" />
                      ) : isGenerating ? (
                          <div className="flex flex-col items-center justify-center h-full text-brand-pink bg-brand-pink/5">
                              <Icons.Loader2 size={48} className="mb-4 animate-spin" />
                              <span className="font-black uppercase tracking-widest text-[10px]">Veo Processing...</span>
                              <span className="text-[9px] text-gray-400 mt-2">Scene {idx + 1} is being generated</span>
                          </div>
                      ) : (
                          <div className="flex flex-col items-center justify-center h-full text-gray-200">
                              <Icons.Video size={48} className="mb-4 opacity-10" />
                              <span className="font-black uppercase tracking-widest text-[10px]">Ready to Generate</span>
                          </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-8 flex justify-between items-center">
              <button onClick={() => setStep(4)} className="text-gray-400 font-black hover:text-brand-dark uppercase tracking-widest text-xs">Back to Images</button>
              <div className="flex items-center gap-4">
                {scenes.some(s => s.video_path) && !scenes.every(s => s.video_path) && (
                  <span className="text-xs text-gray-400 font-medium">
                    {scenes.filter(s => s.video_path).length}/{scenes.length} scenes complete
                  </span>
                )}
                <button
                  onClick={() => setStep(6)}
                  disabled={!scenes.some(s => s.video_path)}
                  className="bg-brand-dark text-white px-10 py-4 rounded-full font-black text-xl shadow-xl disabled:opacity-20"
                >
                  Assemble Master Video
                </button>
              </div>
            </div>
          </div>
        )}

        {step === 6 && (
          <div className="flex-1 flex flex-col items-center justify-center text-center animate-in zoom-in duration-700">
            <div className="w-40 h-40 bg-brand-green/10 rounded-full flex items-center justify-center mb-8">
                <Icons.LayoutTemplate size={80} className="text-brand-green animate-pulse" />
            </div>
            <h2 className="text-5xl font-black text-brand-dark mb-6 tracking-tighter">Unified Video Assembly</h2>
            <p className="text-2xl text-gray-500 max-w-xl mb-14 leading-relaxed">Connecting all generated Veo clips and character voices into a singular high-fidelity cinematic experience.</p>
            <button onClick={() => setStep(7)} className="bg-brand-dark text-white px-16 py-6 rounded-full font-black text-3xl shadow-2xl">
              Preview Final Master <Icons.ChevronRight size={36} className="inline ml-3" />
            </button>
          </div>
        )}

        {step === 7 && (
          <div className="flex-1 flex flex-col items-center justify-center py-12 animate-in zoom-in duration-1000">
            <div className={`relative rounded-[4rem] border-[20px] border-white shadow-2xl overflow-hidden bg-brand-dark mx-auto mb-14 ${aspectRatio === '9:16' ? 'w-64 h-[28rem]' : 'w-[44rem] h-[25rem]'}`}>
              {scenes[currentPlaybackScene]?.video_path && (
                <div className="w-full h-full relative">
                  <video
                    ref={videoPreviewRef}
                    src={scenes[currentPlaybackScene].video_path}
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-12 pt-24">
                    <p className="text-white text-2xl font-black italic">{scenes[currentPlaybackScene].script_segment}</p>
                  </div>
                </div>
              )}
              <div onClick={startFullPreview} className={`absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-[2px] cursor-pointer transition-all ${isPlayingFinal ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
                <div className="w-32 h-32 bg-white/10 backdrop-blur-3xl rounded-full flex items-center justify-center ring-4 ring-white/30 shadow-2xl">
                  <Icons.Play className="text-white w-14 h-14 fill-white ml-2" />
                </div>
              </div>
            </div>
            <h2 className="text-4xl font-black mb-12 uppercase tracking-tighter">AI Masterpiece Ready</h2>
            <div className="flex gap-8">
              <button onClick={() => setStep(1)} className="px-10 py-5 rounded-full font-black text-gray-400 hover:text-brand-dark uppercase tracking-widest text-sm">Reset Project</button>
              <button onClick={handleFinalRender} className="bg-brand-dark text-white px-16 py-6 rounded-full font-black text-2xl shadow-2xl">Export & Save Video</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
