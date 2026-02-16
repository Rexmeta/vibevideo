import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';

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
}

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
  onProgress?: (stage: string, percent: number) => void
): Promise<Blob> => {
  const ffmpeg = await getFFmpeg();
  const validInputs = inputs.filter(i => i.videoUrl);

  if (validInputs.length === 0) throw new Error('병합할 비디오가 없습니다.');

  onProgress?.('준비 중...', 0);

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
};

export const isFFmpegSupported = (): boolean => {
  return typeof SharedArrayBuffer !== 'undefined' || typeof WebAssembly !== 'undefined';
};
