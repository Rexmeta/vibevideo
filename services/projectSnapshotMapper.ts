import {
  Project,
  ProjectSnapshot,
  ProjectStatus,
  Scene,
  SceneSnapshot,
} from '../types';

type JsonObject = Record<string, unknown>;

export interface SnapshotValidationIssue {
  path: string;
  message: string;
}

export type SnapshotParseResult =
  | { success: true; data: ProjectSnapshot; issues: SnapshotValidationIssue[] }
  | { success: false; issues: SnapshotValidationIssue[] };

const isObject = (value: unknown): value is JsonObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const stringValue = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

const finiteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const booleanValue = (value: unknown): boolean | undefined =>
  typeof value === 'boolean' ? value : undefined;

const PROJECT_STATUSES = new Set<string>(Object.values(ProjectStatus));
const ASPECT_RATIOS = new Set(['16:9', '9:16', '1:1', '3:4']);
const VIDEO_MODES = new Set(['ai', 'presentation']);
const SAVED_MODES = new Set(['quick', 'pro']);
const RUN_STATUSES = new Set(['running', 'completed', 'failed', 'cancelled', 'interrupted', 'long-wait']);

const fieldPath = (path: string, key: string): string => path ? `${path}.${key}` : key;

const validateOptionalString = (
  obj: JsonObject,
  key: string,
  path: string,
  issues: SnapshotValidationIssue[],
): void => {
  const value = obj[key];
  // Null is a valid legacy persistence value and must survive round-trip.
  if (value === undefined || value === null || typeof value === 'string') return;
  issues.push({ path: fieldPath(path, key), message: 'invalid string ignored' });
  delete obj[key];
};

const validateOptionalObject = (
  obj: JsonObject,
  key: string,
  path: string,
  issues: SnapshotValidationIssue[],
): void => {
  const value = obj[key];
  if (value === undefined || value === null || isObject(value)) return;
  issues.push({ path: fieldPath(path, key), message: 'invalid object ignored' });
  delete obj[key];
};

const validateOptionalStringArray = (
  obj: JsonObject,
  key: string,
  path: string,
  issues: SnapshotValidationIssue[],
): void => {
  const value = obj[key];
  if (value === undefined || value === null) return;
  if (Array.isArray(value) && value.every(item => typeof item === 'string')) return;
  issues.push({ path: fieldPath(path, key), message: 'invalid string array ignored' });
  delete obj[key];
};

const cleanObjectPrimitives = (
  obj: JsonObject,
  path: string,
  strings: string[],
  numbers: string[],
  booleans: string[],
  issues: SnapshotValidationIssue[],
): void => {
  strings.forEach(key => validateOptionalString(obj, key, path, issues));
  for (const key of numbers) {
    if (obj[key] !== undefined && obj[key] !== null && finiteNumber(obj[key]) === undefined) {
      issues.push({ path: fieldPath(path, key), message: 'invalid number ignored' });
      delete obj[key];
    }
  }
  for (const key of booleans) {
    if (obj[key] !== undefined && obj[key] !== null && booleanValue(obj[key]) === undefined) {
      issues.push({ path: fieldPath(path, key), message: 'invalid boolean ignored' });
      delete obj[key];
    }
  }
};

const normalizeCaptionWords = (
  value: unknown,
  path: string,
  issues: SnapshotValidationIssue[],
): unknown => {
  if (value === undefined || value === null) return value;
  if (!Array.isArray(value)) {
    issues.push({ path, message: 'invalid array ignored' });
    return undefined;
  }
  return value.filter((word, index) => {
    const valid = isObject(word) &&
      typeof word.text === 'string' &&
      finiteNumber(word.startMs) !== undefined &&
      finiteNumber(word.endMs) !== undefined &&
      (word.emoji === undefined || word.emoji === null || typeof word.emoji === 'string');
    if (!valid) issues.push({ path: `${path}[${index}]`, message: 'invalid caption word ignored' });
    return valid;
  });
};

const normalizeNestedProjectFields = (
  project: JsonObject,
  issues: SnapshotValidationIssue[],
): void => {
  if (isObject(project.caption_style)) {
    cleanObjectPrimitives(
      project.caption_style, 'caption_style',
      ['preset', 'emphasisColor'], [], ['enableEmoji'], issues,
    );
  }
  if (isObject(project.generation_run)) {
    const run = project.generation_run;
    cleanObjectPrimitives(
      run, 'generation_run',
      ['id', 'status', 'stage', 'startedAt', 'updatedAt', 'videoModelId', 'videoProvider', 'videoModelLabel'],
      ['total', 'completed', 'failed'], [], issues,
    );
    const validRequired =
      typeof run.id === 'string' &&
      RUN_STATUSES.has(String(run.status)) &&
      run.stage === 'video' &&
      typeof run.startedAt === 'string' &&
      typeof run.updatedAt === 'string' &&
      finiteNumber(run.total) !== undefined &&
      finiteNumber(run.completed) !== undefined &&
      finiteNumber(run.failed) !== undefined;
    if (!validRequired) {
      issues.push({ path: 'generation_run', message: 'invalid generation run ignored' });
      delete project.generation_run;
    } else {
      validateOptionalObject(run, 'operations', 'generation_run', issues);
      for (const key of ['failedIndices', 'longWaitIndices', 'pendingUploadIndices']) {
        const value = run[key];
        if (value !== undefined && value !== null &&
          (!Array.isArray(value) || !value.every(item => finiteNumber(item) !== undefined))) {
          issues.push({ path: `generation_run.${key}`, message: 'invalid number array ignored' });
          delete run[key];
        }
      }
    }
  }
};

const normalizeScene = (
  raw: unknown,
  projectId: string,
  index: number,
  usedIds: Set<string>,
  issues: SnapshotValidationIssue[],
): SceneSnapshot | null => {
  if (!isObject(raw)) {
    issues.push({ path: `saved_scenes[${index}]`, message: 'scene must be an object' });
    return null;
  }

  const scene = { ...raw } as JsonObject;
  const legacyNumber = finiteNumber(scene.scene_number);
  const order = index;
  const requestedId = stringValue(scene.id);
  let id = requestedId || `${projectId}-scene-${index + 1}`;
  if (usedIds.has(id)) {
    id = `${projectId}-scene-${index + 1}`;
    let suffix = 2;
    while (usedIds.has(id)) id = `${projectId}-scene-${index + 1}-${suffix++}`;
    issues.push({ path: `saved_scenes[${index}].id`, message: 'duplicate scene id replaced' });
  }
  usedIds.add(id);
  scene.id = id;
  scene.project_id = stringValue(scene.project_id) || projectId;
  scene.script_segment =
    stringValue(scene.script_segment) || stringValue(scene.audio_script) || '';
  scene.scene_number = legacyNumber ?? index + 1;

  for (const key of [
    'visual_prompt', 'image_path', 'audio_path', 'video_path', 'audio_script',
    'chapter_id', 'remix_original_script', 'visual_prompt_original',
    'script_segment_original',
  ]) validateOptionalString(scene, key, `saved_scenes[${index}]`, issues);

  for (const key of ['start_time', 'end_time', 'audio_duration', 'durationSec']) {
    if (scene[key] !== undefined && finiteNumber(scene[key]) === undefined) {
      issues.push({ path: `saved_scenes[${index}].${key}`, message: 'invalid number ignored' });
      delete scene[key];
    }
  }

  for (const key of ['hidden', 'promptChanged', 'videoCastAttached']) {
    if (scene[key] !== undefined && booleanValue(scene[key]) === undefined) {
      issues.push({ path: `saved_scenes[${index}].${key}`, message: 'invalid boolean ignored' });
      delete scene[key];
    }
  }
  for (const key of ['characters', 'videoCast']) {
    validateOptionalStringArray(scene, key, `saved_scenes[${index}]`, issues);
  }
  scene.captionWords = normalizeCaptionWords(
    scene.captionWords,
    `saved_scenes[${index}].captionWords`,
    issues,
  );
  for (const key of ['presentation', 'qualityScore', 'video_meta']) {
    validateOptionalObject(scene, key, `saved_scenes[${index}]`, issues);
  }
  if (isObject(scene.presentation)) {
    cleanObjectPrimitives(
      scene.presentation, `saved_scenes[${index}].presentation`,
      ['transition', 'motion'], ['transitionDuration'], [], issues,
    );
    validateOptionalObject(
      scene.presentation, 'textOverlay', `saved_scenes[${index}].presentation`, issues,
    );
  }
  if (isObject(scene.video_meta)) {
    cleanObjectPrimitives(
      scene.video_meta, `saved_scenes[${index}].video_meta`,
      [
        'modelId', 'modelLabel', 'provider', 'aspectRatio', 'seedSource',
        'seedAssetPath', 'operationName', 'generatedAt', 'uploadStatus',
        'uploadLastError',
      ],
      [
        'generationDurationMs', 'costUsd', 'pollAttempts', 'uploadAttempts',
        'uploadNextAttemptAt',
      ],
      ['videoCastAttached', 'resumed', 'longWait'],
      issues,
    );
    validateOptionalStringArray(
      scene.video_meta, 'videoCast', `saved_scenes[${index}].video_meta`, issues,
    );
  }

  scene.order = order;
  return scene as unknown as SceneSnapshot;
};

/**
 * Validates and converts any legacy persistence value into the canonical
 * domain snapshot. Invalid optional values are ignored and reported; invalid
 * identity fields reject the document.
 */
export const parseLegacyProjectSnapshot = (input: unknown): SnapshotParseResult => {
  const issues: SnapshotValidationIssue[] = [];
  if (!isObject(input)) {
    return { success: false, issues: [{ path: '', message: 'project must be an object' }] };
  }

  const raw = { ...input } as JsonObject;
  const id = stringValue(raw.id);
  if (!id) issues.push({ path: 'id', message: 'project id is required' });
  const userId = stringValue(raw.user_id);
  if (!userId) issues.push({ path: 'user_id', message: 'user id is required' });
  if (!id || !userId) return { success: false, issues };

  const project = { ...raw } as JsonObject;
  project.id = id;
  project.user_id = userId;
  project.title = stringValue(raw.title) || '새 비디오 프로젝트';
  project.aspect_ratio = ASPECT_RATIOS.has(String(raw.aspect_ratio))
    ? raw.aspect_ratio
    : '16:9';
  project.style_template = stringValue(raw.style_template) || 'Cute Stickman';
  project.status = PROJECT_STATUSES.has(String(raw.status))
    ? raw.status
    : ProjectStatus.DRAFT;
  project.created_at = stringValue(raw.created_at) || stringValue(raw.updated_at) || new Date(0).toISOString();

  if (raw.saved_mode !== undefined && !SAVED_MODES.has(String(raw.saved_mode))) delete project.saved_mode;
  if (raw.video_mode !== undefined && !VIDEO_MODES.has(String(raw.video_mode))) delete project.video_mode;
  for (const key of [
    'thumbnail', 'updated_at', 'saved_script', 'saved_topic',
    'selected_image_model', 'selected_video_model', 'selected_text_model',
    'character_profile', 'character_reference_image',
  ]) validateOptionalString(project, key, '', issues);
  for (const key of [
    'style_sheet', 'stats', 'caption_style', 'generation_run', 'creative_brief',
    'remix_source', 'background_replacements',
  ]) validateOptionalObject(project, key, '', issues);
  normalizeNestedProjectFields(project, issues);
  if (
    project.character_references !== undefined &&
    project.character_references !== null &&
    !Array.isArray(project.character_references)
  ) {
    issues.push({ path: 'character_references', message: 'invalid array ignored' });
    delete project.character_references;
  }

  const sceneCollectionState =
    raw.saved_scenes === undefined ? 'omitted'
      : raw.saved_scenes === null ? 'null'
        : 'array';
  const rawScenes = Array.isArray(raw.saved_scenes) ? raw.saved_scenes : [];
  if (sceneCollectionState === 'array' && !Array.isArray(raw.saved_scenes)) {
    issues.push({ path: 'saved_scenes', message: 'invalid scene collection ignored' });
  }
  delete project.saved_scenes;
  delete project.saved_scenes_map;

  const usedIds = new Set<string>();
  const scenes = rawScenes
    .map((scene, index) => normalizeScene(scene, id, index, usedIds, issues))
    .filter((scene): scene is SceneSnapshot => scene !== null)
    .map((scene, order) => ({ ...scene, order }));

  return {
    success: true,
    data: {
      schemaVersion: 1,
      project: project as unknown as Omit<Project, 'saved_scenes'>,
      scenes,
      sceneCollectionState,
    },
    issues,
  };
};

export const legacyProjectToSnapshot = (input: unknown): ProjectSnapshot => {
  const parsed = parseLegacyProjectSnapshot(input);
  if (!parsed.success) {
    throw new Error(`Invalid project DTO: ${parsed.issues.map(i => `${i.path}: ${i.message}`).join(', ')}`);
  }
  return parsed.data;
};

/** Converts a canonical snapshot back to the existing persistence DTO shape. */
export const snapshotToLegacyProject = (snapshot: ProjectSnapshot): Project => {
  const project = { ...snapshot.project } as Project & { saved_scenes?: Scene[] | null };
  if (snapshot.sceneCollectionState === 'null') {
    project.saved_scenes = null;
  } else if (snapshot.sceneCollectionState === 'array') {
    project.saved_scenes = snapshot.scenes.map(scene => {
    const { order: _order, ...legacy } = scene;
    return legacy as Scene;
    });
  }
  return project as Project;
};

/** Convenience seam for existing callers that still consume `Project`. */
export const normalizeLegacyProject = (input: unknown): Project =>
  snapshotToLegacyProject(legacyProjectToSnapshot(input));

export const areProjectDtosEquivalent = (left: unknown, right: unknown): boolean => {
  try {
    return JSON.stringify(normalizeLegacyProject(left)) === JSON.stringify(normalizeLegacyProject(right));
  } catch {
    return false;
  }
};