import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  MousePointer2,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Sparkles,
  X,
} from 'lucide-react';
import Viewer from './Viewer';
import { DEMOS, buildDemo } from '../demos';
import type { DemoId } from '../demos';
import { appendDemo } from '../demoCommands';
import { compileProject, evaluateSpread } from '../engine/geometry';
import {
  createDigitalRuntime,
  dispatchDigitalEvent,
  evaluateDigitalPresentation,
} from '../engine/digital';
import { useStudio } from '../store';
import castleThumbnail from '../assets/demos/enchanted-castle.svg';
import butterflyThumbnail from '../assets/demos/butterfly-garden.svg';
import portalThumbnail from '../assets/demos/crystal-portal.svg';
import './demos.css';

const thumbnails = {
  'enchanted-castle': castleThumbnail,
  'butterfly-garden': butterflyThumbnail,
  'crystal-portal': portalThumbnail,
};

/** This preview owns its project, controls, event history and animation clock. */
function DemoPreview({ demoId, onClose }: { demoId: DemoId; onClose: () => void }) {
  const experience = useMemo(() => buildDemo(demoId), [demoId]);
  const spread = experience.project.spreads[0];
  const compiled = useMemo(
    () => compileProject(experience.project, spread.id),
    [experience, spread.id],
  );
  const [angle, setAngle] = useState(experience.angle),
    [drivers, setDrivers] = useState(experience.drivers),
    [runtime, setRuntime] = useState(createDigitalRuntime),
    [motionPaused, setMotionPaused] = useState(false),
    [playing, setPlaying] = useState(false),
    [stepIndex, setStepIndex] = useState(0),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  const live = useRef({ playing, angle, motionPaused });
  live.current = { playing, angle, motionPaused };
  useEffect(() => {
    let frame = 0,
      previous = performance.now(),
      direction = 1;
    const animate = (now: number) => {
      const elapsed = (now - previous) / 1000;
      if (elapsed >= 1 / 30) {
        const dt = Math.min(elapsed, 0.1);
        previous = now;
        if (!live.current.motionPaused) setRuntime((r) => ({ ...r, time: r.time + dt }));
        if (live.current.playing) {
          if (live.current.angle >= 179.9) direction = -1;
          else if (live.current.angle <= 0.1) direction = 1;
          setAngle((value) => Math.max(0, Math.min(180, value + direction * dt * 32)));
        }
      }
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, []);
  const step = experience.steps[stepIndex];
  const pose = useMemo(() => evaluateSpread(compiled, angle, drivers), [compiled, angle, drivers]);
  const canTrigger = (targetId: string) => {
    const digital = spread.digital.find((d) => d.id === targetId);
    return digital
      ? evaluateDigitalPresentation(digital, pose, { ...runtime, drivers }, { compiled }).visible
      : pose.parts.some((p) => p.id === targetId);
  };
  const selected =
    spread.digital.find((d) => d.id === step.targetId)?.name ??
    spread.decorations.find((d) => d.id === step.targetId)?.name ??
    compiled.order.find((m) => step.targetId.startsWith(`${m.id}:`))?.name ??
    'Paper scene';
  const trigger = (targetId: string) => {
    if (!canTrigger(targetId)) return;
    setRuntime((current) => dispatchDigitalEvent(spread, { ...current, drivers }, targetId));
    const label = experience.triggers.find((t) => t.targetId === targetId)?.label;
    if (label)
      setNotice(`${label} · ${motionPaused ? 'Resume motion to play' : 'interaction played'}`);
  };
  const moveStep = (index: number) => {
    setStepIndex(index);
    setPlaying(false);
    setNotice('');
  };
  const reset = () => {
    setAngle(experience.angle);
    setDrivers({ ...experience.drivers });
    setRuntime(createDigitalRuntime());
    setPlaying(false);
    setMotionPaused(false);
    setStepIndex(0);
    setNotice('Preview restarted');
  };
  const add = () => {
    setBusy(true);
    setNotice('');
    try {
      // Only this explicit action touches the active studio or its undo history.
      const state = useStudio.getState();
      let inserted: ReturnType<typeof appendDemo> | undefined;
      state.edit(`${spread.name} demo added`, (p) => {
        inserted = appendDemo(p, experience.project);
      });
      const copy = inserted!;
      state.selectSpread(copy.spread.id);
      state.set({
        angle: experience.angle,
        drivers: Object.fromEntries(
          Object.entries(experience.drivers).map(([id, value]) => [copy.idMap[id] ?? id, value]),
        ),
        playing: false,
        reader: false,
        view: '3d',
        selectedId: copy.idMap[spread.digital[0]?.id] ?? null,
        notice: `${spread.name} added${copy.scale < 1 ? ` · scaled to ${Math.round(copy.scale * 100)}% for this book` : ''} · Physical prototype required`,
      });
      onClose();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not add this demo.');
      setBusy(false);
    }
  };
  const hingeTarget = spread.digital.find((d) => d.entrance?.driver.kind === 'hinge')?.entrance
    ?.driver.target;
  const hingeAngle = hingeTarget ? pose.hinges.find((h) => h.id === hingeTarget)?.angle : undefined;
  return (
    <div className="demo-experience">
      <section className="demo-stage" aria-label="Isolated interactive demo preview">
        <div className="demo-stage-top">
          <span>
            <Sparkles size={14} /> LIVE PREVIEW
          </span>
          <div className="demo-preview-actions">
            <button onClick={() => setMotionPaused(!motionPaused)}>
              {motionPaused ? <Play size={13} /> : <Pause size={13} />}
              {motionPaused ? 'Resume motion' : 'Pause motion'}
            </button>
            <button onClick={reset}>
              <RotateCcw size={14} /> Restart
            </button>
          </div>
        </div>
        <div className="demo-viewer">
          <Viewer
            compiled={compiled}
            preview={{
              angle,
              drivers,
              runtime: { ...runtime, drivers },
              selectedId: step.targetId,
              onTrigger: trigger,
              onNotice: setNotice,
            }}
          />
          <div className="demo-viewer-hint">
            <MousePointer2 size={12} /> Drag to orbit · Click to interact
          </div>
        </div>
        <div className={`demo-opening ${step.control === 'opening' ? 'demo-focused-control' : ''}`}>
          <button
            className="demo-play"
            aria-label={playing ? 'Pause opening' : 'Play opening'}
            onClick={() => setPlaying(!playing)}
          >
            {playing ? <Pause size={17} /> : <Play size={17} />}
          </button>
          <label htmlFor="demo-opening">
            Opening <output>{Math.round(angle)}°</output>
          </label>
          <input
            id="demo-opening"
            aria-label="Demo opening angle"
            type="range"
            min="0"
            max="180"
            step="1"
            value={angle}
            onChange={(e) => {
              setPlaying(false);
              setAngle(Number(e.target.value));
            }}
          />
          {hingeAngle !== undefined && (
            <span className="demo-hinge-readout">
              Petal hinge {((hingeAngle * 180) / Math.PI).toFixed(1)}°
            </span>
          )}
        </div>
        {spread.mechanisms
          .filter((m) => m.kind === 'slider')
          .map((slider) => (
            <div
              className={`demo-slider ${step.control === 'slider' ? 'demo-focused-control' : ''}`}
              key={slider.id}
            >
              <label htmlFor={`demo-${slider.id}`}>
                {slider.name} <output>{Math.round((drivers[slider.id] ?? 0) * 100)}%</output>
              </label>
              <input
                id={`demo-${slider.id}`}
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={drivers[slider.id] ?? 0}
                onChange={(e) =>
                  setDrivers((values) => ({ ...values, [slider.id]: Number(e.target.value) }))
                }
              />
            </div>
          ))}
        <div className="demo-trigger-row">
          {experience.triggers.map((t) => (
            <button
              className={
                step.control === 'trigger' &&
                (!step.triggerTarget || t.targetId === step.triggerTarget)
                  ? 'demo-focused-control'
                  : ''
              }
              key={t.targetId}
              disabled={!canTrigger(t.targetId)}
              title={
                !canTrigger(t.targetId)
                  ? 'Reveal this object with its highlighted control first'
                  : undefined
              }
              onClick={() => trigger(t.targetId)}
            >
              <Sparkles size={14} />
              {t.label}
            </button>
          ))}
        </div>
      </section>
      <aside className="demo-walkthrough" aria-label="Demo walkthrough">
        <div className="demo-walkthrough-heading">
          <span className="eyebrow">GUIDED EXPLORATION</span>
          <span>{stepIndex + 1} / 4</span>
        </div>
        <div className="demo-step-nav" aria-label="Walkthrough steps">
          {experience.steps.map((s, index) => (
            <button
              key={s.title}
              title={s.title}
              aria-label={`Step ${index + 1}: ${s.title}`}
              aria-current={index === stepIndex ? 'step' : undefined}
              onClick={() => moveStep(index)}
            >
              {index + 1}
            </button>
          ))}
        </div>
        <h3>{step.title}</h3>
        <div className="demo-explanation">
          <h4>What to try</h4>
          <p>{step.try}</p>
        </div>
        <div className="demo-explanation">
          <h4>How it’s built</h4>
          <p>{step.built}</p>
        </div>
        <div
          className={`demo-settings ${step.control === 'settings' ? 'demo-focused-control' : ''}`}
        >
          <div className="demo-selected-label">
            <span className="demo-highlight-dot" /> Highlighted: {selected}
          </div>
          <dl>
            {step.settings.map((setting) => (
              <div key={setting.label}>
                <dt>{setting.label}</dt>
                <dd>{setting.value}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="demo-step-actions">
          <button onClick={() => moveStep(stepIndex - 1)} disabled={stepIndex === 0}>
            <ArrowLeft size={15} /> Back
          </button>
          <button onClick={() => moveStep(stepIndex + 1)} disabled={stepIndex === 3}>
            Next step <ArrowRight size={15} />
          </button>
        </div>
        <div className="demo-add-area">
          <button className="demo-add" disabled={busy} onClick={add}>
            <Plus size={17} />
            {busy ? 'Adding…' : 'Add & edit this demo'}
          </button>
          <p>Creates a new spread in your book. Paper designs need a physical prototype.</p>
        </div>
        <p className="demo-notice" role="status">
          {notice || 'Explore freely — preview changes stay here.'}
        </p>
      </aside>
    </div>
  );
}

export default function DemosGallery({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [demoId, setDemoId] = useState<DemoId>('enchanted-castle');
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog className="demos-dialog" ref={dialog} onCancel={onClose}>
      <header className="demos-header">
        <div>
          <span className="eyebrow">PAPER MEETS POSSIBILITY</span>
          <h2>Stories that move</h2>
          <p>Three interactive demos. Open, pull, click — then make one your own.</p>
        </div>
        <button className="demo-close" aria-label="Close demos" onClick={onClose}>
          <X size={22} />
        </button>
      </header>
      <nav className="demo-cards" aria-label="Choose a demo">
        {DEMOS.map((demo) => {
          return (
            <button
              key={demo.id}
              aria-pressed={demo.id === demoId}
              className={`demo-card ${demo.id === demoId ? 'is-active' : ''}`}
              style={{ '--demo-accent': demo.accent } as React.CSSProperties}
              onClick={() => setDemoId(demo.id)}
            >
              <img
                className="demo-card-illustration"
                src={thumbnails[demo.id]}
                alt={`${demo.title} paper and digital scene`}
              />
              <span>
                <small>{demo.category}</small>
                <strong>{demo.title}</strong>
                <span>{demo.description}</span>
                <b className="demo-preview-label">
                  <Play size={10} /> Preview
                </b>
              </span>
            </button>
          );
        })}
      </nav>
      <DemoPreview key={demoId} demoId={demoId} onClose={onClose} />
    </dialog>
  );
}
