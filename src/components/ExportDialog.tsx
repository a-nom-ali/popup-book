import { useEffect, useRef, useState } from 'react';
import { Box, Download, FileDown, FileImage, Loader2, X } from 'lucide-react';
import type { CompiledSpread } from '../engine/geometry';
import { validateSpread } from '../engine/validation';
import { useStudio } from '../store';
import { download, packProject, safeName } from '../io/projects';
import { useDigitalRuntime } from '../digitalRuntime';

export default function ExportDialog({
  compiled,
  onClose,
}: {
  compiled: CompiledSpread;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    [paper, setPaper] = useState<'A4' | 'Letter'>('A4'),
    [busy, setBusy] = useState(''),
    [error, setError] = useState('');
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const run = async (type: 'project' | 'svg' | 'pdf' | 'glb' | 'animated' | 'digital-demo') => {
    setError('');
    setBusy(type);
    try {
      const state = useStudio.getState(),
        name = safeName(type === 'project' ? compiled.project.name : compiled.spread.name);
      if (type === 'project') download(packProject(compiled.project), `${name}.popupbook`);
      else if (type === 'svg' || type === 'pdf') {
        const diagnostics = await validateSpread(compiled);
        if (
          useStudio.getState().project === compiled.project &&
          useStudio.getState().activeSpreadId === compiled.spread.id
        )
          state.set({ checked: true, diagnostics });
        const { exportSVG, exportPDF } = await import('../io/templates');
        if (type === 'svg')
          download(exportSVG(compiled, diagnostics), `${name}-templates.svg`, 'image/svg+xml');
        else
          download(
            await exportPDF(compiled, diagnostics, paper),
            `${name}-${paper}-templates.pdf`,
            'application/pdf',
          );
      } else {
        const { exportGLB } = await import('../io/glb');
        download(
          await exportGLB(compiled, state.angle, type === 'animated', state.drivers, {
            mode:
              type === 'animated' ? 'opening' : type === 'digital-demo' ? 'digital-demo' : 'pose',
            runtime: useDigitalRuntime.getState().getInputs(state.drivers),
          }),
          `${name}${type === 'animated' ? '-opening' : type === 'digital-demo' ? '-digital-demo' : ''}.glb`,
          'model/gltf-binary',
        );
      }
      state.set({ notice: `${type.toUpperCase()} download ready` });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  };
  return (
    <dialog
      ref={dialog}
      className="export-dialog"
      onCancel={(e) => {
        if (busy) e.preventDefault();
        else onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="dialog-header">
        <div>
          <span className="eyebrow">TAKE YOUR WORK WITH YOU</span>
          <h2>Export your book</h2>
        </div>
        <button
          className="icon-button"
          aria-label="Close export"
          onClick={onClose}
          disabled={!!busy}
        >
          <X size={20} />
        </button>
      </div>
      <p className="dialog-description">
        Project files preserve the complete editable book. Other exports use the current spread.
      </p>
      <div className="export-grid">
        <button disabled={!!busy} onClick={() => run('project')}>
          <Download size={23} />
          <strong>Project file</strong>
          <span>.popupbook · all spreads and assets</span>
        </button>
        <button disabled={!!busy} onClick={() => run('svg')}>
          <FileImage size={23} />
          <strong>Vector templates</strong>
          <span>SVG · cut, fold, and glue geometry</span>
        </button>
        <button disabled={!!busy} onClick={() => run('pdf')}>
          <FileDown size={23} />
          <strong>Print templates</strong>
          <span>PDF · full scale, tiled if needed</span>
        </button>
        <button disabled={!!busy} onClick={() => run('glb')}>
          <Box size={23} />
          <strong>Current pose</strong>
          <span>GLB · captures digital playback and clicks</span>
        </button>
        <button disabled={!!busy} onClick={() => run('animated')}>
          <Box size={23} />
          <strong>Opening animation</strong>
          <span>GLB · six seconds, pull tabs held in place</span>
        </button>
        <button disabled={!!busy} onClick={() => run('digital-demo')}>
          <Box size={23} />
          <strong>Digital demonstration</strong>
          <span>GLB · pull-tab sweep and clicks at one second</span>
        </button>
      </div>
      <label className="paper-select">
        Print sheet size
        <select
          aria-label="Print sheet size"
          value={paper}
          onChange={(e) => setPaper(e.target.value as 'A4' | 'Letter')}
        >
          <option value="A4">A4 · 210 × 297 mm</option>
          <option value="Letter">US Letter · 8.5 × 11 in</option>
        </select>
      </label>
      <p className="export-note">
        Fabrication exports run a 1° sampled geometry check and include unresolved issues. GLB
        contains baked motion; editing and click behaviors stay in the project file. Digital
        demonstration holds the current opening angle, sweeps linked pull tabs and triggers
        registered clicks during a six-second preview.
      </p>
      {busy && (
        <div className="busy-message" role="status">
          <Loader2 size={17} className="spinner" />
          {busy === 'pdf' || busy === 'svg'
            ? 'Checking the opening sequence and preparing templates…'
            : 'Preparing your file…'}
        </div>
      )}
      {error && (
        <div className="inline-issue" role="alert">
          {error}
        </div>
      )}
    </dialog>
  );
}
