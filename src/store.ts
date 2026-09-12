import { create } from 'zustand';
import type { StoreApi, UseBoundStore } from 'zustand';
import type { Project, PresetKind, Vec2, Diagnostic, Asset, PaperRegion } from './model';
import { uid } from './model';
import { blankSpread, createPreset, exampleProject } from './presets';
import { compileProject, evaluateSpread } from './engine/geometry';
import {
  createCutoutParts,
  cutoutToParent,
  resizeCutout,
  scaleTrace,
  suggestGlue,
} from './engine/cutouts';
import type { CutoutOptions, CutoutTransform } from './engine/cutouts';
import type { TraceResult } from './engine/trace';
import { assertAssetCapacity } from './io/projects';
type Edit = (project: Project) => void;
interface StudioState {
  project: Project;
  activeSpreadId: string;
  selectedId: string | null;
  angle: number;
  drivers: Record<string, number>;
  playing: boolean;
  reader: boolean;
  testInteractions: boolean;
  gizmo: 'translate' | 'rotate' | 'scale';
  view: '3d' | '2d' | 'split';
  past: Project[];
  future: Project[];
  notice: string;
  saveStatus: string;
  checked: boolean;
  diagnostics: Diagnostic[];
  checking: boolean;
  snap: boolean;
  tool: 'select' | 'draw' | 'cutout';
  edit: (label: string, fn: Edit, record?: boolean) => void;
  undo: () => void;
  redo: () => void;
  checkpoint: () => void;
  set: (state: Partial<StudioState>) => void;
  addPreset: (kind: PresetKind, host?: string) => void;
  selectSpread: (id: string) => void;
  addSpread: () => void;
  duplicateSpread: () => void;
  moveSpread: (direction: number) => void;
  deleteSelected: () => void;
  replaceProject: (project: Project) => void;
  updateOutline: (id: string, points: Vec2[], hole?: boolean, record?: boolean) => void;
  insertCutout: (
    asset: Asset,
    trace: TraceResult,
    parentId: string,
    options?: CutoutOptions,
  ) => string[];
  transformCutout: (id: string, transform: CutoutTransform, record?: boolean) => void;
  suggestCutoutGlue: (id: string) => void;
  setCutoutGlue: (id: string, regions: PaperRegion[], record?: boolean) => void;
  duplicateCutout: (id: string) => string | undefined;
  retraceCutout: (id: string, trace: TraceResult) => string[];
}
const initial = exampleProject();
export const useStudio: UseBoundStore<StoreApi<StudioState>> =
  import.meta.hot?.data.studio ??
  create<StudioState>((set, get) => ({
    project: initial,
    activeSpreadId: initial.spreads[0].id,
    selectedId: null,
    angle: 145,
    drivers: {},
    playing: false,
    reader: false,
    testInteractions: false,
    gizmo: 'translate',
    view: '3d',
    past: [],
    future: [],
    notice: '',
    saveStatus: 'Starting local storage…',
    checked: false,
    diagnostics: [],
    checking: false,
    snap: true,
    tool: 'select',
    set,
    edit: (label, fn, record = true) => {
      const before = get().project,
        project = structuredClone(before);
      fn(project);
      project.updatedAt = new Date().toISOString();
      set({
        project,
        past: record ? [...get().past.slice(-59), before] : get().past,
        future: [],
        notice: label,
        checked: false,
        diagnostics: [],
        saveStatus: 'Saving…',
      });
    },
    checkpoint: () => set({ past: [...get().past.slice(-59), get().project], future: [] }),
    undo: () => {
      const s = get();
      if (!s.past.length) return;
      const project = s.past.at(-1)!;
      set({
        project,
        past: s.past.slice(0, -1),
        future: [s.project, ...s.future],
        activeSpreadId: project.spreads.some((p) => p.id === s.activeSpreadId)
          ? s.activeSpreadId
          : project.spreads[0].id,
        checked: false,
        diagnostics: [],
        notice: 'Undo',
        saveStatus: 'Saving…',
      });
    },
    redo: () => {
      const s = get();
      if (!s.future.length) return;
      const project = s.future[0];
      set({
        project,
        past: [...s.past, s.project],
        future: s.future.slice(1),
        activeSpreadId: project.spreads.some((p) => p.id === s.activeSpreadId)
          ? s.activeSpreadId
          : project.spreads[0].id,
        checked: false,
        diagnostics: [],
        notice: 'Redo',
        saveStatus: 'Saving…',
      });
    },
    addPreset: (kind, host = 'spine') => {
      const added = createPreset(kind, host);
      if (host !== 'spine' && !host.startsWith('page-') && kind !== 'slider') {
        const port = evaluateSpread(
          compileProject(get().project, get().activeSpreadId),
          180,
        ).hinges.find((h) => h.id === host);
        if (port) {
          const factor = Math.min(1, port.length / 240);
          for (const m of added) {
            m.width *= factor;
            m.reach *= factor;
            m.left *= factor;
            m.right *= factor;
            m.offset *= factor;
            for (const role of Object.keys(m.outlines))
              m.outlines[role] = m.outlines[role].map(([x, y]) => [x * factor, y * factor]);
            for (const role of Object.keys(m.cutouts))
              m.cutouts[role] = m.cutouts[role].map((hole) =>
                hole.map(([x, y]) => [x * factor, y * factor]),
              );
          }
          added[0].branch = -1;
          added[0].offset = kind === 'tent' ? 0 : port.length * 0.1;
        }
      }
      get().edit('Mechanism added', (p) =>
        p.spreads.find((s) => s.id === get().activeSpreadId)!.mechanisms.push(...added),
      );
      set({ selectedId: `${added[0].id}:${kind === 'slider' ? 'strip' : 'left'}` });
    },
    selectSpread: (id) =>
      set({
        activeSpreadId: id,
        selectedId: null,
        checked: false,
        diagnostics: [],
        playing: false,
      }),
    addSpread: () => {
      const spread = blankSpread(`Spread ${get().project.spreads.length + 1}`);
      get().edit('Spread added', (p) => p.spreads.push(spread));
      get().selectSpread(spread.id);
    },
    duplicateSpread: () => {
      const spread = structuredClone(
        get().project.spreads.find((s) => s.id === get().activeSpreadId)!,
      );
      const map = new Map<string, string>();
      for (const id of [
        spread.id,
        ...spread.mechanisms.map((m) => m.id),
        ...spread.decorations.map((d) => d.id),
        ...spread.digital.map((d) => d.id),
        ...spread.digital.flatMap((d) => (d.triggers ?? []).map((t) => t.id)),
        ...spread.tabs.map((t) => t.id),
        ...spread.artwork.map((a) => a.id),
      ])
        map.set(id, uid(id.split('-')[0]));
      let json = JSON.stringify(spread);
      for (const [oldId, newId] of map) json = json.replaceAll(oldId, newId);
      const copy = JSON.parse(json);
      copy.name += ' copy';
      get().edit('Spread duplicated', (p) =>
        p.spreads.splice(p.spreads.findIndex((s) => s.id === spread.id) + 1, 0, copy),
      );
      get().selectSpread(copy.id);
    },
    moveSpread: (direction) =>
      get().edit('Spread reordered', (p) => {
        const i = p.spreads.findIndex((s) => s.id === get().activeSpreadId),
          j = Math.max(0, Math.min(p.spreads.length - 1, i + direction));
        [p.spreads[i], p.spreads[j]] = [p.spreads[j], p.spreads[i]];
      }),
    deleteSelected: () => {
      const id = get().selectedId;
      if (!id || id.startsWith('page-')) return;
      get().edit('Object removed · dependent attachments kept for repair', (p) => {
        const s = p.spreads.find((s) => s.id === get().activeSpreadId)!;
        s.mechanisms = s.mechanisms.filter((m) => !id.startsWith(m.id));
        s.decorations = s.decorations.filter((d) => d.id !== id);
        s.artwork = s.artwork.filter((a) => a.partId !== id);
        s.tabs = s.tabs.filter((t) => t.partId !== id);
        s.digital = s.digital.filter((d) => d.id !== id);
      });
      set({ selectedId: null });
    },
    replaceProject: (project) =>
      set({
        project,
        activeSpreadId: project.spreads[0].id,
        selectedId: null,
        past: [],
        future: [],
        drivers: {},
        checked: false,
        diagnostics: [],
        playing: false,
        saveStatus: 'Saving…',
        notice: `Opened ${project.name}`,
      }),
    updateOutline: (id, points, hole = false, record = true) =>
      get().edit(
        hole ? 'Cutout added' : 'Paper outline updated',
        (p) => {
          const s = p.spreads.find((s) => s.id === get().activeSpreadId)!;
          const m = s.mechanisms.find((m) => id.startsWith(`${m.id}:`));
          if (m) {
            const role = id.slice(m.id.length + 1);
            if (hole) {
              const existing =
                evaluateSpread(compileProject(p, s.id), 180).parts.find((part) => part.id === id)
                  ?.holes ?? [];
              (m.cutouts[role] ??= structuredClone(existing)).push(points);
            } else m.outlines[role] = points;
          }
          const d = s.decorations.find((d) => d.id === id);
          if (d) {
            if (hole) d.holes.push(points);
            else d.outline = points;
          }
        },
        record,
      ),
    insertCutout: (asset, trace, parentId, options = {}) => {
      const state = get(),
        parent = evaluateSpread(
          compileProject(state.project, state.activeSpreadId),
          state.angle,
          state.drivers,
        ).parts.find((p) => p.id === parentId);
      if (!parent) throw new Error('Select an existing paper panel before gluing a cut-out.');
      if (state.project.assets[asset.id] && state.project.assets[asset.id].data !== asset.data)
        throw new Error('This asset ID already belongs to another image.');
      if (!state.project.assets[asset.id]) assertAssetCapacity(state.project, asset.data);
      const additions = createCutoutParts(asset, trace, parentId, options);
      if (!options.position) {
        const points = additions.decorations.flatMap((d) =>
          d.outline.map((p) => cutoutToParent(d, p)),
        );
        const center = (ps: Vec2[]): Vec2 => [
          (Math.min(...ps.map((p) => p[0])) + Math.max(...ps.map((p) => p[0]))) / 2,
          (Math.min(...ps.map((p) => p[1])) + Math.max(...ps.map((p) => p[1]))) / 2,
        ];
        const supportCenter = center(parent.polygon),
          imageCenter = center(points);
        for (const d of additions.decorations)
          d.position = [supportCenter[0] - imageCenter[0], supportCenter[1] - imageCenter[1]];
      }
      for (const d of additions.decorations) d.glueRegion = suggestGlue(d, parent);
      get().edit(
        `${additions.decorations.length} illustrated paper piece${additions.decorations.length === 1 ? '' : 's'} added`,
        (p) => {
          const spread = p.spreads.find((s) => s.id === state.activeSpreadId)!;
          p.assets[asset.id] = asset;
          spread.decorations.push(...additions.decorations);
          spread.artwork.push(...additions.artwork);
        },
      );
      const ids = additions.decorations.map((d) => d.id);
      set({ selectedId: ids[0], tool: 'select' });
      return ids;
    },
    transformCutout: (id, transform, record = true) => {
      const state = get(),
        spread = state.project.spreads.find((s) => s.id === state.activeSpreadId)!;
      const decoration = spread.decorations.find((d) => d.id === id);
      if (!decoration) throw new Error('The paper cut-out no longer exists.');
      if (transform.position && !transform.position.every(Number.isFinite))
        throw new Error('Position must contain finite millimetre values.');
      if (transform.rotation !== undefined && !Number.isFinite(transform.rotation))
        throw new Error('Rotation must be finite.');
      if (
        transform.scale !== undefined &&
        (!Number.isFinite(transform.scale) || transform.scale <= 0)
      )
        throw new Error('Scale must be positive.');
      if (transform.parent) {
        const target = evaluateSpread(
          compileProject(state.project, spread.id),
          state.angle,
          state.drivers,
        ).parts.find((p) => p.id === transform.parent);
        if (!target) throw new Error('Choose an existing paper panel as the support.');
        const seen = new Set<string>([id]);
        let ancestor: string | undefined = transform.parent;
        while (ancestor) {
          if (seen.has(ancestor))
            throw new Error('A cut-out cannot attach to itself or one of its children.');
          seen.add(ancestor);
          ancestor = spread.decorations.find((d) => d.id === ancestor)?.parent;
        }
      }
      get().edit(
        'Paper cut-out transformed',
        (p) => {
          const s = p.spreads.find((s) => s.id === state.activeSpreadId)!,
            d = s.decorations.find((d) => d.id === id)!;
          if (transform.position) d.position = [...transform.position];
          if (transform.rotation !== undefined) d.rotation = transform.rotation;
          if (transform.scale !== undefined) resizeCutout(d, s.artwork, transform.scale);
          if (transform.parent) d.parent = transform.parent;
        },
        record,
      );
    },
    suggestCutoutGlue: (id) => {
      const state = get(),
        spread = state.project.spreads.find((s) => s.id === state.activeSpreadId)!;
      const d = spread.decorations.find((d) => d.id === id);
      if (!d) return;
      const parent = evaluateSpread(
        compileProject(state.project, spread.id),
        state.angle,
        state.drivers,
      ).parts.find((p) => p.id === d.parent);
      if (!parent) throw new Error('Repair the missing support before suggesting glue.');
      get().setCutoutGlue(id, suggestGlue(d, parent));
    },
    setCutoutGlue: (id, regions, record = true) =>
      get().edit(
        'Cut-out glue area updated',
        (p) => {
          const d = p.spreads
            .find((s) => s.id === get().activeSpreadId)!
            .decorations.find((d) => d.id === id);
          if (d) d.glueRegion = structuredClone(regions);
        },
        record,
      ),
    duplicateCutout: (id) => {
      const state = get(),
        spread = state.project.spreads.find((s) => s.id === state.activeSpreadId)!,
        original = spread.decorations.find((d) => d.id === id);
      if (!original) return;
      const copy = structuredClone(original);
      copy.id = uid('cutout');
      copy.name += ' copy';
      copy.position = [copy.position[0] + 5, copy.position[1] + 5];
      if (copy.cutout) copy.cutout.traceGroup = uid('trace');
      const art = spread.artwork
        .filter((a) => a.partId === id)
        .map((a) => ({ ...a, id: uid('art'), partId: copy.id }));
      const tabs = spread.tabs
        .filter((t) => t.partId === id)
        .map((t) => ({ ...t, id: uid('tab'), partId: copy.id }));
      get().edit('Paper cut-out duplicated', (p) => {
        const s = p.spreads.find((s) => s.id === state.activeSpreadId)!;
        s.decorations.push(copy);
        s.artwork.push(...art);
        s.tabs.push(...tabs);
      });
      set({ selectedId: copy.id });
      return copy.id;
    },
    retraceCutout: (id, trace) => {
      const state = get(),
        spread = state.project.spreads.find((s) => s.id === state.activeSpreadId)!,
        original = spread.decorations.find((d) => d.id === id);
      if (!original?.cutout)
        throw new Error('This paper part has no original cut-out image to retrace.');
      const source = original.cutout,
        asset = state.project.assets[source.assetId];
      if (!asset) throw new Error('The original cut-out image is missing.');
      const additions = createCutoutParts(asset, scaleTrace(trace, source.width), original.parent, {
        name: original.name,
        position: original.position,
        rotation: original.rotation,
      });
      const siblings = source.traceGroup
        ? spread.decorations.filter((d) => d.cutout?.traceGroup === source.traceGroup)
        : [original];
      const replacedIds = new Set(siblings.map((d) => d.id));
      const parent = evaluateSpread(
        compileProject(state.project, spread.id),
        state.angle,
        state.drivers,
      ).parts.find((p) => p.id === original.parent);
      for (let i = 0; i < additions.decorations.length; i++) {
        const d = additions.decorations[i],
          a = additions.artwork[i];
        if (siblings[i]) {
          d.id = siblings[i].id;
          a.partId = d.id;
        }
        d.outline = d.outline.map(([x, y]) => [x + source.imageX, y + source.imageY]);
        d.holes = d.holes.map((h) => h.map(([x, y]) => [x + source.imageX, y + source.imageY]));
        d.cutout!.imageX = source.imageX;
        d.cutout!.imageY = source.imageY;
        a.x = source.imageX;
        a.y = source.imageY;
        d.glueRegion = parent ? suggestGlue(d, parent) : [];
      }
      get().edit('Cut-out retraced from original image', (p) => {
        const s = p.spreads.find((s) => s.id === state.activeSpreadId)!;
        const index = s.decorations.findIndex((d) => replacedIds.has(d.id));
        s.decorations = s.decorations.filter((d) => !replacedIds.has(d.id));
        s.decorations.splice(index, 0, ...additions.decorations);
        s.artwork = s.artwork.filter((a) => !replacedIds.has(a.partId));
        s.artwork.push(...additions.artwork);
        s.tabs = s.tabs.filter((t) => !replacedIds.has(t.partId));
      });
      set({ selectedId: additions.decorations[0].id });
      return additions.decorations.map((d) => d.id);
    },
  }));
// Vite may reload this module while authoring tools are being developed. Keep
// the store and its autosave subscription together instead of showing a fresh book.
if (import.meta.hot) {
  import.meta.hot.data.studio = useStudio;
  import.meta.hot.dispose((data) => {
    data.studio = useStudio;
  });
}
