import React from 'react';
import {
  Scene,
  PresentationConfig,
  TextOverlay,
  TransitionType,
  MotionPreset,
} from '../../../types';

interface PresentationActionsDeps {
  setScenes: React.Dispatch<React.SetStateAction<Partial<Scene>[]>>;
}

export const usePresentationActions = ({ setScenes }: PresentationActionsDeps) => {
  const getDefaultPresentation = (idx: number): PresentationConfig => ({
    transition: idx === 0 ? 'none' : 'fade',
    transitionDuration: 1,
    motion: 'zoom-in',
  });

  const updateScenePresentation = (idx: number, updates: Partial<PresentationConfig>) => {
    setScenes(prev => {
      const next = [...prev];
      const current = next[idx]?.presentation || getDefaultPresentation(idx);
      next[idx] = { ...next[idx], presentation: { ...current, ...updates } };
      return next;
    });
  };

  const updateSceneTextOverlay = (idx: number, updates: Partial<TextOverlay> | null) => {
    setScenes(prev => {
      const next = [...prev];
      const pres = next[idx]?.presentation || getDefaultPresentation(idx);
      if (updates === null) {
        next[idx] = { ...next[idx], presentation: { ...pres, textOverlay: undefined } };
      } else {
        const current =
          pres.textOverlay || {
            text: '',
            position: 'bottom' as const,
            fontSize: 32,
            color: '#ffffff',
            backgroundColor: 'rgba(0,0,0,0.6)',
          };
        next[idx] = {
          ...next[idx],
          presentation: { ...pres, textOverlay: { ...current, ...updates } },
        };
      }
      return next;
    });
  };

  const applyDefaultTransitions = (transitionType: TransitionType = 'fade') => {
    setScenes(prev =>
      prev.map((s, i) => ({
        ...s,
        presentation: {
          ...(s.presentation || getDefaultPresentation(i)),
          transition: i === 0 ? 'none' : transitionType,
        },
      }))
    );
  };

  const applyDefaultMotion = (motion: MotionPreset) => {
    setScenes(prev =>
      prev.map((s, i) => ({
        ...s,
        presentation: {
          ...(s.presentation || getDefaultPresentation(i)),
          motion,
        },
      }))
    );
  };

  return {
    getDefaultPresentation,
    updateScenePresentation,
    updateSceneTextOverlay,
    applyDefaultTransitions,
    applyDefaultMotion,
  };
};
