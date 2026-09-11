import { useEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import {
  Check,
  Magnet,
  Move,
  MousePointer2,
  Pentagon,
  RotateCw,
  Scissors,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { CompiledSpread, PaperPart } from '../engine/geometry';
import { polygonBounds } from '../engine/geometry';
import type { PaperDecoration, PaperRegion, Vec2 } from '../model';
import { useStudio } from '../store';
import { svgPath } from '../engine/polygon';
import {
  cutoutToParent,
  parentToCutout,
  glueRegionValid,
  mapRegions,
  regionArea,
} from '../engine/cutouts';

type Drag = {
  mode: 'move' | 'rotate' | 'scale' | 'glue' | 'vertex';
  start: Vec2;
  decoration: PaperDecoration;
  vertex?: number;
  ring?: number;
  started?: boolean;
};
const path = (region: PaperRegion) =>
  [svgPath(region.outline), ...region.holes.map(svgPath)].join(' ');
export default function CutoutPlacement({
  compiled,
  decoration: d,
  parent,
}: {
  compiled: CompiledSpread;
  decoration: PaperDecoration;
  parent?: PaperPart;
}) {
  const s = useStudio(),
    svg = useRef<SVGSVGElement>(null),
    drag = useRef<Drag | null>(null);
  const [tool, setTool] = useState<'move' | 'reshape' | 'glue' | 'glue-move' | 'hole'>('move');
  const [drawing, setDrawing] = useState<Vec2[]>([]),
    [frozen, setFrozen] = useState<string | null>(null),
    [zoom, setZoom] = useState(1);
  useEffect(() => {
    if (s.tool === 'cutout') {
      setTool('hole');
      setDrawing([]);
      s.set({ tool: 'select' });
    }
  }, [s.tool]);
  const silhouette = d.outline.map((p) => cutoutToParent(d, p));
  const b = polygonBounds([...silhouette, ...(parent?.polygon ?? [])]);
  const w = Math.max(30, b.maxX - b.minX + 30) / zoom,
    h = Math.max(30, b.maxY - b.minY + 30) / zoom;
  const vx = (b.minX + b.maxX - w) / 2,
    vy = (b.minY + b.maxY - h) / 2,
    view = `${vx} ${vy} ${w} ${h}`;
  const db = polygonBounds(d.outline),
    center: Vec2 = [(db.minX + db.maxX) / 2, (db.minY + db.maxY) / 2];
  const valid = !!parent && glueRegionValid(d, parent),
    ink = compiled.spread.artwork.filter((a) => a.partId === d.id);
  const point = (e: PointerEvent): Vec2 => {
    const p = svg.current!.createSVGPoint();
    p.x = e.clientX;
    p.y = e.clientY;
    const result = p.matrixTransform(svg.current!.getScreenCTM()!.inverse());
    return [result.x, result.y];
  };
  const snap = (p: Vec2): Vec2 =>
    p.map((n) => (s.snap ? Math.round(n) : Math.round(n * 100) / 100)) as Vec2;
  const begin = (e: PointerEvent, mode: Drag['mode'], vertex?: number, ring?: number) => {
    e.stopPropagation();
    e.preventDefault();
    setFrozen(view);
    drag.current = { mode, start: point(e), decoration: structuredClone(d), vertex, ring };
    svg.current!.setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent) => {
    const state = drag.current;
    if (!state) return;
    const now = point(e),
      old = state.decoration,
      delta: Vec2 = [now[0] - state.start[0], now[1] - state.start[1]];
    if (!state.started) {
      if (Math.hypot(...delta) < 0.2) return;
      s.checkpoint();
      state.started = true;
    }
    if (state.mode === 'move')
      s.transformCutout(
        d.id,
        { position: snap([old.position[0] + delta[0], old.position[1] + delta[1]]) },
        false,
      );
    else if (state.mode === 'rotate') {
      const a =
        Math.atan2(now[1] - old.position[1], now[0] - old.position[0]) -
        Math.atan2(state.start[1] - old.position[1], state.start[0] - old.position[0]);
      s.transformCutout(
        d.id,
        {
          rotation:
            Math.round(((old.rotation ?? 0) + (a * 180) / Math.PI) / (s.snap ? 5 : 1)) *
            (s.snap ? 5 : 1),
        },
        false,
      );
    } else if (state.mode === 'scale') {
      const size = Math.hypot(now[0] - old.position[0], now[1] - old.position[1]),
        initial = Math.hypot(state.start[0] - old.position[0], state.start[1] - old.position[1]);
      const target = Math.max(0.05, Math.min(20, size / Math.max(0.01, initial)));
      const current = useStudio
        .getState()
        .project.spreads.find((sp) => sp.id === compiled.spread.id)!
        .decorations.find((p) => p.id === d.id)!;
      s.transformCutout(
        d.id,
        { scale: (target * old.cutout!.width) / current.cutout!.width },
        false,
      );
    } else if (state.mode === 'glue') {
      const a = parentToCutout(old, state.start),
        c = parentToCutout(old, now),
        delta = snap([c[0] - a[0], c[1] - a[1]]);
      s.setCutoutGlue(
        d.id,
        mapRegions(old.glueRegion ?? [], ([x, y]) => [x + delta[0], y + delta[1]]),
        false,
      );
    } else {
      const cursor = snap(parentToCutout(d, now));
      if (state.ring === undefined) {
        const outline = [...d.outline];
        outline[state.vertex!] = cursor;
        s.updateOutline(d.id, outline, false, false);
      } else
        s.edit(
          'Cut hole reshaped',
          (p) => {
            p.spreads
              .find((sp) => sp.id === compiled.spread.id)!
              .decorations.find((p) => p.id === d.id)!.holes[state.ring!][state.vertex!] = cursor;
          },
          false,
        );
    }
  };
  const end = () => {
    drag.current = null;
    setFrozen(null);
  };
  const finishGlue = () => {
    const points = drawing.filter(
      (p, i) => i === 0 || Math.hypot(p[0] - drawing[i - 1][0], p[1] - drawing[i - 1][1]) > 0.01,
    );
    if (points.length >= 3) {
      if (tool === 'hole') s.updateOutline(d.id, points, true);
      else s.setCutoutGlue(d.id, [{ outline: points, holes: [] }]);
      setDrawing([]);
      setTool(tool === 'hole' ? 'reshape' : 'glue-move');
    }
  };
  const vertex = (p: Vec2, i: number, ring?: number) => (
    <circle
      key={`${ring ?? 'outer'}-${i}`}
      cx={p[0]}
      cy={p[1]}
      r={w / 160}
      fill="#fffdf7"
      stroke="#cc714e"
      strokeWidth=".35"
      aria-label={`${ring === undefined ? 'Outline' : 'Hole ' + (ring + 1)} vertex ${i + 1}`}
      style={{ cursor: 'move' }}
      onPointerDown={(e) => begin(e, 'vertex', i, ring)}
      onDoubleClick={(e) => {
        e.stopPropagation();
        const points = ring === undefined ? d.outline : d.holes[ring];
        if (points.length > 3) {
          if (ring === undefined)
            s.updateOutline(
              d.id,
              points.filter((_, j) => i !== j),
            );
          else
            s.edit('Hole vertex removed', (p) => {
              p.spreads
                .find((sp) => sp.id === compiled.spread.id)!
                .decorations.find((p) => p.id === d.id)!.holes[ring] = points.filter(
                (_, j) => j !== i,
              );
            });
        }
      }}
    />
  );
  return (
    <div className="flat-editor cutout-placement">
      <div className="flat-toolbar">
        <span className="surface-label">GLUE PLACEMENT · {d.name}</span>
        <div className="flat-tools">
          {(
            [
              { id: 'move', label: 'Move cut-out', Icon: Move },
              { id: 'reshape', label: 'Reshape cut-out', Icon: MousePointer2 },
              { id: 'glue', label: 'Draw glue area', Icon: Pentagon },
              { id: 'glue-move', label: 'Move glue area', Icon: RotateCw },
              { id: 'hole', label: 'Draw cut hole', Icon: Scissors },
            ] as const
          ).map(({ id, label, Icon }) => (
            <button
              key={id}
              className={`canvas-button ${tool === id ? 'active' : ''}`}
              title={label}
              aria-label={label}
              onClick={() => {
                setTool(id);
                setDrawing([]);
              }}
            >
              <Icon size={15} />
            </button>
          ))}
          <button
            className="canvas-button"
            aria-label="Zoom in placement"
            onClick={() => setZoom(Math.min(4, zoom * 1.25))}
          >
            <ZoomIn size={15} />
          </button>
          <button
            className={`canvas-button ${s.snap ? 'active' : ''}`}
            aria-label="Toggle placement snapping"
            title="Toggle 1 mm / 5° snapping"
            onClick={() => s.set({ snap: !s.snap })}
          >
            <Magnet size={15} />
          </button>
          <button
            className="canvas-button"
            aria-label="Zoom out placement"
            onClick={() => setZoom(Math.max(0.4, zoom / 1.25))}
          >
            <ZoomOut size={15} />
          </button>
        </div>
      </div>
      <svg
        ref={svg}
        className="flat-canvas"
        viewBox={frozen ?? view}
        aria-label={`Glue placement for ${d.name}`}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onPointerDown={(e) => {
          if (tool === 'glue' || tool === 'hole')
            setDrawing([...drawing, snap(parentToCutout(d, point(e)))]);
        }}
        onDoubleClick={() => {
          if (tool === 'glue' || tool === 'hole') finishGlue();
        }}
      >
        <defs>
          <pattern id="placement-grid" width="5" height="5" patternUnits="userSpaceOnUse">
            <path d="M5 0H0V5" fill="none" stroke="#9caf9e" strokeWidth=".15" />
          </pattern>
          <pattern
            id="placement-glue"
            width="2"
            height="2"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <path d="M0 0V2" stroke={valid ? '#368665' : '#c65042'} strokeWidth=".65" />
          </pattern>
          <clipPath id="cutout-art-clip">
            <path d={path(d)} clipRule="evenodd" />
          </clipPath>
        </defs>
        <rect
          x={vx - w}
          y={vy - h}
          width={w * 3}
          height={h * 3}
          fill="url(#placement-grid)"
          opacity=".35"
        />
        {parent && (
          <g>
            <path
              d={path({ outline: parent.polygon, holes: parent.holes })}
              fill="#e1e5d9"
              stroke="#92a38b"
              strokeWidth=".4"
              strokeDasharray="2 1"
              fillRule="evenodd"
            />
            {parent.folds.map((f, i) => (
              <line
                key={i}
                x1={f.a[0]}
                y1={f.a[1]}
                x2={f.b[0]}
                y2={f.b[1]}
                stroke="#659ba9"
                strokeDasharray="2 1"
                strokeWidth=".5"
              />
            ))}
          </g>
        )}
        <g transform={`translate(${d.position.join(' ')}) rotate(${d.rotation ?? 0})`}>
          <g
            style={{ cursor: tool === 'move' ? 'move' : undefined }}
            onPointerDown={(e) => {
              if (tool === 'move') begin(e, 'move');
            }}
          >
            <path d={path(d)} fill="#fffdf7" fillRule="evenodd" stroke="#cb7550" strokeWidth=".4" />
            {ink.map((a) => (
              <image
                key={a.id}
                href={compiled.project.assets[a.assetId]?.data}
                x={a.x}
                y={a.y}
                width={a.width}
                height={a.height}
                preserveAspectRatio="none"
                clipPath="url(#cutout-art-clip)"
              />
            ))}
            <path d={path(d)} fill="none" stroke="#c87955" strokeWidth=".3" />
          </g>
          {(d.glueRegion ?? []).map((r, i) => (
            <path
              key={i}
              d={path(r)}
              fill="url(#placement-glue)"
              fillRule="evenodd"
              stroke={valid ? '#287951' : '#be4337'}
              strokeWidth=".5"
              opacity=".85"
              style={{
                cursor: tool === 'glue-move' ? 'move' : undefined,
                pointerEvents: tool === 'glue-move' ? 'auto' : 'none',
              }}
              onPointerDown={(e) => {
                if (tool === 'glue-move') begin(e, 'glue');
              }}
            />
          ))}
          {tool === 'reshape' && (
            <>
              {d.outline.map((p, i) => vertex(p, i))}
              {d.holes.map((ring, j) => ring.map((p, i) => vertex(p, i, j)))}
            </>
          )}
          {tool === 'move' && (
            <g>
              <rect
                x={db.minX - 2}
                y={db.minY - 2}
                width={db.maxX - db.minX + 4}
                height={db.maxY - db.minY + 4}
                fill="none"
                stroke="#61927c"
                strokeDasharray="1.5 1"
                strokeWidth=".3"
                pointerEvents="none"
              />
              <line
                x1={center[0]}
                y1={db.minY - 2}
                x2={center[0]}
                y2={db.minY - 9}
                stroke="#61927c"
                strokeWidth=".35"
              />
              <circle
                aria-label="Rotate cut-out handle"
                cx={center[0]}
                cy={db.minY - 9}
                r="2"
                fill="#fffdf7"
                stroke="#447f63"
                strokeWidth=".5"
                style={{ cursor: 'grab' }}
                onPointerDown={(e) => begin(e, 'rotate')}
              />
              <rect
                aria-label="Resize cut-out handle"
                x={db.maxX}
                y={db.maxY}
                width="3.5"
                height="3.5"
                fill="#fffdf7"
                stroke="#447f63"
                strokeWidth=".5"
                style={{ cursor: 'nwse-resize' }}
                onPointerDown={(e) => begin(e, 'scale')}
              />
            </g>
          )}
          {drawing.length > 0 && (
            <polyline
              points={drawing.map((p) => p.join(',')).join(' ')}
              fill="#5eae7c33"
              stroke="#287951"
              strokeWidth=".5"
              strokeDasharray="2 1"
            />
          )}
        </g>
      </svg>
      {tool === 'glue' || tool === 'hole' ? (
        <div className="draw-controls">
          <span>
            Click around the {tool === 'hole' ? 'cut hole' : 'glue area'} · {drawing.length} points
          </span>
          <button disabled={drawing.length < 3} onClick={finishGlue}>
            <Check size={14} />
            Finish {tool === 'hole' ? 'hole' : 'glue'}
          </button>
          <button
            onClick={() => {
              setDrawing([]);
              setTool('move');
            }}
          >
            <X size={14} />
            Cancel
          </button>
        </div>
      ) : (
        <div className="flat-hint">
          {tool === 'move'
            ? 'Drag image · Round handle rotates · Square handle resizes'
            : tool === 'reshape'
              ? 'Drag outline or hole vertices · Double-click to remove'
              : 'Drag the hatched glue area'}
          <span>mm · {s.snap ? '1 mm snap' : 'Free'}</span>
        </div>
      )}
      <div className={`glue-status ${valid ? 'valid' : 'invalid'}`}>
        <span>
          {valid
            ? `Glue fits · ${regionArea(d.glueRegion ?? []).toFixed(1)} mm²`
            : 'Glue needs attention: place material over the support'}
        </span>
        <button
          disabled={!parent}
          onClick={() => {
            try {
              s.suggestCutoutGlue(d.id);
            } catch (e) {
              s.set({ notice: (e as Error).message });
            }
          }}
        >
          Suggest glue
        </button>
      </div>
    </div>
  );
}
