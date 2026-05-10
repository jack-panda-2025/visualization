import { useState, useCallback } from 'react';
import { useStore } from '../../store/useStore';
import { getSimData } from '../../lib/simData';

interface Props {
  onFrameChange: (fi: number) => void;
}

export default function Controls({ onFrameChange }: Props) {
  const { curFrame, setFrame, playing, setPlaying } = useStore();
  const [gotoVal, setGotoVal] = useState('1');

  const data = getSimData();
  const nFrames = data?.meta.n_frames ?? 55;
  const time = data?.timesArr[curFrame] ?? 0;
  const eps_p95 = data?.meta.eps_p95 ?? 0;
  const vm_p95 = data?.meta.vm_p95 ?? 0;

  const jump = useCallback((fi: number) => {
    fi = Math.max(0, Math.min(nFrames - 1, fi));
    setFrame(fi);
    onFrameChange(fi);
    setGotoVal(String(fi + 1));
  }, [nFrames, setFrame, onFrameChange]);

  const handleGoto = useCallback(() => {
    const v = parseInt(gotoVal);
    if (!isNaN(v)) jump(v - 1);
  }, [gotoVal, jump]);

  const togglePlay = useCallback(() => {
    setPlaying(!playing);
  }, [playing, setPlaying]);

  return (
    <div className="ui-overlay">
      <div className="timeline-row">
        <button className="btn-play" onClick={togglePlay}>{playing ? '⏸' : '▶'}</button>
        <button className="ctrl-btn" onClick={() => jump(curFrame - 1)}>‹</button>
        <button className="ctrl-btn" onClick={() => jump(curFrame + 1)}>›</button>
        <div className="goto-wrap">
          <span className="goto-label">跳至</span>
          <input
            className="goto-input"
            type="number"
            min={1}
            max={nFrames}
            value={gotoVal}
            onChange={e => setGotoVal(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleGoto(); }}
          />
          <span className="goto-label">帧</span>
          <button className="ctrl-btn go-btn" onClick={handleGoto}>GO</button>
        </div>
        <input
          className="slider"
          type="range"
          min={0}
          max={nFrames - 1}
          value={curFrame}
          onChange={e => jump(parseInt(e.target.value))}
        />
        <div className="time-label">t = {time.toFixed(3)} s</div>
      </div>
      <div className="info-row">
        <div className="stat">
          <span className="stat-val">{nFrames}</span>
          <span>总帧数</span>
        </div>
        <div className="stat">
          <span className="stat-val">{curFrame + 1} / {nFrames}</span>
          <span>当前帧</span>
        </div>
        <div className="colorbar-wrap">
          <div className="colorbar-title">PEEQ / Von Mises（蓝=低，红=高）</div>
          <div className="colorbar-row">
            <span className="cb-label">0</span>
            <div className="colorbar-gradient" />
            <span className="cb-label">{eps_p95.toFixed(4)}/{vm_p95.toFixed(0)}MPa</span>
          </div>
        </div>
      </div>
    </div>
  );
}
