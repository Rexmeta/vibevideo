
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
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `Generate a full video script about "${topic}". Style: ${style}. Goal duration: ${lengthSeconds} seconds. Output only the spoken text.`,
  });
  return response.text || "Script generation failed.";
};

export const segmentScriptIntoScenes = async (script: string, style: string, ratio: string): Promise<Partial<Scene>[]> => {
  const ai = new GoogleGenAI({ apiKey: getApiKey() });
  const prompt = `Segment this script into exactly 3-5 visual scenes for a ${ratio} video. Style: ${style}. Output JSON array. Script: "${script}"`;
  const response = await ai.models.generateContent({
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
  });
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

  try {
    const ai = new GoogleGenAI({ apiKey: getApiKey() });
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: cleanText }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: selectedVoice } } },
      },
    });
    
    const audioPart = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
    if (!audioPart?.inlineData?.data) return null;
    
    const { dataUrl, duration } = await pcmToWav(audioPart.inlineData.data);
    return { audio_path: dataUrl, duration };
  } catch (e) {
    console.error("Audio generation failed", e);
    return null;
  }
};

export const generateSceneImage = async (prompt: string, style: string, aspectRatio: string = '16:9'): Promise<string | null> => {
  const ai = new GoogleGenAI({ apiKey: getApiKey() });
  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-image-preview',
    contents: {
      parts: [{ text: `High quality cinematic digital art, 8k, detailed textures. Scene: ${prompt}. Style: ${style}.` }],
    },
    config: { 
      imageConfig: { 
        aspectRatio: aspectRatio as any, 
        imageSize: '1K' 
      } 
    }
  });
  
  // Find the image part among candidates
  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) {
      return part.inlineData.data;
    }
  }
  return null;
};

export const generateSceneVideo = async (prompt: string, imageSource?: string, aspectRatio: string = '16:9'): Promise<string | null> => {
  let validRatio: '16:9' | '9:16' = (aspectRatio === '9:16' || aspectRatio === '3:4') ? '9:16' : '16:9';
  const aiStart = new GoogleGenAI({ apiKey: getApiKey() });
  
  const payload: any = {
    model: 'veo-3.1-fast-generate-preview',
    prompt: `Smooth motion, high quality: ${prompt}`,
    config: { numberOfVideos: 1, resolution: '720p', aspectRatio: validRatio }
  };

  if (imageSource) {
    const imageBytes = imageSource.startsWith('http') ? await urlToBase64(imageSource) : imageSource.replace(/^data:image\/[a-z]+;base64,/, "");
    payload.image = { imageBytes, mimeType: 'image/jpeg' };
  }

  let operation = await aiStart.models.generateVideos(payload);
  let attempts = 0;
  while (!operation.done && attempts < 30) {
    await new Promise(r => setTimeout(r, 7000));
    const aiPoll = new GoogleGenAI({ apiKey: getApiKey() });
    operation = await aiPoll.operations.getVideosOperation({ operation: operation });
    attempts++;
  }
  const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
  return downloadLink ? `${downloadLink}&key=${getApiKey()}` : null;
}
