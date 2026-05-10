interface Props {
  text: string;
  progress: number;
  error?: string;
}

export default function Loading({ text, progress, error }: Props) {
  return (
    <div style={{
      position: 'absolute', inset: 0, background: '#0a0a14',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', gap: 14, zIndex: 20,
    }}>
      <div style={{ fontSize: 14, color: error ? '#e53935' : 'rgba(255,255,255,0.5)' }}>
        {error ?? text}
      </div>
      {!error && (
        <div style={{ width: 240, height: 2, background: 'rgba(255,255,255,0.1)', borderRadius: 1, overflow: 'hidden' }}>
          <div style={{
            height: '100%', background: '#378ADD', borderRadius: 1,
            width: `${progress}%`, transition: 'width 0.25s',
          }} />
        </div>
      )}
    </div>
  );
}
