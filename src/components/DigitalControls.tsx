import { MousePointer2, Pause, Play, RotateCcw, Sparkles } from 'lucide-react';
import { useStudio } from '../store';
import { useDigitalRuntime } from '../digitalRuntime';

export default function DigitalControls({ onDemos }: { onDemos: () => void }) {
  const reader = useStudio((s) => s.reader),
    testing = useStudio((s) => s.testInteractions);
  const paused = useDigitalRuntime((s) => s.paused);
  const active = reader || testing;
  return (
    <div className={`digital-controls ${active ? 'testing' : ''}`}>
      {!reader ? (
        <button
          className={active ? 'active' : ''}
          onClick={() => useStudio.getState().set({ testInteractions: !testing, view: '3d' })}
        >
          <MousePointer2 size={14} />
          {testing ? 'Return to editing' : 'Test interactions'}
        </button>
      ) : (
        <span>
          <MousePointer2 size={14} />
          Click the scene to interact
        </span>
      )}
      <div className="digital-clock-controls">
        <button
          onClick={() => useDigitalRuntime.setState({ paused: !paused })}
          aria-label={paused ? 'Resume digital playback' : 'Pause digital playback'}
          title={paused ? 'Resume digital playback' : 'Pause digital playback'}
        >
          {paused ? <Play size={14} /> : <Pause size={14} />}
        </button>
        <button
          onClick={() => useDigitalRuntime.getState().reset()}
          aria-label="Restart digital playback"
          title="Restart digital playback"
        >
          <RotateCcw size={14} />
        </button>
        <span>Digital {paused ? 'paused' : 'playback'}</span>
      </div>
      <button className="demos-button" onClick={onDemos}>
        <Sparkles size={14} />
        Demos
      </button>
    </div>
  );
}
