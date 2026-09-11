import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { Matrix4, Vector3 } from 'three';
import type { Asset, PaperDecoration, Vec2 } from '../model';
import { parseProject } from '../model';
import { blankSpread, exampleProject, mechanism } from '../presets';
import { compileProject, evaluateSpread, rad, worldPoint } from './geometry';
import { traceAlpha } from './trace';
import {
  createCutoutParts,
  cutoutOverlap,
  cutoutToParent,
  glueRegionValid,
  mapRegions,
  parentToCutout,
  regionArea,
  regionContained,
  resizeCutout,
  suggestGlue,
} from './cutouts';
import { useStudio } from '../store';
import { loadLocal, packProject, saveLocal, unpackProject } from '../io/projects';

const rectangle = (x: number, y: number, w: number, h: number): Vec2[] => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
];
const asset: Asset = {
  id: 'cutout-fixture',
  name: 'Castle.png',
  mime: 'image/png',
  data: 'data:image/png;base64,AQID',
};
const mask = (width: number, height: number, opaque: (x: number, y: number) => boolean) =>
  Uint8Array.from({ length: width * height }, (_, i) =>
    opaque(i % width, Math.floor(i / width)) ? 255 : 0,
  );
const fixture = () =>
  traceAlpha(
    mask(
      12,
      12,
      (x, y) => x >= 2 && x < 10 && y >= 1 && y < 11 && !(x >= 5 && x < 7 && y >= 3 && y < 6),
    ),
    12,
    12,
    { width: 60, tolerance: 0.25 },
  );

describe('alpha silhouettes and millimetre registration', () => {
  it('trims paper margins while preserving the original image rectangle and castle windows', () => {
    const trace = fixture();
    expect(trace.pieces).toHaveLength(1);
    expect(regionArea(trace.pieces)).toBe(1850);
    expect(trace.pieces[0].outline).toEqual(rectangle(10, 5, 40, 50));
    expect(trace.pieces[0].holes).toHaveLength(1);
    const added = createCutoutParts(asset, trace, 'page-right');
    expect(added.artwork[0]).toMatchObject({ x: 0, y: 0, width: 60, height: 60 });
    expect(added.decorations[0].cutout).toMatchObject({ width: 60, imageWidth: 12, imageX: 0 });
  });
  it('keeps diagonal contacts as separate islands and retains nested islands inside holes', () => {
    const diagonal = traceAlpha(Uint8Array.from([255, 0, 0, 255]), 2, 2, { width: 20 });
    expect(diagonal.pieces).toHaveLength(2);
    expect(regionArea(diagonal.pieces)).toBe(200);
    expect(diagonal.warnings[0]).toContain('2 disconnected');
    const nested = traceAlpha(
      mask(9, 9, (x, y) => x === 0 || x === 8 || y === 0 || y === 8 || (x === 4 && y === 4)),
      9,
      9,
      { width: 90 },
    );
    expect(nested.pieces).toHaveLength(2);
    expect(nested.pieces[0].holes).toHaveLength(1);
  });
  it('uses the opacity threshold, handles empty images, and simplifies without losing area on rectangles', () => {
    expect(() => traceAlpha(new Uint8Array(16), 4, 4)).toThrow('No opaque paper');
    expect(() => traceAlpha(Uint8Array.from([100]), 1, 1)).toThrow();
    expect(traceAlpha(Uint8Array.from([100]), 1, 1, { threshold: 0.3 }).pieces).toHaveLength(1);
    const alpha = mask(80, 80, (x, y) => (x - 40) ** 2 + (y - 40) ** 2 < 30 ** 2);
    const exact = traceAlpha(alpha, 80, 80, { width: 80, tolerance: 0 });
    const simplified = traceAlpha(alpha, 80, 80, { width: 80, tolerance: 0.5 });
    expect(simplified.pieces[0].outline.length).toBeLessThan(exact.pieces[0].outline.length);
    expect(Math.abs(regionArea(exact.pieces) - regionArea(simplified.pieces))).toBeLessThan(50);
  });
});

describe('rigid image cut-outs and glue material', () => {
  it('computes glue overlap in rotated local coordinates, excluding holes on both pieces', () => {
    const d = createCutoutParts(asset, fixture(), 'parent', { position: [40, 0], rotation: 90 })
      .decorations[0];
    const parent = { polygon: rectangle(0, 0, 50, 70), holes: [rectangle(10, 30, 5, 5)] };
    d.glueRegion = suggestGlue(d, parent);
    expect(regionArea(d.glueRegion)).toBeGreaterThan(0);
    expect(glueRegionValid(d, parent)).toBe(true);
    for (const p of d.outline)
      expect(parentToCutout(d, cutoutToParent(d, p))).toEqual(
        expect.arrayContaining([expect.any(Number), expect.any(Number)]),
      );
    d.glueRegion = [{ outline: rectangle(20, 12, 15, 20), holes: [] }];
    expect(glueRegionValid(d, parent)).toBe(false);
    expect(regionContained([], { outline: parent.polygon, holes: [] })).toBe(false);
    expect(
      regionContained(
        [
          {
            outline: [
              [0, 0],
              [10, 10],
              [0, 10],
              [10, 0],
            ],
            holes: [],
          },
        ],
        { outline: parent.polygon, holes: [] },
      ),
    ).toBe(false);
  });
  it('scales outlines, holes, image registration, and glue together', () => {
    const { decorations, artwork } = createCutoutParts(asset, fixture(), 'page-right');
    const d = decorations[0];
    d.glueRegion = [{ outline: rectangle(10, 40, 20, 10), holes: [] }];
    const before = structuredClone(d);
    resizeCutout(d, artwork, 1.5);
    expect(d.outline).toEqual(
      mapRegions([{ outline: before.outline, holes: [] }], ([x, y]) => [x * 1.5, y * 1.5])[0]
        .outline,
    );
    expect(d.holes[0][0]).toEqual(before.holes[0][0].map((x) => x * 1.5));
    expect(d.glueRegion[0].outline[0]).toEqual([15, 60]);
    expect(artwork[0].width).toBe(90);
    expect(d.cutout!.width).toBe(90);
  });
  it('inherits its actual panel frame without branch changes through a complete forward and reverse sweep', () => {
    const project = exampleProject(),
      spread = blankSpread('Attachment sweep');
    const tent = mechanism('tent');
    spread.mechanisms.push(tent);
    const cutout = createCutoutParts(asset, fixture(), `${tent.id}:left`, {
      position: [5, 6],
      rotation: 37,
    }).decorations[0];
    spread.decorations.push(cutout);
    project.spreads = [spread];
    const compiled = compileProject(project, spread.id),
      poses = new Map<number, number[]>();
    for (const angle of [
      ...Array.from({ length: 181 }, (_, i) => i),
      ...Array.from({ length: 181 }, (_, i) => 180 - i),
    ]) {
      const pose = evaluateSpread(compiled, angle),
        child = pose.parts.find((p) => p.id === cutout.id)!,
        parent = pose.parts.find((p) => p.id === cutout.parent)!;
      const expected = parent.matrix
        .clone()
        .multiply(new Matrix4().makeTranslation(5, 6, (parent.front ?? 1) * 0.05))
        .multiply(new Matrix4().makeRotationZ(rad(37)));
      expect(child.matrix.elements).toEqual(expected.elements);
      for (const p of child.polygon)
        expect(
          worldPoint(child, p).distanceTo(new Vector3(p[0], p[1], 0).applyMatrix4(expected)),
        ).toBeLessThan(0.01);
      if (poses.has(angle)) expect(child.matrix.elements).toEqual(poses.get(angle));
      else poses.set(angle, [...child.matrix.elements]);
    }
  });
});

describe('cut-out editor commands and project migration', () => {
  beforeEach(() => {
    const project = exampleProject();
    project.spreads = [blankSpread('Cut-out editing')];
    useStudio.getState().replaceProject(project);
  });
  it('atomically inserts, transforms, duplicates, deletes, retraces, and restores artwork with undo', () => {
    const command = useStudio.getState();
    const [id] = command.insertCutout(asset, fixture(), 'page-right');
    let spread = useStudio.getState().project.spreads[0];
    expect(spread.decorations).toHaveLength(1);
    expect(spread.artwork).toHaveLength(1);
    expect(useStudio.getState().past).toHaveLength(1);
    command.transformCutout(id, { position: [20, 30], rotation: 45, scale: 2 });
    spread = useStudio.getState().project.spreads[0];
    expect(spread.decorations[0].cutout!.width).toBe(120);
    command.suggestCutoutGlue(id);
    command.undo();
    command.undo();
    expect(useStudio.getState().project.spreads[0].decorations[0].cutout!.width).toBe(60);
    command.redo();
    const copy = command.duplicateCutout(id)!;
    expect(useStudio.getState().project.spreads[0].artwork).toHaveLength(2);
    command.deleteSelected();
    expect(useStudio.getState().project.spreads[0].decorations.some((d) => d.id === copy)).toBe(
      false,
    );
    expect(useStudio.getState().project.spreads[0].artwork).toHaveLength(1);
    const two = traceAlpha(Uint8Array.from([255, 0, 255]), 3, 1, { width: 30 });
    const ids = command.retraceCutout(id, two);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(id);
    expect(useStudio.getState().project.spreads[0].artwork).toHaveLength(2);
    command.retraceCutout(ids[1], two);
    expect(useStudio.getState().project.spreads[0].decorations).toHaveLength(2);
    expect(useStudio.getState().project.spreads[0].artwork).toHaveLength(2);
    command.undo();
    command.undo();
    expect(useStudio.getState().project.spreads[0].decorations).toHaveLength(1);
    expect(useStudio.getState().project.spreads[0].decorations[0].holes).toHaveLength(1);
  });
  it('validates reattachment targets and retains invalid glue after a move for repair', () => {
    const command = useStudio.getState(),
      [id] = command.insertCutout(asset, fixture(), 'page-right');
    expect(() => command.transformCutout(id, { parent: id })).toThrow();
    expect(() => command.transformCutout(id, { parent: 'missing' })).toThrow();
    command.transformCutout(id, { parent: 'page-left', position: [500, 500] });
    const state = useStudio.getState(),
      d = state.project.spreads[0].decorations[0];
    const parent = evaluateSpread(
      compileProject(state.project, state.activeSpreadId),
      180,
    ).parts.find((p) => p.id === d.parent)!;
    expect(d.glueRegion!.length).toBeGreaterThan(0);
    expect(glueRegionValid(d, parent)).toBe(false);
    expect(cutoutOverlap(d, parent)).toEqual([]);
  });
  it('migrates version1 without moving legacy decorations and round-trips original assets and editable contours', async () => {
    const legacy = { ...exampleProject(), version: 1 };
    const d: PaperDecoration = {
      id: 'legacy-paper',
      name: 'Legacy',
      parent: 'page-right',
      outline: rectangle(0, 0, 20, 20),
      holes: [],
      position: [10, 20],
      color: '#abcabc',
    };
    legacy.spreads[0].decorations.push(d);
    const migrated = parseProject(legacy);
    expect(migrated.version).toBe(2);
    expect(migrated.spreads[0].decorations[0]).toEqual(d);
    useStudio.getState().insertCutout(asset, fixture(), 'page-right');
    const project = useStudio.getState().project;
    const restored = unpackProject(packProject(project));
    expect(restored).toEqual(project);
    await saveLocal(project);
    expect(await loadLocal()).toEqual(project);
  });
});
