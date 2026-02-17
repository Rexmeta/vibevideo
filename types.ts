
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
  scene_duration_mode?: 'time' | 'scenes';
  target_scene_count?: number;
  use_veo_audio?: boolean;
  video_mode?: VideoMode;
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
