import { create } from 'zustand';
import type { Project, PresetKind, Vec2, Diagnostic } from './model';
import { uid } from './model';
import { blankSpread, createPreset, exampleProject } from './presets';
type Edit = (project: Project) => void;
interface StudioState {
  project: Project; activeSpreadId: string; selectedId: string | null; angle: number;
  drivers: Record<string, number>; playing: boolean; reader: boolean; view: '3d' | '2d' | 'split';
  past: Project[]; future: Project[]; notice: string; saveStatus: string;
  diagnostics: Diagnostic[]; checking: boolean; snap: boolean; tool: 'select' | 'draw' | 'cutout';
  edit: (label: string, fn: Edit, record?: boolean) => void;
  undo: () => void; redo: () => void; checkpoint: () => void;
  set: (state: Partial<StudioState>) => void;
  addPreset: (kind: PresetKind, host?: string) => void;
  selectSpread: (id: string) => void; addSpread: () => void; duplicateSpread: () => void;
  moveSpread: (direction: number) => void; deleteSelected: () => void;
  replaceProject: (project: Project) => void; updateOutline: (id: string, points: Vec2[], hole?: boolean, record?: boolean) => void;
}
const initial = exampleProject();
export const useStudio = create<StudioState>((set, get) => ({
  project: initial, activeSpreadId: initial.spreads[0].id, selectedId: null, angle: 145,
  drivers: {}, playing: false, reader: false, view: '3d', past: [], future: [], notice: '', saveStatus: 'Starting local storage…',
  diagnostics: [], checking: false, snap: true, tool: 'select',
  set,
  edit: (label, fn, record = true) => {
    const before = get().project, project = structuredClone(before);
    fn(project); project.updatedAt = new Date().toISOString();
    set({ project, past: record ? [...get().past.slice(-59), before] : get().past, future: [], notice: label, diagnostics: [], saveStatus: 'Saving…' });
  },
  checkpoint: () => set({ past: [...get().past.slice(-59), get().project], future: [] }),
  undo: () => { const s = get(); if (!s.past.length) return; const project = s.past.at(-1)!; set({ project, past: s.past.slice(0, -1), future: [s.project, ...s.future], activeSpreadId: project.spreads.some(p => p.id === s.activeSpreadId) ? s.activeSpreadId : project.spreads[0].id, diagnostics: [], notice: 'Undo', saveStatus: 'Saving…' }); },
  redo: () => { const s = get(); if (!s.future.length) return; const project = s.future[0]; set({ project, past: [...s.past, s.project], future: s.future.slice(1), activeSpreadId: project.spreads.some(p => p.id === s.activeSpreadId) ? s.activeSpreadId : project.spreads[0].id, diagnostics: [], notice: 'Redo', saveStatus: 'Saving…' }); },
  addPreset: (kind, host = 'spine') => {
    const added = createPreset(kind, host);
    get().edit('Mechanism added', p => p.spreads.find(s => s.id === get().activeSpreadId)!.mechanisms.push(...added));
    set({ selectedId: `${added[0].id}:${kind === 'slider' ? 'strip' : 'left'}` });
  },
  selectSpread: id => set({ activeSpreadId: id, selectedId: null, diagnostics: [], playing: false }),
  addSpread: () => { const spread = blankSpread(`Spread ${get().project.spreads.length + 1}`); get().edit('Spread added', p => p.spreads.push(spread)); get().selectSpread(spread.id); },
  duplicateSpread: () => {
    const spread = structuredClone(get().project.spreads.find(s => s.id === get().activeSpreadId)!);
    const map = new Map<string, string>();
    for (const id of [spread.id, ...spread.mechanisms.map(m => m.id), ...spread.decorations.map(d => d.id), ...spread.digital.map(d => d.id), ...spread.tabs.map(t => t.id), ...spread.artwork.map(a => a.id)]) map.set(id, uid(id.split('-')[0]));
    let json = JSON.stringify(spread); for (const [oldId, newId] of map) json = json.replaceAll(oldId, newId);
    const copy = JSON.parse(json); copy.name += ' copy';
    get().edit('Spread duplicated', p => p.spreads.splice(p.spreads.findIndex(s => s.id === spread.id) + 1, 0, copy)); get().selectSpread(copy.id);
  },
  moveSpread: direction => get().edit('Spread reordered', p => { const i = p.spreads.findIndex(s => s.id === get().activeSpreadId), j = Math.max(0, Math.min(p.spreads.length - 1, i + direction)); [p.spreads[i], p.spreads[j]] = [p.spreads[j], p.spreads[i]]; }),
  deleteSelected: () => {
    const id = get().selectedId; if (!id || id.startsWith('page-')) return;
    get().edit('Object removed · dependent attachments kept for repair', p => { const s = p.spreads.find(s => s.id === get().activeSpreadId)!; s.mechanisms = s.mechanisms.filter(m => !id.startsWith(m.id)); s.decorations = s.decorations.filter(d => d.id !== id); s.digital = s.digital.filter(d => d.id !== id); });
    set({ selectedId: null });
  },
  replaceProject: project => set({ project, activeSpreadId: project.spreads[0].id, selectedId: null, past: [], future: [], drivers: {}, diagnostics: [], playing: false, saveStatus: 'Saving…', notice: `Opened ${project.name}` }),
  updateOutline: (id, points, hole = false, record = true) => get().edit(hole ? 'Cutout added' : 'Paper outline updated', p => {
    const s = p.spreads.find(s => s.id === get().activeSpreadId)!;
    const m = s.mechanisms.find(m => id.startsWith(`${m.id}:`));
    if (m) { const role = id.slice(m.id.length + 1); if (hole) (m.cutouts[role] ??= []).push(points); else m.outlines[role] = points; }
    const d = s.decorations.find(d => d.id === id); if (d) { if (hole) d.holes.push(points); else d.outline = points; }
  }, record),
}));
