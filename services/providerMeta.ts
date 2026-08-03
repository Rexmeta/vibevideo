/**
 * Provider metadata for the Model Hub.
 * Defines display names, colours, descriptions, docs URLs, and coming-soon flags
 * for each AI provider surfaced in the hub UX.
 */

export interface ProviderMeta {
  /** Canonical provider key — must match AIModel.provider */
  key: string;
  /** Human-readable display name */
  displayName: string;
  /** Short tagline shown on the card */
  tagline: string;
  /** Tailwind background colour class for the avatar */
  avatarBg: string;
  /** Tailwind text colour class for the avatar letter */
  avatarText: string;
  /** Documentation / API key URL */
  docsUrl: string;
  /** When true the provider has no models yet — shown as "곧 지원 예정" */
  comingSoon?: boolean;
}

export const PROVIDER_META: ProviderMeta[] = [
  {
    key: 'NanoBanana',
    displayName: 'NanoBanana (Google)',
    tagline: 'Google Gemini & Imagen 기반 통합 모델',
    avatarBg: 'bg-yellow-100',
    avatarText: 'text-yellow-700',
    docsUrl: 'https://aistudio.google.com/apikey',
  },
  {
    key: 'Google',
    displayName: 'Google',
    tagline: 'Gemini, Imagen, Veo 공식 모델',
    avatarBg: 'bg-blue-100',
    avatarText: 'text-blue-700',
    docsUrl: 'https://aistudio.google.com/apikey',
  },
  {
    key: 'OpenAI',
    displayName: 'OpenAI',
    tagline: 'GPT-4o, DALL-E, Sora 등 범용 AI',
    avatarBg: 'bg-green-100',
    avatarText: 'text-green-700',
    docsUrl: 'https://platform.openai.com/api-keys',
  },
  {
    key: 'ByteDance',
    displayName: 'ByteDance (Seedance)',
    tagline: 'Seedance / Seedream 영상·이미지 모델',
    avatarBg: 'bg-red-100',
    avatarText: 'text-red-700',
    docsUrl: 'https://www.volcengine.com/',
  },
  {
    key: 'Kuaishou',
    displayName: 'Kuaishou (Kling)',
    tagline: 'Kling 멀티샷·오디오 동기화 비디오 모델',
    avatarBg: 'bg-purple-100',
    avatarText: 'text-purple-700',
    docsUrl: 'https://klingai.com/',
  },
  {
    key: 'Minimax',
    displayName: 'Minimax (Hailuo)',
    tagline: 'Hailuo 물리 시뮬레이션 영상 모델',
    avatarBg: 'bg-indigo-100',
    avatarText: 'text-indigo-700',
    docsUrl: 'https://www.minimaxi.com/',
  },
  {
    key: 'Alibaba',
    displayName: 'Alibaba',
    tagline: 'Qwen, Wan — 이미지·영상 생성 모델',
    avatarBg: 'bg-orange-100',
    avatarText: 'text-orange-700',
    docsUrl: 'https://www.aliyun.com/',
  },
  {
    key: 'Midjourney',
    displayName: 'Midjourney',
    tagline: '예술적 이미지·영상 생성 AI',
    avatarBg: 'bg-pink-100',
    avatarText: 'text-pink-700',
    docsUrl: 'https://docs.midjourney.com/',
  },
  {
    key: 'xAI',
    displayName: 'xAI (Grok)',
    tagline: 'Grok 기반 이미지 생성 모델',
    avatarBg: 'bg-gray-100',
    avatarText: 'text-gray-700',
    docsUrl: 'https://x.ai/api',
  },
  {
    key: 'Black Forest Labs',
    displayName: 'Black Forest Labs',
    tagline: 'Flux 2 — 초고속 실사 이미지 생성',
    avatarBg: 'bg-slate-100',
    avatarText: 'text-slate-700',
    docsUrl: 'https://blackforestlabs.ai/',
  },
  {
    key: 'Ideogram',
    displayName: 'Ideogram',
    tagline: '텍스트 렌더링 특화 이미지 AI',
    avatarBg: 'bg-teal-100',
    avatarText: 'text-teal-700',
    docsUrl: 'https://ideogram.ai/',
  },
  {
    key: 'Vidu',
    displayName: 'Vidu',
    tagline: '멀티샷 컷전환 고성능 비디오 모델',
    avatarBg: 'bg-cyan-100',
    avatarText: 'text-cyan-700',
    docsUrl: 'https://www.vidu.io/',
  },
  {
    key: 'Anthropic',
    displayName: 'Anthropic',
    tagline: 'Claude — 고성능 텍스트/추론 AI',
    avatarBg: 'bg-amber-100',
    avatarText: 'text-amber-700',
    docsUrl: 'https://console.anthropic.com/settings/keys',
    comingSoon: true,
  },
  {
    key: 'Replicate',
    displayName: 'Replicate',
    tagline: '오픈소스 모델 API 허브',
    avatarBg: 'bg-violet-100',
    avatarText: 'text-violet-700',
    docsUrl: 'https://replicate.com/account/api-tokens',
    comingSoon: true,
  },
];

/** Look up metadata for a provider by its key (case-insensitive). */
export function getProviderMeta(providerKey: string): ProviderMeta | undefined {
  const lower = providerKey.toLowerCase();
  return PROVIDER_META.find(m => m.key.toLowerCase() === lower);
}

/** Get initials to display in the avatar (first letter of each word, max 2). */
export function getProviderInitials(name: string): string {
  const words = name.split(/[\s(/-]+/).filter(Boolean);
  if (words.length === 1) return words[0].substring(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/**
 * One-click preset bundles — clicking these pre-fills the add-model form
 * with the provider's representative models.
 */
export interface ProviderPreset {
  providerKey: string;
  label: string;
  models: Array<{
    name: string;
    type: 'image' | 'video' | 'text';
    modelId: string;
    description: string;
    supportsKorean: boolean;
  }>;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    providerKey: 'OpenAI',
    label: 'OpenAI 프리셋',
    models: [
      { name: 'GPT-4o', type: 'text', modelId: 'gpt-4o', description: 'OpenAI 최신 멀티모달 텍스트 모델', supportsKorean: true },
      { name: 'GPT Image 1.5', type: 'image', modelId: 'gpt-image-1.5', description: 'OpenAI 최신 이미지 생성 모델', supportsKorean: true },
      { name: 'Sora 2', type: 'video', modelId: 'sora-2', description: 'OpenAI 사실적인 영상 생성 모델', supportsKorean: true },
    ],
  },
  {
    providerKey: 'ByteDance',
    label: 'ByteDance (Seedance) 프리셋',
    models: [
      { name: 'Seedance 1.5 Pro', type: 'video', modelId: 'seedance-1.5-pro', description: 'ByteDance의 Seedance 1.5 Pro 모델', supportsKorean: true },
      { name: 'Seedream V4.5', type: 'image', modelId: 'seedream-v4.5', description: '놀라운 연속성과 높은 퀄리티', supportsKorean: false },
    ],
  },
  {
    providerKey: 'Kuaishou',
    label: 'Kuaishou (Kling) 프리셋',
    models: [
      { name: 'Kling 3.0', type: 'video', modelId: 'kling-3.0', description: '멀티샷 제어와 오디오 동기화 차세대 AI', supportsKorean: true },
      { name: 'Kling 2.6', type: 'video', modelId: 'kling-2.6', description: 'Kling 2.6 — 네이티브 오디오 지원', supportsKorean: true },
    ],
  },
  {
    providerKey: 'Anthropic',
    label: 'Anthropic (Claude) 프리셋',
    models: [
      { name: 'Claude 3.5 Sonnet', type: 'text', modelId: 'claude-3-5-sonnet-20241022', description: 'Anthropic 최신 Claude 텍스트 모델', supportsKorean: true },
    ],
  },
  {
    providerKey: 'Replicate',
    label: 'Replicate 프리셋',
    models: [
      { name: 'Flux 1.1 Pro', type: 'image', modelId: 'black-forest-labs/flux-1.1-pro', description: 'Replicate 경유 Flux 이미지 생성', supportsKorean: false },
    ],
  },
];
