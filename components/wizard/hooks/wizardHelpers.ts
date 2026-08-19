import { Scene, CharacterReference, TransitionType, MotionPreset } from '../../../types';
import { uploadFileToCloud } from '../../../services/storageService';

export const CONCURRENCY = 3;

export const isMediaUploaded = (path?: string): boolean => !!path && path.startsWith('http');

export const hasMedia = (path?: string): boolean =>
  !!path && (path.startsWith('http') || path.startsWith('data:') || path.startsWith('blob:'));

/**
 * Preserve service-layer messages (including the friendly Gemini congestion
 * copy) before displaying them in the wizard. Some browser and SDK errors are
 * not Error instances, so extract their message defensively.
 */
export const getGenerationErrorMessage = (
  error: unknown,
  fallback: string = '오류'
): string => {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message.trim();
  }
  if (typeof error === 'string' && error.trim()) return error.trim();
  return fallback;
};

/**
 * Keep a batch summary concise while retaining the actual reason users need
 * before they decide whether to retry.
 */
export const summarizeGenerationErrors = (
  errors: unknown[],
  limit: number = 3
): string[] => {
  const messages = errors
    .map(error => getGenerationErrorMessage(error, ''))
    .filter(Boolean);
  return Array.from(new Set(messages)).slice(0, limit);
};

export const tryUploadExisting = async (
  path: string,
  storagePath: string,
  format: 'base64' | 'blob'
): Promise<string> => {
  if (path.startsWith('http')) return path;
  try {
    const url = await uploadFileToCloud(storagePath, path, format);
    return url;
  } catch {
    return path;
  }
};

export const runParallel = async <T,>(
  tasks: { idx: number; fn: () => Promise<T> }[],
  concurrency: number,
  onStart: (idx: number) => void,
  onDone: (idx: number, error?: any) => void
): Promise<{ idx: number; result?: T; error?: any }[]> => {
  const results: { idx: number; result?: T; error?: any }[] = [];
  let cursor = 0;
  const run = async (): Promise<void> => {
    while (cursor < tasks.length) {
      const task = tasks[cursor++];
      onStart(task.idx);
      let lastError: any = undefined;
      try {
        const result = await task.fn();
        results.push({ idx: task.idx, result });
      } catch (error) {
        lastError = error;
        results.push({ idx: task.idx, error });
      }
      onDone(task.idx, lastError);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, () => run()));
  return results;
};

export const buildReferenceImagesForScene = (
  characterReferences: CharacterReference[],
  s: Partial<Scene>
): { name?: string; description?: string; image: string }[] => {
  if (!characterReferences || characterReferences.length === 0) return [];
  const tagged = (s?.characters || []).filter(Boolean);
  const lower = new Set(tagged.map(t => t.toLowerCase()));
  const matched = characterReferences.filter(
    c => c && c.imageUrl && lower.has(c.name.toLowerCase())
  );
  return matched.map(c => ({ name: c.name, description: c.description, image: c.imageUrl }));
};

export const TRANSITION_OPTIONS: { value: TransitionType; label: string }[] = [
  { value: 'none', label: '없음' },
  { value: 'fade', label: '페이드' },
  { value: 'fadeblack', label: '페이드 (블랙)' },
  { value: 'fadewhite', label: '페이드 (화이트)' },
  { value: 'wipeleft', label: '와이프 ←' },
  { value: 'wiperight', label: '와이프 →' },
  { value: 'wipeup', label: '와이프 ↑' },
  { value: 'wipedown', label: '와이프 ↓' },
  { value: 'slideleft', label: '슬라이드 ←' },
  { value: 'slideright', label: '슬라이드 →' },
  { value: 'slideup', label: '슬라이드 ↑' },
  { value: 'slidedown', label: '슬라이드 ↓' },
  { value: 'circleopen', label: '서클 열기' },
  { value: 'circleclose', label: '서클 닫기' },
  { value: 'smoothleft', label: '스무스 ←' },
  { value: 'smoothright', label: '스무스 →' },
];

export const MOTION_OPTIONS: { value: MotionPreset; label: string }[] = [
  { value: 'none', label: '정지' },
  { value: 'zoom-in', label: '줌 인' },
  { value: 'zoom-out', label: '줌 아웃' },
  { value: 'pan-left', label: '팬 ←' },
  { value: 'pan-right', label: '팬 →' },
  { value: 'pan-up', label: '팬 ↑' },
  { value: 'pan-down', label: '팬 ↓' },
];
