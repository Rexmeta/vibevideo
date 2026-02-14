
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

async function withRetry<T>(fn: () => Promise<T>, maxRetries: number = 1, label: string = ''): Promise<T> {
  let lastError: any;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e: any) {
      lastError = e;
      const errStr = String(e?.message || '') + String(e?.status || '');
      const is429 = errStr.includes('429') || errStr.includes('RESOURCE_EXHAUSTED');
      const isRetryable = is429 ||
                          errStr.includes('시간 초과') || 
                          errStr.includes('timeout') ||
                          errStr.includes('DEADLINE_EXCEEDED') ||
                          errStr.includes('503') ||
                          errStr.includes('500');
      if (attempt < maxRetries && isRetryable) {
        let retryAfter = 0;
        if (e?.headers?.get) {
          try { retryAfter = parseInt(e.headers.get('retry-after') || '0', 10) * 1000; } catch {}
        }
        const baseDelay = is429 ? 60000 : 5000;
        const delay = retryAfter || Math.min(baseDelay * Math.pow(2, attempt), 180000);
        console.log(`[Retry] ${label} attempt ${attempt + 1} failed (${is429 ? '429 rate limit' : errStr.slice(0, 50)}), retrying in ${delay / 1000}s...`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        break;
      }
    }
  }
  throw lastError;
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

  return withRetry(async () => {
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
    
    const audioPart = response.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);
    if (!audioPart?.inlineData?.data) {
      throw new Error('오디오 데이터가 생성되지 않았습니다.');
    }
    
    const { dataUrl, duration } = await pcmToWav(audioPart.inlineData.data);
    return { audio_path: dataUrl, duration };
  }, 1, '오디오 생성');
};

export const generateSceneImage = async (prompt: string, style: string, aspectRatio: string = '16:9'): Promise<{ base64: string; mimeType: string } | null> => {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('API 키가 설정되지 않았습니다.');
  }

  console.log(`[Image] 이미지 생성 시작 - prompt length: ${prompt.length}, style: ${style}, ratio: ${aspectRatio}`);

  return withRetry(async () => {
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

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData && part.inlineData.data) {
        const mimeType = part.inlineData.mimeType || 'image/png';
        return { base64: part.inlineData.data, mimeType };
      }
    }
    throw new Error('이미지 데이터가 생성되지 않았습니다.');
  }, 1, '이미지 생성');
};

async function resizeImageForVideo(imageSource: string, maxDim: number = 768): Promise<{ imageBytes: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Canvas context failed')); return; }
      ctx.drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      const base64 = dataUrl.split(',')[1];
      resolve({ imageBytes: base64, mimeType: 'image/jpeg' });
    };
    img.onerror = () => reject(new Error('Image load failed for resize'));
    img.crossOrigin = 'anonymous';
    if (imageSource.startsWith('data:') || imageSource.startsWith('http')) {
      img.src = imageSource;
    } else {
      img.src = `data:image/png;base64,${imageSource}`;
    }
  });
}

async function attemptVideoGeneration(
  prompt: string, 
  apiKey: string, 
  validRatio: '16:9' | '9:16', 
  imageData?: { imageBytes: string; mimeType: string },
  label: string = ''
): Promise<string> {
  const ai = new GoogleGenAI({ apiKey });
  const payload: any = {
    model: 'veo-3.1-fast-generate-preview',
    prompt: `Cinematic smooth motion, high quality: ${prompt}`,
    config: { numberOfVideos: 1, resolution: '720p', aspectRatio: validRatio }
  };

  if (imageData) {
    payload.image = { imageBytes: imageData.imageBytes, mimeType: imageData.mimeType };
    console.log(`[Video Gen][${label}] With seed image (${imageData.mimeType}, ${Math.round(imageData.imageBytes.length / 1024)}KB)`);
  } else {
    console.log(`[Video Gen][${label}] Text-only (no seed image)`);
  }

  console.log(`[Video Gen][${label}] Calling generateVideos API...`);
  let operation: any;
  try {
    operation = await ai.models.generateVideos(payload);
  } catch (submitErr: any) {
    console.error(`[Video Gen][${label}] generateVideos() threw:`, submitErr?.message || submitErr, JSON.stringify(submitErr).slice(0, 500));
    throw submitErr;
  }

  console.log(`[Video Gen][${label}] Operation received. done=${operation.done}, name=${(operation as any).name || 'N/A'}`);

  if (operation.done) {
    console.log(`[Video Gen][${label}] Operation completed immediately. Checking response...`);
    const opStr = JSON.stringify(operation).slice(0, 1000);
    console.log(`[Video Gen][${label}] Operation data: ${opStr}`);
  }

  let attempts = 0;
  const maxAttempts = 40;
  const pollInterval = 15000;
  let consecutivePollErrors = 0;

  while (!operation.done && attempts < maxAttempts) {
    await new Promise(r => setTimeout(r, pollInterval));
    try {
      const aiPoll = new GoogleGenAI({ apiKey });
      operation = await aiPoll.operations.getVideosOperation({ operation });
      consecutivePollErrors = 0;
      console.log(`[Video Gen][${label}] Poll #${attempts}: done=${operation.done}`);
    } catch (pollErr: any) {
      consecutivePollErrors++;
      const msg = pollErr?.message || String(pollErr);
      console.warn(`[Video Gen][${label}] Poll #${attempts} error (consecutive: ${consecutivePollErrors}):`, msg);
      if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) {
        await new Promise(r => setTimeout(r, 20000));
      }
      if (consecutivePollErrors >= 5) {
        throw new Error(`폴링 중 연속 ${consecutivePollErrors}회 오류`);
      }
    }
    attempts++;
  }

  if (!operation.done) {
    throw new Error(`비디오 생성 시간 초과 (${attempts} polls, ~${Math.round(attempts * pollInterval / 60000)}분)`);
  }

  const opResult = JSON.stringify(operation).slice(0, 1500);
  console.log(`[Video Gen][${label}] Final operation: ${opResult}`);

  const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
  if (!downloadLink) {
    const errMsg = (operation as any).error?.message || 
                   (operation as any).response?.error?.message || '';
    console.error(`[Video Gen][${label}] No video URI. Error: ${errMsg}`);
    throw new Error(errMsg || '비디오 URI 없음');
  }

  const separator = downloadLink.includes('?') ? '&' : '?';
  console.log(`[Video Gen][${label}] SUCCESS! URI obtained.`);
  return `${downloadLink}${separator}key=${apiKey}`;
}

export const generateSceneVideo = async (prompt: string, imageSource?: string, aspectRatio: string = '16:9'): Promise<string | null> => {
  const validRatio: '16:9' | '9:16' = (aspectRatio === '9:16' || aspectRatio === '3:4') ? '9:16' : '16:9';
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('API_KEY가 설정되지 않았습니다.');

  let imageData: { imageBytes: string; mimeType: string } | undefined;
  if (imageSource) {
    try {
      imageData = await resizeImageForVideo(imageSource, 768);
      console.log(`[Video Gen] Seed image resized → ${imageData.mimeType}, ${Math.round(imageData.imageBytes.length / 1024)}KB`);
    } catch (resizeErr) {
      console.warn("[Video Gen] Image resize failed:", resizeErr);
      try {
        let imageBytes: string;
        let mimeType = 'image/jpeg';
        if (imageSource.startsWith('data:')) {
          const m = imageSource.match(/^data:(image\/[a-z+]+);base64,/);
          if (m) mimeType = m[1];
          imageBytes = imageSource.replace(/^data:image\/[a-z+]+;base64,/, "");
        } else if (imageSource.startsWith('http')) {
          imageBytes = await urlToBase64(imageSource);
        } else {
          imageBytes = imageSource;
        }
        imageData = { imageBytes, mimeType };
      } catch (rawErr) {
        console.warn("[Video Gen] Raw image load also failed, will try text-only");
        imageData = undefined;
      }
    }
  }

  return withRetry(async () => {
    if (imageData) {
      try {
        return await attemptVideoGeneration(prompt, apiKey, validRatio, imageData, 'img');
      } catch (imgErr: any) {
        const msg = String(imgErr?.message || imgErr);
        console.warn(`[Video Gen] Image-based generation failed: ${msg}`);
        if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) {
          throw imgErr;
        }
        console.log(`[Video Gen] Falling back to text-only generation...`);
        return await attemptVideoGeneration(prompt, apiKey, validRatio, undefined, 'txt-fallback');
      }
    }
    return await attemptVideoGeneration(prompt, apiKey, validRatio, undefined, 'txt');
  }, 3, '비디오 생성');
}
