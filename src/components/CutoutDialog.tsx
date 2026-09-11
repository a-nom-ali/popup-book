import { useEffect, useRef, useState } from 'react';
import { Loader2, Scissors, X } from 'lucide-react';
import type { Asset } from '../model';
import type { TraceResult } from '../engine/trace';
import { traceImage } from '../io/trace';
import { svgPath } from '../engine/polygon';
import { useStudio } from '../store';

export interface CutoutRequest {
  asset: Asset;
  parentId: string;
  spreadId: string;
  projectId: string;
  retraceId?: string;
  initialTrace?: TraceResult;
}
export default function CutoutDialog({
  request,
  onClose,
}: {
  request: CutoutRequest;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const original = useStudio
    .getState()
    .project.spreads.find((s) => s.id === request.spreadId)
    ?.decorations.find((d) => d.id === request.retraceId)?.cutout;
  const [width, setWidth] = useState(original?.width ?? request.initialTrace?.width ?? 60);
  const [threshold, setThreshold] = useState(original?.threshold ?? 0.5);
  const [tolerance, setTolerance] = useState(original?.tolerance ?? 0.25);
  const [trace, setTrace] = useState<TraceResult | null>(request.initialTrace ?? null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [showImage, setShowImage] = useState(true);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setError('');
    const timer = setTimeout(() => {
      traceImage(request.asset, { width, threshold, tolerance })
        .then((result) => {
          if (!cancelled) {
            setTrace(result);
            setBusy(false);
          }
        })
        .catch((e) => {
          if (!cancelled) {
            setError((e as Error).message);
            setTrace(null);
            setBusy(false);
          }
        });
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [request.asset, width, threshold, tolerance]);
  const apply = () => {
    if (!trace || busy || !trace.pieces.length) return;
    try {
      const s = useStudio.getState();
      if (s.project.id !== request.projectId || s.activeSpreadId !== request.spreadId)
        throw new Error('The destination changed. Close this preview and select a panel again.');
      if (request.retraceId) s.retraceCutout(request.retraceId, trace);
      else
        s.insertCutout(request.asset, trace, request.parentId, {
          name: request.asset.name.replace(/\.[^.]+$/, ''),
        });
      s.set({ view: 'split', tool: 'select' });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <dialog ref={dialog} className="export-dialog cutout-dialog" onCancel={onClose}>
      <div className="dialog-header">
        <div>
          <span className="eyebrow">ILLUSTRATED PAPER</span>
          <h2>{request.retraceId ? 'Retrace cut-out' : 'Glue image cut-out'}</h2>
        </div>
        <button className="icon-button" aria-label="Close cut-out preview" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      <p className="dialog-description">
        {request.retraceId
          ? 'Retracing replaces all pieces from this image trace, using this piece’s placement and size. Undo restores the previous outlines and placements.'
          : 'Opaque pixels become paper. Transparent windows become cut holes. Place the pieces on their support after inserting.'}
      </p>
      <div className="cutout-preview checkerboard">
        {trace && (
          <svg
            viewBox={`-3 -3 ${trace.width + 6} ${trace.height + 6}`}
            aria-label="Traced image silhouette preview"
          >
            {showImage && (
              <image
                href={request.asset.data}
                width={trace.width}
                height={trace.height}
                preserveAspectRatio="none"
              />
            )}
            {trace.pieces.map((piece, i) => (
              <g key={i}>
                <path
                  d={[svgPath(piece.outline), ...piece.holes.map(svgPath)].join(' ')}
                  fill={showImage ? 'none' : '#fffdf7'}
                  fillRule="evenodd"
                  stroke="#ce684b"
                  strokeWidth=".3"
                />
                <text x={piece.outline[0][0]} y={piece.outline[0][1]} fill="#1d392f" fontSize="3">
                  {i + 1}
                </text>
              </g>
            ))}
          </svg>
        )}
        {busy && (
          <span className="trace-busy">
            <Loader2 className="spinner" size={18} />
            Tracing silhouette…
          </span>
        )}
      </div>
      <div className="trace-controls">
        <label>
          Image width{' '}
          <div>
            <input
              aria-label="Cut-out image width"
              type="number"
              min="1"
              max="2000"
              disabled={!!request.retraceId}
              value={width}
              onChange={(e) => setWidth(Math.max(1, Math.min(2000, +e.target.value || 1)))}
            />{' '}
            mm
          </div>
        </label>
        <label>
          Opacity threshold{' '}
          <div>
            <input
              aria-label="Opacity threshold"
              type="range"
              min="1"
              max="100"
              value={threshold * 100}
              onChange={(e) => setThreshold(+e.target.value / 100)}
            />
            <output>{Math.round(threshold * 100)}%</output>
          </div>
        </label>
        <label>
          Contour detail{' '}
          <select
            aria-label="Contour detail"
            value={tolerance}
            onChange={(e) => setTolerance(+e.target.value)}
          >
            {![0.1, 0.25, 0.5, 1].includes(tolerance) && (
              <option value={tolerance}>Current · {tolerance.toFixed(3)} mm</option>
            )}
            <option value="0.1">Fine · 0.1 mm</option>
            <option value="0.25">Balanced · 0.25 mm</option>
            <option value="0.5">Simple · 0.5 mm</option>
            <option value="1">Bold · 1 mm</option>
          </select>
        </label>
      </div>
      <label className="preview-toggle">
        <input
          type="checkbox"
          checked={showImage}
          onChange={(e) => setShowImage(e.target.checked)}
        />{' '}
        Show illustration
      </label>
      {trace && (
        <p className="trace-summary">
          <strong>
            {trace.pieces.length} separate paper {trace.pieces.length === 1 ? 'piece' : 'pieces'}
          </strong>{' '}
          · {trace.pieces.reduce((n, p) => n + p.holes.length, 0)} cut holes ·{' '}
          {trace.width.toFixed(1)} × {trace.height.toFixed(1)} mm
          <br />
          {trace.pieces.length > 1
            ? 'Each disconnected region gets its own editable piece and glue area.'
            : 'Image proportions and transparent margins stay registered to the outline.'}
        </p>
      )}
      {trace?.warnings.map((warning, i) => (
        <p className="small-note" key={i}>
          {warning}
        </p>
      ))}
      {error && (
        <p role="alert" className="inline-issue">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <button className="button subtle" onClick={onClose}>
          Cancel
        </button>
        <button className="button primary" disabled={busy || !trace?.pieces.length} onClick={apply}>
          <Scissors size={16} />
          {request.retraceId
            ? 'Apply trace'
            : `Insert ${trace?.pieces.length || ''} ${trace?.pieces.length === 1 ? 'piece' : 'pieces'}`}
        </button>
      </div>
    </dialog>
  );
}
