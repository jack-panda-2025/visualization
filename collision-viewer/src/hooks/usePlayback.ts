import { useEffect, useRef } from 'react';
import { useStore } from '../store/useStore';
import { FRAME_MS } from '../lib/constants';
import { getSimData } from '../lib/simData';

export function usePlayback(onFrame: (fi: number) => void) {
  const playing = useStore(s => s.playing);
  const curFrame = useStore(s => s.curFrame);
  const setFrame = useStore(s => s.setFrame);
  const lastTRef = useRef(0);
  const rafRef = useRef(0);

  useEffect(() => {
    if (!playing) return;
    lastTRef.current = performance.now();

    const tick = (now: number) => {
      if (now - lastTRef.current >= FRAME_MS) {
        const data = getSimData();
        if (data) {
          const next = (useStore.getState().curFrame + 1) % data.meta.n_frames;
          setFrame(next);
          onFrame(next);
        }
        lastTRef.current = now;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, onFrame, setFrame]);

  // When frame changes externally (not via playback), still call onFrame
  const prevFrameRef = useRef(curFrame);
  useEffect(() => {
    if (!playing && curFrame !== prevFrameRef.current) {
      onFrame(curFrame);
    }
    prevFrameRef.current = curFrame;
  }, [curFrame, playing, onFrame]);
}
