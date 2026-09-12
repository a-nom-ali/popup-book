import { useEffect, useState } from 'react';
import {
  BookOpen,
  Box,
  ImagePlus,
  Layers3,
  Plus,
  Scissors,
  Settings2,
  Trash2,
  X,
} from 'lucide-react';
import { useStudio } from '../store';
import type { CompiledSpread, Pose } from '../engine/geometry';
import type { Mechanism, Project, Vec2 } from '../model';
import { uid } from '../model';
import { PRESETS } from '../presets';
import DigitalInspector from './DigitalInspector';
import { validateDigitalObjects } from '../engine/digital';
import { partTabs } from '../engine/fabrication';
import { polygonBounds } from '../engine/geometry';

export function NumberField({
  label,
  value,
  onChange,
  unit = 'mm',
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  unit?: string;
  step?: number;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(Math.round(value * 10000) / 10000)), [value]);
  const commit = () => {
    if (draft.trim() && Number.isFinite(+draft) && +draft !== value) onChange(+draft);
    else setDraft(String(value));
  };
  return (
    <label className="property-row">
      <span>{label}</span>
      <div className="number-field">
        <input
          aria-label={label}
          type="number"
          step={step}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
        <span>{unit}</span>
      </div>
    </label>
  );
}
export function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <label className="text-field">
      <span>{label}</span>
      <input
        aria-label={label}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft.trim() && draft !== value) onChange(draft.trim());
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
    </label>
  );
}
function resizeOutlines(m: Mechanism, old: Mechanism) {
  if (old.width <= 0 || old.reach <= 0) return;
  for (const role of new Set(Object.keys(m.outlines).concat(Object.keys(m.cutouts)))) {
    const transform = ([x, y]: Vec2): Vec2 => {
      if (
        m.kind === 'vfold' &&
        old.width > 0 &&
        old.reach > 0 &&
        Math.sin((old.beta * Math.PI) / 180) > 0.01
      ) {
        const oldB = (old.beta * Math.PI) / 180,
          b = (m.beta * Math.PI) / 180,
          ridge = y / (old.reach * Math.sin(oldB)),
          base = (x - ridge * old.reach * Math.cos(oldB)) / old.width;
        return [base * m.width + ridge * m.reach * Math.cos(b), ridge * m.reach * Math.sin(b)];
      }
      if (m.kind === 'tent') {
        const before = old.reach - (role === 'left' ? old.left : old.right),
          after = m.reach - (role === 'left' ? m.left : m.right);
        return [before > 0 ? (x * after) / before : x, (y * m.width) / old.width];
      }
      return [(x * m.reach) / old.reach, (y * m.width) / old.width];
    };
    if (m.outlines[role]) m.outlines[role] = m.outlines[role].map(transform);
    if (m.cutouts[role]) m.cutouts[role] = m.cutouts[role].map((hole) => hole.map(transform));
  }
}

export default function Inspector({
  compiled,
  pose,
  onImport,
  onClose,
  onRetrace,
}: {
  compiled: CompiledSpread;
  pose: Pose;
  onImport: (kind: 'image' | 'model' | 'cutout') => void;
  onClose: () => void;
  onRetrace: (id: string) => void;
}) {
  const s = useStudio(),
    spread = compiled.spread,
    selected = pose.parts.find((p) => p.id === s.selectedId);
  const mechanism = spread.mechanisms.find(
    (m) => s.selectedId?.startsWith(`${m.id}:`) || s.selectedId === m.id,
  );
  const digital = spread.digital.find((d) => d.id === s.selectedId),
    decoration = spread.decorations.find((d) => d.id === s.selectedId);
  const decorationParent = decoration && pose.parts.find((p) => p.id === decoration.parent);
  const parentOptions = decoration
    ? pose.parts.filter((part) => {
        const seen = new Set<string>([decoration.id]);
        let ancestor: string | undefined = part.id;
        while (ancestor) {
          if (seen.has(ancestor)) return false;
          seen.add(ancestor);
          ancestor = spread.decorations.find((d) => d.id === ancestor)?.parent;
        }
        return true;
      })
    : [];
  const runCutoutCommand = (command: () => unknown) => {
    try {
      command();
    } catch (error) {
      s.set({ notice: `Cut-out edit failed: ${(error as Error).message}` });
    }
  };
  const edit = (label: string, fn: (spread: typeof compiled.spread, project: Project) => void) =>
    s.edit(label, (p) =>
      fn(
        p.spreads.find((p) => p.id === spread.id)!,
        p,
      ),
    );
  const update = (key: keyof Mechanism, value: number | string) =>
    mechanism &&
    edit('Mechanism updated', (sp) => {
      const m = sp.mechanisms.find((m) => m.id === mechanism.id)!,
        old = structuredClone(m);
      Object.assign(m, { [key]: value });
      if (['width', 'reach', 'left', 'right', 'beta'].includes(key)) resizeOutlines(m, old);
    });
  const related = [
    ...s.diagnostics,
    ...pose.diagnostics,
    ...validateDigitalObjects(compiled, pose),
  ].filter((d) => d.partIds.some((id) => id === s.selectedId || id === mechanism?.id));
  const tabs = selected ? partTabs(selected, compiled) : [];
  return (
    <aside className="right-panel">
      <div className="panel-label">
        {digital
          ? 'DIGITAL CONTENT'
          : selected || mechanism
            ? 'PART PROPERTIES'
            : 'SPREAD PROPERTIES'}
        <button
          className="icon-button mobile-close"
          onClick={onClose}
          aria-label="Close properties"
        >
          <X size={17} />
        </button>
        <Settings2 size={15} />
      </div>
      <div className="inspector-intro">
        <span className="inspector-symbol">
          {digital ? (
            <Box size={24} />
          ) : mechanism || selected ? (
            <Layers3 size={24} />
          ) : (
            <BookOpen size={24} />
          )}
        </span>
        <h2>{digital?.name ?? selected?.name ?? mechanism?.name ?? spread.name}</h2>
        <p>
          {digital
            ? 'Digital only · follows its paper parent'
            : mechanism
              ? PRESETS.find((p) => p.kind === mechanism.kind)?.description
              : 'Select a part to shape its geometry.'}
        </p>
      </div>
      {related.length > 0 && <div className="inline-issue">{related[0].message}</div>}
      {digital ? (
        <DigitalInspector object={digital} compiled={compiled} pose={pose} />
      ) : mechanism ? (
        <>
          <div className="inspector-section">
            <h3>Mechanism</h3>
            <TextField
              label="Mechanism name"
              value={mechanism.name}
              onChange={(v) => update('name', v)}
            />
            <label className="select-field">
              <span>{mechanism.kind === 'slider' ? 'Parent panel' : 'Host hinge'}</span>
              <select
                aria-label="Host attachment"
                value={mechanism.host}
                onChange={(e) => update('host', e.target.value)}
              >
                {mechanism.kind === 'slider'
                  ? pose.parts
                      .filter((p) => p.mechanismId !== mechanism.id && p.role !== 'decoration')
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))
                  : pose.hinges
                      .filter((h) => h.id !== `${mechanism.id}:ridge`)
                      .map((h) => (
                        <option key={h.id} value={h.id}>
                          {h.id === 'spine'
                            ? 'Book spine'
                            : `${spread.mechanisms.find((m) => h.id.startsWith(m.id))?.name} · ridge`}
                        </option>
                      ))}
                {!pose.hinges.some((h) => h.id === mechanism.host) &&
                  !pose.parts.some((p) => p.id === mechanism.host) && (
                    <option value={mechanism.host}>Missing host</option>
                  )}
              </select>
            </label>
            <NumberField
              label="Along hinge"
              value={mechanism.offset}
              onChange={(v) => update('offset', v)}
            />
            <NumberField
              label="Width"
              value={mechanism.width}
              onChange={(v) => update('width', v)}
            />
            <NumberField
              label="Closed reach"
              value={mechanism.reach}
              onChange={(v) => update('reach', v)}
            />
            {mechanism.kind === 'vfold' ? (
              <>
                <NumberField
                  label="Base angle"
                  value={mechanism.alpha}
                  unit="°"
                  onChange={(v) => update('alpha', v)}
                />
                <NumberField
                  label="Panel angle"
                  value={mechanism.beta}
                  unit="°"
                  onChange={(v) => update('beta', v)}
                />
              </>
            ) : (
              <>
                <NumberField
                  label={mechanism.kind === 'slider' ? 'Across panel' : 'Left anchor'}
                  value={mechanism.left}
                  onChange={(v) => update('left', v)}
                />
                {mechanism.kind === 'tent' && (
                  <NumberField
                    label="Right anchor"
                    value={mechanism.right}
                    onChange={(v) => update('right', v)}
                  />
                )}
              </>
            )}
            {mechanism.kind !== 'slider' && (
              <label className="select-field">
                <span>Assembly side</span>
                <select
                  aria-label="Assembly side"
                  value={mechanism.branch}
                  onChange={(e) => update('branch', +e.target.value)}
                >
                  <option value="1">Interior fold</option>
                  <option value="-1">Exterior fold</option>
                </select>
              </label>
            )}
            {mechanism.kind === 'slider' && (
              <>
                <NumberField
                  label="Travel"
                  value={mechanism.stroke}
                  onChange={(v) => update('stroke', v)}
                />
                <label className="range-property">
                  <span>
                    Pull-tab position{' '}
                    <output>{Math.round((s.drivers[mechanism.id] ?? 0) * 100)}%</output>
                  </span>
                  <input
                    aria-label="Pull-tab position"
                    type="range"
                    min="0"
                    max="1"
                    step=".01"
                    value={s.drivers[mechanism.id] ?? 0}
                    onChange={(e) =>
                      s.set({ drivers: { ...s.drivers, [mechanism.id]: +e.target.value } })
                    }
                  />
                </label>
              </>
            )}
            <label className="property-row">
              <span>Paper color</span>
              <input
                type="color"
                aria-label="Paper color"
                value={mechanism.color}
                onChange={(e) => update('color', e.target.value)}
              />
            </label>
            {mechanism.kind !== 'slider' && (
              <div className="paired-buttons">
                <button
                  onClick={() => s.set({ selectedId: `${mechanism.id}:left` })}
                  className={selected?.role === 'left' ? 'active' : ''}
                >
                  Left panel
                </button>
                <button
                  onClick={() => s.set({ selectedId: `${mechanism.id}:right` })}
                  className={selected?.role === 'right' ? 'active' : ''}
                >
                  Right panel
                </button>
              </div>
            )}
          </div>
          {mechanism.kind !== 'slider' && (
            <div className="inspector-section">
              <h3>Build on this fold</h3>
              <p className="small-note">Attach a new mechanism across this moving ridge.</p>
              <div className="paired-buttons">
                <button onClick={() => s.addPreset('vfold', `${mechanism.id}:ridge`)}>
                  <Plus size={13} />
                  V-fold
                </button>
                <button onClick={() => s.addPreset('tent', `${mechanism.id}:ridge`)}>
                  <Plus size={13} />
                  Tent
                </button>
              </div>
            </div>
          )}
        </>
      ) : decoration ? (
        <div className="inspector-section">
          <h3>{decoration.cutout ? 'Illustrated cut-out' : 'Paper decoration'}</h3>
          <TextField
            label="Part name"
            value={decoration.name}
            onChange={(v) =>
              edit('Part renamed', (sp) => {
                sp.decorations.find((d) => d.id === decoration.id)!.name = v;
              })
            }
          />
          <label className="select-field">
            <span>Rigid parent</span>
            <select
              aria-label="Decoration parent"
              value={decoration.parent}
              onChange={(e) =>
                decoration.cutout
                  ? runCutoutCommand(() =>
                      s.transformCutout(decoration.id, { parent: e.target.value }),
                    )
                  : edit('Decoration attached', (sp) => {
                      sp.decorations.find((d) => d.id === decoration.id)!.parent = e.target.value;
                    })
              }
            >
              {!parentOptions.some((p) => p.id === decoration.parent) && (
                <option value={decoration.parent} disabled>
                  Missing or invalid support · choose a panel
                </option>
              )}
              {parentOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          {['X', 'Y'].map((axis, i) => (
            <NumberField
              key={axis}
              label={`Offset ${axis}`}
              value={decoration.position[i]}
              onChange={(v) =>
                decoration.cutout
                  ? s.transformCutout(decoration.id, {
                      position: decoration.position.map((n, j) => (i === j ? v : n)) as Vec2,
                    })
                  : edit('Decoration positioned', (sp) => {
                      sp.decorations.find((d) => d.id === decoration.id)!.position[i] = v;
                    })
              }
            />
          ))}
          {decoration.cutout && (
            <>
              <NumberField
                label="Rotation"
                unit="°"
                value={decoration.rotation ?? 0}
                onChange={(rotation) => s.transformCutout(decoration.id, { rotation })}
              />
              <NumberField
                label="Cut-out width"
                value={
                  polygonBounds(decoration.outline).maxX - polygonBounds(decoration.outline).minX
                }
                onChange={(width) => {
                  const b = polygonBounds(decoration.outline);
                  if (width > 0)
                    s.transformCutout(decoration.id, {
                      scale: width / Math.max(0.01, b.maxX - b.minX),
                    });
                }}
              />
              <p className="small-note">
                Proportional sizing keeps the illustration, cut holes, and glue area aligned.
              </p>
              <div className="paired-buttons">
                <button onClick={() => s.duplicateCutout(decoration.id)}>Duplicate</button>
                <button onClick={() => onRetrace(decoration.id)}>Retrace image</button>
              </div>
              <button
                className="text-button"
                disabled={!decorationParent}
                onClick={() =>
                  runCutoutCommand(() => {
                    s.suggestCutoutGlue(decoration.id);
                    s.set({ view: 'split' });
                  })
                }
              >
                Suggest glue from overlap
              </button>
              {!decorationParent && (
                <p className="small-note">Choose an existing support above before defining glue.</p>
              )}
              <p className="small-note">
                Use the 2D placement view to move the piece, rotate it, reshape its edges, or draw a
                glue area.
              </p>
            </>
          )}
          <label className="property-row">
            <span>Paper color</span>
            <input
              aria-label="Decoration color"
              type="color"
              value={decoration.color}
              onChange={(e) =>
                edit('Decoration recolored', (sp) => {
                  sp.decorations.find((d) => d.id === decoration.id)!.color = e.target.value;
                })
              }
            />
          </label>
        </div>
      ) : (
        <div className="inspector-section">
          <h3>Book & spread</h3>
          <TextField
            label="Book title"
            value={s.project.name}
            onChange={(v) =>
              s.edit('Book renamed', (p) => {
                p.name = v;
              })
            }
          />
          <TextField
            label="Spread title"
            value={spread.name}
            onChange={(v) =>
              edit('Spread renamed', (sp) => {
                sp.name = v;
              })
            }
          />
          <NumberField
            label="Page width"
            value={s.project.pageWidth}
            onChange={(v) =>
              s.edit('Page size updated', (p) => {
                p.pageWidth = Math.max(20, Math.min(2000, v));
              })
            }
          />
          <NumberField
            label="Page height"
            value={s.project.pageHeight}
            onChange={(v) =>
              s.edit('Page size updated', (p) => {
                p.pageHeight = Math.max(20, Math.min(2000, v));
              })
            }
          />
          <p className="small-note">Dimensions apply to every spread.</p>
          <button
            className="wide-button"
            onClick={() =>
              s.edit('Unused assets removed', (p) => {
                const used = new Set(
                  p.spreads.flatMap((sp) => [
                    ...[...sp.artwork, ...sp.digital].map((a) => a.assetId),
                    ...sp.decorations.flatMap((d) => (d.cutout ? [d.cutout.assetId] : [])),
                  ]),
                );
                p.assets = Object.fromEntries(
                  Object.entries(p.assets).filter(([id]) => used.has(id)),
                );
              })
            }
          >
            Remove unused assets
          </button>
          <div className="paired-buttons">
            <button onClick={() => s.set({ selectedId: 'page-left' })}>Left page</button>
            <button onClick={() => s.set({ selectedId: 'page-right' })}>Right page</button>
          </div>
          <button
            className="text-button danger"
            disabled={s.project.spreads.length === 1}
            onClick={() => {
              const remaining = s.project.spreads.filter((p) => p.id !== spread.id);
              s.edit('Spread removed · undo available', (p) => {
                p.spreads = remaining;
              });
              s.selectSpread(remaining[0].id);
            }}
          >
            <Trash2 size={14} />
            Remove spread
          </button>
        </div>
      )}
      {selected && !digital && (
        <>
          <div className="inspector-section">
            <h3>Paper construction</h3>
            <button
              className="wide-button"
              onClick={() => s.set({ view: 'split', tool: 'select' })}
            >
              <Scissors size={15} />
              Edit outline in 2D
            </button>
            {(mechanism || decoration) && (
              <>
                <div className="paired-buttons">
                  <button
                    onClick={() =>
                      edit('Vertex added', (sp) => {
                        const points = [...selected.polygon],
                          a = points[0],
                          b = points[1];
                        points.splice(1, 0, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
                        if (mechanism)
                          sp.mechanisms.find((m) => m.id === mechanism.id)!.outlines[
                            selected.role
                          ] = points;
                        else sp.decorations.find((d) => d.id === selected.id)!.outline = points;
                      })
                    }
                  >
                    <Plus size={13} />
                    Vertex
                  </button>
                  <button onClick={() => s.set({ view: 'split', tool: 'cutout' })}>
                    <Scissors size={13} />
                    Cutout
                  </button>
                </div>
                {selected.holes.map((_, i) => (
                  <div className="item-row" key={i}>
                    <span>Cutout {i + 1}</span>
                    <button
                      aria-label={`Remove cutout ${i + 1}`}
                      onClick={() =>
                        edit('Cutout removed', (sp) => {
                          if (mechanism)
                            (sp.mechanisms.find((m) => m.id === mechanism.id)!.cutouts[
                              selected.role
                            ] = structuredClone(selected.holes)).splice(i, 1);
                          else sp.decorations.find((d) => d.id === selected.id)!.holes.splice(i, 1);
                        })
                      }
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </>
            )}
            <p className="small-note">
              {tabs.length} glue tabs · joining tabs are generated automatically.
            </p>
            <label className="select-field">
              <span>Add a glue tab</span>
              <select
                aria-label="Add glue tab on edge"
                value=""
                onChange={(e) => {
                  if (e.target.value !== '')
                    edit('Glue tab added', (sp) =>
                      sp.tabs.push({
                        id: uid('tab'),
                        partId: selected.id,
                        edge: +e.target.value,
                        depth: 6,
                      }),
                    );
                }}
              >
                <option value="">Choose an outline edge…</option>
                {selected.polygon.map((_, i) => (
                  <option key={i} value={i}>
                    Edge {i + 1}
                  </option>
                ))}
              </select>
            </label>
            {spread.tabs
              .filter((t) => t.partId === selected.id)
              .map((t) => (
                <div className="tab-edit" key={t.id}>
                  <NumberField
                    label={`Tab ${t.edge + 1} depth`}
                    value={t.depth}
                    onChange={(v) =>
                      edit('Tab depth updated', (sp) => {
                        sp.tabs.find((tab) => tab.id === t.id)!.depth = Math.max(0.5, v);
                      })
                    }
                  />
                  <button
                    aria-label={`Remove custom tab ${t.edge + 1}`}
                    onClick={() =>
                      edit('Custom tab removed', (sp) => {
                        sp.tabs = sp.tabs.filter((tab) => tab.id !== t.id);
                      })
                    }
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
          </div>
          <div className="inspector-section">
            <h3>Artwork</h3>
            <button className="text-button" onClick={() => onImport('cutout')}>
              <Scissors size={14} />
              Glue image cut-out
            </button>
            <div className="paired-buttons">
              <button onClick={() => onImport('image')}>
                <ImagePlus size={14} />
                Image
              </button>
              <button onClick={() => onImport('model')}>
                <Box size={14} />
                3D model
              </button>
            </div>
            {spread.artwork
              .filter((a) => a.partId === selected.id)
              .map((a) => (
                <div className="artwork-controls" key={a.id}>
                  <div className="item-row">
                    <strong>{s.project.assets[a.assetId]?.name ?? 'Missing image'}</strong>
                    <button
                      aria-label="Remove artwork"
                      onClick={() =>
                        edit('Artwork removed', (sp) => {
                          sp.artwork = sp.artwork.filter((image) => image.id !== a.id);
                        })
                      }
                    >
                      <X size={14} />
                    </button>
                  </div>
                  {!decoration?.cutout &&
                    (['x', 'y', 'width', 'height'] as const).map((key) => (
                      <NumberField
                        key={key}
                        label={`Image ${key}`}
                        value={a[key]}
                        onChange={(v) =>
                          edit('Artwork positioned', (sp) => {
                            sp.artwork.find((image) => image.id === a.id)![key] =
                              key === 'width' || key === 'height' ? Math.max(0.1, v) : v;
                          })
                        }
                      />
                    ))}
                </div>
              ))}
          </div>
        </>
      )}
      {(mechanism || digital || decoration) && (
        <button className="text-button danger" onClick={s.deleteSelected}>
          <Trash2 size={14} />
          Remove {digital ? 'digital object' : 'mechanism / part'}
        </button>
      )}
      <div className="inspector-section">
        <h3>
          Structure <span>{spread.mechanisms.length}</span>
        </h3>
        <div className="structure-tree">
          <button onClick={() => s.set({ selectedId: null })}>
            <BookOpen size={15} />
            Book spine
          </button>
          {spread.mechanisms.map((m) => (
            <button
              key={m.id}
              className={mechanism?.id === m.id ? 'selected' : ''}
              style={{ marginLeft: m.host === 'spine' || m.host.startsWith('page-') ? 10 : 22 }}
              onClick={() =>
                s.set({ selectedId: `${m.id}:${m.kind === 'slider' ? 'strip' : 'left'}` })
              }
            >
              <span className="tree-line" />
              <span className="color-chip" style={{ background: m.color }} />
              {m.name}
            </button>
          ))}
          {spread.decorations.map((d) => (
            <button key={d.id} onClick={() => s.set({ selectedId: d.id })}>
              <Layers3 size={14} />
              {d.name}
            </button>
          ))}
          {spread.digital.map((d) => (
            <button
              key={d.id}
              className={s.selectedId === d.id ? 'selected' : ''}
              onClick={() => s.set({ selectedId: d.id })}
            >
              <Box size={14} />
              {d.name}
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}
