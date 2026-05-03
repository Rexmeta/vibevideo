import { Project, Scene, ProjectStatus, CaptionWord } from '../types';
import { DEFAULT_CAPTION_STYLE } from './captionService';

export const SAMPLE_PROJECT_ID = 'sample-demo-vibe-2024';

export const isSampleProjectId = (id?: string | null): boolean =>
  id === SAMPLE_PROJECT_ID;

const svgImage = (label: string, bg1: string, bg2: string, accent: string): string => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" preserveAspectRatio="xMidYMid slice">
<defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
<stop offset="0%" stop-color="${bg1}"/><stop offset="100%" stop-color="${bg2}"/>
</linearGradient></defs>
<rect width="1280" height="720" fill="url(#g)"/>
<circle cx="980" cy="180" r="140" fill="${accent}" opacity="0.35"/>
<circle cx="220" cy="560" r="200" fill="${accent}" opacity="0.25"/>
<rect x="80" y="320" width="900" height="14" rx="7" fill="white" opacity="0.18"/>
<rect x="80" y="360" width="660" height="14" rx="7" fill="white" opacity="0.12"/>
<text x="640" y="430" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="72" font-weight="900" fill="white">${label}</text>
</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

const buildCaptionWords = (text: string, totalMs: number): CaptionWord[] => {
  const tokens = text.trim().split(/\s+/);
  if (tokens.length === 0) return [];
  const per = Math.max(180, Math.floor(totalMs / tokens.length));
  return tokens.map((t, i) => ({
    text: t,
    startMs: i * per,
    endMs: Math.min(totalMs, (i + 1) * per),
  }));
};

/**
 * Builds an in-memory sample project that lands the user directly on
 * Step 6 (Preview). No network calls, no cloud writes — the WizardProvider
 * detects the sample id, seeds state from this and disables sync.
 */
export const buildSampleProject = (userId: string): Project => {
  const now = new Date().toISOString();
  const scene1Script = '아침 햇살을 머금은 도쿄 거리. 작은 카페가 문을 엽니다.';
  const scene2Script = '바리스타가 정성껏 라떼 아트를 그리며 하루를 시작합니다.';

  const scenes: Scene[] = [
    {
      id: 'sample-scene-1',
      project_id: SAMPLE_PROJECT_ID,
      scene_number: 1,
      script_segment: scene1Script,
      audio_script: scene1Script,
      visual_prompt: 'A quiet Tokyo morning street with a small cafe opening, warm sunlight, cinematic',
      durationSec: 8,
      image_path: svgImage('Scene 1', '#FFB088', '#FF6B6B', '#FFE066'),
      captionWords: buildCaptionWords(scene1Script, 8000),
      presentation: {
        transition: 'fade',
        transitionDuration: 0.6,
        motion: 'zoom-in',
      },
    },
    {
      id: 'sample-scene-2',
      project_id: SAMPLE_PROJECT_ID,
      scene_number: 2,
      script_segment: scene2Script,
      audio_script: scene2Script,
      visual_prompt: 'A barista pouring latte art in a cozy cafe, close-up, warm light, cinematic',
      durationSec: 8,
      image_path: svgImage('Scene 2', '#7AC1FF', '#5B5BFF', '#A8FF60'),
      captionWords: buildCaptionWords(scene2Script, 8000),
      presentation: {
        transition: 'fade',
        transitionDuration: 0.6,
        motion: 'pan-right',
      },
    },
  ];

  return {
    id: SAMPLE_PROJECT_ID,
    user_id: userId || 'sample',
    title: '[샘플] 도쿄 카페의 아침',
    aspect_ratio: '16:9',
    style_template: 'Realistic Cinematic',
    status: ProjectStatus.COMPLETED,
    created_at: now,
    updated_at: now,
    saved_step: 6,
    saved_max_step: 7,
    saved_mode: 'pro',
    saved_topic: '도쿄 카페의 따뜻한 아침',
    saved_duration: 16,
    saved_script: `${scene1Script}\n\n${scene2Script}`,
    saved_scenes: scenes,
    target_scene_count: 2,
    use_veo_audio: true,
    video_mode: 'presentation',
    vision_critic_enabled: false,
    caption_style: DEFAULT_CAPTION_STYLE,
    thumbnail: scenes[0].image_path,
    scene_count: scenes.length,
    total_duration: 16,
    stats: {
      imagesGenerated: 2,
      criticCalls: 0,
      refineCalls: 0,
      videosGenerated: 0,
    },
  };
};
