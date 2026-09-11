import { describe, expect, it } from 'vitest';
import { Matrix4, Vector3 } from 'three';
import { compileProject, evaluateSpread, rad, solveTent, solveVFold, worldPoint } from './geometry';
import type { PaperPart } from './geometry';
import { blankSpread, createPreset, exampleProject, mechanism } from '../presets';
import { partsIntersect, validateStatic, validateSpread } from './validation';
import { segmentInMaterial } from './polygon';
import { partTabs, templateParts } from './fabrication';
import type { Vec2 } from '../model';

describe('rigid paper kinematics', () => {
  it('matches analytical tent and V-fold fixtures', () => {
    const tent = solveTent(35, 35, 95, Math.PI);
    expect(tent.x).toBeCloseTo(0, 8);
    expect(tent.y).toBeCloseTo(Math.sqrt(60 ** 2 - 35 ** 2), 8);
    expect(solveTent(35, 35, 95, 0).x).toBe(95);
    const v = solveVFold(rad(30), rad(30), rad(95), Math.PI);
    expect(v.y).toBeCloseTo(0.487997534, 8);
    expect(v.z).toBeCloseTo(0.872845007, 8);
    const asymmetric = solveVFold(rad(20), rad(40), rad(100), Math.PI / 2);
    expect(asymmetric.x).toBeCloseTo(0.584279847, 8);
    expect(asymmetric.z).toBeCloseTo(0.811073633, 8);
  });
  it('maintains spherical constraints including near-singular endpoints on both symmetric branches', () => {
    for (const branch of [1, -1] as const)
      for (const degrees of [0, 1e-8, ...Array.from({ length: 181 }, (_, i) => i)]) {
        const theta = rad(degrees),
          v = solveVFold(rad(30), rad(30), rad(95), theta, branch);
        const left = new Vector3(0.5, Math.cos(rad(30)), 0),
          right = new Vector3(0.5 * Math.cos(theta), Math.cos(rad(30)), 0.5 * Math.sin(theta));
        expect(v.length()).toBeCloseTo(1, 8);
        expect(v.dot(left)).toBeCloseTo(Math.cos(rad(65)), 8);
        expect(v.dot(right)).toBeCloseTo(Math.cos(rad(65)), 8);
      }
  });
  it('keeps primitive and three-level compound joins within .01 mm during direct and reverse seeks', () => {
    const project = exampleProject();
    for (const spread of project.spreads) {
      const compiled = compileProject(project, spread.id);
      const snapshots = new Map<number, number[]>();
      for (const angle of [
        ...Array.from({ length: 181 }, (_, i) => i),
        ...Array.from({ length: 181 }, (_, i) => 180 - i),
      ]) {
        const pose = evaluateSpread(compiled, angle);
        expect(pose.diagnostics).toEqual([]);
        const values = pose.parts.flatMap((p) => p.matrix.elements);
        expect(values.every(Number.isFinite)).toBe(true);
        if (snapshots.has(angle)) expect(values).toEqual(snapshots.get(angle));
        else snapshots.set(angle, values);
        for (const part of pose.parts.filter((p) => p.role === 'left')) {
          const other = pose.parts.find((p) => p.id === `${part.mechanismId}:right`)!;
          const a = part.folds.find((f) => f.kind === 'mountain')!,
            b = other.folds.find((f) => f.kind === 'mountain')!;
          expect(worldPoint(part, a.a).distanceTo(worldPoint(other, b.a))).toBeLessThan(0.01);
          expect(worldPoint(part, a.b).distanceTo(worldPoint(other, b.b))).toBeLessThan(0.01);
          for (let i = 0; i < part.polygon.length; i++) {
            const p = part.polygon[i],
              q = part.polygon[(i + 1) % part.polygon.length];
            expect(
              Math.abs(
                worldPoint(part, p).distanceTo(worldPoint(part, q)) -
                  Math.hypot(p[0] - q[0], p[1] - q[1]),
              ),
            ).toBeLessThan(0.01);
          }
        }
      }
    }
  });
  it('places the exterior pavilion roof above its walls and right-page sliders above paper', () => {
    const project = exampleProject(),
      s = project.spreads[1],
      pose = evaluateSpread(compileProject(project, s.id), 180);
    expect(pose.hinges[2].origin.z).toBeGreaterThan(pose.hinges[1].origin.z);
    const story = project.spreads[2],
      strip = evaluateSpread(compileProject(project, story.id), 180).parts.find(
        (p) => p.role === 'strip',
      )!;
    expect(new Vector3().setFromMatrixPosition(strip.matrix).z).toBeGreaterThan(0);
  });
  it('ships examples with complete attachment material and glue regions', () => {
    const project = exampleProject();
    for (const spread of project.spreads)
      expect(
        validateStatic(compileProject(project, spread.id)).filter((d) => d.severity === 'error'),
      ).toEqual([]);
  });
  it('reports invalid sizes, missing hosts, cycles, destroyed creases and slider travel', () => {
    const project = exampleProject(),
      s = blankSpread();
    project.spreads = [s];
    const invalid = mechanism('tent', { reach: 5 });
    s.mechanisms = [invalid];
    expect(validateStatic(compileProject(project, s.id)).some((d) => d.code === 'unsolved')).toBe(
      true,
    );
    s.mechanisms = [mechanism('vfold', { host: 'absent:ridge' })];
    expect(compileProject(project, s.id).diagnostics.some((d) => d.code === 'missing-host')).toBe(
      true,
    );
    const a = mechanism('vfold'),
      b = mechanism('vfold', { host: `${a.id}:ridge` });
    a.host = `${b.id}:ridge`;
    s.mechanisms = [a, b];
    expect(compileProject(project, s.id).diagnostics.some((d) => d.code === 'cycle')).toBe(true);
    s.mechanisms = createPreset('vfold');
    s.mechanisms[0].outlines.left = [
      [0, 0],
      [1, 0],
      [0, 1],
    ];
    expect(
      validateStatic(compileProject(project, s.id)).some((d) => d.code === 'hinge-material'),
    ).toBe(true);
    s.mechanisms = [mechanism('slider', { stroke: 500 })];
    expect(
      validateStatic(compileProject(project, s.id)).some((d) => d.code === 'slider-travel'),
    ).toBe(true);
  });
  it('detects true crossings while allowing shared-edge contacts and separated sheets', () => {
    const part: PaperPart = {
      id: 'a',
      name: 'A',
      role: 'test',
      polygon: [
        [-10, -10],
        [10, -10],
        [10, 10],
        [-10, 10],
      ],
      holes: [],
      color: '#fff',
      matrix: new Matrix4(),
      folds: [],
      parentIds: [],
    };
    const crossing = {
      ...part,
      id: 'b',
      matrix: new Matrix4().makeRotationX(Math.PI / 2).setPosition(1, 0, 0),
    };
    expect(partsIntersect(part, crossing)).toBe(true);
    expect(partsIntersect(part, { ...part, id: 'coincident' })).toBe(true);
    expect(partsIntersect(part, { ...part, matrix: new Matrix4().makeTranslation(0, 0, 2) })).toBe(
      false,
    );
    expect(partsIntersect(part, { ...part, matrix: new Matrix4().makeTranslation(20, 0, 0) })).toBe(
      false,
    );
  });
  it('detects tiny holes through essential hinge segments between coarse samples', () => {
    expect(
      segmentInMaterial(
        [0, 5],
        [100, 5],
        [
          [0, 0],
          [100, 0],
          [100, 10],
          [0, 10],
        ],
        [
          [
            [4, 4],
            [5, 4],
            [5, 6],
            [4, 6],
          ],
        ],
      ),
    ).toBe(false);
  });
  it('retains joining tabs when an edge is subdivided or a custom depth is applied', () => {
    const p = exampleProject(),
      s = p.spreads[0],
      m = s.mechanisms[0],
      points = m.outlines.left;
    points.splice(1, 0, [(points[0][0] + points[1][0]) / 2, 0]);
    s.tabs.push({ id: 'custom', partId: `${m.id}:left`, edge: 0, depth: 4 });
    const c = compileProject(p, s.id),
      pose = evaluateSpread(c, 180),
      part = pose.parts.find((p) => p.id === `${m.id}:left`)!;
    const tabs = partTabs(part, c);
    expect(tabs.filter((t) => t.match === 'page-left')).toHaveLength(2);
    expect(tabs[0].fold.kind).toBe('valley');
    expect(templateParts(c, pose)[0].footprints.filter((f) => f.match === part.id)).toHaveLength(2);
  });
  it('diagnoses overlapping cutouts, lost guide engagement and missing end stops', () => {
    const p = exampleProject(),
      s = p.spreads[2],
      m = s.mechanisms.at(-1)!;
    m.outlines.strip = [
      [0, 0],
      [2, 0],
      [2, 22],
      [0, 22],
    ];
    const errors = validateStatic(compileProject(p, s.id));
    expect(errors.some((d) => d.code === 'slider-engagement')).toBe(true);
    expect(errors.some((d) => d.code === 'slider-stops')).toBe(true);
    m.cutouts.cover = [
      [
        [5, 8],
        [15, 8],
        [15, 20],
        [5, 20],
      ],
      [
        [10, 9],
        [20, 9],
        [20, 22],
        [10, 22],
      ],
    ];
    expect(
      validateStatic(compileProject(p, s.id)).some((d) => d.code === 'overlapping-cutouts'),
    ).toBe(true);
    const cover = evaluateSpread(compileProject(p, s.id), 180).parts.find(
      (p) => p.role === 'cover',
    )!;
    expect(cover.holes).toEqual(m.cutouts.cover);
  });
  it('resolves rigid decoration parents independently of array order and reports cycles', () => {
    const p = exampleProject(),
      s = p.spreads[0],
      outline: Vec2[] = [
        [0, 0],
        [5, 0],
        [0, 5],
      ];
    s.decorations = [
      {
        id: 'child',
        parent: 'parent',
        name: 'Child',
        outline,
        holes: [],
        position: [3, 0],
        color: '#fff',
      },
      {
        id: 'parent',
        parent: 'page-right',
        name: 'Parent',
        outline,
        holes: [],
        position: [20, 0],
        color: '#fff',
      },
    ];
    expect(evaluateSpread(compileProject(p, s.id), 120).parts.some((p) => p.id === 'child')).toBe(
      true,
    );
    s.decorations[1].parent = 'child';
    expect(validateStatic(compileProject(p, s.id)).some((d) => d.code === 'cycle')).toBe(true);
  });
  it('samples every example including independent slider travel and glue-tab surfaces', async () => {
    const p = exampleProject();
    for (const s of p.spreads) {
      const diagnostics = await validateSpread(compileProject(p, s.id));
      expect(diagnostics, s.name).toEqual([]);
    }
  }, 30000);
});
