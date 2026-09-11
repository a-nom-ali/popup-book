import { useMemo, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import {
  Check,
  Crosshair,
  Magnet,
  MousePointer2,
  Pentagon,
  Scissors,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { CompiledSpread } from '../engine/geometry';
import { evaluateSpread, polygonBounds } from '../engine/geometry';
import { svgPath, makeTab } from '../engine/polygon';
import { partTabs } from '../engine/fabrication';
import type { Vec2 } from '../model';
import { uid } from '../model';
import { useStudio } from '../store';
import CutoutPlacement from './CutoutPlacement';

export default function FlatEditor({ compiled }: { compiled: CompiledSpread }) {
  const selectedId = useStudio((s) => s.selectedId);
  const decoration = compiled.spread.decorations.find((d) => d.id === selectedId);
  const pose = useMemo(() => evaluateSpread(compiled, 180), [compiled]);
  if (decoration?.cutout)
    return (
      <CutoutPlacement
        key={decoration.id}
        compiled={compiled}
        decoration={decoration}
        parent={pose.parts.find((p) => p.id === decoration.parent)}
      />
    );
  return <PaperEditor compiled={compiled} />;
}

function PaperEditor({ compiled }: { compiled: CompiledSpread }) {
  const s = useStudio(),
    svg = useRef<SVGSVGElement>(null),
    drag = useRef<number | null>(null);
  const [drawing, setDrawing] = useState<Vec2[]>([]),
    [zoom, setZoom] = useState(1);
  const [dragViewport, setDragViewport] = useState<string | null>(null);
  const pose = useMemo(() => evaluateSpread(compiled, 180), [compiled]);
  const part =
    pose.parts.find((p) => p.id === s.selectedId) ?? pose.parts.find((p) => p.id === 'page-right')!;
  const bounds = polygonBounds(part.polygon),
    w = Math.max(bounds.maxX - bounds.minX, 30),
    h = Math.max(bounds.maxY - bounds.minY, 30),
    pad = 22;
  const vw = (w + pad * 2) / zoom,
    vh = (h + pad * 2) / zoom,
    vx = (bounds.minX + bounds.maxX - vw) / 2,
    vy = (bounds.minY + bounds.maxY - vh) / 2;
  const cursorPoint = (e: PointerEvent) => {
    const p = svg.current!.createSVGPoint();
    p.x = e.clientX;
    p.y = e.clientY;
    const result = p.matrixTransform(svg.current!.getScreenCTM()!.inverse());
    return [
      s.snap ? Math.round(result.x) : Math.round(result.x * 10) / 10,
      s.snap ? Math.round(result.y) : Math.round(result.y * 10) / 10,
    ] as Vec2;
  };
  const editable = !!part.mechanismId || part.role === 'decoration';
  const finish = () => {
    const points = drawing.filter(
      (p, i) => i === 0 || Math.hypot(p[0] - drawing[i - 1][0], p[1] - drawing[i - 1][1]) > 0.01,
    );
    if (points.length < 3) return;
    if (s.tool === 'cutout') {
      if (editable) s.updateOutline(part.id, points, true);
      else s.set({ notice: 'Choose a mechanism panel or decoration before cutting a hole.' });
    } else {
      const id = uid('paper');
      s.edit('Custom paper part added', (p) => {
        const d = {
          id,
          name: 'Custom paper',
          parent: part.id,
          outline: points,
          holes: [],
          position: [0, 0] as Vec2,
          color: '#dba98a',
        };
        p.spreads.find((p) => p.id === s.activeSpreadId)!.decorations.push(d);
      });
      s.set({ selectedId: id });
    }
    setDrawing([]);
    s.set({ tool: 'select' });
  };
  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (s.tool !== 'select') setDrawing([...drawing, cursorPoint(e)]);
  };
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    if (drag.current === null) return;
    const polygon = [...part.polygon];
    polygon[drag.current] = cursorPoint(e);
    s.updateOutline(part.id, polygon, false, false);
  };
  const endDrag = () => {
    drag.current = null;
    setDragViewport(null);
  };
  const images = compiled.spread.artwork.filter((a) => a.partId === part.id);
  const tabs = partTabs(part, compiled);
  return (
    <div className="flat-editor">
      <div className="flat-toolbar">
        <span className="surface-label">{part.name.toUpperCase()}</span>
        <div className="flat-tools">
          {[
            { tool: 'select', label: 'Edit vertices', Icon: MousePointer2 },
            { tool: 'draw', label: 'Draw paper part', Icon: Pentagon },
            { tool: 'cutout', label: 'Draw cutout', Icon: Scissors },
          ].map(({ tool, label, Icon }) => (
            <button
              key={tool}
              title={label}
              aria-label={label}
              className={`canvas-button ${s.tool === tool ? 'active' : ''}`}
              onClick={() => {
                s.set({ tool: tool as typeof s.tool });
                setDrawing([]);
              }}
            >
              <Icon size={15} />
            </button>
          ))}
          <button
            className={`canvas-button ${s.snap ? 'active' : ''}`}
            onClick={() => s.set({ snap: !s.snap })}
            title="Toggle 1 mm snapping"
            aria-label="Toggle snapping"
          >
            <Magnet size={15} />
          </button>
          <button
            className="canvas-button"
            onClick={() => setZoom(Math.min(4, zoom * 1.2))}
            title="Zoom in flat view"
            aria-label="Zoom in flat view"
          >
            <ZoomIn size={15} />
          </button>
          <button
            className="canvas-button"
            onClick={() => setZoom(Math.max(0.5, zoom / 1.2))}
            title="Zoom out flat view"
            aria-label="Zoom out flat view"
          >
            <ZoomOut size={15} />
          </button>
        </div>
      </div>
      <svg
        ref={svg}
        className="flat-canvas"
        viewBox={dragViewport ?? `${vx} ${vy} ${vw} ${vh}`}
        onPointerDown={onPointerDown}
        onPointerMove={onMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={finish}
        aria-label={`2D pattern for ${part.name}`}
      >
        <defs>
          <pattern id="pattern-grid" width="5" height="5" patternUnits="userSpaceOnUse">
            <path d="M5 0H0V5" fill="none" stroke="#b2c0a9" strokeWidth=".14" />
          </pattern>
          <clipPath id="part-clip">
            <path
              d={[svgPath(part.polygon), ...part.holes.map(svgPath)].join(' ')}
              clipRule="evenodd"
            />
          </clipPath>
          <pattern
            id="glue-hatch"
            width="3"
            height="3"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line x1="0" y1="0" x2="0" y2="3" stroke="#719778" strokeWidth=".45" />
          </pattern>
        </defs>
        <rect x={vx} y={vy} width={vw} height={vh} fill="url(#pattern-grid)" opacity=".5" />
        <path
          d={[svgPath(part.polygon), ...part.holes.map(svgPath)].join(' ')}
          fill={part.color}
          fillRule="evenodd"
          stroke="#df825a"
          strokeWidth=".45"
        />
        {images.map((image) => (
          <image
            key={image.id}
            href={compiled.project.assets[image.assetId]?.data}
            x={image.x}
            y={image.y}
            width={image.width}
            height={image.height}
            clipPath="url(#part-clip)"
            preserveAspectRatio="none"
          />
        ))}
        {tabs.map((tab) => (
          <path
            key={tab.id}
            d={svgPath(tab.polygon)}
            fill="url(#glue-hatch)"
            stroke="#679575"
            strokeWidth=".35"
          />
        ))}
        {part.folds.map((fold, i) => (
          <g key={i}>
            <line
              x1={fold.a[0]}
              y1={fold.a[1]}
              x2={fold.b[0]}
              y2={fold.b[1]}
              stroke={fold.kind === 'mountain' ? '#706bae' : '#4d8ca0'}
              strokeWidth=".55"
              strokeDasharray={fold.kind === 'mountain' ? '3 1 .5 1' : '2 1.5'}
            />
          </g>
        ))}
        <line
          x1={bounds.minX}
          y1={bounds.maxY + 9}
          x2={bounds.maxX}
          y2={bounds.maxY + 9}
          stroke="#8c9c80"
          strokeWidth=".2"
        />
        <text
          x={(bounds.minX + bounds.maxX) / 2}
          y={bounds.maxY + 14}
          textAnchor="middle"
          fontSize="3"
          fill="#65775a"
        >
          {Math.round((bounds.maxX - bounds.minX) * 10) / 10} mm
        </text>
        {editable &&
          s.tool === 'select' &&
          part.polygon.map((p, i) => (
            <circle
              key={i}
              cx={p[0]}
              cy={p[1]}
              r={vw / 130}
              fill="#fffefa"
              stroke="#d4764f"
              strokeWidth=".5"
              style={{ cursor: 'move' }}
              aria-label={`Vertex ${i + 1}`}
              onPointerDown={(e) => {
                e.stopPropagation();
                s.checkpoint();
                setDragViewport(`${vx} ${vy} ${vw} ${vh}`);
                drag.current = i;
                svg.current!.setPointerCapture(e.pointerId);
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                if (part.polygon.length > 3)
                  s.updateOutline(
                    part.id,
                    part.polygon.filter((_, index) => i !== index),
                  );
              }}
            />
          ))}
        {drawing.length > 0 && (
          <>
            <polyline
              points={drawing.map((p) => p.join(',')).join(' ')}
              fill="#d9a47e33"
              stroke="#c26d45"
              strokeWidth=".5"
              strokeDasharray="2 1"
            />
            {drawing.map((p, i) => (
              <circle key={i} cx={p[0]} cy={p[1]} r=".9" fill="#c26d45" />
            ))}
          </>
        )}
      </svg>
      {s.tool !== 'select' ? (
        <div className="draw-controls">
          <span>Click to add vertices · {drawing.length} points</span>
          <button disabled={drawing.length < 3} onClick={finish}>
            <Check size={14} />
            Finish
          </button>
          <button
            onClick={() => {
              setDrawing([]);
              s.set({ tool: 'select' });
            }}
          >
            <X size={14} />
            Cancel
          </button>
        </div>
      ) : (
        <div className="flat-hint">
          {editable
            ? 'Drag vertices to reshape · Double-click a vertex to remove'
            : 'Select a panel in Structure, or draw a part on this page'}
          <span>{s.snap ? '1 mm snap' : 'Free positioning'}</span>
        </div>
      )}
      <div className="fold-legend">
        <span className="cut">Cut</span>
        <span className="valley">Valley fold</span>
        <span className="mountain">Mountain fold</span>
        <span className="glue">Glue tab</span>
      </div>
    </div>
  );
}
