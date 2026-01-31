
import { GoogleGenAI } from "@google/genai";
import { Scene } from "../types";

/**
 * Clean text for TTS: Remove markdown symbols (*, _, #), 
 * extra whitespace, and emojis that might crash the TTS engine.
 */
function sanitizeTextForTTS(text: string): string {
  return text
    .replace(/\*\*/g, '') // remove bold
    .replace(/\*/g, '')  // remove italic/bullets
    .replace(/#/g, '')   // remove headers
    .replace(/[`_~]/g, '') // remove other markdown
    .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '') // remove emojis
    .trim();
}

/**
 * Utility for exponential backoff retry logic.
 */
async function retry<T>(fn: () => Promise<T>, retries = 3, delay = 1500): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    if (retries <= 0) throw error;
    console.warn(`API call failed (500 or transient). Retrying in ${delay}ms...`, error);
    await new Promise(resolve => setTimeout(resolve, delay));
    return retry(fn, retries - 1, delay * 2);
  }
}

export function decodeBase64(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number = 24000,
  numChannels: number = 1
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

export const generateScript = async (topic: string, style: string, lengthSeconds: number = 60): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const styleContext = style === 'Cute Stickman' 
    ? "Write in a very friendly, playful, and energetic casual tone as if a stickman character is talking to the audience."
    : `Adjust the tone to match the "${style}" aesthetic.`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Write a compelling video script about "${topic}". 
      Visual Style Context: ${style}.
      ${styleContext}
      Target Length: approximately ${lengthSeconds} seconds.
      Format: Return ONLY the spoken text. Do not include markdown or stage directions.`,
    });
    return response.text || "Failed to generate script.";
  } catch (error: any) {
    console.error("Script generation error:", error);
    throw error;
  }
};

export const segmentScriptIntoScenes = async (script: string, style: string, ratio: string): Promise<Partial<Scene>[]> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  try {
    const prompt = `
      Break the following script into visual scenes for a ${ratio} video.
      Style: ${style}.
      
      For each scene, provide:
      1. 'script_segment': The text spoken in this scene.
      2. 'visual_prompt': A short, clear visual description for image generation that would be a great keyframe for this scene.
      
      Return ONLY a JSON array of objects with these keys.
      Script: "${script}"
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: { responseMimeType: 'application/json' }
    });

    const data = JSON.parse(response.text || "[]");
    return data.map((item: any, index: number) => ({
      id: `scene-${index}`,
      project_id: 'temp',
      script_segment: item.script_segment,
      visual_prompt: item.visual_prompt
    }));
  } catch (error: any) {
    console.error("Segmentation error:", error);
    throw error;
  }
};

export const generateSceneAudio = async (text: string, style: string, voiceOverride?: string): Promise<string | null> => {
  const voiceMap: Record<string, string> = {
    'Cute Stickman': 'Puck',
    'Japanese Anime': 'Kore',
    'Minimal Info': 'Charon',
    '3D Animation': 'Zephyr',
    'Real Photo': 'Fenrir',
    'Cinematic': 'Fenrir'
  };

  const selectedVoice = voiceOverride || voiceMap[style] || 'Kore';
  const cleanText = sanitizeTextForTTS(text);

  if (!cleanText) return null;

  return retry(async () => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: cleanText }] }],
      config: {
        responseModalities: ['AUDIO'] as any,
        speechConfig: {
          voiceConfig: { 
            prebuiltVoiceConfig: { voiceName: selectedVoice } 
          },
        },
      },
    });

    const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!audioData) {
      console.error("No audio data in response candidate:", response);
      throw new Error("EMPTY_AUDIO_RESPONSE");
    }
    return audioData;
  }).catch((error: any) => {
    console.error("TTS Final failure:", error);
    if (error.message?.includes("Requested entity was not found") || error.message?.includes("permission")) {
      throw new Error("API_KEY_RESELECT_REQUIRED");
    }
    throw error;
  });
};

export const generateSceneImage = async (prompt: string, style: string, aspectRatio: string = '1:1'): Promise<string | null> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: `Create a high-quality visual for a video scene. 
      Subject: ${prompt}. 
      Style: ${style}. 
      Ensure cinematic lighting and professional composition.`,
      config: {
        imageConfig: {
          aspectRatio: aspectRatio as any
        }
      }
    });

    for (const part of response.candidates[0].content.parts) {
      if (part.inlineData) {
        // Gemini 2.5 Flash Image defaults to JPEG usually, but we just return the raw bytes here.
        // The calling function assumes JPEG for Veo input.
        return part.inlineData.data;
      }
    }
    return null;
  } catch (error: any) {
    console.error("Image generation error:", error);
    if (error.message?.includes("Requested entity was not found") || error.message?.includes("permission")) {
      throw new Error("API_KEY_RESELECT_REQUIRED");
    }
    throw error;
  }
};

export const generateSceneVideo = async (prompt: string, base64Image?: string, aspectRatio: string = '16:9'): Promise<string | null> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  // Veo strictly supports 16:9 or 9:16. 
  // Map other ratios to the closest supported format for the video generation step.
  let validRatio: '16:9' | '9:16' = '16:9';
  if (aspectRatio === '9:16' || aspectRatio === '3:4' || aspectRatio === '1:1') {
    validRatio = '9:16';
  }

  try {
    // Construct the payload dynamically to avoid passing 'undefined' to the image field
    // which can cause API validation errors.
    const requestPayload: any = {
      model: 'veo-3.1-fast-generate-preview',
      prompt: prompt,
      config: {
        numberOfVideos: 1,
        resolution: '720p',
        aspectRatio: validRatio
      }
    };

    if (base64Image) {
      requestPayload.image = {
        imageBytes: base64Image,
        // Gemini generated images are typically JPEG. Using 'image/jpeg' is safer than 'image/png'.
        mimeType: 'image/jpeg' 
      };
    }

    let operation = await ai.models.generateVideos(requestPayload);

    let retries = 0;
    const maxRetries = 60; // Max 5 minutes (60 * 5s)
    
    while (!operation.done && retries < maxRetries) {
      // 5 seconds poll interval is better responsiveness than 10s
      await new Promise(resolve => setTimeout(resolve, 5000));
      operation = await ai.operations.getVideosOperation({ operation: operation });
      retries++;
    }

    if (!operation.done) {
        throw new Error("Video generation timed out after 5 minutes.");
    }

    const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
    if (!downloadLink) return null;
    
    return `${downloadLink}&key=${process.env.API_KEY}`;
  } catch (error: any) {
    console.error("Video generation error details:", error);
    if (
      error.message?.includes("Requested entity was not found") || 
      error.message?.includes("permission") ||
      error.status === "PERMISSION_DENIED" ||
      error.code === 403
    ) {
      throw new Error("API_KEY_RESELECT_REQUIRED");
    }
    throw error;
  }
}
