import type { Chapter, Scene } from '../types';

/**
 * Task #99 — Auto-group consecutive scenes into ~60-90s chapters ("parts").
 *
 * Pure helper. Given a sequence of scene durations and a target chapter
 * length, greedily pack scenes into chapters that try to land in the
 * [minDurationSec, maxDurationSec] window. Always emits at least one
 * chapter when there is at least one scene.
 *
 * Returned chapter ids are stable for a given (sceneCount, target) input
 * so the wizard can persist them and detect "still the same grouping"
 * cheaply on reload.
 */
export interface ChapterPlanOptions {
  targetDurationSec?: number;   // default 75
  minDurationSec?: number;      // default 60
  maxDurationSec?: number;      // default 90
}

const DEFAULT_TARGET = 75;
const DEFAULT_MIN = 60;
const DEFAULT_MAX = 90;

export const planChapters = (
  durations: number[],
  opts: ChapterPlanOptions = {}
): Chapter[] => {
  const target = opts.targetDurationSec ?? DEFAULT_TARGET;
  const min = opts.minDurationSec ?? DEFAULT_MIN;
  const max = opts.maxDurationSec ?? DEFAULT_MAX;

  if (!durations || durations.length === 0) return [];

  const chapters: Chapter[] = [];
  let currentIndices: number[] = [];
  let currentDur = 0;

  const flush = () => {
    if (currentIndices.length === 0) return;
    const idx = chapters.length;
    chapters.push({
      id: `ch_${String(idx + 1).padStart(2, '0')}`,
      title: `Part ${idx + 1}`,
      targetDurationSec: target,
      sceneIndices: currentIndices,
    });
    currentIndices = [];
    currentDur = 0;
  };

  for (let i = 0; i < durations.length; i++) {
    const d = Math.max(0, durations[i] || 0);
    // If adding this scene would push us past max AND we're already at/past
    // min, start a new chapter first.
    if (currentDur + d > max && currentDur >= min) flush();
    currentIndices.push(i);
    currentDur += d;
    // Aggressive flush once we cross target — keeps chapters near the
    // recommended length even when individual scenes are short.
    if (currentDur >= target && i < durations.length - 1) {
      // Lookahead: only flush if next scene would put us over max
      const next = Math.max(0, durations[i + 1] || 0);
      if (currentDur + next > max) flush();
    }
  }
  flush();
  return chapters;
};

/** Convenience: derive chapters straight from a Scene[] using audio_duration. */
export const planChaptersFromScenes = (
  scenes: Partial<Scene>[],
  fallbackPerSceneSec = 8,
  opts: ChapterPlanOptions = {}
): Chapter[] => {
  const durations = (scenes || []).map(
    s => s?.audio_duration || s?.durationSec || fallbackPerSceneSec
  );
  return planChapters(durations, opts);
};

/** Sum of durations across the given scene indices. */
export const sumChapterDuration = (
  chapter: Chapter,
  durations: number[]
): number =>
  chapter.sceneIndices.reduce(
    (acc, i) => acc + (durations[i] || 0),
    0
  );

/** Tag each scene with chapter_id in-place (returns a new array). */
export const assignSceneChapterIds = <T extends Partial<Scene>>(
  scenes: T[],
  chapters: Chapter[]
): T[] => {
  const map = new Map<number, string>();
  for (const c of chapters) for (const i of c.sceneIndices) map.set(i, c.id);
  return scenes.map((s, i) => {
    const cid = map.get(i);
    if (!cid) return s;
    return { ...s, chapter_id: cid };
  });
};

export const LONG_FORM_DURATION_THRESHOLD_SEC = 180;

/** Long-form mode is auto-enabled when planned duration crosses 3 minutes. */
export const isLongFormDuration = (durationSec: number): boolean =>
  (durationSec || 0) >= LONG_FORM_DURATION_THRESHOLD_SEC;
