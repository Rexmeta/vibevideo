/**
 * Pure helpers for evaluating whether an in-browser FFmpeg.wasm export is
 * safe, risky, or outright over the limit for the user's device.
 *
 * The thresholds are intentionally collected in a single object so they
 * are easy to tune later. They reflect the practical 2GB WebAssembly
 * memory ceiling and the per-clip overhead that piles up with more
 * scenes, longer total runtime, captions, or higher resolutions.
 */

export type ExportRiskLevel = 'safe' | 'warn' | 'block';

export interface ExportRiskInput {
  totalDurationSec: number;
  sceneCount: number;
  resolution: { w: number; h: number };
  hasCaptions: boolean;
  isPresentationMode: boolean;
}

export interface ResolvedThresholds {
  warnDurationSec: number;
  blockDurationSec: number;
  warnScenes: number;
  blockScenes: number;
}

export interface DeviceProfile {
  isMobile: boolean;
  isLowMemory: boolean;
  deviceMemoryGB?: number;
}

export interface ExportRiskAssessment {
  level: ExportRiskLevel;
  reasons: string[];
  recommendations: string[];
  summary: string;
  thresholds: ResolvedThresholds;
  device: DeviceProfile;
}

export const DEFAULT_THRESHOLDS: ResolvedThresholds = {
  warnDurationSec: 90,
  blockDurationSec: 180,
  warnScenes: 12,
  blockScenes: 20,
};

export const THRESHOLD_OVERRIDES_STORAGE_KEY = 'ffmpegExportThresholdOverrides.v1';

export type ThresholdOverrides = Partial<ResolvedThresholds>;

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0;

const sanitizeOverrides = (raw: unknown): ThresholdOverrides => {
  if (!raw || typeof raw !== 'object') return {};
  const o = raw as Record<string, unknown>;
  const out: ThresholdOverrides = {};
  if (isFiniteNumber(o.warnDurationSec)) out.warnDurationSec = o.warnDurationSec;
  if (isFiniteNumber(o.blockDurationSec)) out.blockDurationSec = o.blockDurationSec;
  if (isFiniteNumber(o.warnScenes)) out.warnScenes = Math.round(o.warnScenes);
  if (isFiniteNumber(o.blockScenes)) out.blockScenes = Math.round(o.blockScenes);
  return out;
};

export const getUserThresholdOverrides = (): ThresholdOverrides => {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(THRESHOLD_OVERRIDES_STORAGE_KEY);
    if (!raw) return {};
    return sanitizeOverrides(JSON.parse(raw));
  } catch {
    return {};
  }
};

export const setUserThresholdOverrides = (overrides: ThresholdOverrides): ThresholdOverrides => {
  const clean = sanitizeOverrides(overrides);
  if (typeof localStorage !== 'undefined') {
    try {
      if (Object.keys(clean).length === 0) {
        localStorage.removeItem(THRESHOLD_OVERRIDES_STORAGE_KEY);
      } else {
        localStorage.setItem(THRESHOLD_OVERRIDES_STORAGE_KEY, JSON.stringify(clean));
      }
    } catch {
      /* ignore quota / disabled storage */
    }
  }
  return clean;
};

export const resetUserThresholdOverrides = (): void => {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(THRESHOLD_OVERRIDES_STORAGE_KEY);
  } catch {
    /* ignore */
  }
};

export const getEffectiveBaseThresholds = (): ResolvedThresholds => {
  const overrides = getUserThresholdOverrides();
  return {
    warnDurationSec: overrides.warnDurationSec ?? DEFAULT_THRESHOLDS.warnDurationSec,
    blockDurationSec: overrides.blockDurationSec ?? DEFAULT_THRESHOLDS.blockDurationSec,
    warnScenes: overrides.warnScenes ?? DEFAULT_THRESHOLDS.warnScenes,
    blockScenes: overrides.blockScenes ?? DEFAULT_THRESHOLDS.blockScenes,
  };
};

const PIXELS_720P = 1280 * 720;
const PIXELS_1080P = 1920 * 1080;

const detectDevice = (): DeviceProfile => {
  if (typeof navigator === 'undefined') {
    return { isMobile: false, isLowMemory: false };
  }
  const nav = navigator as Navigator & { deviceMemory?: number };
  const deviceMemoryGB = typeof nav.deviceMemory === 'number' ? nav.deviceMemory : undefined;
  const ua = nav.userAgent || '';
  const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(ua);
  const isLowMemory = typeof deviceMemoryGB === 'number' && deviceMemoryGB <= 4;
  return { isMobile, isLowMemory, deviceMemoryGB };
};

const resolveThresholds = (
  device: DeviceProfile,
  resolution: { w: number; h: number }
): ResolvedThresholds => {
  let scale = 1;
  if (device.isMobile || device.isLowMemory) scale *= 0.5;
  const px = Math.max(1, resolution.w * resolution.h);
  if (px >= PIXELS_1080P) scale *= 0.5;
  else if (px > PIXELS_720P) scale *= 0.75;
  const base = getEffectiveBaseThresholds();
  return {
    warnDurationSec: Math.max(20, base.warnDurationSec * scale),
    blockDurationSec: Math.max(40, base.blockDurationSec * scale),
    warnScenes: Math.max(3, Math.round(base.warnScenes * scale)),
    blockScenes: Math.max(5, Math.round(base.blockScenes * scale)),
  };
};

export const evaluateExportLimits = (input: ExportRiskInput): ExportRiskAssessment => {
  const device = detectDevice();
  const thresholds = resolveThresholds(device, input.resolution);

  let level: ExportRiskLevel = 'safe';
  const reasons: string[] = [];
  const recs = new Set<string>();

  const bump = (next: ExportRiskLevel) => {
    if (next === 'block') level = 'block';
    else if (next === 'warn' && level === 'safe') level = 'warn';
  };

  const dur = Math.max(0, input.totalDurationSec || 0);
  const scenes = Math.max(0, input.sceneCount || 0);

  if (dur >= thresholds.blockDurationSec) {
    bump('block');
    reasons.push(
      `총 길이 ${Math.round(dur)}초가 안전 한도(${Math.round(thresholds.blockDurationSec)}초)를 넘었습니다.`
    );
    recs.add('영상 길이를 줄이거나 두 개의 프로젝트로 나눠 내보내세요.');
  } else if (dur >= thresholds.warnDurationSec) {
    bump('warn');
    reasons.push(
      `총 길이 ${Math.round(dur)}초가 권장 길이(${Math.round(thresholds.warnDurationSec)}초)를 초과합니다.`
    );
    recs.add(`총 길이를 ${Math.round(thresholds.warnDurationSec)}초 이하로 맞추면 더 안정적입니다.`);
  }

  if (scenes >= thresholds.blockScenes) {
    bump('block');
    reasons.push(`씬 수 ${scenes}개가 안전 한도(${thresholds.blockScenes}개)를 넘었습니다.`);
    recs.add('씬을 합치거나 줄여 한 번에 내보내는 분량을 낮추세요.');
  } else if (scenes >= thresholds.warnScenes) {
    bump('warn');
    reasons.push(`씬 수 ${scenes}개가 권장(${thresholds.warnScenes}개)을 초과합니다.`);
    recs.add(`씬 수를 ${thresholds.warnScenes}개 이하로 줄이면 더 안정적입니다.`);
  }

  const px = input.resolution.w * input.resolution.h;
  if (px >= PIXELS_1080P && dur >= thresholds.warnDurationSec * 0.6) {
    bump('warn');
    reasons.push('해상도가 1080p 이상이라 같은 길이라도 메모리를 더 많이 씁니다.');
    recs.add('해상도(가로/세로)를 720p 수준으로 낮춰 보세요.');
  }

  if (input.hasCaptions && scenes >= Math.max(4, thresholds.warnScenes - 4)) {
    bump('warn');
    reasons.push('자막을 켠 상태에서 씬 수가 많아 처리할 프레임이 늘어납니다.');
    recs.add('자막을 일시적으로 끄거나 씬 수를 줄여 보세요.');
  }

  if (device.isMobile || device.isLowMemory) {
    recs.add('가능하면 데스크톱 브라우저(메모리 8GB 이상)에서 내보내기를 진행하세요.');
  }

  let summary: string;
  if (level === 'safe') {
    summary = '현재 설정으로 안전하게 내보낼 수 있습니다.';
  } else if (level === 'warn') {
    summary = '내보내기는 가능하지만, 브라우저 메모리 부담이 큽니다.';
  } else {
    summary = '브라우저 메모리 한계를 넘을 가능성이 높아 내보내기가 차단되었습니다.';
  }

  return {
    level,
    reasons,
    recommendations: Array.from(recs),
    summary,
    thresholds,
    device,
  };
};

export interface SafeChunkPlanInput {
  durations: number[];
  resolution: { w: number; h: number };
  hasCaptions: boolean;
  isPresentationMode: boolean;
}

export interface SafeChunkPlan {
  chunks: number[][];
  thresholds: ResolvedThresholds;
  needsSplit: boolean;
}

/**
 * Greedily group scene indices into chunks that each evaluate as 'safe'
 * under the same threshold policy as `evaluateExportLimits`. A scene that
 * by itself exceeds the safe limits is still placed alone in its own
 * chunk (best effort), so the caller can always make forward progress.
 */
export const planSafeExportChunks = (input: SafeChunkPlanInput): SafeChunkPlan => {
  const device = detectDevice();
  const thresholds = resolveThresholds(device, input.resolution);

  const evalChunk = (durations: number[]) =>
    evaluateExportLimits({
      totalDurationSec: durations.reduce((a, b) => a + b, 0),
      sceneCount: durations.length,
      resolution: input.resolution,
      hasCaptions: input.hasCaptions,
      isPresentationMode: input.isPresentationMode,
    });

  const chunks: number[][] = [];
  let current: number[] = [];
  let currentDur: number[] = [];

  for (let i = 0; i < input.durations.length; i++) {
    const d = Math.max(0, input.durations[i] || 0);
    const tentative = [...currentDur, d];
    const assess = evalChunk(tentative);
    if (assess.level === 'safe' || current.length === 0) {
      current.push(i);
      currentDur.push(d);
    } else {
      chunks.push(current);
      current = [i];
      currentDur = [d];
    }
  }
  if (current.length > 0) chunks.push(current);

  return {
    chunks,
    thresholds,
    needsSplit: chunks.length > 1,
  };
};

export const FRIENDLY_OOM_MESSAGE =
  '브라우저 메모리 한계로 영상 합치기에 실패했습니다. 씬 수나 총 길이를 줄이거나 해상도를 낮춰 다시 시도해 주세요.';

const MEMORY_ERROR_PATTERNS = [
  'out of memory',
  'memory access out of bounds',
  'cannot allocate',
  'allocation failed',
  'rangeerror',
  'wasm memory',
  'oom',
];

export const isMemoryRelatedError = (err: unknown): boolean => {
  const raw = err instanceof Error ? `${err.name} ${err.message}` : String(err ?? '');
  const m = raw.toLowerCase();
  return MEMORY_ERROR_PATTERNS.some((p) => m.includes(p));
};
