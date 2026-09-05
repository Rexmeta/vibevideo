import type { AIModel, CreativeBrief, GenreId, PlatformId, Scene, StyleSheet } from '../types';
import {
  generateSceneAudio,
  generateSceneImage,
  generateSceneVideo,
  generateScript,
  generateStyleSheet,
  segmentScriptIntoScenes,
  type GenerateImageOptions,
  type GenerateImageResult,
  type GenerateVideoOptions,
  type GenerateVideoResult,
} from './geminiService';
import {
  createGenerationCommand,
  executeGenerationCommand,
} from './generationContract';
import type {
  GenerationProviderOptions,
} from './generationContract';
import type { GenerationProgressEvent, GenerationResult } from '../types';

export interface TextGenerationInput {
  topic: string;
  style: string;
  lengthSeconds: number;
  sceneCount?: number;
  genre?: GenreId;
  platform?: PlatformId;
  creativeBrief?: CreativeBrief;
  textModel?: string;
}

export interface AudioGenerationInput {
  text: string;
  style: string;
}

export interface SceneSegmentationInput {
  script: string;
  style: string;
  ratio: string;
  characterProfile?: string;
  sceneCount?: number;
  genre?: GenreId;
  platform?: PlatformId;
  characterReferences?: import('../types').CharacterReference[];
  creativeBrief?: CreativeBrief;
  textModel?: string;
}

export interface StyleSheetGenerationInput {
  topic: string;
  script: string;
  visualStyle: string;
  genre?: GenreId;
  textModel?: string;
}

export interface ImageGenerationInput {
  prompt: string;
  style: string;
  aspectRatio: string;
  model?: Pick<AIModel, 'modelId' | 'provider'>;
  characterProfile?: string;
  options?: GenerateImageOptions;
}

export interface VideoGenerationInput {
  prompt: string;
  imageSource?: string;
  aspectRatio: string;
  model?: Pick<AIModel, 'modelId' | 'provider'>;
  audioScript?: string;
  characterProfile?: string;
  previousSceneContext?: string;
  sceneIndex?: number;
  options?: GenerateVideoOptions;
}

type Progress = (event: GenerationProgressEvent) => void;

export const runTextGeneration = (
  input: TextGenerationInput,
  onProgress?: Progress,
): Promise<GenerationResult<string>> => {
  const command = createGenerationCommand('text', input, {
    provider: 'Google',
    modelId: input.textModel,
  });
  return executeGenerationCommand(command, value =>
    generateScript(value.topic, value.style, value.lengthSeconds, value.sceneCount, {
      genre: value.genre,
      platform: value.platform,
      creativeBrief: value.creativeBrief,
      textModel: value.textModel,
    }), onProgress);
};

export const runAudioGeneration = (
  input: AudioGenerationInput,
  onProgress?: Progress,
  providerOptions?: GenerationProviderOptions,
): Promise<GenerationResult<{ audio_path: string; duration: number } | null>> => {
  const command = createGenerationCommand('audio', input, { provider: 'Google' });
  return executeGenerationCommand(
    command,
    value => generateSceneAudio(value.text, value.style, providerOptions),
    onProgress,
  );
};

export const runSceneSegmentation = (
  input: SceneSegmentationInput,
  onProgress?: Progress,
): Promise<GenerationResult<Partial<Scene>[]>> => {
  const command = createGenerationCommand('text', input, {
    provider: 'Google',
    modelId: input.textModel,
  });
  return executeGenerationCommand(command, value => segmentScriptIntoScenes(
    value.script,
    value.style,
    value.ratio,
    value.characterProfile,
    value.sceneCount,
    {
      genre: value.genre,
      platform: value.platform,
      characterReferences: value.characterReferences,
      creativeBrief: value.creativeBrief,
      textModel: value.textModel,
    },
  ), onProgress);
};

export const runStyleSheetGeneration = (
  input: StyleSheetGenerationInput,
  onProgress?: Progress,
): Promise<GenerationResult<StyleSheet>> => {
  const command = createGenerationCommand('text', input, {
    provider: 'Google',
    modelId: input.textModel,
  });
  return executeGenerationCommand(command, value =>
    generateStyleSheet(value.topic, value.script, value.visualStyle, {
      genre: value.genre,
      textModel: value.textModel,
    }), onProgress);
};

export const runImageGeneration = (
  input: ImageGenerationInput,
  onProgress?: Progress,
  providerOptions?: GenerationProviderOptions,
): Promise<GenerationResult<GenerateImageResult | null>> => {
  const command = createGenerationCommand('image', input, {
    provider: input.model?.provider || 'Google',
    modelId: input.model?.modelId,
  });
  return executeGenerationCommand(command, value =>
    generateSceneImage(
      value.prompt,
      value.style,
      value.aspectRatio,
      value.model?.modelId,
      value.model?.provider,
      value.characterProfile,
      value.options,
      providerOptions,
    ), onProgress);
};

export const runVideoGeneration = (
  input: VideoGenerationInput,
  onProgress?: Progress,
): Promise<GenerationResult<GenerateVideoResult | null>> => {
  const command = createGenerationCommand('video', input, {
    provider: input.model?.provider || 'Google',
    modelId: input.model?.modelId,
  });
  return executeGenerationCommand(command, value =>
    generateSceneVideo(
      value.prompt,
      value.imageSource,
      value.aspectRatio,
      value.model?.modelId,
      value.model?.provider,
      value.audioScript,
      value.characterProfile,
      value.previousSceneContext,
      value.sceneIndex,
      value.options,
    ), onProgress);
};