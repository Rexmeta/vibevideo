import React, { useRef } from 'react';

interface AudioVideoSyncDeps {
  syncAudioRef: React.MutableRefObject<HTMLAudioElement | null>;
}

export const useAudioVideoSync = ({ syncAudioRef }: AudioVideoSyncDeps) => {
  const syncCleanupRef = useRef<(() => void) | null>(null);

  const syncAudioWithVideo = (videoEl: HTMLVideoElement | null, audioUrl?: string) => {
    if (syncCleanupRef.current) {
      syncCleanupRef.current();
      syncCleanupRef.current = null;
    }
    if (!videoEl || !audioUrl) return;
    const sa = syncAudioRef.current;
    if (!sa) return;
    sa.src = audioUrl;
    sa.currentTime = 0;

    const playHandler = () => {
      sa.currentTime = videoEl.currentTime;
      sa.play().catch(() => {});
    };
    const pauseHandler = () => {
      sa.pause();
    };
    const seekHandler = () => {
      sa.currentTime = videoEl.currentTime;
    };
    const endHandler = () => {
      sa.pause();
      sa.currentTime = 0;
    };

    videoEl.addEventListener('play', playHandler);
    videoEl.addEventListener('pause', pauseHandler);
    videoEl.addEventListener('seeked', seekHandler);
    videoEl.addEventListener('ended', endHandler);

    if (!videoEl.paused) {
      sa.currentTime = videoEl.currentTime;
      sa.play().catch(() => {});
    }

    syncCleanupRef.current = () => {
      videoEl.removeEventListener('play', playHandler);
      videoEl.removeEventListener('pause', pauseHandler);
      videoEl.removeEventListener('seeked', seekHandler);
      videoEl.removeEventListener('ended', endHandler);
      sa.pause();
    };
  };

  return { syncAudioWithVideo, syncCleanupRef };
};
