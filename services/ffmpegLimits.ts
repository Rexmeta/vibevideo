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

const BASE_THRESHOLDS: ResolvedThresholds = {
  warnDurationSec: 90,
  blockDurationSec: 180,
  warnScenes: 12,
  blockScenes: 20,
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
  return {
    warnDurationSec: Math.max(20, BASE_THRESHOLDS.warnDurationSec * scale),
    blockDurationSec: Math.max(40, BASE_THRESHOLDS.blockDurationSec * scale),
    warnScenes: Math.max(3, Math.round(BASE_THRESHOLDS.warnScenes * scale)),
    blockScenes: Math.max(5, Math.round(BASE_THRESHOLDS.blockScenes * scale)),
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
