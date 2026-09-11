import { useEffect, useMemo, useRef, useState } from 'react';
import { Box3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  AlertTriangle,
  BookOpen,
  Box,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FolderOpen,
  ImagePlus,
  Layers3,
  Leaf,
  ListChecks,
  Loader2,
  Maximize2,
  PanelLeft,
  Pause,
  Play,
  Plus,
  Redo2,
  Save,
  Scissors,
  Settings2,
  SplitSquareHorizontal,
  Undo2,
  X,
} from 'lucide-react';
import { useStudio } from './store';
import { compileProject, evaluateSpread, polygonBounds } from './engine/geometry';
import { validateSpread } from './engine/validation';
import { PRESETS } from './presets';
import { uid } from './model';
import { useAgentTools, useKeyboard, usePersistence } from './hooks';
import {
  assertAssetCapacity,
  bytesFromData,
  download,
  packProject,
  safeName,
  unpackProject,
} from './io/projects';
import { importAsset } from './io/assets';
import { disposeObject } from './engine/scene';
import Viewer from './components/Viewer';
import FlatEditor from './components/FlatEditor';
import Inspector from './components/Inspector';
import ExportDialog from './components/ExportDialog';

export default function App() {
  usePersistence();
  useKeyboard();
  useAgentTools();
  const s = useStudio(),
    spread = s.project.spreads.find((p) => p.id === s.activeSpreadId) ?? s.project.spreads[0];
  const [exportOpen, setExportOpen] = useState(false),
    [issuesOpen, setIssuesOpen] = useState(false),
    [drawer, setDrawer] = useState<'book' | 'properties' | null>(null),
    [importing, setImporting] = useState(false);
  const projectInput = useRef<HTMLInputElement>(null),
    assetInput = useRef<HTMLInputElement>(null);
  const compiled = useMemo(() => compileProject(s.project, spread.id), [s.project, spread.id]);
  const pose = useMemo(
    () => evaluateSpread(compiled, s.angle, s.drivers),
    [compiled, s.angle, s.drivers],
  );
  useEffect(() => {
    if (!s.playing) return;
    let frame = 0,
      previous = performance.now(),
      direction = s.angle >= 179 ? -1 : 1;
    const step = (now: number) => {
      const state = useStudio.getState();
      let angle = state.angle + direction * Math.min(now - previous, 50) * 0.025;
      previous = now;
      if (angle >= 180) {
        angle = 180;
        direction = -1;
      }
      if (angle <= 0) {
        angle = 0;
        direction = 1;
      }
      state.set({ angle });
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [s.playing]);
  const importToPart = (kind: 'image' | 'model') => {
    if (assetInput.current) {
      assetInput.current.accept = kind === 'image' ? '.png,.jpg,.jpeg' : '.glb';
      assetInput.current.click();
    }
  };
  const handleAsset = async (file?: File) => {
    if (!file) return;
    setImporting(true);
    try {
      const projectId = s.project.id,
        spreadId = spread.id,
        parent =
          pose.parts.find((p) => p.id === s.selectedId) ??
          pose.parts.find((p) => p.id === 'page-right')!,
        asset = await importAsset(file);
      assertAssetCapacity(useStudio.getState().project, asset.data);
      let scale = 0.05;
      if (asset.mime === 'model/gltf-binary') {
        const gltf = await new GLTFLoader().parseAsync(
          new Uint8Array(bytesFromData(asset.data)).buffer,
          '',
        );
        const b = new Box3().setFromObject(gltf.scene);
        const size = Math.max(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z);
        scale = 50 / (Math.max(0.00001, size) * 1000);
        disposeObject(gltf.scene);
      }
      if (
        useStudio.getState().project.id !== projectId ||
        !useStudio.getState().project.spreads.some((p) => p.id === spreadId)
      )
        throw new Error('The destination project changed. Select a part and import again.');
      const id = uid(asset.mime === 'model/gltf-binary' ? 'digital' : 'art');
      s.edit('Asset imported', (p) => {
        p.assets[asset.id] = asset;
        const sp = p.spreads.find((p) => p.id === spreadId)!;
        const b = polygonBounds(parent.polygon);
        if (asset.mime === 'model/gltf-binary')
          sp.digital.push({
            id,
            name: file.name.replace(/\.glb$/i, ''),
            assetId: asset.id,
            parent: parent.id,
            position: [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, 0],
            rotation: [0, 0, 0],
            scale,
            behavior: 'loop',
            clip: 0,
            angleStart: 0,
            angleEnd: 180,
          });
        else
          sp.artwork.push({
            id,
            assetId: asset.id,
            partId: parent.id,
            x: b.minX,
            y: b.minY,
            width: b.maxX - b.minX,
            height: b.maxY - b.minY,
          });
      });
      s.set({ selectedId: asset.mime === 'model/gltf-binary' ? id : parent.id });
      setDrawer('properties');
    } catch (e) {
      s.set({ notice: `Import failed: ${(e as Error).message}` });
    } finally {
      setImporting(false);
      if (assetInput.current) assetInput.current.value = '';
    }
  };
  const check = async () => {
    s.set({ checking: true });
    setIssuesOpen(true);
    try {
      const diagnostics = await validateSpread(compiled);
      if (
        useStudio.getState().project === compiled.project &&
        useStudio.getState().activeSpreadId === compiled.spread.id
      )
        s.set({
          checked: true,
          diagnostics,
          notice: `Checked 181 opening angles · ${diagnostics.length} issue${diagnostics.length === 1 ? '' : 's'}`,
        });
      else
        s.set({
          notice: 'Design changed during the check. Run it again for the updated geometry.',
        });
    } catch (e) {
      s.set({ notice: `Check failed: ${(e as Error).message}` });
    } finally {
      s.set({ checking: false });
    }
  };
  const changeSpread = (direction: number) => {
    const i = s.project.spreads.indexOf(spread),
      next = s.project.spreads[i + direction];
    if (next) s.selectSpread(next.id);
  };
  const errors = pose.diagnostics.filter((d) => d.severity === 'error');
  return (
    <div className={`studio ${s.reader ? 'reader-mode' : ''} ${drawer ? `drawer-${drawer}` : ''}`}>
      <input
        ref={projectInput}
        type="file"
        accept=".popupbook"
        className="sr-only"
        aria-label="Open project file"
        onChange={async (e) => {
          const input = e.target,
            file = input.files?.[0];
          if (!file) return;
          try {
            const project = unpackProject(new Uint8Array(await file.arrayBuffer()));
            s.replaceProject(project);
          } catch (error) {
            s.set({ notice: `Project was not replaced: ${(error as Error).message}` });
          }
          input.value = '';
        }}
      />
      <input
        ref={assetInput}
        type="file"
        className="sr-only"
        aria-label="Import asset file"
        onChange={(e) => handleAsset(e.target.files?.[0])}
      />
      <header className="app-header">
        <a className="brand" href="#" onClick={(e) => e.preventDefault()}>
          <div className="brand-mark">
            <BookOpen size={21} />
          </div>
          <strong>
            fold<span>studio</span>
          </strong>
        </a>
        <div className="header-separator" />
        <button
          className="project-title"
          onClick={() => {
            s.set({ selectedId: null });
            setDrawer('properties');
          }}
          title="Edit book details"
        >
          {s.project.name}
          <span className="local-badge">LOCAL PROJECT</span>
        </button>
        <div className="header-right">
          <span className="save-state">
            <span className="status-dot" />
            {s.saveStatus}
          </span>
          <button
            className="icon-button"
            onClick={() => projectInput.current?.click()}
            title="Open project"
            aria-label="Open project"
          >
            <FolderOpen size={18} />
          </button>
          <button
            className="icon-button"
            onClick={() => {
              try {
                download(packProject(s.project), `${safeName(s.project.name)}.popupbook`);
                s.set({ notice: 'Project file downloaded' });
              } catch (error) {
                s.set({ notice: `Save failed: ${(error as Error).message}` });
              }
            }}
            title="Save project file (Ctrl+S)"
            aria-label="Save project file"
          >
            <Save size={18} />
          </button>
          <button
            className={`button subtle reader-button ${s.reader ? 'active' : ''}`}
            onClick={() => s.set({ reader: !s.reader })}
          >
            <BookOpen size={16} />
            {s.reader ? 'Edit book' : 'Read book'}
          </button>
          <button className="button primary" onClick={() => setExportOpen(true)}>
            <Download size={16} />
            <span>Export</span>
          </button>
        </div>
      </header>
      <div className="workspace">
        {drawer && (
          <button
            className="drawer-backdrop"
            aria-label="Close side panel"
            onClick={() => setDrawer(null)}
          />
        )}
        <aside className="left-panel">
          <div className="panel-label">
            YOUR BOOK
            <div>
              <button
                className="icon-button"
                title="Add spread"
                aria-label="Add spread"
                onClick={s.addSpread}
              >
                <Plus size={16} />
              </button>
              <button
                className="icon-button mobile-close"
                onClick={() => setDrawer(null)}
                aria-label="Close book panel"
              >
                <X size={16} />
              </button>
            </div>
          </div>
          <div className="spread-list">
            {s.project.spreads.map((page, i) => (
              <button
                key={page.id}
                className={`spread-card ${page.id === spread.id ? 'selected' : ''}`}
                onClick={() => {
                  s.selectSpread(page.id);
                  setDrawer(null);
                }}
              >
                <div
                  className="spread-thumbnail"
                  style={{ '--paper-accent': page.color } as React.CSSProperties}
                >
                  <span />
                  <span />
                  <i />
                </div>
                <div>
                  <small>SPREAD {String(i + 1).padStart(2, '0')}</small>
                  <strong>{page.name}</strong>
                  <span>{page.mechanisms.length} mechanisms</span>
                </div>
              </button>
            ))}
          </div>
          <div className="spread-management">
            <button
              onClick={s.duplicateSpread}
              title="Duplicate spread"
              aria-label="Duplicate spread"
            >
              <Copy size={14} />
            </button>
            <button
              onClick={() => s.moveSpread(-1)}
              disabled={s.project.spreads.indexOf(spread) === 0}
              title="Move spread earlier"
              aria-label="Move spread earlier"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={() => s.moveSpread(1)}
              disabled={s.project.spreads.indexOf(spread) === s.project.spreads.length - 1}
              title="Move spread later"
              aria-label="Move spread later"
            >
              <ChevronRight size={16} />
            </button>
          </div>
          <div className="library-heading">
            <div>
              <span className="eyebrow">PAPER ENGINEERING</span>
              <h2>Mechanisms</h2>
            </div>
            <Scissors size={18} />
          </div>
          <div className="mechanism-library">
            {PRESETS.map((preset, i) => (
              <button
                key={preset.kind}
                onClick={() => {
                  s.addPreset(preset.kind);
                  setDrawer(null);
                }}
                className="mechanism-card"
                title={preset.description}
              >
                <div className={`mechanism-icon icon-${i}`}>
                  {i === 2 ? (
                    <Leaf size={20} />
                  ) : i === 5 ? (
                    <Maximize2 size={20} />
                  ) : (
                    <Layers3 size={20} />
                  )}
                </div>
                <div>
                  <strong>{preset.name}</strong>
                  <small>{preset.tag}</small>
                </div>
                <Plus size={15} />
              </button>
            ))}
          </div>
          <div className="library-tip">
            <Scissors size={16} />
            <p>
              Parametric folds.
              <br />
              Possibilities in paper.
            </p>
          </div>
        </aside>
        <main className="main-panel">
          <div className="document-heading">
            <div>
              <div className="eyebrow">
                SPREAD {String(s.project.spreads.indexOf(spread) + 1).padStart(2, '0')}{' '}
                <span>/ {String(s.project.spreads.length).padStart(2, '0')}</span>
              </div>
              <h1>{spread.name}</h1>
              <p>{spread.subtitle}</p>
            </div>
            <div className="document-actions">
              <button
                className="icon-button book-toggle"
                onClick={() => setDrawer('book')}
                title="Book and mechanisms"
                aria-label="Book and mechanisms"
              >
                <PanelLeft size={19} />
              </button>
              <button
                className="icon-button"
                onClick={() => changeSpread(-1)}
                disabled={s.project.spreads.indexOf(spread) === 0}
                title="Previous spread"
                aria-label="Previous spread"
              >
                <ChevronLeft size={20} />
              </button>
              <button
                className="icon-button"
                onClick={() => changeSpread(1)}
                disabled={s.project.spreads.indexOf(spread) === s.project.spreads.length - 1}
                title="Next spread"
                aria-label="Next spread"
              >
                <ChevronRight size={20} />
              </button>
              <button
                className="icon-button"
                onClick={() => setDrawer('properties')}
                title="Properties"
                aria-label="Properties"
              >
                <Settings2 size={19} />
              </button>
            </div>
          </div>
          {!s.reader && (
            <div className="canvas-toolbar">
              <div className="segmented">
                {(
                  [
                    { view: '3d', label: '3D model', Icon: Box },
                    { view: '2d', label: '2D pattern', Icon: Scissors },
                    { view: 'split', label: 'Split', Icon: SplitSquareHorizontal },
                  ] as const
                ).map(({ view, label, Icon }) => (
                  <button
                    key={view}
                    className={s.view === view ? 'active' : ''}
                    onClick={() => s.set({ view })}
                  >
                    <Icon size={15} />
                    <span>{label}</span>
                  </button>
                ))}
              </div>
              <div className="toolbar-right">
                <button
                  className="icon-button"
                  disabled={importing}
                  onClick={() => importToPart('image')}
                  title="Import image onto selected part"
                  aria-label="Import image"
                >
                  <ImagePlus size={17} />
                </button>
                <button
                  className="icon-button"
                  disabled={importing}
                  onClick={() => importToPart('model')}
                  title="Import GLB model"
                  aria-label="Import 3D model"
                >
                  <Box size={17} />
                </button>
                <span className="toolbar-divider" />
                <button
                  className="icon-button"
                  onClick={s.undo}
                  disabled={!s.past.length}
                  title="Undo (Ctrl+Z)"
                  aria-label="Undo"
                >
                  <Undo2 size={17} />
                </button>
                <button
                  className="icon-button"
                  onClick={s.redo}
                  disabled={!s.future.length}
                  title="Redo (Ctrl+Shift+Z)"
                  aria-label="Redo"
                >
                  <Redo2 size={17} />
                </button>
              </div>
            </div>
          )}
          <div className={`canvas-area ${s.view === 'split' && !s.reader ? 'split-view' : ''}`}>
            {(s.view !== '2d' || s.reader) && <Viewer compiled={compiled} />}
            {s.view !== '3d' && !s.reader && (
              <FlatEditor key={`${spread.id}:${s.selectedId}`} compiled={compiled} />
            )}
            {errors.length > 0 && (
              <div className="pose-error">
                <AlertTriangle size={15} />
                <span>{errors[0].message} Last valid parts remain visible.</span>
              </div>
            )}
            {importing && (
              <div className="canvas-loading">
                <Loader2 size={17} className="spinner" />
                Importing asset…
              </div>
            )}
          </div>
          <div className="playback-bar">
            <button
              className={`play-button ${s.playing ? 'playing' : ''}`}
              onClick={() => s.set({ playing: !s.playing })}
              aria-label={s.playing ? 'Pause folding' : 'Play folding'}
            >
              {s.playing ? (
                <Pause size={17} fill="currentColor" />
              ) : (
                <Play size={17} fill="currentColor" />
              )}
            </button>
            <div className="opening-label">
              <strong>Book opening</strong>
              <span>{s.playing ? 'Playing fold sequence' : 'Scrub to explore the mechanism'}</span>
            </div>
            <span className="angle-end">0°</span>
            <input
              aria-label="Book opening angle"
              className="angle-slider"
              type="range"
              min="0"
              max="180"
              step=".1"
              value={s.angle}
              onChange={(e) => s.set({ angle: +e.target.value, playing: false })}
              style={{ '--progress': `${s.angle / 1.8}%` } as React.CSSProperties}
            />
            <span className="angle-end">180°</span>
            <output className="angle-value">
              {Math.round(s.angle)}
              <span>°</span>
            </output>
          </div>
          <div className="workspace-footer">
            <span>
              {pose.parts.length - 2} paper parts <span className="muted">·</span>{' '}
              {s.project.pageWidth * 2} × {s.project.pageHeight} mm
            </span>
            <button onClick={check} disabled={s.checking}>
              {s.checking ? <Loader2 size={13} className="spinner" /> : <ListChecks size={14} />}
              {s.checking ? 'Checking…' : 'Check folding'}
              {s.diagnostics.length > 0 && (
                <span className="issue-count">{s.diagnostics.length}</span>
              )}
            </button>
          </div>
          {issuesOpen && (
            <section className="issues-panel" aria-label="Folding diagnostics">
              <div>
                <strong>Sampled geometry check</strong>
                <span>181 angles · zero-thickness paper · not a physical certification</span>
                <button
                  className="icon-button"
                  aria-label="Close diagnostics"
                  onClick={() => setIssuesOpen(false)}
                >
                  <X size={16} />
                </button>
              </div>
              {s.checking ? (
                <p>Checking attachments, closure, and intersections…</p>
              ) : s.diagnostics.length ? (
                <ul>
                  {s.diagnostics.map((d) => (
                    <li key={d.id}>
                      <button
                        onClick={() => {
                          s.set({
                            selectedId: d.partIds[0],
                            ...(d.drivers ? { drivers: d.drivers } : {}),
                            ...(d.angle === undefined ? {} : { angle: d.angle }),
                            playing: false,
                          });
                          setDrawer('properties');
                        }}
                      >
                        <AlertTriangle size={14} />
                        <span>{d.message}</span>
                        {d.angle !== undefined && <b>{d.angle}°</b>}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>
                  <Check size={15} />
                  No issue detected at the tested angles. Make a paper prototype before final
                  fabrication.
                </p>
              )}
            </section>
          )}
        </main>
        <Inspector
          compiled={compiled}
          pose={pose}
          onImport={importToPart}
          onClose={() => setDrawer(null)}
        />
      </div>
      <footer className="app-status">
        <span>
          FOLD STUDIO <span className="version">/ 0.1</span>
        </span>
        <span role="status">{s.notice || 'Ready · your work stays on this device'}</span>
        <span>
          <Save size={12} />
          LOCAL WORKSPACE
        </span>
      </footer>
      {exportOpen && <ExportDialog compiled={compiled} onClose={() => setExportOpen(false)} />}
    </div>
  );
}
