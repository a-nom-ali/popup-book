import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { Matrix4, Vector3 } from 'three';
import type { DigitalObject } from '../model';
import { parseProject } from '../model';
import { blankSpread, exampleProject, mechanism } from '../presets';
import { compileProject, evaluateSpread } from './geometry';
import {
  createDigitalRuntime,
  digitalBaseMatrix,
  digitalBaseOffset,
  dispatchDigitalEvent,
  evaluateDigitalPresentation,
  physicalPaperFrame,
  resetDigitalRuntime,
  seededRandom,
  validateDigitalObjects,
} from './digital';
import {
  createDigitalObject,
  duplicateDigital,
  insertDigital,
  placeDigitalBase,
  removeDigital,
  updateDigital,
} from '../digitalCommands';
import { useStudio } from '../store';
import { loadLocal, packProject, saveLocal, unpackProject } from '../io/projects';

const setup = () => {
  const p = exampleProject();
  p.spreads = [blankSpread('Digital test')];
  return p;
};
const object = (patch: Partial<DigitalObject> = {}) =>
  createDigitalObject({ kind: 'builtin', id: 'dragon' }, 'page-right', patch);

describe('digital presentation and attachment frames', () => {
  it('seeks rise/grow endpoints and reverse angles deterministically without singular hidden matrices', () => {
    const p = setup(),
      spread = p.spreads[0],
      d = object({
        entrance: {
          kind: 'grow',
          driver: { kind: 'opening' },
          start: 25,
          end: 100,
          distance: 20,
          easing: 'smooth',
          duration: 1.2,
        },
      });
    spread.digital.push(d);
    const compiled = compileProject(p, spread.id),
      runtime = createDigitalRuntime(),
      samples = new Map<number, number[]>();
    for (const angle of [
      ...Array.from({ length: 181 }, (_, i) => i),
      ...Array.from({ length: 181 }, (_, i) => 180 - i),
    ]) {
      const result = evaluateDigitalPresentation(d, evaluateSpread(compiled, angle), runtime, {
        compiled,
      });
      expect(result.worldMatrix.elements.every(Number.isFinite)).toBe(true);
      const rotation = new Matrix4().extractRotation(result.worldMatrix);
      expect(rotation.elements.every(Number.isFinite)).toBe(true);
      if (angle <= 25) expect(result.visible).toBe(false);
      if (angle >= 100) expect(result.progress).toBe(1);
      if (samples.has(angle)) expect(result.worldMatrix.elements).toEqual(samples.get(angle));
      else samples.set(angle, [...result.worldMatrix.elements]);
    }
  });
  it('uses actual hinge angles and normalized slider intervals, including exact clip endpoints', () => {
    const p = setup(),
      spread = p.spreads[0],
      tent = mechanism('tent'),
      slider = mechanism('slider', { host: 'page-right' });
    spread.mechanisms.push(tent, slider);
    const compiled = compileProject(p, spread.id),
      pose = evaluateSpread(compiled, 110, { [slider.id]: 0.5 });
    const d = object({
      entrance: {
        kind: 'rise',
        driver: { kind: 'hinge', target: `${tent.id}:ridge` },
        start: 0,
        end: 180,
        distance: 20,
        easing: 'linear',
        duration: 1.2,
      },
    });
    const runtime = { ...createDigitalRuntime(), drivers: { [slider.id]: 0.5 } };
    expect(evaluateDigitalPresentation(d, pose, runtime).progress).toBeCloseTo(
      pose.hinges.find((h) => h.id === `${tent.id}:ridge`)!.angle / Math.PI,
      10,
    );
    d.entrance!.driver = { kind: 'slider', target: slider.id };
    d.entrance!.start = 0.2;
    d.entrance!.end = 0.8;
    d.behavior = 'slider';
    d.sliderId = slider.id;
    d.angleStart = 0.2;
    d.angleEnd = 0.8;
    for (const [travel, progress] of [
      [0, 0],
      [0.2, 0],
      [0.5, 0.5],
      [0.8, 1],
      [1, 1],
      [0.5, 0.5],
    ]) {
      runtime.drivers[slider.id] = travel;
      const result = evaluateDigitalPresentation(d, pose, runtime, { clipDuration: 2 });
      expect(result.progress).toBeCloseTo(progress, 9);
      expect(result.animationTime).toBeCloseTo(progress * 2, 9);
    }
  });
  it('keeps legacy transforms exact and strips nested decoration offsets for explicit v3 sources', () => {
    const p = setup(),
      spread = p.spreads[0];
    spread.decorations.push(
      {
        id: 'a',
        name: 'a',
        parent: 'page-right',
        position: [10, 20],
        rotation: 35,
        color: '#fff',
        outline: [
          [0, 0],
          [20, 0],
          [20, 20],
          [0, 20],
        ],
        holes: [],
      },
      {
        id: 'b',
        name: 'b',
        parent: 'a',
        position: [5, 6],
        rotation: 20,
        color: '#fff',
        outline: [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
        ],
        holes: [],
      },
    );
    const compiled = compileProject(p, spread.id),
      pose = evaluateSpread(compiled, 90),
      parent = pose.parts.find((x) => x.id === 'b')!;
    const d = object({
      parent: 'b',
      position: [1, 2, 3],
      rotation: [10, 20, 30],
      scale: 0.5,
      entrance: undefined,
    });
    const physical = physicalPaperFrame(parent, pose, compiled);
    const plane = pose.parts
      .find((x) => x.id === 'page-right')!
      .matrix.clone()
      .multiply(new Matrix4().makeTranslation(10, 20, 0))
      .multiply(new Matrix4().makeRotationZ((35 * Math.PI) / 180))
      .multiply(new Matrix4().makeTranslation(5, 6, 0))
      .multiply(new Matrix4().makeRotationZ((20 * Math.PI) / 180));
    expect(physical.elements).toEqual(plane.elements);
    const explicit = digitalBaseMatrix(d, pose, compiled),
      legacy = digitalBaseMatrix({ ...d, source: undefined }, pose, compiled);
    expect(
      new Vector3()
        .setFromMatrixPosition(explicit)
        .distanceTo(new Vector3().setFromMatrixPosition(legacy)),
    ).toBeCloseTo(0.1, 8);
    expect(explicit.elements.slice(0, 12)).toEqual(legacy.elements.slice(0, 12));
  });
  it('orients positive digital height along either paper front and places rotated model bounds on that face', () => {
    const p = setup(),
      compiled = compileProject(p, p.spreads[0].id),
      pose = evaluateSpread(compiled, 180);
    for (const parent of ['page-left', 'page-right']) {
      const d = object({ parent, entrance: undefined, position: [0, 0, 0], scale: 1 });
      const matrix = digitalBaseMatrix(d, pose, compiled),
        part = pose.parts.find((x) => x.id === parent)!;
      const origin = new Vector3().applyMatrix4(matrix),
        up = new Vector3(0, 0.01, 0).applyMatrix4(matrix).sub(origin);
      const expected = new Vector3(0, 0, part.front ?? 1)
        .transformDirection(part.matrix)
        .multiplyScalar(10);
      expect(up.distanceTo(expected)).toBeLessThan(0.01);
      const tilted = object({ parent, rotation: [90, 0, 0] });
      const hidden = evaluateDigitalPresentation(
        tilted,
        { ...pose, angle: 25 },
        createDigitalRuntime(),
        { compiled },
      );
      const emerged = evaluateDigitalPresentation(
        tilted,
        { ...pose, angle: 100 },
        createDigitalRuntime(),
        { compiled },
      );
      const displacement = new Vector3()
        .setFromMatrixPosition(emerged.worldMatrix)
        .sub(new Vector3().setFromMatrixPosition(hidden.worldMatrix));
      expect(displacement.distanceTo(expected.clone().multiplyScalar(2))).toBeLessThan(0.01);
    }
    const d = object({ rotation: [0, 0, 90], scale: 2 });
    expect(digitalBaseOffset(d, { min: [-0.03, 0, -0.01], max: [0.01, 0.05, 0.01] })).toBeCloseTo(
      60,
      8,
    );
  });
});

describe('deterministic digital events and clocks', () => {
  it('replays a hidden entrance from a paper hotspot, holds click endpoints, and resumes non-click drivers after previews', () => {
    const p = setup(),
      spread = p.spreads[0],
      d = object();
    spread.digital.push(d);
    d.entrance!.driver = { kind: 'click' };
    d.behavior = 'click';
    d.triggers = [
      { id: 'hot', target: 'page-right', action: 'entrance' },
      { id: 'clip', target: 'page-right', action: 'clip' },
    ];
    const pose = evaluateSpread(compileProject(p, spread.id), 180),
      initial = createDigitalRuntime();
    expect(evaluateDigitalPresentation(d, pose, initial).visible).toBe(false);
    const clicked = dispatchDigitalEvent(spread, { ...initial, time: 3 }, 'page-right');
    expect(initial.events).toEqual({});
    expect(
      evaluateDigitalPresentation(d, pose, { ...clicked, time: 3.6 }, { clipDuration: 2 }).progress,
    ).toBeCloseTo(0.5);
    const finished = evaluateDigitalPresentation(
      d,
      pose,
      { ...clicked, time: 10 },
      { clipDuration: 2 },
    );
    expect(finished.progress).toBe(1);
    expect(finished.animationTime).toBe(2);
    d.entrance!.driver = { kind: 'opening' };
    const closed = { ...pose, angle: 0 };
    expect(evaluateDigitalPresentation(d, closed, { ...clicked, time: 3.6 }).progress).toBeCloseTo(
      0.5,
    );
    expect(evaluateDigitalPresentation(d, closed, { ...clicked, time: 10 }).progress).toBe(0);
  });
  it('starts toggle-trigger objects off and toggles on then off without changing the document', () => {
    const p = setup(),
      spread = p.spreads[0],
      d = object({
        entrance: undefined,
        triggers: [{ id: 'toggle', target: 'page-left', action: 'toggle' }],
      });
    spread.digital.push(d);
    const pose = evaluateSpread(compileProject(p, spread.id), 180),
      before = JSON.stringify(p),
      initial = createDigitalRuntime();
    expect(evaluateDigitalPresentation(d, pose, initial).visible).toBe(false);
    const on = dispatchDigitalEvent(spread, initial, 'page-left');
    expect(evaluateDigitalPresentation(d, pose, on).visible).toBe(true);
    const off = dispatchDigitalEvent(spread, on, 'page-left');
    expect(evaluateDigitalPresentation(d, pose, off).visible).toBe(false);
    expect(JSON.stringify(p)).toBe(before);
  });
  it('gates a slider entrance with toggle state and hides it again after retraction', () => {
    const p = setup(),
      spread = p.spreads[0],
      slider = mechanism('slider', { host: 'page-right' });
    spread.mechanisms.push(slider);
    const d = object({
      entrance: {
        kind: 'grow',
        driver: { kind: 'slider', target: slider.id },
        start: 0.2,
        end: 0.8,
        distance: 20,
        easing: 'linear',
        duration: 1.2,
      },
      triggers: [{ id: 'gate', target: 'page-left', action: 'toggle' }],
    });
    spread.digital.push(d);
    const compiled = compileProject(p, spread.id),
      pose = evaluateSpread(compiled, 180),
      initial = { ...createDigitalRuntime(), drivers: { [slider.id]: 1 } };
    expect(evaluateDigitalPresentation(d, pose, initial).visible).toBe(false);
    const enabled = dispatchDigitalEvent(spread, initial, 'page-left');
    for (const [value, expected] of [
      [1, 1],
      [0.5, 0.5],
      [0, 0],
      [0.5, 0.5],
      [1, 1],
    ]) {
      const result = evaluateDigitalPresentation(d, pose, {
        ...enabled,
        drivers: { [slider.id]: value },
      });
      expect(result.progress).toBeCloseTo(expected, 8);
      expect(result.visible).toBe(expected > 0);
    }
    const disabled = dispatchDigitalEvent(spread, enabled, 'page-left');
    expect(evaluateDigitalPresentation(d, pose, disabled).visible).toBe(false);
  });
  it('resets only requested object clocks and generates stable seeded effect values', () => {
    const a = object({ id: 'a', entrance: undefined, motion: { hover: 2, spin: 30 } }),
      b = object({ id: 'b', entrance: undefined }),
      p = setup(),
      pose = evaluateSpread(compileProject(p, p.spreads[0].id), 180);
    const runtime = {
      ...createDigitalRuntime(),
      time: 7.5,
      events: { a: { clipAt: 3 }, b: { clipAt: 4 } },
    };
    const reset = resetDigitalRuntime(runtime, ['a']);
    expect(reset.events.b).toEqual(runtime.events.b);
    expect(reset.events.a).toBeUndefined();
    expect(evaluateDigitalPresentation(a, pose, reset, { clipDuration: 2 }).animationTime).toBe(0);
    expect(evaluateDigitalPresentation(b, pose, reset, { clipDuration: 2 }).animationTime).toBe(
      1.5,
    );
    const one = seededRandom(44),
      two = seededRandom(44),
      other = seededRandom(45);
    const values = Array.from({ length: 64 }, one);
    expect(values).toEqual(Array.from({ length: 64 }, two));
    expect(values).not.toEqual(Array.from({ length: 64 }, other));
  });
});

describe('digital commands, diagnostics and portable model', () => {
  beforeEach(() => useStudio.getState().replaceProject(setup()));
  it('inserts, updates, duplicates, places bases and removes with atomic history', () => {
    const id = insertDigital({ kind: 'builtin', id: 'crystal', seed: 44, count: 16 }, 'page-right');
    expect(useStudio.getState().past).toHaveLength(1);
    expect(useStudio.getState().project.spreads[0].digital[0].entrance).toMatchObject({
      start: 25,
      end: 100,
      distance: 20,
      duration: 1.2,
    });
    updateDigital(id, { rotation: [0, 0, 90], scale: 2 });
    placeDigitalBase(id, { min: [-0.03, 0, -0.01], max: [0.01, 0.05, 0.01] });
    expect(useStudio.getState().project.spreads[0].digital[0].position[2]).toBeCloseTo(60, 8);
    const copy = duplicateDigital(id);
    expect(copy).not.toBe(id);
    expect(useStudio.getState().project.spreads[0].digital).toHaveLength(2);
    removeDigital(copy);
    expect(useStudio.getState().project.spreads[0].digital).toHaveLength(1);
    useStudio.getState().undo();
    expect(useStudio.getState().project.spreads[0].digital).toHaveLength(2);
    const before = useStudio.getState().project;
    expect(() =>
      updateDigital(id, { source: { kind: 'builtin', id: 'fireflies', count: 65 } }),
    ).toThrow();
    expect(useStudio.getState().project).toBe(before);
  });
  it('identifies missing drivers, sources, triggers, parents, ranges and unreachable hidden click entrances', () => {
    const p = setup(),
      spread = p.spreads[0],
      d = object({
        parent: 'missing',
        source: { kind: 'glb', assetId: 'missing' },
        behavior: 'slider',
        sliderId: 'gone',
        angleStart: 1,
        angleEnd: 0,
        triggers: [{ id: 'bad', target: 'deleted', action: 'entrance' }],
      });
    d.source = { kind: 'glb', assetId: 'missing' };
    d.entrance!.driver = { kind: 'hinge', target: 'gone' };
    spread.digital.push(d);
    let codes = validateDigitalObjects(compileProject(p, spread.id)).map((d) => d.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        'digital-parent',
        'digital-source',
        'digital-slider',
        'digital-clip-range',
        'digital-hinge',
        'digital-trigger',
      ]),
    );
    d.parent = 'page-right';
    d.source = { kind: 'builtin', id: 'crystal' };
    d.entrance!.driver = { kind: 'click' };
    d.triggers = [];
    codes = validateDigitalObjects(compileProject(p, spread.id)).map((d) => d.code);
    expect(codes).toContain('digital-hidden-trigger');
    d.triggers.push({ id: 'paper', target: 'page-right', action: 'entrance' });
    expect(
      validateDigitalObjects(compileProject(p, spread.id)).some(
        (d) => d.code === 'digital-hidden-trigger',
      ),
    ).toBe(false);
  });
  it('repairs independently broken references one field at a time', () => {
    const p = setup(),
      d = object({ parent: 'missing' });
    d.source = { kind: 'glb', assetId: 'missing' };
    d.triggers = [{ id: 'broken', target: 'missing', action: 'entrance' }];
    p.spreads[0].digital.push(d);
    useStudio.getState().replaceProject(p);
    updateDigital(d.id, { parent: 'page-right' });
    updateDigital(d.id, { source: { kind: 'builtin', id: 'crystal' } });
    updateDigital(d.id, { triggers: [] });
    const repaired = useStudio.getState().project;
    expect(validateDigitalObjects(compileProject(repaired, repaired.spreads[0].id))).toEqual([]);
  });
  it('migrates v1/v2 without adding behavior or moving legacy records, and preserves new layers through ZIP/autosave', async () => {
    const p = setup(),
      legacy: DigitalObject = {
        id: 'legacy',
        name: 'Legacy',
        assetId: 'old',
        parent: 'page-right',
        position: [1, 2, 3],
        rotation: [4, 5, 6],
        scale: 0.03,
        behavior: 'angle',
        clip: 0,
        angleStart: 30,
        angleEnd: 150,
      };
    p.spreads[0].digital.push(legacy);
    for (const version of [1, 2]) {
      const migrated = parseProject({ ...p, version });
      expect(migrated.version).toBe(3);
      expect(migrated.spreads[0].digital[0]).toEqual(legacy);
    }
    const id = insertDigital({ kind: 'builtin', id: 'sparkles', seed: 92, count: 64 });
    updateDigital(id, { triggers: [{ id: 'event', target: 'page-right', action: 'entrance' }] });
    const authored = useStudio.getState().project;
    expect(unpackProject(packProject(authored))).toEqual(authored);
    await saveLocal(authored);
    expect(await loadLocal()).toEqual(authored);
  });
});
