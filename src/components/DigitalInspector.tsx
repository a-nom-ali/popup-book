import { Copy, Move3D, Rotate3D, Scaling, Play, Plus, X } from 'lucide-react';
import { useStudio } from '../store';
import { useDigitalRuntime, modelDimensions } from '../digitalRuntime';
import { updateDigital, duplicateDigital, placeDigitalBase } from '../digitalCommands';
import { DIGITAL_BUILTINS, uid } from '../model';
import type { DigitalObject, DigitalEntrance, DigitalTrigger, Vec3 } from '../model';
import type { CompiledSpread, Pose } from '../engine/geometry';
import { NumberField, TextField } from './Inspector';

export const ENTRANCE_DEFAULT: DigitalEntrance = {
  kind: 'rise',
  driver: { kind: 'opening' },
  start: 25,
  end: 100,
  distance: 20,
  easing: 'smooth',
  duration: 1.2,
};
const titles = {
  dragon: 'Winged dragon',
  butterfly: 'Butterfly',
  crystal: 'Floating crystal',
  fireflies: 'Fireflies',
  sparkles: 'Sparkles',
  portal: 'Portal',
};

export default function DigitalInspector({
  object,
  compiled,
  pose,
}: {
  object: DigitalObject;
  compiled: CompiledSpread;
  pose: Pose;
}) {
  const s = useStudio();
  const measurement = useDigitalRuntime((state) => state.measurements[object.id]);
  const dimensions = modelDimensions(object, measurement);
  const entrance = object.entrance;
  const sliders = compiled.spread.mechanisms.filter((m) => m.kind === 'slider');
  const targets = [
    ...pose.parts.map((p) => ({ id: p.id, name: p.name })),
    ...compiled.spread.digital.map((d) => ({ id: d.id, name: d.name })),
  ];
  const run = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      s.set({ notice: (e as Error).message });
    }
  };
  const update = (patch: Partial<DigitalObject>) => run(() => updateDigital(object.id, patch));
  const setEntrance = (patch: Partial<DigitalEntrance>) =>
    update({ entrance: { ...(entrance ?? ENTRANCE_DEFAULT), ...patch } });
  const setTrigger = (id: string, patch: Partial<DigitalTrigger>) =>
    update({ triggers: object.triggers?.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
  const preview = (action: DigitalTrigger['action']) =>
    useDigitalRuntime.getState().preview(object.id, action);
  return (
    <>
      <div className="inspector-section">
        <h3>Source & attachment</h3>
        <TextField label="Model name" value={object.name} onChange={(name) => update({ name })} />
        <label className="select-field">
          <span>Source</span>
          <select
            aria-label="Digital source"
            value={
              object.source?.kind === 'builtin'
                ? `builtin:${object.source.id}`
                : `glb:${object.assetId}`
            }
            onChange={(e) => {
              const [kind, id] = e.target.value.split(':');
              update({
                source:
                  kind === 'builtin'
                    ? {
                        kind: 'builtin',
                        id: id as (typeof DIGITAL_BUILTINS)[number],
                        seed: 42,
                        count: 16,
                      }
                    : { kind: 'glb', assetId: id },
                assetId: kind === 'glb' ? id : '',
                clip: 0,
              });
            }}
          >
            {DIGITAL_BUILTINS.map((id) => (
              <option key={id} value={`builtin:${id}`}>
                {titles[id]}
              </option>
            ))}
            {Object.values(compiled.project.assets)
              .filter((a) => a.mime === 'model/gltf-binary')
              .map((a) => (
                <option key={a.id} value={`glb:${a.id}`}>
                  {a.name}
                </option>
              ))}
            {object.assetId && !compiled.project.assets[object.assetId] && (
              <option value={`glb:${object.assetId}`}>Missing model · choose a source</option>
            )}
          </select>
        </label>
        <label className="select-field">
          <span>Parent part</span>
          <select
            aria-label="Digital parent part"
            value={object.parent}
            onChange={(e) => update({ parent: e.target.value })}
          >
            {!pose.parts.some((p) => p.id === object.parent) && (
              <option value={object.parent}>Missing parent · reattach here</option>
            )}
            {pose.parts.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <div className="gizmo-options">
          {(
            [
              { id: 'translate', label: 'Move', Icon: Move3D },
              { id: 'rotate', label: 'Rotate', Icon: Rotate3D },
              { id: 'scale', label: 'Resize', Icon: Scaling },
            ] as const
          ).map(({ id, label, Icon }) => (
            <button
              key={id}
              className={s.gizmo === id ? 'active' : ''}
              onClick={() => s.set({ gizmo: id, testInteractions: false, view: '3d' })}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>
        <p className="property-note">Drag a 3D handle. Each completed drag is one undo step.</p>
        {(['X', 'Y', 'Z'] as const).map((axis, i) => (
          <NumberField
            key={axis}
            label={`Position ${axis}`}
            value={object.position[i]}
            onChange={(v) => {
              const position = [...object.position] as Vec3;
              position[i] = v;
              update({ position });
            }}
          />
        ))}
        {(['X', 'Y', 'Z'] as const).map((axis, i) => (
          <NumberField
            key={axis}
            label={`Rotation ${axis}`}
            unit="°"
            value={object.rotation[i]}
            onChange={(v) => {
              const rotation = [...object.rotation] as Vec3;
              rotation[i] = v;
              update({ rotation });
            }}
          />
        ))}
        <NumberField
          label="Model scale"
          value={object.scale}
          unit="×"
          step={0.01}
          onChange={(scale) => update({ scale })}
        />
        {dimensions && (
          <>
            <div className="model-dimensions">
              {dimensions.map((n) => n.toFixed(1)).join(' × ')} mm{' '}
              <small>local X × Y × Z, before animation</small>
            </div>
            <NumberField
              label="Longest dimension"
              value={Math.max(...dimensions)}
              onChange={(n) => {
                if (n > 0) update({ scale: (object.scale * n) / Math.max(...dimensions) });
              }}
            />
          </>
        )}
        <button
          className="text-button"
          disabled={!measurement}
          onClick={() => measurement && run(() => placeDigitalBase(object.id, measurement))}
        >
          Place base on panel
        </button>
        <button className="text-button" onClick={() => run(() => duplicateDigital(object.id))}>
          <Copy size={14} />
          Duplicate digital object
        </button>
      </div>
      <div className="inspector-section">
        <h3>Entrance</h3>
        <label className="select-field">
          <span>Appearance</span>
          <select
            aria-label="Entrance style"
            value={entrance?.kind ?? 'none'}
            onChange={(e) =>
              e.target.value === 'none'
                ? update({ entrance: undefined })
                : setEntrance({ kind: e.target.value as DigitalEntrance['kind'] })
            }
          >
            <option value="none">Always visible</option>
            <option value="reveal">Reveal</option>
            <option value="rise">Rise from paper</option>
            <option value="grow">Grow into view</option>
          </select>
        </label>
        {entrance && (
          <>
            <label className="select-field">
              <span>Driven by</span>
              <select
                aria-label="Entrance driver"
                value={entrance.driver.kind}
                onChange={(e) => {
                  const kind = e.target.value as DigitalEntrance['driver']['kind'];
                  setEntrance({
                    driver: {
                      kind,
                      target:
                        kind === 'hinge'
                          ? (pose.hinges.find((h) => h.id !== 'spine')?.id ?? 'spine')
                          : kind === 'slider'
                            ? sliders[0]?.id
                            : undefined,
                    },
                    start: kind === 'slider' || kind === 'click' ? 0 : 25,
                    end: kind === 'slider' || kind === 'click' ? 1 : 100,
                  });
                }}
              >
                <option value="opening">Book opening</option>
                <option value="hinge">Actual hinge angle</option>
                <option value="slider">Pull tab</option>
                <option value="click">Click trigger</option>
              </select>
            </label>
            {entrance.driver.kind === 'hinge' && (
              <label className="select-field">
                <span>Hinge</span>
                <select
                  aria-label="Entrance hinge"
                  value={entrance.driver.target ?? ''}
                  onChange={(e) =>
                    setEntrance({ driver: { kind: 'hinge', target: e.target.value } })
                  }
                >
                  <option value="">Choose a hinge</option>
                  {pose.hinges.map((h) => (
                    <option key={h.id} value={h.id}>
                      {compiled.spread.mechanisms.find((m) => h.id.startsWith(m.id))?.name ??
                        'Book spine'}{' '}
                      · {((h.angle * 180) / Math.PI).toFixed(1)}°
                    </option>
                  ))}
                </select>
              </label>
            )}
            {entrance.driver.kind === 'slider' && (
              <label className="select-field">
                <span>Pull tab</span>
                <select
                  aria-label="Entrance pull tab"
                  value={entrance.driver.target ?? ''}
                  onChange={(e) =>
                    setEntrance({ driver: { kind: 'slider', target: e.target.value } })
                  }
                >
                  <option value="">Choose a pull tab</option>
                  {sliders.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {entrance.driver.kind !== 'click' && (
              <>
                <NumberField
                  label="Entrance start"
                  value={entrance.start}
                  unit={entrance.driver.kind === 'slider' ? '0–1' : '°'}
                  step={entrance.driver.kind === 'slider' ? 0.05 : 1}
                  onChange={(start) => setEntrance({ start })}
                />
                <NumberField
                  label="Entrance end"
                  value={entrance.end}
                  unit={entrance.driver.kind === 'slider' ? '0–1' : '°'}
                  step={entrance.driver.kind === 'slider' ? 0.05 : 1}
                  onChange={(end) => setEntrance({ end })}
                />
              </>
            )}
            {entrance.kind === 'rise' && (
              <NumberField
                label="Rise distance"
                value={entrance.distance}
                onChange={(distance) => setEntrance({ distance })}
              />
            )}
            <NumberField
              label="Replay duration"
              value={entrance.duration}
              unit="s"
              step={0.1}
              onChange={(duration) => setEntrance({ duration })}
            />
            <label className="select-field">
              <span>Easing</span>
              <select
                aria-label="Entrance easing"
                value={entrance.easing}
                onChange={(e) => setEntrance({ easing: e.target.value as 'smooth' | 'linear' })}
              >
                <option value="smooth">Smooth</option>
                <option value="linear">Linear</option>
              </select>
            </label>
            <button className="text-button" onClick={() => preview('entrance')}>
              <Play size={13} />
              Preview entrance
            </button>
            {entrance.driver.kind === 'click' && (
              <p className="property-note">
                Choose a visible paper part below to reveal this hidden object.
              </p>
            )}
          </>
        )}
      </div>
      <div className="inspector-section">
        <h3>Animation & motion</h3>
        <label className="select-field">
          <span>Clip</span>
          <select
            aria-label="Animation clip"
            value={object.clip}
            disabled={!measurement?.clips.length}
            onChange={(e) => update({ clip: +e.target.value })}
          >
            {measurement?.clips.length ? (
              measurement.clips.map((clip, i) => (
                <option key={i} value={i}>
                  {clip.name}
                </option>
              ))
            ) : (
              <option value={object.clip}>No animation in this model</option>
            )}
          </select>
        </label>
        <label className="select-field">
          <span>Playback</span>
          <select
            aria-label="Animation playback"
            value={object.behavior}
            onChange={(e) =>
              update({
                behavior: e.target.value as DigitalObject['behavior'],
                ...(e.target.value === 'slider'
                  ? { sliderId: sliders[0]?.id, angleStart: 0, angleEnd: 1 }
                  : e.target.value === 'angle'
                    ? { angleStart: 0, angleEnd: 180 }
                    : {}),
              })
            }
          >
            <option value="loop">Loop continuously</option>
            <option value="click">Play on trigger</option>
            <option value="angle">Follow book opening</option>
            <option value="slider">Follow pull tab</option>
          </select>
        </label>
        {object.behavior === 'slider' && (
          <label className="select-field">
            <span>Clip pull tab</span>
            <select
              aria-label="Animation pull tab"
              value={object.sliderId ?? ''}
              onChange={(e) => update({ sliderId: e.target.value })}
            >
              <option value="">Choose a pull tab</option>
              {sliders.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {(object.behavior === 'angle' || object.behavior === 'slider') && (
          <>
            <NumberField
              label="Clip start"
              value={object.angleStart}
              unit={object.behavior === 'slider' ? '0–1' : '°'}
              step={object.behavior === 'slider' ? 0.05 : 1}
              onChange={(angleStart) => update({ angleStart })}
            />
            <NumberField
              label="Clip end"
              value={object.angleEnd}
              unit={object.behavior === 'slider' ? '0–1' : '°'}
              step={object.behavior === 'slider' ? 0.05 : 1}
              onChange={(angleEnd) => update({ angleEnd })}
            />
          </>
        )}
        <button
          className="text-button"
          disabled={!measurement?.clips.length}
          onClick={() => preview('clip')}
        >
          <Play size={13} />
          Preview clip once
        </button>
        <NumberField
          label="Hover height"
          value={object.motion?.hover ?? 0}
          onChange={(hover) => update({ motion: { spin: object.motion?.spin ?? 0, hover } })}
        />
        <NumberField
          label="Spin speed"
          value={object.motion?.spin ?? 0}
          unit="°/s"
          onChange={(spin) => update({ motion: { hover: object.motion?.hover ?? 0, spin } })}
        />
        {object.source?.kind === 'builtin' &&
          ['fireflies', 'sparkles', 'portal'].includes(object.source.id) && (
            <>
              <NumberField
                label="Particle count"
                value={object.source.count ?? 16}
                unit="≤64"
                onChange={(count) =>
                  update({
                    source: {
                      ...(object.source as Extract<DigitalObject['source'], { kind: 'builtin' }>),
                      count: Math.round(Math.min(64, Math.max(1, count))),
                    },
                  })
                }
              />
              <NumberField
                label="Effect seed"
                value={object.source.seed ?? 42}
                unit="#"
                onChange={(seed) =>
                  update({
                    source: {
                      ...(object.source as Extract<DigitalObject['source'], { kind: 'builtin' }>),
                      seed: Math.round(seed),
                    },
                  })
                }
              />
            </>
          )}
      </div>
      <div className="inspector-section">
        <h3>Click interactions</h3>
        {(object.triggers ?? []).map((trigger, i) => (
          <div className="trigger-card" key={trigger.id}>
            <div className="item-row">
              <strong>Trigger {i + 1}</strong>
              <button
                aria-label={`Remove trigger ${i + 1}`}
                onClick={() =>
                  update({ triggers: object.triggers?.filter((t) => t.id !== trigger.id) })
                }
              >
                <X size={13} />
              </button>
            </div>
            <label className="select-field">
              <span>When clicked</span>
              <select
                aria-label={`Trigger ${i + 1} target`}
                value={trigger.target}
                onChange={(e) => setTrigger(trigger.id, { target: e.target.value })}
              >
                {!targets.some((t) => t.id === trigger.target) && (
                  <option value={trigger.target}>Missing target · choose one</option>
                )}
                {targets.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="select-field">
              <span>Action on this object</span>
              <select
                aria-label={`Trigger ${i + 1} action`}
                value={trigger.action}
                onChange={(e) =>
                  setTrigger(trigger.id, { action: e.target.value as DigitalTrigger['action'] })
                }
              >
                <option value="entrance">Replay entrance</option>
                <option value="clip">Play clip once</option>
                <option value="toggle">Toggle effect</option>
              </select>
            </label>
            <button className="text-button" onClick={() => preview(trigger.action)}>
              <Play size={13} />
              Preview action {i + 1}
            </button>
          </div>
        ))}
        <button
          className="text-button"
          onClick={() =>
            update({
              triggers: [
                ...(object.triggers ?? []),
                {
                  id: uid('trigger'),
                  target: entrance?.driver.kind === 'click' ? object.parent : object.id,
                  action: entrance?.driver.kind === 'click' ? 'entrance' : 'clip',
                },
              ],
            })
          }
        >
          <Plus size={14} />
          Add click trigger
        </button>
        <p className="property-note">
          Use Test interactions above the viewer, or Read book. Editing clicks select objects.
        </p>
      </div>
    </>
  );
}
