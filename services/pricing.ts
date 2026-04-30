// Pricing constants for AI model API calls.
// Numbers are best-effort approximations as of 2026-Q1 and are deliberately
// kept in a single place so they can be tuned without touching UI components.
//
// All prices are in USD. Image/video values represent a single generation call
// (one output image / one ~5s clip). The vision-critic price is per call
// (small text prompt + one image input through gemini-2.5-flash).

import type { AIModel } from '../types';

const DEFAULT_IMAGE_USD = 0.04;
const DEFAULT_VIDEO_USD = 0.50;
const DEFAULT_CRITIC_USD = 0.002;

const IMAGE_PRICE_USD: Record<string, number> = {
  'gemini-3-pro-image-preview': 0.06,
  'gemini-2.5-flash-image': 0.04,
  'seedream-v4.5': 0.03,
  'seedream-v4': 0.025,
  'midjourney': 0.05,
  'qwen-image': 0.02,
  'ideogram-v3': 0.06,
  'z-image-turbo': 0.01,
  'gpt-image-1.5': 0.04,
  'flux-2': 0.04,
  'grok-imagine': 0.05,
};

const VIDEO_PRICE_USD: Record<string, number> = {
  'veo-3.1-fast-generate-preview': 2.00,
  'veo-3.1-generate-preview': 3.00,
  'seedance-1.0-lite': 0.20,
  'seedance-1.5-pro': 0.50,
  'seedance-v1': 0.40,
  'sora-2': 1.50,
  'kling-3.0': 0.80,
  'kling-2.6': 0.60,
  'kling-2.5-turbo': 0.40,
  'kling-o1': 0.70,
  'hailuo-2.3': 0.40,
  'hailuo-02': 0.30,
  'vidu-q3': 0.30,
  'wan-2.5': 0.30,
  'midjourney-video': 0.50,
};

// Vision critic always uses gemini-2.5-flash with a small prompt + one image.
const CRITIC_PRICE_USD = 0.002;

export function getImagePricePerCallUsd(modelId?: string): number {
  if (!modelId) return DEFAULT_IMAGE_USD;
  return IMAGE_PRICE_USD[modelId] ?? DEFAULT_IMAGE_USD;
}

export function getVideoPricePerCallUsd(modelId?: string): number {
  if (!modelId) return DEFAULT_VIDEO_USD;
  return VIDEO_PRICE_USD[modelId] ?? DEFAULT_VIDEO_USD;
}

export function getCriticPricePerCallUsd(): number {
  return CRITIC_PRICE_USD;
}

export interface CostBreakdown {
  imagesUsd: number;
  refinesUsd: number;
  criticsUsd: number;
  videosUsd: number;
  totalUsd: number;
}

export interface CostInputs {
  imagesGenerated?: number;
  refineCalls?: number;
  criticCalls?: number;
  videosGenerated?: number;
  imageModelId?: string;
  videoModelId?: string;
}

export function estimateCost(inputs: CostInputs): CostBreakdown {
  const imgPrice = getImagePricePerCallUsd(inputs.imageModelId);
  const vidPrice = getVideoPricePerCallUsd(inputs.videoModelId);
  const critPrice = getCriticPricePerCallUsd();

  const imagesUsd = (inputs.imagesGenerated || 0) * imgPrice;
  // A refine call re-runs the same image model, so it shares the per-image price.
  const refinesUsd = (inputs.refineCalls || 0) * imgPrice;
  const criticsUsd = (inputs.criticCalls || 0) * critPrice;
  const videosUsd = (inputs.videosGenerated || 0) * vidPrice;
  const totalUsd = imagesUsd + refinesUsd + criticsUsd + videosUsd;

  return { imagesUsd, refinesUsd, criticsUsd, videosUsd, totalUsd };
}

export function formatUsd(amount: number): string {
  if (!isFinite(amount) || amount <= 0) return '$0.00';
  if (amount < 0.01) return '<$0.01';
  if (amount < 1) return `$${amount.toFixed(2)}`;
  if (amount < 100) return `$${amount.toFixed(2)}`;
  return `$${amount.toFixed(0)}`;
}

// Resolve a model's underlying API modelId from the catalog id stored in
// project state (e.g. "img-nano-banana-pro" -> "gemini-3-pro-image-preview").
export function resolveApiModelId(models: AIModel[], catalogId?: string): string | undefined {
  if (!catalogId) return undefined;
  return models.find(m => m.id === catalogId)?.modelId;
}
