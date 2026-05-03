import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import type { TransitionType, MotionPreset, TextOverlay, CaptionWord, CaptionStyle } from '../types';
import { renderCaptionFrame } from './captionService';
import { FRIENDLY_OOM_MESSAGE, isMemoryRelatedError } from './ffmpegLimits';

const STATIC_TEMP_FILES = [
  'concat.txt',
  'audio_concat.txt',
  'vid_concat.txt',
  'final_output.mp4',
  'video_concat.mp4',
  'video_transitions.mp4',
  'pres_final.mp4',
  'merged_audio.aac',
  'input_video.mp4',
  'input_audio.mp3',
  'input_audio.wav',
  'output.mp4',
];

/**
 * Best-effort sweep of any temp files this module may have created. Called
 * before each merge (clearing leftovers from a previous session) and again
 * in finally — both on success and failure — so successive exports in the
 * same tab don't accumulate memory.
 */
const sweepTempFiles = async (ffmpeg: FFmpeg, sceneCount: number): Promise<void> => {
  const targets = new Set<string>(STATIC_TEMP_FILES);
  const max = Math.max(sceneCount + 4, 8);
  for (let i = 0; i < max; i++) {
    targets.add(`scene_${i}.mp4`);
    targets.add(`scene_${i}_silent.mp4`);
    targets.add(`audio_${i}.mp3`);
    targets.add(`audio_${i}.wav`);
    targets.add(`merged_${i}.mp4`);
    targets.add(`capped_${i}.mp4`);
    targets.add(`clip_${i}.mp4`);
    targets.add(`clip_${i}_capped.mp4`);
    targets.add(`img_${i}.jpg`);
    targets.add(`pres_audio_${i}.mp3`);
    targets.add(`pres_audio_${i}.wav`);
    targets.add(`ts_${i}.ts`);
    targets.add(`part_${i}.ts`);
  }
  for (let k = 0; k < 400; k++) targets.add(`cap_${k}.png`);
  for (const name of targets) {
    try { await ffmpeg.deleteFile(name); } catch { /* file not present – ignore */ }
  }
};

class FFmpegMemoryError extends Error {
  override readonly name = 'FFmpegMemoryError';
  readonly originalError: Error;
  constructor(message: string, originalError: Error) {
    super(message);
    this.originalError = originalError;
  }
}

const wrapFFmpegError = (err: unknown): Error => {
  if (isMemoryRelatedError(err)) {
    const orig = err instanceof Error ? err : new Error(String(err));
    console.error('[FFmpeg] Memory-related failure:', orig);
    return new FFmpegMemoryError(FRIENDLY_OOM_MESSAGE, orig);
  }
  return err instanceof Error ? err : new Error(String(err));
};

let ffmpegInstance: FFmpeg | null = null;
let loadingPromise: Promise<FFmpeg> | null = null;

const getFFmpeg = async (): Promise<FFmpeg> => {
  if (ffmpegInstance) return ffmpegInstance;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const ffmpeg = new FFmpeg();
    ffmpeg.on('log', ({ message }) => {
      console.log(`[FFmpeg] ${message}`);
    });
    await ffmpeg.load({
      coreURL: 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js',
      wasmURL: 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm',
    });
    ffmpegInstance = ffmpeg;
    return ffmpeg;
  })();

  return loadingPromise;
};

export interface MergeInput {
  videoUrl: string;
  audioUrl?: string;
  captionWords?: CaptionWord[];
  captionDurationSec?: number;
}

export const getResolution = (aspectRatio: string): { w: number; h: number } => {
  switch (aspectRatio) {
    case '9:16': return { w: 720, h: 1280 };
    case '1:1': return { w: 720, h: 720 };
    case '3:4': return { w: 540, h: 720 };
    default: return { w: 1280, h: 720 };
  }
};

export interface CaptionRenderOptions {
  style: CaptionStyle;
  width: number;
  height: number;
}

/**
 * Burn word-level captions onto an existing clip via chained FFmpeg overlay filters.
 * Each caption keyframe is rendered as a transparent PNG and enabled only during its time window.
 * No-op when style.preset === 'none' or words list is empty.
 */
const applyCaptionsToClip = async (
  ffmpeg: FFmpeg,
  inputClip: string,
  outputClip: string,
  words: CaptionWord[],
  clipDurationSec: number,
  opts: CaptionRenderOptions
): Promise<boolean> => {
  if (!words || words.length === 0 || opts.style.preset === 'none') return false;

  const { width, height, style } = opts;
  const blobs: Blob[] = [];
  for (let i = 0; i < words.length; i++) {
    try {
      const blob = await renderCaptionFrame(words, i, { width, height, style });
      blobs.push(blob);
    } catch (e) {
      console.warn(`[Captions] frame ${i} render failed:`, e);
    }
  }
  if (blobs.length === 0) return false;

  for (let k = 0; k < blobs.length; k++) {
    const data = new Uint8Array(await blobs[k].arrayBuffer());
    await ffmpeg.writeFile(`cap_${k}.png`, data);
  }

  const inputs: string[] = ['-i', inputClip];
  for (let k = 0; k < blobs.length; k++) inputs.push('-i', `cap_${k}.png`);

  let filter = '';
  let prevLabel = '0:v';
  for (let k = 0; k < words.length; k++) {
    const w = words[k];
    const startSec = Math.max(0, w.startMs / 1000);
    const endSec = Math.min(clipDurationSec, w.endMs / 1000);
    if (endSec <= startSec) continue;
    const idx = k + 1;
    const nextLabel = k === words.length - 1 ? 'capped' : `cv${k}`;
    filter += `[${prevLabel}][${idx}:v]overlay=(W-w)/2:(H-h)/2:enable='between(t,${startSec.toFixed(3)},${endSec.toFixed(3)})'[${nextLabel}]`;
    if (k < words.length - 1) filter += ';';
    prevLabel = nextLabel;
  }
  if (prevLabel !== 'capped') {
    filter += `;[${prevLabel}]copy[capped]`;
  }

  try {
    await ffmpeg.exec([
      ...inputs,
      '-filter_complex', filter,
      '-map', '[capped]',
      '-map', '0:a?',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'copy',
      '-y',
      outputClip,
    ]);
  } catch (e) {
    console.warn('[Captions] overlay encode failed:', e);
    for (let k = 0; k < blobs.length; k++) {
      try { await ffmpeg.deleteFile(`cap_${k}.png`); } catch {}
    }
    return false;
  }

  for (let k = 0; k < blobs.length; k++) {
    try { await ffmpeg.deleteFile(`cap_${k}.png`); } catch {}
  }
  return true;
};

const fetchAsUint8Array = async (url: string): Promise<Uint8Array> => {
  if (url.startsWith('data:')) {
    const base64 = url.split(',')[1];
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  return await fetchFile(url);
};

export const mergeVideoWithAudio = async (
  videoUrl: string,
  audioUrl: string,
  outputName: string = 'output.mp4'
): Promise<Blob> => {
  const ffmpeg = await getFFmpeg();

  const videoData = await fetchAsUint8Array(videoUrl);
  const audioData = await fetchAsUint8Array(audioUrl);

  await ffmpeg.writeFile('input_video.mp4', videoData);

  const isWav = audioUrl.includes('.wav') || audioUrl.startsWith('data:audio/wav');
  const audioExt = isWav ? 'wav' : 'mp3';
  await ffmpeg.writeFile(`input_audio.${audioExt}`, audioData);

  await ffmpeg.exec([
    '-i', 'input_video.mp4',
    '-i', `input_audio.${audioExt}`,
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-shortest',
    '-y',
    outputName
  ]);

  const data = await ffmpeg.readFile(outputName);
  const blob = new Blob([data], { type: 'video/mp4' });

  await ffmpeg.deleteFile('input_video.mp4');
  await ffmpeg.deleteFile(`input_audio.${audioExt}`);
  await ffmpeg.deleteFile(outputName);

  return blob;
};

export const mergeAllScenes = async (
  inputs: MergeInput[],
  onProgress?: (stage: string, percent: number) => void,
  captionStyle?: CaptionStyle,
  aspectRatio?: string
): Promise<Blob> => {
  const ffmpeg = await getFFmpeg();
  const validInputs = inputs.filter(i => i.videoUrl);

  if (validInputs.length === 0) throw new Error('병합할 비디오가 없습니다.');

  onProgress?.('준비 중...', 0);

  await sweepTempFiles(ffmpeg, validInputs.length);

  const captionRes = aspectRatio ? getResolution(aspectRatio) : { w: 1280, h: 720 };

  try {
  const mergedParts: string[] = [];
  for (let i = 0; i < validInputs.length; i++) {
    const input = validInputs[i];
    const pct = Math.round((i / validInputs.length) * 60);
    onProgress?.(`씬 ${i + 1} 처리 중...`, pct);

    const videoData = await fetchAsUint8Array(input.videoUrl);
    const videoFile = `scene_${i}.mp4`;
    await ffmpeg.writeFile(videoFile, videoData);

    if (input.audioUrl) {
      const audioData = await fetchAsUint8Array(input.audioUrl);
      const isWav = input.audioUrl.includes('.wav') || input.audioUrl.startsWith('data:audio/wav');
      const audioExt = isWav ? 'wav' : 'mp3';
      const audioFile = `audio_${i}.${audioExt}`;
      await ffmpeg.writeFile(audioFile, audioData);

      const mergedFile = `merged_${i}.mp4`;
      await ffmpeg.exec([
        '-i', videoFile,
        '-i', audioFile,
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-shortest',
        '-y',
        mergedFile
      ]);
      mergedParts.push(mergedFile);

      await ffmpeg.deleteFile(videoFile);
      await ffmpeg.deleteFile(audioFile);
    } else {
      const tsFile = `scene_${i}_silent.mp4`;
      await ffmpeg.exec([
        '-i', videoFile,
        '-c:v', 'copy',
        '-an',
        '-y',
        tsFile
      ]);
      mergedParts.push(tsFile);
      await ffmpeg.deleteFile(videoFile);
    }

    if (captionStyle && captionStyle.preset !== 'none' && input.captionWords && input.captionWords.length > 0) {
      const sourceFile = mergedParts[mergedParts.length - 1];
      const cappedFile = `capped_${i}.mp4`;
      const dur = input.captionDurationSec || (input.captionWords[input.captionWords.length - 1].endMs / 1000) || 8;
      const ok = await applyCaptionsToClip(
        ffmpeg,
        sourceFile,
        cappedFile,
        input.captionWords,
        dur,
        { style: captionStyle, width: captionRes.w, height: captionRes.h }
      );
      if (ok) {
        try { await ffmpeg.deleteFile(sourceFile); } catch {}
        mergedParts[mergedParts.length - 1] = cappedFile;
      }
    }
  }

  onProgress?.('비디오 합치는 중...', 70);

  if (mergedParts.length === 1) {
    const data = await ffmpeg.readFile(mergedParts[0]);
    await ffmpeg.deleteFile(mergedParts[0]);
    return new Blob([data], { type: 'video/mp4' });
  }

  for (let i = 0; i < mergedParts.length; i++) {
    const tsFile = `part_${i}.ts`;
    await ffmpeg.exec([
      '-i', mergedParts[i],
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-f', 'mpegts',
      '-y',
      tsFile
    ]);
    await ffmpeg.deleteFile(mergedParts[i]);
    mergedParts[i] = tsFile;
  }

  onProgress?.('최종 파일 생성 중...', 85);

  const concatStr = mergedParts.map(f => `file '${f}'`).join('\n');
  await ffmpeg.writeFile('concat.txt', new TextEncoder().encode(concatStr));

  await ffmpeg.exec([
    '-f', 'concat',
    '-safe', '0',
    '-i', 'concat.txt',
    '-c', 'copy',
    '-y',
    'final_output.mp4'
  ]);

  const finalData = await ffmpeg.readFile('final_output.mp4');

  for (const f of mergedParts) {
    try { await ffmpeg.deleteFile(f); } catch {}
  }
  try { await ffmpeg.deleteFile('concat.txt'); } catch {}
  try { await ffmpeg.deleteFile('final_output.mp4'); } catch {}

  onProgress?.('완료!', 100);

  return new Blob([finalData], { type: 'video/mp4' });
  } catch (err) {
    throw wrapFFmpegError(err);
  } finally {
    try { await sweepTempFiles(ffmpeg, validInputs.length); } catch {}
  }
};

export const isFFmpegSupported = (): boolean => {
  return typeof SharedArrayBuffer !== 'undefined' || typeof WebAssembly !== 'undefined';
};

export interface PresentationSceneInput {
  imageUrl: string;
  audioUrl?: string;
  duration: number;
  transition: TransitionType;
  transitionDuration: number;
  motion: MotionPreset;
  textOverlay?: TextOverlay;
  captionWords?: CaptionWord[];
}

const renderTextOnImage = async (
  imageUrl: string,
  textOverlay: TextOverlay | undefined,
  targetW: number,
  targetH: number
): Promise<Blob> => {
  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d')!;

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.crossOrigin = 'anonymous';
    el.onload = () => resolve(el);
    el.onerror = reject;
    el.src = imageUrl;
  });

  const imgRatio = img.width / img.height;
  const canvasRatio = targetW / targetH;
  let sx = 0, sy = 0, sw = img.width, sh = img.height;
  if (imgRatio > canvasRatio) {
    sw = img.height * canvasRatio;
    sx = (img.width - sw) / 2;
  } else {
    sh = img.width / canvasRatio;
    sy = (img.height - sh) / 2;
  }
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, targetW, targetH);

  if (textOverlay && textOverlay.text.trim()) {
    const fontSize = textOverlay.fontSize || 32;
    ctx.font = `bold ${fontSize}px "Noto Sans KR", "Malgun Gothic", sans-serif`;
    ctx.textAlign = 'center';

    const maxWidth = targetW * 0.85;
    const words = textOverlay.text.split('');
    const lines: string[] = [];
    let currentLine = '';
    for (const char of words) {
      const testLine = currentLine + char;
      if (ctx.measureText(testLine).width > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = char;
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) lines.push(currentLine);

    const lineHeight = fontSize * 1.4;
    const blockH = lines.length * lineHeight;
    const padV = fontSize * 0.6;
    const padH = fontSize * 0.8;

    let baseY: number;
    if (textOverlay.position === 'top') baseY = targetH * 0.08;
    else if (textOverlay.position === 'center') baseY = (targetH - blockH) / 2;
    else baseY = targetH - blockH - targetH * 0.1;

    if (textOverlay.backgroundColor && textOverlay.backgroundColor !== 'transparent') {
      const maxLineW = Math.max(...lines.map(l => ctx.measureText(l).width));
      ctx.fillStyle = textOverlay.backgroundColor;
      const rx = (targetW - maxLineW) / 2 - padH;
      const ry = baseY - padV;
      const rw = maxLineW + padH * 2;
      const rh = blockH + padV * 2;
      const radius = fontSize * 0.4;
      ctx.beginPath();
      ctx.roundRect(rx, ry, rw, rh, radius);
      ctx.fill();
    }

    ctx.fillStyle = textOverlay.color || '#ffffff';
    ctx.shadowColor = 'rgba(0,0,0,0.7)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;
    lines.forEach((line, li) => {
      ctx.fillText(line, targetW / 2, baseY + li * lineHeight + fontSize);
    });
  }

  return new Promise<Blob>((resolve) => {
    canvas.toBlob((blob) => resolve(blob!), 'image/jpeg', 0.92);
  });
};

const getZoomPanFilter = (motion: MotionPreset, frames: number, w: number, h: number): string => {
  const s = `${w}x${h}`;
  switch (motion) {
    case 'zoom-in':
      return `zoompan=z='min(zoom+0.0015,1.25)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${s}:fps=25`;
    case 'zoom-out':
      return `zoompan=z='if(eq(on\\,0)\\,1.25\\,max(zoom-0.0015\\,1))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${s}:fps=25`;
    case 'pan-left':
      return `zoompan=z=1.15:x='iw*(1-on/${frames})*(1-1/1.15)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${s}:fps=25`;
    case 'pan-right':
      return `zoompan=z=1.15:x='iw*on/${frames}*(1-1/1.15)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${s}:fps=25`;
    case 'pan-up':
      return `zoompan=z=1.15:x='iw/2-(iw/zoom/2)':y='ih*(1-on/${frames})*(1-1/1.15)':d=${frames}:s=${s}:fps=25`;
    case 'pan-down':
      return `zoompan=z=1.15:x='iw/2-(iw/zoom/2)':y='ih*on/${frames}*(1-1/1.15)':d=${frames}:s=${s}:fps=25`;
    default:
      return `zoompan=z=1:d=${frames}:s=${s}:fps=25`;
  }
};

export const renderPresentationVideo = async (
  scenes: PresentationSceneInput[],
  aspectRatio: string,
  onProgress?: (stage: string, percent: number) => void,
  captionStyle?: CaptionStyle
): Promise<Blob> => {
  if (scenes.length === 0) throw new Error('렌더링할 씬이 없습니다.');

  const ffmpeg = await getFFmpeg();
  const { w, h } = getResolution(aspectRatio);

  onProgress?.('이미지 준비 중...', 5);

  await sweepTempFiles(ffmpeg, scenes.length);

  try {
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const pct = 5 + Math.round((i / scenes.length) * 20);
    onProgress?.(`씬 ${i + 1} 이미지 처리 중...`, pct);

    const imageBlob = await renderTextOnImage(scene.imageUrl, scene.textOverlay, w, h);
    const imageData = new Uint8Array(await imageBlob.arrayBuffer());
    await ffmpeg.writeFile(`img_${i}.jpg`, imageData);
  }

  onProgress?.('비디오 클립 생성 중...', 30);

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const dur = scene.duration;
    const frames = Math.round(dur * 25);
    const pct = 30 + Math.round((i / scenes.length) * 30);
    onProgress?.(`씬 ${i + 1} 모션 렌더링 중...`, pct);

    if (scene.motion && scene.motion !== 'none') {
      const zpFilter = getZoomPanFilter(scene.motion, frames, w, h);
      await ffmpeg.exec([
        '-loop', '1',
        '-i', `img_${i}.jpg`,
        '-vf', `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,${zpFilter},trim=0:${dur},setpts=PTS-STARTPTS`,
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-pix_fmt', 'yuv420p',
        '-t', String(dur),
        '-y',
        `clip_${i}.mp4`
      ]);
    } else {
      await ffmpeg.exec([
        '-loop', '1',
        '-i', `img_${i}.jpg`,
        '-vf', `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`,
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-pix_fmt', 'yuv420p',
        '-t', String(dur),
        '-r', '25',
        '-y',
        `clip_${i}.mp4`
      ]);
    }
    try { await ffmpeg.deleteFile(`img_${i}.jpg`); } catch {}

    if (captionStyle && captionStyle.preset !== 'none' && scene.captionWords && scene.captionWords.length > 0) {
      const cappedFile = `clip_${i}_capped.mp4`;
      const ok = await applyCaptionsToClip(
        ffmpeg,
        `clip_${i}.mp4`,
        cappedFile,
        scene.captionWords,
        dur,
        { style: captionStyle, width: w, height: h }
      );
      if (ok) {
        try { await ffmpeg.deleteFile(`clip_${i}.mp4`); } catch {}
        await ffmpeg.exec(['-i', cappedFile, '-c', 'copy', '-y', `clip_${i}.mp4`]);
        try { await ffmpeg.deleteFile(cappedFile); } catch {}
      }
    }
  }

  onProgress?.('전환 효과 적용 중...', 65);

  let finalVideoFile: string;

  const hasTransitions = scenes.some((s, i) => i > 0 && s.transition && s.transition !== 'none');

  if (hasTransitions && scenes.length > 1) {
    try {
      const inputArgs: string[] = [];
      for (let i = 0; i < scenes.length; i++) {
        inputArgs.push('-i', `clip_${i}.mp4`);
      }

      let filterStr = '';
      const durations = scenes.map(s => s.duration);

      if (scenes.length === 2) {
        const t = Math.min(scenes[1].transitionDuration || 1, durations[0] - 0.1, durations[1] - 0.1);
        const transName = scenes[1].transition === 'none' ? 'fade' : scenes[1].transition;
        const offset = durations[0] - t;
        filterStr = `[0:v][1:v]xfade=transition=${transName}:duration=${t}:offset=${offset}[vout]`;
      } else {
        let prevLabel = '0:v';
        let cumDur = durations[0];
        let cumTrans = 0;
        for (let j = 1; j < scenes.length; j++) {
          const transName = scenes[j].transition === 'none' ? 'fade' : scenes[j].transition;
          const t = Math.min(scenes[j].transitionDuration || 1, Math.max(0.2, cumDur - cumTrans - 0.5), durations[j] - 0.1);
          const offset = cumDur - cumTrans - t;
          const outLabel = j < scenes.length - 1 ? `v${j}` : 'vout';
          filterStr += `[${prevLabel}][${j}:v]xfade=transition=${transName}:duration=${t.toFixed(2)}:offset=${offset.toFixed(2)}[${outLabel}]`;
          if (j < scenes.length - 1) filterStr += ';';
          prevLabel = outLabel;
          cumDur += durations[j];
          cumTrans += t;
        }
      }

      await ffmpeg.exec([
        ...inputArgs,
        '-filter_complex', filterStr,
        '-map', '[vout]',
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-pix_fmt', 'yuv420p',
        '-y',
        'video_transitions.mp4'
      ]);
      finalVideoFile = 'video_transitions.mp4';
    } catch (err) {
      console.warn('[Presentation] xfade failed, falling back to concat:', err);
      finalVideoFile = await concatClips(ffmpeg, scenes.length);
    }
  } else {
    finalVideoFile = await concatClips(ffmpeg, scenes.length);
  }

  for (let i = 0; i < scenes.length; i++) {
    try { await ffmpeg.deleteFile(`clip_${i}.mp4`); } catch {}
  }

  onProgress?.('오디오 합성 중...', 80);

  const audioInputs = scenes.filter(s => s.audioUrl);
  let outputFile = finalVideoFile;

  if (audioInputs.length > 0) {
    const audioParts: string[] = [];
    let audioOffset = 0;
    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      if (scene.audioUrl) {
        const audioData = await fetchAsUint8Array(scene.audioUrl);
        const ext = scene.audioUrl.includes('.wav') || scene.audioUrl.startsWith('data:audio/wav') ? 'wav' : 'mp3';
        const audioFile = `pres_audio_${i}.${ext}`;
        await ffmpeg.writeFile(audioFile, audioData);
        audioParts.push(audioFile);
      }
      audioOffset += scene.duration;
    }

    if (audioParts.length > 0) {
      if (audioParts.length === 1) {
        await ffmpeg.exec([
          '-i', finalVideoFile,
          '-i', audioParts[0],
          '-c:v', 'copy',
          '-c:a', 'aac',
          '-b:a', '128k',
          '-shortest',
          '-y',
          'pres_final.mp4'
        ]);
      } else {
        const concatAudioStr = audioParts.map(f => `file '${f}'`).join('\n');
        await ffmpeg.writeFile('audio_concat.txt', new TextEncoder().encode(concatAudioStr));
        await ffmpeg.exec([
          '-f', 'concat', '-safe', '0', '-i', 'audio_concat.txt',
          '-c:a', 'aac', '-b:a', '128k', '-y', 'merged_audio.aac'
        ]);
        await ffmpeg.exec([
          '-i', finalVideoFile,
          '-i', 'merged_audio.aac',
          '-c:v', 'copy',
          '-c:a', 'aac',
          '-b:a', '128k',
          '-shortest',
          '-y',
          'pres_final.mp4'
        ]);
        try { await ffmpeg.deleteFile('audio_concat.txt'); } catch {}
        try { await ffmpeg.deleteFile('merged_audio.aac'); } catch {}
      }
      outputFile = 'pres_final.mp4';
      for (const f of audioParts) {
        try { await ffmpeg.deleteFile(f); } catch {}
      }
    }
  }

  if (outputFile !== finalVideoFile) {
    try { await ffmpeg.deleteFile(finalVideoFile); } catch {}
  }

  onProgress?.('최종 파일 생성 중...', 95);

  const finalData = await ffmpeg.readFile(outputFile);
  try { await ffmpeg.deleteFile(outputFile); } catch {}

  onProgress?.('완료!', 100);

  return new Blob([finalData], { type: 'video/mp4' });
  } catch (err) {
    throw wrapFFmpegError(err);
  } finally {
    try { await sweepTempFiles(ffmpeg, scenes.length); } catch {}
  }
};

const concatClips = async (ffmpeg: FFmpeg, count: number): Promise<string> => {
  if (count === 1) {
    await ffmpeg.exec(['-i', 'clip_0.mp4', '-c', 'copy', '-y', 'video_concat.mp4']);
    return 'video_concat.mp4';
  }

  for (let i = 0; i < count; i++) {
    await ffmpeg.exec([
      '-i', `clip_${i}.mp4`,
      '-c:v', 'libx264', '-preset', 'ultrafast',
      '-c:a', 'aac', '-b:a', '128k',
      '-f', 'mpegts', '-y', `ts_${i}.ts`
    ]);
  }

  const concatStr = Array.from({ length: count }, (_, i) => `file 'ts_${i}.ts'`).join('\n');
  await ffmpeg.writeFile('vid_concat.txt', new TextEncoder().encode(concatStr));

  await ffmpeg.exec([
    '-f', 'concat', '-safe', '0', '-i', 'vid_concat.txt',
    '-c', 'copy', '-y', 'video_concat.mp4'
  ]);

  for (let i = 0; i < count; i++) {
    try { await ffmpeg.deleteFile(`ts_${i}.ts`); } catch {}
  }
  try { await ffmpeg.deleteFile('vid_concat.txt'); } catch {}

  return 'video_concat.mp4';
};
