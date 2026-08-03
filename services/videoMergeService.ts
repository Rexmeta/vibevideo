import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
// Task #106 — bundle the FFmpeg core via Vite so we don't depend on a CDN
// (unpkg) for the worker handshake. `?url` returns a same-origin URL that
// works inside the FFmpeg worker. The CDN URLs below are kept as a fallback.
import ffmpegCoreUrl from '@ffmpeg/core?url';
import ffmpegWasmUrl from '@ffmpeg/core/wasm?url';
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

/**
 * Task #99 — Tear down the FFmpeg.wasm singleton and release its WASM
 * heap. Call between long-form export chunks so each chapter's render
 * starts from a clean ~32MB allocation instead of accumulating up to the
 * 2GB browser ceiling. Subsequent calls to any merge helper will lazily
 * reload core.
 */
export const terminateFFmpegForCleanup = async (): Promise<void> => {
  const inst = ffmpegInstance;
  ffmpegInstance = null;
  loadingPromise = null;
  if (!inst) return;
  try {
    inst.terminate();
  } catch (e) {
    console.warn('[FFmpeg] terminate failed (ignoring):', e);
  }
};

/**
 * Task #99 — Concatenate already-rendered MP4 part blobs into a single MP4
 * via the MPEG-TS + concat-demuxer trick (re-encodes each part to TS, then
 * stream-copies into a final container). Caller is responsible for calling
 * `terminateFFmpegForCleanup()` first if memory is tight.
 *
 * Returns the single concatenated blob. Throws on FFmpeg failure (caller
 * should catch and fall back to per-part downloads).
 */
export const concatMp4Parts = async (
  parts: Blob[],
  onProgress?: (stage: string, pct: number) => void
): Promise<Blob> => {
  if (!parts || parts.length === 0) throw new Error('No parts to concat');
  if (parts.length === 1) return parts[0];

  const ffmpeg = await getFFmpeg();
  try {
    onProgress?.('파트 로드 중...', 5);
    for (let i = 0; i < parts.length; i++) {
      const u8 = new Uint8Array(await parts[i].arrayBuffer());
      await ffmpeg.writeFile(`part_${i}.mp4`, u8);
    }

    onProgress?.('파트를 MPEG-TS로 변환 중...', 25);
    for (let i = 0; i < parts.length; i++) {
      await ffmpeg.exec([
        '-i', `part_${i}.mp4`,
        '-c:v', 'libx264', '-preset', 'ultrafast',
        '-c:a', 'aac', '-b:a', '128k',
        '-bsf:v', 'h264_mp4toannexb',
        '-f', 'mpegts', '-y', `part_${i}.ts`,
      ]);
      try { await ffmpeg.deleteFile(`part_${i}.mp4`); } catch {}
      onProgress?.(
        `파트 ${i + 1}/${parts.length} 변환 완료`,
        25 + Math.round(((i + 1) / parts.length) * 50)
      );
    }

    onProgress?.('최종 결합 중...', 85);
    const list = parts.map((_, i) => `file 'part_${i}.ts'`).join('\n');
    await ffmpeg.writeFile('parts_concat.txt', new TextEncoder().encode(list));
    await ffmpeg.exec([
      '-f', 'concat', '-safe', '0', '-i', 'parts_concat.txt',
      '-c', 'copy', '-y', 'final_long.mp4',
    ]);

    onProgress?.('최종 파일 생성 중...', 95);
    const data = await ffmpeg.readFile('final_long.mp4');

    for (let i = 0; i < parts.length; i++) {
      try { await ffmpeg.deleteFile(`part_${i}.ts`); } catch {}
    }
    try { await ffmpeg.deleteFile('parts_concat.txt'); } catch {}
    try { await ffmpeg.deleteFile('final_long.mp4'); } catch {}

    onProgress?.('완료!', 100);
    return new Blob([data as BlobPart], { type: 'video/mp4' });
  } catch (err) {
    throw wrapFFmpegError(err);
  }
};

const FFMPEG_LOAD_TIMEOUT_MS = 30000;
const FFMPEG_CDN_CORE = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js';
const FFMPEG_CDN_WASM = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm';

export class FFmpegLoadTimeoutError extends Error {
  override readonly name = 'FFmpegLoadTimeoutError';
  constructor(message = 'FFmpeg 로딩이 시간 내에 완료되지 않았습니다.') {
    super(message);
  }
}

const withTimeout = <T,>(p: Promise<T>, ms: number, label: string): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new FFmpegLoadTimeoutError(
      `${label} (${Math.round(ms / 1000)}s 초과)`
    )), ms);
    p.then(v => { clearTimeout(t); resolve(v); },
           e => { clearTimeout(t); reject(e); });
  });

const tryLoad = async (
  ffmpeg: FFmpeg,
  coreURL: string,
  wasmURL: string,
  source: string
): Promise<void> => {
  console.log(`[FFmpeg] Loading core from ${source}...`);
  await withTimeout(
    ffmpeg.load({ coreURL, wasmURL }),
    FFMPEG_LOAD_TIMEOUT_MS,
    `FFmpeg ${source} 로드 실패`
  );
  console.log(`[FFmpeg] Core loaded from ${source}.`);
};

const getFFmpeg = async (): Promise<FFmpeg> => {
  if (ffmpegInstance) return ffmpegInstance;
  if (loadingPromise) return loadingPromise;

  const attempt = (async () => {
    const ffmpeg = new FFmpeg();
    ffmpeg.on('log', ({ message }) => {
      console.log(`[FFmpeg] ${message}`);
    });

    try {
      await tryLoad(ffmpeg, ffmpegCoreUrl, ffmpegWasmUrl, 'local bundle');
    } catch (localErr) {
      console.warn('[FFmpeg] Local core load failed, falling back to CDN:', localErr);
      // Fresh instance for the retry — the previous one may be in a bad state.
      try { ffmpeg.terminate(); } catch {}
      const ffmpeg2 = new FFmpeg();
      ffmpeg2.on('log', ({ message }) => {
        console.log(`[FFmpeg] ${message}`);
      });
      try {
        await tryLoad(ffmpeg2, FFMPEG_CDN_CORE, FFMPEG_CDN_WASM, 'CDN fallback');
      } catch (cdnErr) {
        console.error('[FFmpeg] CDN fallback also failed:', cdnErr);
        try { ffmpeg2.terminate(); } catch {}
        throw cdnErr instanceof FFmpegLoadTimeoutError
          ? cdnErr
          : new FFmpegLoadTimeoutError('FFmpeg 코어를 불러오지 못했습니다.');
      }
      ffmpegInstance = ffmpeg2;
      return ffmpeg2;
    }

    ffmpegInstance = ffmpeg;
    return ffmpeg;
  })();

  loadingPromise = attempt.catch((err) => {
    // Reset cache so the next call gets a clean retry instead of returning
    // the same rejected/pending promise forever.
    ffmpegInstance = null;
    loadingPromise = null;
    throw err;
  }).finally(() => {
    // On success, clear the in-flight marker but keep the cached instance.
    if (ffmpegInstance) loadingPromise = null;
  }) as Promise<FFmpeg>;

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
  /**
   * Container/codec layout for the produced clip.
   * - `mp4` (default): outputs h264 + copy-of-input audio in MP4.
   * - `mpegts`: outputs h264 + AAC inside MPEG-TS so the clip can be concat-copied
   *   directly without an additional re-encode step.
   */
  outputFormat?: 'mp4' | 'mpegts';
  /**
   * Optional separate audio file (already written to the ffmpeg FS) to mux into
   * the captioned output in the same libx264 pass. When provided, the audio
   * track of `inputClip` is ignored and this file's audio is encoded to AAC
   * (`-c:a aac`). When omitted, the audio of `inputClip` is reused (`-c:a copy`
   * for mp4, re-encoded to AAC for mpegts).
   *
   * This lets single-scene preview/export skip a separate `mergeVideoWithAudio`
   * pass — the audio mux + caption overlay + final encode all happen at once.
   */
  audioSource?: string;
}

/**
 * Burn word-level captions onto an existing clip via chained FFmpeg overlay filters.
 * Each caption keyframe is rendered as a transparent PNG and enabled only during its time window.
 * When `outputFormat === 'mpegts'` the same single libx264 pass also remuxes to MPEG-TS,
 * so the caller can skip a second re-encode for concat preparation.
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
  const isTs = opts.outputFormat === 'mpegts';
  const hasExternalAudio = !!opts.audioSource;
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
  if (hasExternalAudio) inputs.push('-i', opts.audioSource!);
  // Caption PNG inputs come after the (optional) audio input so their stream
  // indices stay sequential regardless of whether external audio is present.
  const captionInputBase = hasExternalAudio ? 2 : 1;
  for (let k = 0; k < blobs.length; k++) inputs.push('-i', `cap_${k}.png`);

  let filter = '';
  let prevLabel = '0:v';
  for (let k = 0; k < words.length; k++) {
    const w = words[k];
    const startSec = Math.max(0, w.startMs / 1000);
    const endSec = Math.min(clipDurationSec, w.endMs / 1000);
    if (endSec <= startSec) continue;
    const idx = captionInputBase + k;
    const nextLabel = k === words.length - 1 ? 'capped' : `cv${k}`;
    filter += `[${prevLabel}][${idx}:v]overlay=(W-w)/2:(H-h)/2:enable='between(t,${startSec.toFixed(3)},${endSec.toFixed(3)})'[${nextLabel}]`;
    if (k < words.length - 1) filter += ';';
    prevLabel = nextLabel;
  }
  if (prevLabel !== 'capped') {
    filter += `;[${prevLabel}]copy[capped]`;
  }

  // When an external audio file is provided we always re-encode it to AAC so
  // the muxed output is well-formed regardless of the source codec (mp3/wav).
  // For mp4 with built-in audio we can stream-copy; for MPEG-TS we still need
  // AAC so the concat-demuxer stays happy.
  const audioArgs = hasExternalAudio || isTs
    ? ['-c:a', 'aac', '-b:a', '128k']
    : ['-c:a', 'copy'];
  const audioMap = hasExternalAudio ? '1:a?' : '0:a?';
  const formatArgs = isTs ? ['-f', 'mpegts'] : [];
  const shortestArgs = hasExternalAudio ? ['-shortest'] : [];

  try {
    await ffmpeg.exec([
      ...inputs,
      '-filter_complex', filter,
      '-map', '[capped]',
      '-map', audioMap,
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-pix_fmt', 'yuv420p',
      ...audioArgs,
      ...shortestArgs,
      ...formatArgs,
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

export interface MergeVideoWithAudioOptions {
  /** Optional caption words to burn into the output in the same encode pass. */
  captionWords?: CaptionWord[];
  /** Caption styling. Required when `captionWords` is non-empty (and not 'none'). */
  captionStyle?: CaptionStyle;
  /** Clip duration in seconds. Used to clamp caption end times. */
  captionDurationSec?: number;
  /** Aspect ratio key (e.g. '16:9') used to derive the caption render canvas. */
  aspectRatio?: string;
}

/**
 * Merge a single video clip with an audio track. When captions are provided
 * and enabled, the video+audio mux, caption overlay, and final libx264 encode
 * are all performed in a single ffmpeg invocation (via `applyCaptionsToClip`)
 * — matching the unified encoding path used by `mergeAllScenes` /
 * `renderPresentationVideo`. Without captions, this is a one-shot mux just
 * like before.
 */
export const mergeVideoWithAudio = async (
  videoUrl: string,
  audioUrl: string,
  outputName: string = 'output.mp4',
  options: MergeVideoWithAudioOptions = {}
): Promise<Blob> => {
  const ffmpeg = await getFFmpeg();

  const videoData = await fetchAsUint8Array(videoUrl);
  const audioData = await fetchAsUint8Array(audioUrl);

  await ffmpeg.writeFile('input_video.mp4', videoData);

  const isWav = audioUrl.includes('.wav') || audioUrl.startsWith('data:audio/wav');
  const audioExt = isWav ? 'wav' : 'mp3';
  const audioFile = `input_audio.${audioExt}`;
  await ffmpeg.writeFile(audioFile, audioData);

  const captionsEnabled = !!(
    options.captionStyle
    && options.captionStyle.preset !== 'none'
    && options.captionWords
    && options.captionWords.length > 0
  );

  let usedCaptionPass = false;
  if (captionsEnabled) {
    const { w, h } = getResolution(options.aspectRatio || '16:9');
    const dur = options.captionDurationSec
      || (options.captionWords![options.captionWords!.length - 1].endMs / 1000)
      || 8;
    usedCaptionPass = await applyCaptionsToClip(
      ffmpeg,
      'input_video.mp4',
      outputName,
      options.captionWords!,
      dur,
      {
        style: options.captionStyle!,
        width: w,
        height: h,
        audioSource: audioFile,
      }
    );
  }

  if (!usedCaptionPass) {
    // No captions (or caption pass failed): fall back to the legacy single-pass
    // mux which stream-copies the video and re-encodes the audio to AAC.
    await ffmpeg.exec([
      '-i', 'input_video.mp4',
      '-i', audioFile,
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-shortest',
      '-y',
      outputName
    ]);
  }

  const data = await ffmpeg.readFile(outputName);
  const blob = new Blob([data as BlobPart], { type: 'video/mp4' });

  try { await ffmpeg.deleteFile('input_video.mp4'); } catch {}
  try { await ffmpeg.deleteFile(audioFile); } catch {}
  try { await ffmpeg.deleteFile(outputName); } catch {}

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
  const isMulti = validInputs.length > 1;
  const partFiles: string[] = [];
  const N = validInputs.length;
  // Reserve 0..75 for the per-scene loop, 75..92 for the final concat,
  // 92..100 for reading the result. Each scene further reports sub-progress
  // (load → audio merge → caption/TS encode) so the bar advances smoothly
  // even when N is small.
  const sceneRange = isMulti ? 75 : 90;
  const reportScene = (i: number, frac: number, stage: string) => {
    const base = (i / N) * sceneRange;
    const span = sceneRange / N;
    onProgress?.(stage, Math.min(sceneRange, Math.round(base + frac * span)));
  };

  for (let i = 0; i < validInputs.length; i++) {
    const input = validInputs[i];
    reportScene(i, 0, `씬 ${i + 1} 처리 중...`);

    const videoData = await fetchAsUint8Array(input.videoUrl);
    const videoFile = `scene_${i}.mp4`;
    await ffmpeg.writeFile(videoFile, videoData);

    let audioFile: string | null = null;
    if (input.audioUrl) {
      const audioData = await fetchAsUint8Array(input.audioUrl);
      const isWav = input.audioUrl.includes('.wav') || input.audioUrl.startsWith('data:audio/wav');
      const audioExt = isWav ? 'wav' : 'mp3';
      audioFile = `audio_${i}.${audioExt}`;
      await ffmpeg.writeFile(audioFile, audioData);
    }

    const hasCaptions = !!(captionStyle && captionStyle.preset !== 'none'
      && input.captionWords && input.captionWords.length > 0);

    // Fast path: single-scene preview/export with captions AND an external
    // audio track. Combine the audio mux + caption overlay + final libx264
    // encode into one ffmpeg call so the preview only triggers a single
    // invocation instead of two.
    //
    // When `audioFile` is absent we deliberately stay on the legacy path: the
    // pre-existing silent flow uses `-an` to drop any audio embedded in the
    // source video, and we must preserve that behavior (taking the fast path
    // here would map `0:a?` and re-introduce that embedded audio).
    if (!isMulti && hasCaptions && audioFile) {
      const cappedFile = `capped_${i}.mp4`;
      const dur = input.captionDurationSec
        || (input.captionWords![input.captionWords!.length - 1].endMs / 1000) || 8;
      const ok = await applyCaptionsToClip(
        ffmpeg, videoFile, cappedFile, input.captionWords!, dur,
        {
          style: captionStyle!,
          width: captionRes.w,
          height: captionRes.h,
          audioSource: audioFile,
        }
      );
      if (ok) {
        try { await ffmpeg.deleteFile(videoFile); } catch {}
        try { await ffmpeg.deleteFile(audioFile); } catch {}
        partFiles.push(cappedFile);
        reportScene(i, 1, `씬 ${i + 1} 완료`);
        continue;
      }
      // Caption pass failed — fall through to the legacy 2-pass path below
      // (videoFile and audioFile are still on the FS).
    }

    let mergedFile: string;
    if (audioFile) {
      mergedFile = `merged_${i}.mp4`;
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

      await ffmpeg.deleteFile(videoFile);
      await ffmpeg.deleteFile(audioFile);
    } else {
      mergedFile = `scene_${i}_silent.mp4`;
      await ffmpeg.exec([
        '-i', videoFile,
        '-c:v', 'copy',
        '-an',
        '-y',
        mergedFile
      ]);
      await ffmpeg.deleteFile(videoFile);
    }

    reportScene(i, 0.45, `씬 ${i + 1} 인코딩 중...`);

    if (!isMulti) {
      // Single-scene captioned case is handled by the fast path above; only the
      // no-captions case (or post-failure fallback) reaches here.
      partFiles.push(mergedFile);
    } else {
      // Multi-scene: produce an MPEG-TS part directly so the final concat is `-c copy`.
      const tsFile = `part_${i}.ts`;
      let producedTs = false;
      if (hasCaptions) {
        const dur = input.captionDurationSec
          || (input.captionWords![input.captionWords!.length - 1].endMs / 1000) || 8;
        producedTs = await applyCaptionsToClip(
          ffmpeg, mergedFile, tsFile, input.captionWords!, dur,
          { style: captionStyle!, width: captionRes.w, height: captionRes.h, outputFormat: 'mpegts' }
        );
      }
      if (!producedTs) {
        // No captions (or caption pass failed): try a copy-remux to TS first to
        // skip re-encoding. Falls back to a libx264 re-encode if the input is
        // not H.264 (the bitstream filter assumes H.264).
        let copied = false;
        try {
          await ffmpeg.exec([
            '-i', mergedFile,
            '-c', 'copy',
            '-bsf:v', 'h264_mp4toannexb',
            '-f', 'mpegts',
            '-y',
            tsFile,
          ]);
          copied = true;
        } catch (e) {
          console.warn('[Merge] TS copy-remux failed, re-encoding:', e);
        }
        if (!copied) {
          await ffmpeg.exec([
            '-i', mergedFile,
            '-c:v', 'libx264',
            '-preset', 'ultrafast',
            '-c:a', 'aac',
            '-b:a', '128k',
            '-f', 'mpegts',
            '-y',
            tsFile,
          ]);
        }
      }
      try { await ffmpeg.deleteFile(mergedFile); } catch {}
      partFiles.push(tsFile);
    }

    reportScene(i, 1, `씬 ${i + 1} 완료`);
  }

  if (partFiles.length === 1) {
    onProgress?.('최종 파일 생성 중...', 94);
    const data = await ffmpeg.readFile(partFiles[0]);
    try { await ffmpeg.deleteFile(partFiles[0]); } catch {}
    onProgress?.('완료!', 100);
    return new Blob([data as BlobPart], { type: 'video/mp4' });
  }

  onProgress?.('파트 합치는 중...', 80);

  const concatStr = partFiles.map(f => `file '${f}'`).join('\n');
  await ffmpeg.writeFile('concat.txt', new TextEncoder().encode(concatStr));

  await ffmpeg.exec([
    '-f', 'concat',
    '-safe', '0',
    '-i', 'concat.txt',
    '-c', 'copy',
    '-y',
    'final_output.mp4'
  ]);

  onProgress?.('최종 파일 생성 중...', 94);
  const finalData = await ffmpeg.readFile('final_output.mp4');

  for (const f of partFiles) {
    try { await ffmpeg.deleteFile(f); } catch {}
  }
  try { await ffmpeg.deleteFile('concat.txt'); } catch {}
  try { await ffmpeg.deleteFile('final_output.mp4'); } catch {}

  onProgress?.('완료!', 100);

  return new Blob([finalData as BlobPart], { type: 'video/mp4' });
  } catch (err) {
    throw wrapFFmpegError(err);
  } finally {
    try { await sweepTempFiles(ffmpeg, validInputs.length); } catch {}
  }
};

export const isFFmpegSupported = (): boolean => {
  return typeof SharedArrayBuffer !== 'undefined' || typeof WebAssembly !== 'undefined';
};

// ─────────────────────────────────────────────────────────────────────────────
// Brand Kit helpers
// ─────────────────────────────────────────────────────────────────────────────

export type BrandLogoPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';

/**
 * Build the FFmpeg overlay position expression for a given corner/center.
 * Returns (x, y) expressions for the overlay filter.
 */
const logoPositionExpr = (pos: BrandLogoPosition, padPx = 16): [string, string] => {
  switch (pos) {
    case 'top-left':     return [`${padPx}`, `${padPx}`];
    case 'top-right':    return [`main_w-overlay_w-${padPx}`, `${padPx}`];
    case 'bottom-left':  return [`${padPx}`, `main_h-overlay_h-${padPx}`];
    case 'center':       return [`(main_w-overlay_w)/2`, `(main_h-overlay_h)/2`];
    default:             return [`main_w-overlay_w-${padPx}`, `main_h-overlay_h-${padPx}`]; // bottom-right
  }
};

/**
 * Apply a logo watermark to a video blob via FFmpeg overlay.
 * Returns a new blob with the logo burned in.
 */
export const applyLogoWatermark = async (
  videoBlob: Blob,
  logoUrl: string,
  position: BrandLogoPosition = 'bottom-right',
  opacity: number = 0.8,
  onProgress?: (stage: string) => void,
): Promise<Blob> => {
  const ffmpeg = await getFFmpeg();

  onProgress?.('로고 워터마크 적용 중...');

  // Write input video
  const videoData = new Uint8Array(await videoBlob.arrayBuffer());
  await ffmpeg.writeFile('wm_input.mp4', videoData);

  // Fetch and write logo
  const logoData = await fetchAsUint8Array(logoUrl);
  const ext = logoUrl.match(/\.(png|svg|jpe?g|webp)/i)?.[1]?.replace('jpeg', 'jpg') || 'png';
  const logoFile = `wm_logo.${ext}`;
  await ffmpeg.writeFile(logoFile, logoData);

  const [x, y] = logoPositionExpr(position);
  const alphaFilter = `[1:v]format=rgba,colorchannelmixer=aa=${opacity.toFixed(2)}[logo_t]`;
  const overlayFilter = `[0:v][logo_t]overlay=${x}:${y}[out]`;

  try {
    await ffmpeg.exec([
      '-i', 'wm_input.mp4',
      '-i', logoFile,
      '-filter_complex', `${alphaFilter};${overlayFilter}`,
      '-map', '[out]',
      '-map', '0:a?',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
      '-c:a', 'copy',
      '-y', 'wm_output.mp4',
    ]);
  } catch (e) {
    // If the alpha filter fails (e.g. SVG), try simpler overlay without alpha
    try {
      await ffmpeg.exec([
        '-i', 'wm_input.mp4',
        '-i', logoFile,
        '-filter_complex', `[0:v][1:v]overlay=${x}:${y}[out]`,
        '-map', '[out]',
        '-map', '0:a?',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
        '-c:a', 'copy',
        '-y', 'wm_output.mp4',
      ]);
    } catch {
      // Watermark failed — return original blob unmodified
      console.warn('[BrandKit] logo watermark failed, returning original');
      try { await ffmpeg.deleteFile('wm_input.mp4'); } catch {}
      try { await ffmpeg.deleteFile(logoFile); } catch {}
      return videoBlob;
    }
  }

  const data = await ffmpeg.readFile('wm_output.mp4');

  try { await ffmpeg.deleteFile('wm_input.mp4'); } catch {}
  try { await ffmpeg.deleteFile(logoFile); } catch {}
  try { await ffmpeg.deleteFile('wm_output.mp4'); } catch {}

  return new Blob([data as BlobPart], { type: 'video/mp4' });
};

export interface SlideClipConfig {
  /** Main title text */
  text: string;
  /** Optional subtitle */
  subtext?: string;
  /** CSS hex colour e.g. "#1a1a2e" */
  bgColor: string;
  /** Optional background image URL */
  bgImageUrl?: string;
  /** Duration in seconds (1–5) */
  durationSec: number;
}

/**
 * Draw a slide frame onto an existing canvas element using the given config.
 * This is the shared rendering helper used both by generateSlideClip (for
 * FFmpeg encoding) and by BrandKitSettings (for the live canvas preview).
 *
 * The canvas dimensions are used as-is; callers should size the canvas to the
 * desired output resolution before calling this function.
 *
 * Returns a Promise so that async background-image loading is awaited before
 * the caller reads back the canvas pixels.
 */
export const drawSlideFrame = async (
  canvas: HTMLCanvasElement,
  config: SlideClipConfig,
): Promise<void> => {
  const { w, h } = { w: canvas.width, h: canvas.height };
  const { bgColor, text, subtext } = config;
  const ctx = canvas.getContext('2d')!;

  // Background colour (or background image if provided)
  if (config.bgImageUrl) {
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.crossOrigin = 'anonymous';
        el.onload = () => resolve(el);
        el.onerror = reject;
        el.src = config.bgImageUrl!;
      });
      // Cover-fit
      const imgRatio = img.width / img.height;
      const canvasRatio = w / h;
      let sx = 0, sy = 0, sw = img.width, sh = img.height;
      if (imgRatio > canvasRatio) { sw = img.height * canvasRatio; sx = (img.width - sw) / 2; }
      else { sh = img.width / canvasRatio; sy = (img.height - sh) / 2; }
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
    } catch {
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, w, h);
    }
  } else {
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, w, h);
  }

  // Title text
  if (text) {
    const fontSize = Math.round(h * 0.07);
    ctx.font = `900 ${fontSize}px "Noto Sans KR", "Malgun Gothic", Arial, sans-serif`;
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 8;
    const y = subtext ? h * 0.45 : h * 0.5;
    ctx.fillText(text, w / 2, y);
  }

  // Subtitle
  if (subtext) {
    const subSize = Math.round(h * 0.045);
    ctx.font = `600 ${subSize}px "Noto Sans KR", "Malgun Gothic", Arial, sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.shadowColor = 'rgba(0,0,0,0.4)';
    ctx.shadowBlur = 6;
    ctx.fillText(subtext, w / 2, h * 0.57);
  }
};

/**
 * Generate a short slide clip (solid colour background + text overlay) via canvas + FFmpeg.
 * Returns a blob URL of the resulting MP4 clip.
 *
 * Uses canvas to render the frame, then encodes to H.264 via FFmpeg's `-loop 1 -t N` trick.
 * This avoids dependency on FFmpeg's drawtext / fontconfig subsystems.
 */
export const generateSlideClip = async (
  config: SlideClipConfig,
  resolution: { w: number; h: number },
): Promise<Blob> => {
  const { w, h } = resolution;
  const { durationSec } = config;

  // ── 1. Render the frame on a canvas ──────────────────────────────────────
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;

  await drawSlideFrame(canvas, config);

  const frameBlob = await new Promise<Blob>((resolve) => {
    canvas.toBlob((b) => resolve(b!), 'image/png');
  });

  // ── 2. Encode to MP4 via FFmpeg ───────────────────────────────────────────
  const ffmpeg = await getFFmpeg();
  const frameData = new Uint8Array(await frameBlob.arrayBuffer());
  await ffmpeg.writeFile('slide_frame.png', frameData);

  await ffmpeg.exec([
    '-loop', '1',
    '-i', 'slide_frame.png',
    '-vf', `scale=${w}:${h}`,
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-pix_fmt', 'yuv420p',
    '-t', String(durationSec),
    '-an',
    '-y', 'slide_out.mp4',
  ]);

  const data = await ffmpeg.readFile('slide_out.mp4');
  try { await ffmpeg.deleteFile('slide_frame.png'); } catch {}
  try { await ffmpeg.deleteFile('slide_out.mp4'); } catch {}

  return new Blob([data as BlobPart], { type: 'video/mp4' });
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

  // Decide upfront whether the concat path will be used. When there are no
  // transitions and we have multiple scenes, we can skip a second re-encode by
  // having the captions pass write MPEG-TS directly (and remuxing non-captioned
  // clips with `-c copy`).
  const hasTransitions = scenes.some((s, i) => i > 0 && s.transition && s.transition !== 'none');
  const useTsForConcat = !hasTransitions && scenes.length > 1;
  const clipFiles: string[] = [];

  // Per-scene loop reserves 30..68 (38pp). Each scene reports sub-progress at
  // start (motion render), mid (caption burn), and end (TS remux) so the bar
  // doesn't sit still while a single scene is being encoded.
  const clipLoopBase = 30;
  const clipLoopRange = 38;
  const reportClip = (i: number, frac: number, stage: string) => {
    const base = clipLoopBase + (i / scenes.length) * clipLoopRange;
    const span = clipLoopRange / scenes.length;
    onProgress?.(stage, Math.min(clipLoopBase + clipLoopRange, Math.round(base + frac * span)));
  };

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const dur = scene.duration;
    const frames = Math.round(dur * 25);
    reportClip(i, 0, `씬 ${i + 1} 모션 렌더링 중...`);

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

    let currentClip = `clip_${i}.mp4`;
    const hasCaptions = !!(captionStyle && captionStyle.preset !== 'none'
      && scene.captionWords && scene.captionWords.length > 0);

    if (hasCaptions) {
      reportClip(i, 0.45, `씬 ${i + 1} 자막 합성 중...`);
      const cappedFile = useTsForConcat ? `ts_${i}.ts` : `clip_${i}_capped.mp4`;
      const ok = await applyCaptionsToClip(
        ffmpeg,
        currentClip,
        cappedFile,
        scene.captionWords!,
        dur,
        {
          style: captionStyle!,
          width: w,
          height: h,
          outputFormat: useTsForConcat ? 'mpegts' : 'mp4',
        }
      );
      if (ok) {
        try { await ffmpeg.deleteFile(currentClip); } catch {}
        currentClip = cappedFile;
      }
    }

    if (useTsForConcat && !currentClip.endsWith('.ts')) {
      reportClip(i, 0.8, `씬 ${i + 1} 인코딩 정리 중...`);
      // Captions pass didn't run or failed for this clip — remux to TS so the
      // final concat can stay `-c copy`.
      const tsFile = `ts_${i}.ts`;
      await ffmpeg.exec([
        '-i', currentClip,
        '-c', 'copy',
        '-bsf:v', 'h264_mp4toannexb',
        '-f', 'mpegts',
        '-y',
        tsFile,
      ]);
      try { await ffmpeg.deleteFile(currentClip); } catch {}
      currentClip = tsFile;
    }

    clipFiles.push(currentClip);
    reportClip(i, 1, `씬 ${i + 1} 완료`);
  }

  onProgress?.(hasTransitions && scenes.length > 1 ? '전환 효과 적용 중...' : '클립 합치는 중...', 72);

  let finalVideoFile: string;

  if (hasTransitions && scenes.length > 1) {
    try {
      const inputArgs: string[] = [];
      for (let i = 0; i < scenes.length; i++) {
        inputArgs.push('-i', clipFiles[i]);
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
      finalVideoFile = await concatClips(ffmpeg, clipFiles);
    }
  } else {
    finalVideoFile = await concatClips(ffmpeg, clipFiles);
  }

  for (const f of clipFiles) {
    try { await ffmpeg.deleteFile(f); } catch {}
  }

  onProgress?.('오디오 합성 중...', 84);

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

  onProgress?.('최종 파일 생성 중...', 94);

  const finalData = await ffmpeg.readFile(outputFile);
  try { await ffmpeg.deleteFile(outputFile); } catch {}

  onProgress?.('완료!', 100);

  return new Blob([finalData as BlobPart], { type: 'video/mp4' });
  } catch (err) {
    throw wrapFFmpegError(err);
  } finally {
    try { await sweepTempFiles(ffmpeg, scenes.length); } catch {}
  }
};

const concatClips = async (ffmpeg: FFmpeg, inputFiles: string[]): Promise<string> => {
  if (inputFiles.length === 1) {
    await ffmpeg.exec(['-i', inputFiles[0], '-c', 'copy', '-y', 'video_concat.mp4']);
    return 'video_concat.mp4';
  }

  // If callers already produced MPEG-TS parts (the fast path that avoids a
  // second libx264 pass), concat them with `-c copy`. Otherwise re-encode to TS.
  const allTs = inputFiles.every(f => f.endsWith('.ts'));
  const tsFiles: string[] = [];

  if (allTs) {
    tsFiles.push(...inputFiles);
  } else {
    for (let i = 0; i < inputFiles.length; i++) {
      const tsFile = `ts_${i}.ts`;
      await ffmpeg.exec([
        '-i', inputFiles[i],
        '-c:v', 'libx264', '-preset', 'ultrafast',
        '-c:a', 'aac', '-b:a', '128k',
        '-f', 'mpegts', '-y', tsFile,
      ]);
      tsFiles.push(tsFile);
    }
  }

  const concatStr = tsFiles.map(f => `file '${f}'`).join('\n');
  await ffmpeg.writeFile('vid_concat.txt', new TextEncoder().encode(concatStr));

  await ffmpeg.exec([
    '-f', 'concat', '-safe', '0', '-i', 'vid_concat.txt',
    '-c', 'copy', '-y', 'video_concat.mp4'
  ]);

  if (!allTs) {
    for (const f of tsFiles) {
      try { await ffmpeg.deleteFile(f); } catch {}
    }
  }
  try { await ffmpeg.deleteFile('vid_concat.txt'); } catch {}

  return 'video_concat.mp4';
};
