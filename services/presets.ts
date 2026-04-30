import type { GenreId, PlatformId } from '../types';

export interface GenrePreset {
  id: GenreId;
  label: string;
  description: string;
  // Structural framework: AIDA, PAS, 3-Act, day-in-life, hook+punchline
  structure: string;
  toneKeywords: string;
  // Strategy for the first 1.5–3 seconds
  hookStrategy: string;
  hasCTA: boolean;
  // System instruction snippet that the LLM should respect
  systemHint: string;
}

export const GENRES: GenrePreset[] = [
  {
    id: 'ad',
    label: '광고 / 프로모션',
    description: '제품·서비스 노출과 행동 유도가 목적',
    structure: 'AIDA (Attention → Interest → Desire → Action)',
    toneKeywords: 'punchy, confident, benefit-led',
    hookStrategy: '강력한 약속(Promise) 또는 페인 포인트 직격',
    hasCTA: true,
    systemHint:
      'Write a high-conversion ad script using AIDA. Lead with a benefit-driven promise. End with a single clear CTA.',
  },
  {
    id: 'explainer',
    label: '설명 / 튜토리얼',
    description: '개념·기능·과정을 명확하게 전달',
    structure: 'PAS (Problem → Agitate → Solve) + step-by-step',
    toneKeywords: 'clear, friendly, instructive',
    hookStrategy: '시청자가 검색했을 법한 질문으로 시작',
    hasCTA: false,
    systemHint:
      'Write a clear explainer script. Open with the exact question the viewer is asking. Break the answer into ordered, visualizable beats. No jargon.',
  },
  {
    id: 'story',
    label: '스토리 / 내러티브',
    description: '캐릭터·갈등·해소가 있는 짧은 이야기',
    structure: '3-Act (Setup → Confrontation → Resolution)',
    toneKeywords: 'cinematic, emotional, vivid',
    hookStrategy: '긴장된 한 장면 in medias res',
    hasCTA: false,
    systemHint:
      'Write a 3-act micro-story. Open mid-action. Establish a clear protagonist desire and an obstacle. Pay it off in the final beat.',
  },
  {
    id: 'vlog',
    label: '브이로그 / 일상',
    description: '자연스러운 일상 공유, 친근한 어조',
    structure: 'Day-in-the-life micro-arcs',
    toneKeywords: 'casual, personal, warm',
    hookStrategy: '오늘의 한 줄 요약 또는 호기심 자극 한마디',
    hasCTA: false,
    systemHint:
      'Write a casual vlog narration in first person. Open with a one-line tease of what today is about. Keep it conversational.',
  },
  {
    id: 'social-hook',
    label: '소셜 훅 (Shorts/Reels)',
    description: '15~30초 안에 끌어당기는 짧은 후크 영상',
    structure: 'Hook → Punchline',
    toneKeywords: 'bold, fast, surprising',
    hookStrategy: '충격적 통계 / 도발적 질문 / 카운터 인튜이티브 주장',
    hasCTA: true,
    systemHint:
      'Write an ultra-short social video script (under 30s). The first sentence MUST be a pattern-interrupt hook (shocking stat, bold claim, or contrarian question). End with a one-line punchline or CTA.',
  },
];

export interface PlatformPreset {
  id: PlatformId;
  label: string;
  aspectRatio: '16:9' | '9:16' | '1:1';
  recommendedDurationSec: number;
  hookIntensity: 'low' | 'medium' | 'high' | 'extreme';
  captionStyle: 'minimal' | 'bold' | 'word-by-word';
}

export const PLATFORMS: PlatformPreset[] = [
  {
    id: 'youtube-shorts',
    label: 'YouTube Shorts',
    aspectRatio: '9:16',
    recommendedDurationSec: 30,
    hookIntensity: 'high',
    captionStyle: 'bold',
  },
  {
    id: 'tiktok',
    label: 'TikTok',
    aspectRatio: '9:16',
    recommendedDurationSec: 24,
    hookIntensity: 'extreme',
    captionStyle: 'word-by-word',
  },
  {
    id: 'reels',
    label: 'Instagram Reels',
    aspectRatio: '9:16',
    recommendedDurationSec: 30,
    hookIntensity: 'extreme',
    captionStyle: 'word-by-word',
  },
  {
    id: 'youtube-16-9',
    label: 'YouTube 16:9',
    aspectRatio: '16:9',
    recommendedDurationSec: 60,
    hookIntensity: 'medium',
    captionStyle: 'minimal',
  },
  {
    id: 'instagram-1-1',
    label: 'Instagram 1:1',
    aspectRatio: '1:1',
    recommendedDurationSec: 30,
    hookIntensity: 'high',
    captionStyle: 'bold',
  },
];

export function getGenre(id?: GenreId): GenrePreset | undefined {
  if (!id) return undefined;
  return GENRES.find(g => g.id === id);
}

export function getPlatform(id?: PlatformId): PlatformPreset | undefined {
  if (!id) return undefined;
  return PLATFORMS.find(p => p.id === id);
}

export function applyPlatformDefaults(
  platformId: PlatformId | undefined,
): { aspectRatio?: '16:9' | '9:16' | '1:1'; duration?: number; targetSceneCount?: number } {
  const p = getPlatform(platformId);
  if (!p) return {};
  const sceneCount = Math.max(2, Math.round(p.recommendedDurationSec / 8));
  return {
    aspectRatio: p.aspectRatio,
    duration: p.recommendedDurationSec,
    targetSceneCount: sceneCount,
  };
}
