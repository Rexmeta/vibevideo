
import React from 'react';
import { Icons } from './Icons';
import { ViewState } from '../types';

interface LandingPageProps {
  onNavigate: (view: ViewState) => void;
  /** Task #95: Loads the bundled demo project straight to Step 6. */
  onStartSample?: () => void;
  /** Task #95: Express Quick Mode entry — 1-2 scene presentation pipeline. */
  onStartExpress?: () => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({ onNavigate, onStartSample, onStartExpress }) => {
  return (
    <div className="bg-white min-h-screen">
      
      {/* Hero Section */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-12 pb-20">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div>
            <h1 className="text-6xl md:text-7xl font-extrabold tracking-tight leading-[1.1] mb-6">
              Free your story <br/>
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-brand-cyan to-brand-green">
                AI video generator
              </span>
            </h1>
            <p className="text-xl text-gray-600 mb-8 max-w-lg">
              Fast, simple, and incredibly powerful. Start with text, image, or audio clip. Then, our AI video generator creates the entire video for you.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 flex-wrap">
               <button 
                onClick={() => onNavigate('projects')}
                className="bg-brand-cyan text-black px-8 py-4 rounded-full font-bold text-lg hover:brightness-110 transition-all flex items-center justify-center gap-2"
              >
                Get Started for free <Icons.ArrowRight size={20} />
              </button>
              {onStartSample && (
                <button
                  onClick={onStartSample}
                  className="bg-white border-2 border-gray-200 text-black px-6 py-4 rounded-full font-bold text-base hover:border-brand-cyan transition-all flex items-center justify-center gap-2"
                >
                  <Icons.Play size={18} /> 샘플로 보기
                </button>
              )}
              {onStartExpress && (
                <button
                  onClick={onStartExpress}
                  className="bg-black text-white px-6 py-4 rounded-full font-bold text-base hover:scale-[1.02] transition-all flex items-center justify-center gap-2"
                >
                  <Icons.Sparkles size={18} /> 1분 Express
                </button>
              )}
            </div>
            <p className="mt-4 text-sm text-gray-400">
              샘플은 로그인 없이 즉시, Express는 1-2분 안에 결과물 완성
            </p>
          </div>
          <div className="relative">
            <div className="bg-[#E0F7FA] rounded-[3rem] p-4 rotate-2 hover:rotate-0 transition-all duration-500">
               <img 
                src="https://picsum.photos/600/600?random=1" 
                alt="AI Video Preview" 
                className="rounded-[2.5rem] w-full h-auto object-cover shadow-xl"
              />
              <div className="absolute -bottom-6 -left-6 bg-white p-4 rounded-2xl shadow-lg flex items-center gap-3">
                 <div className="w-10 h-10 bg-brand-green rounded-full flex items-center justify-center">
                    <Icons.Play fill="black" size={16} />
                 </div>
                 <div>
                    <p className="font-bold text-sm">Video generated</p>
                    <p className="text-xs text-gray-500">12s • 1080p</p>
                 </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Stats Bar */}
      <section className="border-y border-gray-100 bg-brand-light/30">
        <div className="max-w-7xl mx-auto px-4 py-8 flex flex-wrap justify-between items-center text-center">
            <div className="w-full md:w-1/3 mb-4 md:mb-0">
                <h3 className="text-3xl font-black">97,756,065</h3>
                <p className="text-gray-500 font-medium">Total videos generated</p>
            </div>
            <div className="w-full md:w-1/3 mb-4 md:mb-0 border-l border-r border-gray-200">
                <h3 className="text-3xl font-black">72,920,470</h3>
                <p className="text-gray-500 font-medium">Total avatars generated</p>
            </div>
             <div className="w-full md:w-1/3">
                <h3 className="text-3xl font-black">13,971,173</h3>
                <p className="text-gray-500 font-medium">Total videos translated</p>
            </div>
        </div>
      </section>

      {/* Feature 1: Avatars (Blue) */}
      <section className="bg-brand-cyan p-8 md:p-12 my-8 mx-4 rounded-[3rem]">
        <div className="max-w-6xl mx-auto text-center mb-12">
            <h2 className="text-4xl md:text-5xl font-black mb-4">Tell any story with the all-in-one AI video maker</h2>
            <button className="bg-black text-white px-6 py-2 rounded-full text-sm font-bold">Get started for free</button>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white/10 backdrop-blur-sm p-6 rounded-3xl border border-white/20">
                <div className="h-48 bg-gray-200 rounded-2xl mb-4 overflow-hidden">
                    <img src="https://picsum.photos/400/300?random=2" className="w-full h-full object-cover" />
                </div>
                <h3 className="text-xl font-bold mb-2">Avatar IV</h3>
                <p className="text-sm opacity-80">Generate photorealistic AI avatars from a single image.</p>
            </div>
             <div className="bg-white/10 backdrop-blur-sm p-6 rounded-3xl border border-white/20">
                <div className="h-48 bg-gray-200 rounded-2xl mb-4 overflow-hidden">
                    <img src="https://picsum.photos/400/300?random=3" className="w-full h-full object-cover" />
                </div>
                <h3 className="text-xl font-bold mb-2">Photo Avatar</h3>
                <p className="text-sm opacity-80">Instantly generate animated AI photo avatars of yourself.</p>
            </div>
             <div className="bg-white/10 backdrop-blur-sm p-6 rounded-3xl border border-white/20">
                <div className="h-48 bg-gray-200 rounded-2xl mb-4 overflow-hidden">
                    <img src="https://picsum.photos/400/300?random=4" className="w-full h-full object-cover" />
                </div>
                <h3 className="text-xl font-bold mb-2">Stock Avatar</h3>
                <p className="text-sm opacity-80">Choose from over 1,000 AI avatars tailored for any situation.</p>
            </div>
        </div>
      </section>

      {/* Feature 2: Text to Video (Pink) */}
      <section className="bg-brand-pink p-8 md:p-20 my-8 mx-4 rounded-[3rem] relative overflow-hidden">
         <div className="flex flex-col md:flex-row gap-12 items-center">
            <div className="flex-1 z-10">
                <h2 className="text-4xl md:text-5xl font-black mb-6">Turn text into video with AI</h2>
                <p className="text-lg opacity-80 mb-8 max-w-md">Produce complete videos with just a script. Our AI video generator automates the editing process and adds visuals.</p>
                <button onClick={() => onNavigate('projects')} className="bg-white text-black px-8 py-3 rounded-full font-bold">Get started for free</button>
            </div>
            <div className="flex-1 relative z-10">
                <div className="bg-white p-4 rounded-3xl shadow-xl transform rotate-1">
                    <div className="flex gap-2 mb-4">
                         <img src="https://picsum.photos/50/50?random=10" className="w-8 h-8 rounded-full" />
                         <div className="bg-gray-100 rounded-xl p-3 text-sm w-full">
                            Generate a video about a futuristic city with flying cars...
                         </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <img src="https://picsum.photos/200/200?random=5" className="rounded-xl w-full" />
                        <img src="https://picsum.photos/200/200?random=6" className="rounded-xl w-full" />
                    </div>
                </div>
            </div>
         </div>
      </section>

      {/* Feature 3: Image to Video (Light) */}
      <section className="bg-brand-light p-8 md:p-20 my-8 mx-4 rounded-[3rem]">
        <div className="flex flex-col md:flex-row gap-12 items-center">
            <div className="flex-1 order-2 md:order-1">
                 <div className="bg-white p-4 rounded-3xl shadow-lg">
                    <img src="https://picsum.photos/600/400?random=7" className="rounded-2xl w-full mb-4" />
                    <div className="flex items-center gap-2 bg-yellow-100 p-2 rounded-lg text-xs font-medium text-yellow-800 w-fit">
                        <Icons.Check size={14} /> Sponsor verified
                    </div>
                 </div>
            </div>
            <div className="flex-1 order-1 md:order-2">
                <h2 className="text-4xl md:text-5xl font-black mb-6">Image to video with AI</h2>
                <p className="text-lg text-gray-600 mb-8">Turn any photo into a video. Upload an image, add your script, and watch as it comes to life.</p>
                <button className="bg-black text-white px-8 py-3 rounded-full font-bold">Get started for free</button>
            </div>
        </div>
      </section>

       {/* Feature 4: Translator (Green) */}
       <section className="bg-brand-green p-8 md:p-20 my-8 mx-4 rounded-[3rem]">
         <div className="max-w-4xl mx-auto text-center">
             <h2 className="text-4xl md:text-5xl font-black mb-6">Speak any language with AI video translator</h2>
             <p className="text-lg opacity-80 mb-12">Translate videos into 40+ languages with natural lip-sync and voice cloning.</p>
             
             <div className="bg-black/80 backdrop-blur-md p-6 rounded-[2.5rem] text-white text-left max-w-2xl mx-auto relative overflow-hidden">
                <div className="flex items-center justify-between mb-8">
                    <div className="flex gap-4">
                        <span className="bg-white/20 px-4 py-1 rounded-full text-sm">Casual</span>
                        <span className="bg-brand-green text-black px-4 py-1 rounded-full text-sm font-bold">Calm</span>
                        <span className="bg-white/20 px-4 py-1 rounded-full text-sm">Energetic</span>
                    </div>
                    <Icons.Mic className="text-brand-green" />
                </div>
                <h3 className="text-3xl font-serif italic mb-4">"Slowly breathe in and out"</h3>
                <div className="h-1 bg-white/20 rounded-full w-full overflow-hidden">
                    <div className="h-full bg-brand-green w-2/3"></div>
                </div>
             </div>
         </div>
       </section>

       {/* Demo Section */}
       <section className="max-w-7xl mx-auto px-4 py-20">
         <div className="bg-white border border-gray-200 rounded-[3rem] p-8 md:p-12 shadow-2xl">
            <div className="flex flex-col md:flex-row gap-12">
                <div className="flex-1">
                    <h3 className="font-bold text-lg mb-4">Pick an avatar</h3>
                    <div className="flex gap-4 mb-8 overflow-x-auto pb-2">
                        {[1,2,3,4].map(i => (
                            <img key={i} src={`https://picsum.photos/100/100?random=${i+20}`} className={`w-16 h-16 rounded-full border-4 cursor-pointer hover:scale-110 transition-transform ${i === 1 ? 'border-brand-cyan' : 'border-transparent'}`} />
                        ))}
                    </div>
                    
                    <h3 className="font-bold text-lg mb-4">Type your script</h3>
                    <div className="bg-gray-50 rounded-2xl p-4 border border-gray-200">
                        <textarea 
                            className="w-full bg-transparent border-none resize-none focus:ring-0 text-gray-600"
                            rows={4}
                            placeholder="Explain video creation for our new project management software..."
                        ></textarea>
                         <div className="flex justify-between items-center mt-4">
                            <span className="text-xs text-gray-400">0/1000 characters</span>
                            <button onClick={() => onNavigate('projects')} className="bg-brand-cyan px-4 py-2 rounded-lg font-bold text-sm hover:brightness-110">Generate video</button>
                        </div>
                    </div>
                </div>
                <div className="flex-1">
                    <img src="https://picsum.photos/600/600?random=50" className="w-full rounded-3xl object-cover h-full min-h-[400px]" />
                </div>
            </div>
         </div>
       </section>
      
      {/* Footer */}
      <footer className="bg-gray-50 py-20 px-4">
        <div className="max-w-7xl mx-auto text-center">
            <h2 className="text-3xl font-bold mb-4">Start creating videos with AI</h2>
            <button onClick={() => onNavigate('projects')} className="bg-brand-cyan px-8 py-3 rounded-full font-bold text-lg hover:brightness-110">Get started for free</button>
            <p className="mt-12 text-gray-400 text-sm">© 2024 VibeVideo AI. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
};
