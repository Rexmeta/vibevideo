import React from 'react';
import { Scene } from '../../../types';
import { runAudioGeneration } from '../../../services/generationCommands';
import { throwGenerationFailure } from '../../../services/generationContract';
import { uploadFileToCloud } from '../../../services/storageService';
import { saveMedia } from '../../../services/mediaCache';
import { jobOrchestrator } from '../../../services/jobOrchestrator';
import { createGenerationCommand } from '../../../services/generationContract';
import {
  CONCURRENCY,
  hasMedia,
  isMediaUploaded,
  getGenerationErrorMessage,
  runParallel,
  summarizeGenerationErrors,
  tryUploadExisting,
} from './wizardHelpers';

interface AudioActionsDeps {
  userId: string;
  projectId: string;
  videoStyle: string;
  scenes: Partial<Scene>[];
  failedScenes: Map<string, string>;
  audioRef: React.MutableRefObject<HTMLAudioElement | null>;
  playingAudioIdx: number | null;
  setPlayingAudioIdx: React.Dispatch<React.SetStateAction<number | null>>;
  setProcessingType: React.Dispatch<React.SetStateAction<'audio' | 'image' | 'video' | null>>;
  setProcessingSet: React.Dispatch<React.SetStateAction<Set<number>>>;
  setFailedScenes: React.Dispatch<React.SetStateAction<Map<string, string>>>;
  setLoadingMessage: React.Dispatch<React.SetStateAction<string>>;
  updateSceneAt: (idx: number, updates: Partial<Scene>) => void;
  sync: (
    targetStep?: number,
    scenesOverride?: Partial<Scene>[],
    extraData?: any,
    overrides?: any
  ) => void;
}

export const useAudioActions = (deps: AudioActionsDeps) => {
  const {
    userId,
    projectId,
    videoStyle,
    scenes,
    failedScenes,
    audioRef,
    playingAudioIdx,
    setPlayingAudioIdx,
    setProcessingType,
    setProcessingSet,
    setFailedScenes,
    setLoadingMessage,
    updateSceneAt,
    sync,
  } = deps;

  const generateAudio = async (
    idx: number,
    scene: Partial<Scene>,
    explicitRegeneration = false,
  ) => {
    const input = { text: scene.script_segment!, style: videoStyle };
    const command = createGenerationCommand('audio', input, { provider: 'Google' });
    const submission = await jobOrchestrator.submitAssetGeneration({
      id: command.id,
      projectId,
      sceneId: scene.id,
      sceneIndex: idx,
      capability: 'audio',
      provider: command.provider || 'Google',
      model: command.modelId || 'default-audio',
      input,
      execute: executionContext => runAudioGeneration(
        input,
        undefined,
        executionContext,
      ).then(throwGenerationFailure),
    }, { explicitRegeneration });
    const res = submission.value;
    if (!submission.reused && res) {
      try {
        if (!jobOrchestrator.canPersistAssetGeneration({
          jobId: submission.generationJob.jobId,
          projectId,
          sceneIndex: idx,
          capability: 'audio',
        })) return;
        saveMedia(projectId, idx, 'audio', res.audio_path);
        updateSceneAt(idx, {
          audio_path: res.audio_path,
          audio_duration: res.duration,
          audioGenerationJobId: submission.generationJob.jobId,
        });
        const url = await uploadFileToCloud(
          `users/${userId}/projects/${projectId}/audio/s${idx}-${submission.generationJob.jobId}.wav`,
          res.audio_path,
          'base64',
        );
        if (!jobOrchestrator.canPersistAssetGeneration({
          jobId: submission.generationJob.jobId,
          projectId,
          sceneIndex: idx,
          capability: 'audio',
        })) return;
        updateSceneAt(idx, {
          audio_path: url,
          audioGenerationJobId: submission.generationJob.jobId,
        });
      } finally {
        jobOrchestrator.acknowledgeAssetPersistence(submission.generationJob.jobId);
      }
    }
  };

  const handlePlayAudio = (url: string, idx: number) => {
    if (playingAudioIdx === idx) {
      audioRef.current?.pause();
      setPlayingAudioIdx(null);
    } else {
      if (audioRef.current) {
        audioRef.current.src = url;
        audioRef.current.play();
        setPlayingAudioIdx(idx);
      }
    }
  };

  const handleSingleAudio = async (idx: number) => {
    setProcessingType('audio');
    setProcessingSet(new Set([idx]));
    const fKey = `audio-${idx}`;
    try {
      const currentScene = scenes[idx];
      if (hasMedia(currentScene.audio_path) && !isMediaUploaded(currentScene.audio_path)) {
        const generationJobId = currentScene.audioGenerationJobId;
        const url = await tryUploadExisting(
          currentScene.audio_path!,
          `users/${userId}/projects/${projectId}/audio/s${idx}${
            generationJobId ? `-${generationJobId}` : ''
          }.wav`,
          'base64'
        );
        if (generationJobId && !jobOrchestrator.canPersistAssetGeneration({
          jobId: generationJobId,
          projectId,
          sceneIndex: idx,
          capability: 'audio',
        })) return;
        updateSceneAt(idx, { audio_path: url, audioGenerationJobId: generationJobId });
        setFailedScenes(prev => {
          const n = new Map(prev);
          n.delete(fKey);
          return n;
        });
        setProcessingSet(new Set());
        setProcessingType(null);
        return;
      }
      await generateAudio(
        idx,
        currentScene,
        isMediaUploaded(currentScene.audio_path),
      );
      setFailedScenes(prev => {
        const n = new Map(prev);
        n.delete(fKey);
        return n;
      });
      sync();
    } catch (e: any) {
      console.error(`Scene ${idx} audio retry error:`, e);
      setFailedScenes(prev => new Map(prev).set(fKey, getGenerationErrorMessage(e)));
    }
    setProcessingSet(new Set());
    setProcessingType(null);
  };

  const handleBatchAudio = async () => {
    setProcessingType('audio');
    const sceneSnapshot = [...scenes];

    const tasks = sceneSnapshot
      .map((s, i) => ({ idx: i, s }))
      .filter(({ s }) => !isMediaUploaded(s.audio_path))
      .map(({ idx, s }) => ({
        idx,
        fn: async () => {
          if (hasMedia(s.audio_path)) {
            const generationJobId = s.audioGenerationJobId;
            const url = await tryUploadExisting(
              s.audio_path!,
              `users/${userId}/projects/${projectId}/audio/s${idx}${
                generationJobId ? `-${generationJobId}` : ''
              }.wav`,
              'base64'
            );
            if (generationJobId && !jobOrchestrator.canPersistAssetGeneration({
              jobId: generationJobId,
              projectId,
              sceneIndex: idx,
              capability: 'audio',
            })) return;
            updateSceneAt(idx, { audio_path: url, audioGenerationJobId: generationJobId });
            return;
          }
          await generateAudio(idx, s);
        },
      }));

    if (tasks.length === 0) {
      setProcessingType(null);
      return;
    }
    setLoadingMessage(`오디오 생성 중... (${tasks.length}개 씬, 최대 ${CONCURRENCY}개 동시 처리)`);

    const results = await runParallel(
      tasks,
      CONCURRENCY,
      idx => setProcessingSet(prev => new Set(prev).add(idx)),
      (idx, error) => {
        setProcessingSet(prev => {
          const n = new Set(prev);
          n.delete(idx);
          return n;
        });
        // Surface per-scene status as soon as it settles so live progress UIs
        // (Quick mode grid) can show failed scenes mid-batch.
        setFailedScenes(prev => {
          const n = new Map(prev);
          if (error) n.set(`audio-${idx}`, getGenerationErrorMessage(error));
          else n.delete(`audio-${idx}`);
          return n;
        });
      }
    );

    const errors = results.filter(r => r.error);
    setProcessingSet(new Set());
    setProcessingType(null);
    setLoadingMessage('');
    sync();
    if (errors.length > 0) {
      const errorDetails = summarizeGenerationErrors(errors.map(({ error }) => error));
      alert(
        `오디오 생성 실패 (${errors.length}/${tasks.length}개 씬)${
          errorDetails.length > 0 ? `\n\n오류 내용:\n${errorDetails.join('\n')}` : ''
        }\n\n실패한 씬 옆 '재시도' 버튼으로 개별 재생성할 수 있습니다.`
      );
    }
  };

  return { handlePlayAudio, handleSingleAudio, handleBatchAudio };
};
