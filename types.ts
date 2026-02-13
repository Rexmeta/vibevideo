
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
  // Added updated_at property to fix Property 'updated_at' does not exist on type 'Project' errors
  updated_at?: string;
  thumbnail?: string;
  // Fields for Autosave/Resume functionality
  saved_step?: number;
  saved_max_step?: number;
  saved_script?: string;
  saved_scenes?: Scene[];
  saved_topic?: string;
  saved_duration?: number;
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

export type ViewState = 'landing' | 'projects' | 'create' | 'profile' | 'pricing' | 'login' | 'signup';

export interface WizardState {
  step: 1 | 2 | 3 | 4 | 5 | 6 | 7; // 1:Setup, 2:Script, 3:Audio, 4:Images, 5:Motion, 6:Assembly, 7:Export
  topic: string;
  duration: number;
  currentScript: string;
  scenes: Scene[];
  isGenerating: boolean;
}
