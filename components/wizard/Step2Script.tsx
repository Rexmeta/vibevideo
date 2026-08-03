import React from 'react';
import { Icons } from '../Icons';
import { generateScript, segmentScriptIntoScenes, generateStyleSheet } from '../../services/geminiService';
import { useWizard } from './WizardContext';

function alertGeminiError(prefix: string, e: any) {
  const msg = String(e?.message || '');
  if (msg.includes('API key') || msg.includes('API 키가 설정되지 않았습니다')) {
    alert('API 키가 설정되지 않았습니다. 관리 페이지에서 Gemini API 키를 설정해주세요.');
  } else if (msg.startsWith('Gemini ')) {
    alert(msg);
  } else {
    alert(`${prefix}: ${msg || '알 수 없는 오류'}`);
  }
}

export const Step2Script: React.FC = () => {
  const w = useWizard();
  const {
    topic,
    setTopic,
    setLoading,
    setLoadingMessage,
    videoStyle,
    duration,
    targetSceneCount,
    genre,
    platform,
    creativeBrief,
    setScript,
    script,
    setStep,
    setMaxStep,
    setScenes,
    aspectRatio,
    characterProfile,
    characterReferences,
    styleSheet,
    setStyleSheet,
    sync,
    maxStep,
  } = w;

  return (
    <div className="flex-1 flex flex-col max-w-4xl mx-auto w-full gap-8">
      <div className="flex gap-4">
        <input
          value={topic}
          onChange={e => setTopic(e.target.value)}
          placeholder="비디오 주제를 입력하세요 (예: 2024년 파리 올림픽 요약)..."
          className="flex-1 p-8 bg-gray-50 rounded-[2.5rem] outline-none text-2xl font-bold shadow-inner"
        />
        <button
          onClick={async () => {
            setLoading(true);
            setLoadingMessage('AI가 창의적인 스크립트를 빌드 중입니다...');
            try {
              const result = await generateScript(topic, videoStyle, duration, targetSceneCount, { genre, platform, creativeBrief });
              setScript(result);
            } catch (e: any) {
              console.error('Script generation failed:', e);
              alertGeminiError('스크립트 생성 실패', e);
            } finally {
              setLoading(false);
            }
          }}
          className="bg-brand-cyan text-black px-10 rounded-[2.5rem] shadow-xl hover:scale-105 transition-all"
        >
          <Icons.Wand2 size={28} />
        </button>
      </div>
      <textarea
        value={script}
        onChange={e => setScript(e.target.value)}
        className="flex-1 p-10 bg-gray-50 rounded-[3rem] outline-none font-serif text-xl leading-relaxed shadow-inner"
        placeholder="AI가 작성한 스크립트..."
      />
      <div className="flex gap-4">
        <button onClick={() => setStep(1)} className="px-10 py-6 rounded-full font-black text-gray-400 hover:text-black transition-colors">
          Back
        </button>
        <button
          onClick={async () => {
            setLoading(true);
            setLoadingMessage('스크립트를 씬 단위로 분석하고 있습니다...');
            try {
              const s = await segmentScriptIntoScenes(
                script,
                videoStyle,
                aspectRatio,
                characterProfile || undefined,
                targetSceneCount,
                { genre, platform, characterReferences, creativeBrief }
              );
              setScenes(s);
              if (!styleSheet) {
                try {
                  setLoadingMessage('비주얼 스타일 시트를 추출하는 중...');
                  const sheet = await generateStyleSheet(topic, script, videoStyle, { genre });
                  setStyleSheet(sheet);
                } catch (sheetErr) {
                  console.warn('[StyleSheet] auto-generation failed, continuing:', sheetErr);
                }
              }
              setStep(3);
              setMaxStep(prev => Math.max(prev, 3));
              setLoading(false);
              await sync(3, s, {}, { script, topic, maxStep: Math.max(maxStep, 3) });
            } catch (e: any) {
              console.error('Scene segmentation failed:', e);
              alertGeminiError('스토리보드 구성 실패', e);
              setLoading(false);
            }
          }}
          className="flex-1 bg-brand-dark text-white py-6 rounded-full font-black text-2xl shadow-2xl hover:scale-[1.01] transition-all"
        >
          Construct Storyboard
        </button>
      </div>
    </div>
  );
};
