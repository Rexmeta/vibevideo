
import { GoogleGenAI, Modality, Type } from "@google/genai";
import { Scene } from "../types";

// Helper to safely get the API KEY
const getApiKey = () => {
  const key = process.env.API_KEY;
  if (!key) {
    console.warn("API_KEY is not defined in process.env. Using fallback/empty string.");
    return "";
  }
  return key;
};

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} 시간 초과 (${ms / 1000}초)`)), ms);
    promise.then(
      val => { clearTimeout(timer); resolve(val); },
      err => { clearTimeout(timer); reject(err); }
    );
  });
}

async function urlToBase64(url: string): Promise<string> {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        resolve(result.split(',')[1]);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error("URL to Base64 conversion failed:", error);
    throw error;
  }
}

function sanitizeTextForTTS(text: string): string {
  if (!text) return "";
  return text
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/#/g, '')
    .replace(/[`_~]/g, '')
    .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '')
    .trim();
}

async function pcmToWav(pcmBase64: string, sampleRate: number = 24000): Promise<{ dataUrl: string, duration: number }> {
  try {
    const binaryString = atob(pcmBase64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    
    const duration = len / (sampleRate * 2);

    const wavHeader = new ArrayBuffer(44);
    const view = new DataView(wavHeader);
    const writeString = (view: DataView, offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };
    
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + len, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); 
    view.setUint16(22, 1, true); 
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(view, 36, 'data');
    view.setUint32(40, len, true);
    
    const blob = new Blob([wavHeader, bytes], { type: 'audio/wav' });
    const dataUrl = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve((reader.result as string));
      reader.readAsDataURL(blob);
    });

    return { dataUrl, duration };
  } catch (e) {
    console.error("PCM to WAV failed", e);
    return { dataUrl: `data:audio/wav;base64,${pcmBase64}`, duration: 0 };
  }
}

export const generateScript = async (topic: string, style: string, lengthSeconds: number = 60): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: getApiKey() });
  const response = await withTimeout(
    ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Generate a full video script about "${topic}". Style: ${style}. Goal duration: ${lengthSeconds} seconds. Output only the spoken text.`,
    }),
    60000,
    '스크립트 생성'
  );
  return response.text || "Script generation failed.";
};

export const segmentScriptIntoScenes = async (script: string, style: string, ratio: string): Promise<Partial<Scene>[]> => {
  const ai = new GoogleGenAI({ apiKey: getApiKey() });
  const prompt = `Segment this script into exactly 3-5 visual scenes for a ${ratio} video. Style: ${style}. Output JSON array. Script: "${script}"`;
  const response = await withTimeout(
    ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: { 
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              script_segment: { type: Type.STRING },
              visual_prompt: { type: Type.STRING }
            },
            required: ['script_segment', 'visual_prompt']
          }
        }
      }
    }),
    60000,
    '씬 분석'
  );
  const data = JSON.parse(response.text || "[]");
  return data.map((item: any, index: number) => ({
    id: `scene-${index}`,
    script_segment: item.script_segment,
    visual_prompt: item.visual_prompt
  }));
};

export const generateSceneAudio = async (text: string, style: string): Promise<{ audio_path: string, duration: number } | null> => {
  const voiceMap: Record<string, string> = { 'Cute Stickman': 'Puck', 'Japanese Anime': 'Kore' };
  const selectedVoice = voiceMap[style] || 'Kore';
  const cleanText = sanitizeTextForTTS(text);
  if (!cleanText) return null;

  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('API 키가 설정되지 않았습니다.');
  }

  console.log(`[TTS] 오디오 생성 시작 - voice: ${selectedVoice}, text length: ${cleanText.length}`);

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await withTimeout(
      ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: cleanText }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: selectedVoice } } },
        },
      }),
      45000,
      '오디오 생성'
    );
    
    console.log("[TTS] API 응답 수신 완료");
    const audioPart = response.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);
    if (!audioPart?.inlineData?.data) {
      console.error("[TTS] 응답에 오디오 데이터 없음:", JSON.stringify(response.candidates?.[0]?.content?.parts?.map((p: any) => Object.keys(p))));
      throw new Error('오디오 데이터가 생성되지 않았습니다.');
    }
    
    console.log(`[TTS] 오디오 데이터 수신 - size: ${audioPart.inlineData.data.length}`);
    const { dataUrl, duration } = await pcmToWav(audioPart.inlineData.data);
    console.log(`[TTS] WAV 변환 완료 - duration: ${duration}s`);
    return { audio_path: dataUrl, duration };
  } catch (e: any) {
    console.error("[TTS] 오디오 생성 실패:", e?.message || e);
    throw e;
  }
};

export const generateSceneImage = async (prompt: string, style: string, aspectRatio: string = '16:9'): Promise<string | null> => {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('API 키가 설정되지 않았습니다.');
  }

  console.log(`[Image] 이미지 생성 시작 - prompt length: ${prompt.length}, style: ${style}, ratio: ${aspectRatio}`);

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await withTimeout(
      ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: [{ parts: [{ text: `Generate an image. High quality cinematic digital art, 8k, detailed textures. Scene: ${prompt}. Style: ${style}. Aspect ratio: ${aspectRatio}.` }] }],
        config: {
          responseModalities: [Modality.IMAGE, Modality.TEXT],
        }
      }),
      60000,
      '이미지 생성'
    );

    console.log("[Image] API 응답 수신 완료");
    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        console.log(`[Image] 이미지 데이터 수신 - size: ${part.inlineData.data?.length || 0}`);
        return part.inlineData.data || null;
      }
    }
    console.error("[Image] 응답에 이미지 데이터 없음");
    throw new Error('이미지 데이터가 생성되지 않았습니다.');
  } catch (e: any) {
    console.error("[Image] 이미지 생성 실패:", e?.message || e);
    throw e;
  }
};

export const generateSceneVideo = async (prompt: string, imageSource?: string, aspectRatio: string = '16:9'): Promise<string | null> => {
  let validRatio: '16:9' | '9:16' = (aspectRatio === '9:16' || aspectRatio === '3:4') ? '9:16' : '16:9';
  const apiKey = getApiKey();
  const aiStart = new GoogleGenAI({ apiKey });
  
  const payload: any = {
    model: 'veo-3.1-fast-generate-preview',
    prompt: `Smooth motion, high quality: ${prompt}`,
    config: { numberOfVideos: 1, resolution: '720p', aspectRatio: validRatio }
  };

  if (imageSource) {
    try {
      let imageBytes: string;
      if (imageSource.startsWith('data:')) {
        imageBytes = imageSource.replace(/^data:image\/[a-z+]+;base64,/, "");
      } else if (imageSource.startsWith('http')) {
        imageBytes = await urlToBase64(imageSource);
      } else {
        imageBytes = imageSource;
      }
      payload.image = { imageBytes, mimeType: 'image/jpeg' };
    } catch (imgErr) {
      console.warn("[Video Gen] Could not load reference image, generating without it:", imgErr);
    }
  }

  try {
    let operation = await aiStart.models.generateVideos(payload);
    let attempts = 0;
    while (!operation.done && attempts < 40) {
      await new Promise(r => setTimeout(r, 7000));
      const aiPoll = new GoogleGenAI({ apiKey });
      operation = await aiPoll.operations.getVideosOperation({ operation: operation });
      attempts++;
    }

    if (!operation.done) {
      console.error("[Video Gen] Timed out after polling");
      return null;
    }

    const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
    if (!downloadLink) {
      console.error("[Video Gen] No video URI in response");
      return null;
    }

    const separator = downloadLink.includes('?') ? '&' : '?';
    return `${downloadLink}${separator}key=${apiKey}`;
  } catch (e) {
    console.error("[Video Gen] Generation failed:", e);
    return null;
  }
}
