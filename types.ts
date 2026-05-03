
// Data models based on PDF Section 4: Data Model Design

export enum ProjectStatus {
  DRAFT = 'draft',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed'
}

export interface User {
  id: string;
  email: string;
  credit_balance: number;
  name: string;
  avatar_url: string;
  tier: 'Free' | 'Pro' | 'Enterprise';
}

export type GenreId = 'ad' | 'explainer' | 'story' | 'vlog' | 'social-hook';
export type PlatformId = 'youtube-shorts' | 'tiktok' | 'reels' | 'youtube-16-9' | 'instagram-1-1';

export interface StyleSheet {
  palette: string[];
  lighting: string;
  mood: string;
  tone?: string;
  refImageUrl?: string;
}

export interface CharacterReference {
  name: string;
  description?: string;
  imageUrl: string;
}

export interface Project {
  id: string;
  user_id: string;
  title: string;
  aspect_ratio: '16:9' | '9:16' | '1:1' | '3:4';
  style_template: string;
  status: ProjectStatus;
  created_at: string;
  updated_at?: string;
  thumbnail?: string;
  saved_step?: number;
  saved_max_step?: number;
  saved_mode?: 'quick' | 'pro';
  saved_script?: string;
  saved_scenes?: Scene[];
  saved_topic?: string;
  saved_duration?: number;
  version?: number;
  scene_count?: number;
  total_duration?: number;
  selected_image_model?: string;
  selected_video_model?: string;
  character_profile?: string;
  use_reference_image?: boolean;
  character_reference_image?: string;
  character_references?: CharacterReference[];
  scene_duration_mode?: 'time' | 'scenes';
  target_scene_count?: number;
  use_veo_audio?: boolean;
  video_mode?: VideoMode;
  // Director Pipeline (Task #6)
  genre?: GenreId;
  platform?: PlatformId;
  style_sheet?: StyleSheet;
  vision_critic_enabled?: boolean;
  quality_threshold?: number;
  negative_prompt?: string;
  stats?: ProjectStats;
  caption_style?: CaptionStyle;
  // Multi-project parallel + context packs.
  // The id of the ContextPack this project inherits from (if any).
  linked_context_pack_id?: string;
  // Hash of the pack snapshot the project was last reconciled against.
  // When the linked pack is edited, this becomes stale and the wizard
  // surfaces a "팩 변경 후 미반영" badge with a one-click 적용 action.
  context_pack_version?: number;
  // True when the linked pack changed since this project last applied it.
  context_pack_dirty?: boolean;
  // Snapshot of the most recent video batch run, used to resume an
  // interrupted job (page reload, tab close mid-batch). When status is
  // 'interrupted' the project card / Studio dock shows "이어서 진행".
  generation_run?: GenerationRun;
  // Task #76: scenes are stored in a Firebase Storage JSON blob to keep
  // the Firestore doc small. When these are present, `saved_scenes` is
  // hydrated from the blob on read.
  scenes_blob_url?: string;
  scenes_blob_path?: string;
  scenes_blob_updated_at?: string;
  // Task #99: long-form (>180s) flag and auto-derived chapters used to
  // group ~60-90s of consecutive scenes for chapter-aware UX and
  // memory-safe multipart export.
  long_form_mode?: boolean;
  chapters?: Chapter[];
}

// Auto-derived grouping of consecutive scenes into ~60-90s "parts".
// Persisted on the project so Step 7 can show "Part 3/8 렌더 중" without
// re-deriving on every render. Source of truth is scene durations; the
// wizard regenerates this whenever the scene list changes.
export interface Chapter {
  id: string;
  title?: string;
  targetDurationSec: number;
  sceneIndices: number[];
}

// Snapshot of an in-flight or interrupted video batch generation. Persisted
// on the project document so a tab close mid-batch leaves a recoverable
// trail. Only the video stage is tracked — image / audio batches are short
// enough that resume is not needed.
export interface GenerationRun {
  id: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted' | 'long-wait';
  stage: 'video';
  startedAt: string;
  updatedAt: string;
  total: number;
  completed: number;
  failed: number;
  failedIndices?: number[];
  // Snapshot of the model the run was using, so a later resume picks up
  // the same provider/model rather than the project's current default.
  videoModelId?: string;
  videoProvider?: string;
  videoModelLabel?: string;
  // Task #83: in-flight Veo operations keyed by scene index. Persisted as
  // soon as `generateVideos` returns so a tab close mid-poll can be picked
  // up by the next session via `operations.getVideosOperation({ name })`.
  // Keys are zero-padded 2-digit scene indices (e.g. "00", "01") to avoid
  // Firestore numeric-key array coercion ambiguity.
  operations?: Record<string, OperationRecord>;
  // Scene indices that exceeded the 30-min poll budget and entered the
  // "long-wait" tracking state. Surfaced as a badge in the dock + Step 5.
  longWaitIndices?: number[];
  // Scene indices whose Veo download succeeded but Firebase Storage upload
  // is being retried by the durable upload queue.
  pendingUploadIndices?: number[];
}

// Veo long-running operation snapshot — persisted per scene so we can
// resume polling after a tab close. Includes the seed source actually used
// and an estimated USD cost so the wizard can surface a rich post-mortem.
export interface OperationRecord {
  name: string;            // operations/...
  sceneIdx?: number;
  modelId?: string;
  provider?: string;
  submittedAt: string;
  lastPolledAt?: string;
  attempts: number;
  status: 'pending' | 'long-wait' | 'done' | 'failed';
  seedSource?: SeedSource;
  seedAssetPath?: string;
  costUsd?: number;
  // Sticky flag set when this scene was picked up by a fresh session
  // (i.e. submitted before, polled after a reload). Surfaces "재개됨".
  resumed?: boolean;
  // Last error message from the most recent poll attempt (informational).
  lastPollError?: string;
}

// ContextPack: a reusable bundle of "creative context" (character
// profile, style sheet, model preferences, caption style, video config) that
// can be linked to multiple projects. Editing the pack offers to propagate
// changes; linked projects show a "팩에서 상속됨" badge on the affected fields.
export interface ContextPack {
  id: string;
  user_id: string;
  name: string;
  description?: string;
  created_at: string;
  updated_at: string;
  // Monotonically incremented on each save so projects can detect a stale
  // local snapshot (`Project.context_pack_version` !== `ContextPack.version`).
  version: number;
  // Inheritable fields — keep these aligned with Project's surface so the
  // "apply pack to project" action is a straightforward field copy.
  character_profile?: string;
  character_reference_image?: string;
  character_references?: CharacterReference[];
  style_sheet?: StyleSheet;
  video_style?: string;
  aspect_ratio?: '16:9' | '9:16' | '1:1' | '3:4';
  selected_image_model?: string;
  selected_video_model?: string;
  use_veo_audio?: boolean;
  caption_style?: CaptionStyle;
  video_mode?: VideoMode;
  negative_prompt?: string;
  vision_critic_enabled?: boolean;
  quality_threshold?: number;
  genre?: GenreId;
  platform?: PlatformId;
  // Cached count of projects currently linked to this pack — updated on
  // save / when a project links or unlinks. Used to size the "이 팩을
  // 사용하는 프로젝트 N개에 영향을 줍니다" warning at edit time.
  linked_project_count?: number;
}

export interface ProjectStats {
  imagesGenerated?: number;
  criticCalls?: number;
  refineCalls?: number;
  videosGenerated?: number;
}

export interface Script {
  id: string;
  project_id: string;
  content: string; // The full text
  created_at: string;
}

export type TransitionType = 'none' | 'fade' | 'fadeblack' | 'fadewhite' | 'wipeleft' | 'wiperight' | 'wipeup' | 'wipedown' | 'slideleft' | 'slideright' | 'slideup' | 'slidedown' | 'circleopen' | 'circleclose' | 'smoothleft' | 'smoothright';

export type MotionPreset = 'none' | 'zoom-in' | 'zoom-out' | 'pan-left' | 'pan-right' | 'pan-up' | 'pan-down';

export type TextPosition = 'top' | 'center' | 'bottom';

export interface TextOverlay {
  text: string;
  position: TextPosition;
  fontSize: number;
  color: string;
  backgroundColor: string;
}

export interface PresentationConfig {
  transition: TransitionType;
  transitionDuration: number;
  motion: MotionPreset;
  textOverlay?: TextOverlay;
}

export type VideoMode = 'ai' | 'presentation';

// Word-level caption (Submagic-style)
export interface CaptionWord {
  text: string;
  startMs: number;
  endMs: number;
  emoji?: string;
}

export type CaptionPreset = 'none' | 'clean' | 'bold' | 'hype';

export interface CaptionStyle {
  preset: CaptionPreset;
  emphasisColor: string;
  enableEmoji: boolean;
}

// Director Pipeline shotlist roles
export type ShotType = 'wide' | 'medium' | 'close-up' | 'extreme-close-up' | 'over-shoulder' | 'pov' | 'aerial' | 'establishing';
export type CameraMovement = 'static' | 'pan-left' | 'pan-right' | 'tilt-up' | 'tilt-down' | 'dolly-in' | 'dolly-out' | 'tracking' | 'handheld' | 'crane';
export type BeatRole = 'hook' | 'setup' | 'development' | 'payoff' | 'cta';

export type SeedSource = 'reference' | 'scene-image' | 'text-only';

export interface QualityScore {
  characterConsistency: number;
  compositionQuality: number;
  intentAlignment: number;
  overall: number;
  issues: string[];
  refined?: boolean;
}

export interface Scene {
  id: string;
  project_id: string;
  script_segment: string;
  visual_prompt?: string;
  start_time?: number;
  end_time?: number;
  image_path?: string;
  audio_path?: string;
  audio_duration?: number;
  video_path?: string;
  audio_script?: string;
  scene_number?: number;
  presentation?: PresentationConfig;
  // Director Pipeline shot list fields
  shotType?: ShotType;
  cameraMovement?: CameraMovement;
  lighting?: string;
  durationSec?: number;
  beatRole?: BeatRole;
  transitionTo?: TransitionType;
  negativePrompt?: string;
  qualityScore?: QualityScore;
  qualityNotes?: string;
  captionWords?: CaptionWord[];
  characters?: string[]; // names of characters from project.character_references that appear in this scene
  // Task #99: id of the chapter this scene belongs to, when long_form_mode
  // is on. Optional/back-compat: short-form projects leave this undefined.
  chapter_id?: string;
  // Records the seed source that was actually used by the last video
  // generation (could downgrade to 'text-only' if image-based generation
  // failed and we fell back). Surfaced as a badge on the Step 5 card.
  seedSource?: SeedSource;
  // User preference (Task #27) for which seed to feed Veo on the next
  // generation. 'scene-image' (default) prefers the per-scene image and
  // falls back to the project-level character reference when absent.
  // 'reference' forces the character reference even if a scene image
  // exists. 'text-only' suppresses any seed image.
  videoSeedPreference?: SeedSource;
  // Names of cast that were actually passed into the video model on the last
  // generation. Mirrors `characters` in normal cases but persists what the
  // model was actually told (e.g. the AI may strip a name from `characters`
  // later via re-segmentation). Empty array means "no named cast passed".
  videoCast?: string[];
  // True if the named cast was attached to the video model as actual reference
  // images (multi-image-capable model). False means cast was surfaced only as
  // text in the prompt — current Veo path is always text-only.
  videoCastAttached?: boolean;
  // Snapshot of the user's `videoSeedPreference` at the time of the last
  // successful video generation. Used to detect when the per-scene seed-source
  // toggle has been changed since rendering and surface an inline
  // "applies on next regeneration" hint. Legacy scenes without this field
  // suppress the hint to avoid false positives.
  videoSeedPreferenceUsed?: SeedSource;
  // Task #83: rich, durable metadata about the most recent Veo run for
  // this scene. Persisted alongside `video_path` so the wizard can show
  // model/seed/cost/operation post-facto and so retries know what was
  // actually used. `uploadStatus` is the only field that may flip after
  // initial generation (when the durable upload queue eventually succeeds
  // or gives up).
  video_meta?: VideoMeta;
}

export type VideoUploadStatus = 'ok' | 'pending-upload' | 'upload-failed';

export interface VideoMeta {
  modelId?: string;
  modelLabel?: string;
  provider?: string;
  aspectRatio?: '16:9' | '9:16' | '1:1' | '3:4';
  videoCast?: string[];
  videoCastAttached?: boolean;
  generationDurationMs?: number;
  seedSource?: SeedSource;
  // Best-effort URL/path of the asset used as the seed image (so users can
  // trace which image actually drove this clip). Empty for text-only.
  seedAssetPath?: string;
  // Veo long-running operation name. Useful for support / debugging and
  // for re-attaching to the operation if upload later needs to recover.
  operationName?: string;
  // Estimated USD cost of this clip (per `services/pricing.ts`).
  costUsd?: number;
  generatedAt?: string;
  // Number of poll attempts the operation took before completing.
  pollAttempts?: number;
  // Number of upload attempts (incl. successful one). 0 means uploaded on
  // the first try; >1 means the durable queue had to retry.
  uploadAttempts?: number;
  uploadStatus?: VideoUploadStatus;
  // Epoch-ms at which the durable upload queue will retry next. Mirrored
  // into Firestore on every failed attempt so other devices/sessions can
  // surface "업로드 재시도 중" without an in-memory queue.
  uploadNextAttemptAt?: number;
  uploadLastError?: string;
  // True if this scene was completed by a session different from the one
  // that submitted the operation (i.e. the user closed the tab and came
  // back). Surfaces a "재개됨" badge.
  resumed?: boolean;
  // True if the run hit the 30-min poll budget. After this, the upload
  // queue keeps tracking but the UI surfaces "장시간 대기".
  longWait?: boolean;
}

export type ModelType = 'image' | 'video' | 'audio';

export interface AIModel {
  id: string;
  name: string;
  type: ModelType;
  provider: string;
  description: string;
  modelId: string;
  isActive: boolean;
  sortOrder: number;
  supportsKorean: boolean;
  iconUrl?: string;
  apiEndpoint?: string;
  requiresApiKey?: boolean;
  apiKeyConfigured?: boolean;
  defaultParams?: Record<string, any>;
  created_at?: string;
  updated_at?: string;
}

export type ViewState = 'landing' | 'projects' | 'create' | 'profile' | 'pricing' | 'login' | 'signup' | 'admin' | 'api-keys';

export interface WizardState {
  step: 1 | 2 | 3 | 4 | 5 | 6 | 7; // 1:Setup, 2:Script, 3:Audio, 4:Images, 5:Motion, 6:Assembly, 7:Export
  topic: string;
  duration: number;
  currentScript: string;
  scenes: Scene[];
  isGenerating: boolean;
}
