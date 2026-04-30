
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

export type ViewState = 'landing' | 'projects' | 'create' | 'profile' | 'pricing' | 'login' | 'signup' | 'admin';

export interface WizardState {
  step: 1 | 2 | 3 | 4 | 5 | 6 | 7; // 1:Setup, 2:Script, 3:Audio, 4:Images, 5:Motion, 6:Assembly, 7:Export
  topic: string;
  duration: number;
  currentScript: string;
  scenes: Scene[];
  isGenerating: boolean;
}
