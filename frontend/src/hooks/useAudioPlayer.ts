import { useCallback, useEffect, useRef, useState } from 'react';
import { HtmlAudioPlaybackClock, type PlaybackSnapshot } from '@/services/playbackClock';

export function useAudioPlayer() {
  const clockRef = useRef<HtmlAudioPlaybackClock | null>(null);
  if (!clockRef.current) {
    clockRef.current = new HtmlAudioPlaybackClock();
  }

  const [snapshot, setSnapshot] = useState<PlaybackSnapshot>(() =>
    clockRef.current!.getSnapshot(),
  );

  useEffect(() => {
    const clock = clockRef.current!;
    const unsubscribe = clock.subscribe(setSnapshot);
    return () => {
      unsubscribe();
      clock.destroy();
    };
  }, []);

  const loadFromFile = useCallback((file: File) => {
    clockRef.current?.loadFromFile(file);
  }, []);

  const loadFromUrl = useCallback((url: string, label: string) => {
    clockRef.current?.loadFromUrl(url, label);
  }, []);

  const toggle = useCallback(() => {
    clockRef.current?.toggle();
  }, []);

  const pause = useCallback(() => {
    clockRef.current?.pause();
  }, []);

  const seek = useCallback((seconds: number) => {
    clockRef.current?.seek(seconds);
  }, []);

  const setPlaybackRate = useCallback((rate: number) => {
    clockRef.current?.setPlaybackRate(rate);
  }, []);

  const setVolume = useCallback((volume: number) => {
    clockRef.current?.setVolume(volume);
  }, []);

  const toggleMute = useCallback(() => {
    clockRef.current?.toggleMute();
  }, []);

  const setLoop = useCallback((loop: boolean) => {
    clockRef.current?.setLoop(loop);
  }, []);

  return {
    snapshot,
    loadFromFile,
    loadFromUrl,
    toggle,
    pause,
    seek,
    setPlaybackRate,
    setVolume,
    toggleMute,
    setLoop,
  };
}
