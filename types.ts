
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
}

export interface Script {
  id: string;
  project_id: string;
  content: string; // The full text
  created_at: string;
}

export interface Scene {
  id: string;
  project_id: string;
  script_segment: string; // The text for this specific scene
  visual_prompt?: string; // Prompt for image generation
  start_time?: number;
  end_time?: number;
  image_path?: string; // base64 encoded string or URL
  audio_path?: string; // base64 encoded audio
  audio_duration?: number; // duration in seconds
  video_path?: string; // URL to generated video clip
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
