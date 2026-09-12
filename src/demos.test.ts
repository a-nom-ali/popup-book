import { describe, expect, it } from 'vitest';
import { buildDemo, DEMOS } from './demos';
import { appendDemo, prepareDemoInsertion } from './demoCommands';
import { exampleProject } from './presets';
import { parseProject, uid } from './model';
import { compileProject, evaluateSpread } from './engine/geometry';
import { validateSpread } from './engine/validation';
import {
  createDigitalRuntime,
  dispatchDigitalEvent,
  evaluateDigitalPresentation,
  validateDigitalObjects,
} from './engine/digital';
import { packProject, unpackProject } from './io/projects';

describe('interactive teaching demos', () => {
  for (const demo of DEMOS) {
    it(`${demo.id} has complete paper sweeps and live, repair-free digital references`, async () => {
      const experience = buildDemo(demo.id),
        project = experience.project,
        spread = project.spreads[0];
      const compiled = compileProject(project, spread.id);
      expect(parseProject(project)).toEqual(project);
      expect(project.pageWidth).toBe(148);
      expect(project.pageHeight).toBe(210);
      expect(spread.subtitle).toContain('Physical prototype required');
      expect(experience.steps).toHaveLength(4);
      expect(await validateSpread(compiled)).toEqual([]);
      expect(validateDigitalObjects(compiled)).toEqual([]);
      const runtime = { ...createDigitalRuntime(), time: 4, drivers: experience.drivers };
      for (const angle of [0, 1, 45, 90, 135, 179, 180]) {
        const pose = evaluateSpread(compiled, angle, runtime.drivers);
        for (const object of spread.digital) {
          const presentation = evaluateDigitalPresentation(object, pose, runtime, { compiled });
          expect(presentation.worldMatrix.elements.every(Number.isFinite)).toBe(true);
        }
      }
      const currentTargets = new Set([
        ...evaluateSpread(compiled, 180).parts.map((p) => p.id),
        ...spread.digital.map((d) => d.id),
      ]);
      for (const step of experience.steps) expect(currentTargets.has(step.targetId)).toBe(true);
      for (const trigger of experience.triggers)
        expect(currentTargets.has(trigger.targetId)).toBe(true);
      expect(unpackProject(packProject(project))).toEqual(project);
    }, 60000);
  }

  it('replays paper clicks and shares one butterfly click across wings and particles', () => {
    const castle = buildDemo('enchanted-castle'),
      spread = castle.project.spreads[0];
    const compiled = compileProject(castle.project, spread.id),
      dragon = spread.digital[0],
      fireflies = spread.digital[1];
    const initial = { ...createDigitalRuntime(), time: 10 };
    const dragonEvent = dispatchDigitalEvent(spread, initial, castle.triggers[0].targetId);
    expect(dragonEvent.events[dragon.id].clipAt).toBe(10);
    expect(initial.events).toEqual({});
    const treeEvent = dispatchDigitalEvent(spread, dragonEvent, castle.triggers[1].targetId);
    const opened = evaluateSpread(compiled, 180);
    expect(evaluateDigitalPresentation(fireflies, opened, initial).visible).toBe(false);
    expect(evaluateDigitalPresentation(fireflies, opened, { ...treeEvent, time: 12 }).visible).toBe(
      true,
    );
    expect(treeEvent.events[fireflies.id].toggled).toBe(true);
    const treeOff = dispatchDigitalEvent(spread, treeEvent, castle.triggers[1].targetId);
    expect(evaluateDigitalPresentation(fireflies, opened, treeOff).visible).toBe(false);
    expect(evaluateDigitalPresentation(dragon, evaluateSpread(compiled, 60), initial).visible).toBe(
      false,
    );
    expect(evaluateDigitalPresentation(dragon, opened, initial).progress).toBe(1);
    const garden = buildDemo('butterfly-garden'),
      bloom = garden.project.spreads[0];
    const event = dispatchDigitalEvent(bloom, initial, garden.triggers[0].targetId);
    expect(event.events[bloom.digital[0].id].clipAt).toBe(10);
    expect(event.events[bloom.digital[1].id].entranceAt).toBe(10);
    const butterflies = bloom.digital.filter(
      (d) => d.source?.kind === 'builtin' && d.source.id === 'butterfly',
    );
    expect(butterflies).toHaveLength(2);
    expect(new Set(butterflies.map((d) => d.parent)).size).toBe(2);
    expect(new Set(butterflies.map((d) => d.entrance!.driver.target)).size).toBe(2);
    const companionEvent = dispatchDigitalEvent(bloom, initial, garden.triggers[1].targetId);
    expect(companionEvent.events[butterflies[1].id].clipAt).toBe(10);
    expect(companionEvent.events[bloom.digital[3].id].entranceAt).toBe(10);
  });

  it('toggles orbiting sparks without bypassing the portal slider entrance', () => {
    const demo = buildDemo('crystal-portal'),
      spread = demo.project.spreads[0],
      slider = spread.mechanisms[0];
    const compiled = compileProject(demo.project, spread.id),
      sparks = spread.digital[2];
    const extended = { ...createDigitalRuntime(), time: 10, drivers: { [slider.id]: 1 } };
    const pose = evaluateSpread(compiled, 150, extended.drivers);
    expect(evaluateDigitalPresentation(sparks, pose, extended).visible).toBe(false);
    const on = dispatchDigitalEvent(spread, extended, demo.triggers[0].targetId);
    expect(evaluateDigitalPresentation(sparks, pose, on).visible).toBe(true);
    const retracted = { ...on, drivers: { [slider.id]: 0 } };
    expect(
      evaluateDigitalPresentation(
        sparks,
        evaluateSpread(compiled, 150, retracted.drivers),
        retracted,
      ).visible,
    ).toBe(false);
    const off = dispatchDigitalEvent(spread, on, demo.triggers[0].targetId);
    expect(evaluateDigitalPresentation(sparks, pose, off).visible).toBe(false);
  });

  it('uses the actual nested hinge angle and independent slider travel', () => {
    const garden = buildDemo('butterfly-garden'),
      bloom = garden.project.spreads[0];
    const compiled = compileProject(garden.project, bloom.id),
      butterfly = bloom.digital[0];
    const pose = evaluateSpread(compiled, 90),
      entrance = butterfly.entrance!;
    const hinge = pose.hinges.find((h) => h.id === entrance.driver.target)!;
    const value = Math.max(
      0,
      Math.min(
        1,
        ((hinge.angle * 180) / Math.PI - entrance.start) / (entrance.end - entrance.start),
      ),
    );
    expect(
      evaluateDigitalPresentation(butterfly, pose, createDigitalRuntime()).progress,
    ).toBeCloseTo(value * value * (3 - 2 * value), 10);
    expect(Math.abs((hinge.angle * 180) / Math.PI - pose.angle)).toBeGreaterThan(5);
    expect(
      evaluateDigitalPresentation(butterfly, evaluateSpread(compiled, 180), createDigitalRuntime())
        .visible,
    ).toBe(true);
    const portal = buildDemo('crystal-portal'),
      spread = portal.project.spreads[0],
      slider = spread.mechanisms[0];
    const portalCompiled = compileProject(portal.project, spread.id),
      crystal = spread.digital[1];
    for (const angle of [60, 180]) {
      const closed = { ...createDigitalRuntime(), drivers: { [slider.id]: 0 } },
        open = { ...closed, drivers: { [slider.id]: 1 } };
      expect(
        evaluateDigitalPresentation(
          crystal,
          evaluateSpread(portalCompiled, angle, closed.drivers),
          closed,
        ).progress,
      ).toBe(0);
      expect(
        evaluateDigitalPresentation(
          crystal,
          evaluateSpread(portalCompiled, angle, open.drivers),
          open,
        ).progress,
      ).toBe(1);
    }
  });
});

describe('atomic editable demo copies', () => {
  it('copies all references with fresh IDs while preserving existing work, dimensions and source data', () => {
    const target = exampleProject(),
      source = buildDemo('enchanted-castle').project;
    const sourceSpread = source.spreads[0],
      triggerTarget = sourceSpread.decorations[0].id;
    sourceSpread.name = `Keep this literal ${triggerTarget}`;
    sourceSpread.tabs.push({ id: uid('tab'), partId: triggerTarget, edge: 0, depth: 4 });
    const assetId = uid('asset');
    source.assets[assetId] = {
      id: assetId,
      name: 'Embedded demo.glb',
      mime: 'model/gltf-binary',
      data: 'data:model/gltf-binary;base64,YWJj',
    };
    sourceSpread.digital.push({
      ...structuredClone(sourceSpread.digital[0]),
      id: uid('digital'),
      assetId,
      source: { kind: 'glb', assetId },
      triggers: [],
    });
    const before = structuredClone(target),
      original = structuredClone(source);
    const first = appendDemo(target, source),
      second = appendDemo(target, source);
    expect(target.pageWidth).toBe(before.pageWidth);
    expect(target.pageHeight).toBe(before.pageHeight);
    expect(target.spreads.slice(0, before.spreads.length)).toEqual(before.spreads);
    expect(source).toEqual(original);
    expect(first.spread.id).not.toBe(second.spread.id);
    expect(first.spread.name).toBe(sourceSpread.name);
    const allFirst = new Set(Object.values(first.idMap));
    for (const id of Object.values(second.idMap)) expect(allFirst.has(id)).toBe(false);
    for (const [oldId, newId] of Object.entries(first.idMap)) expect(oldId).not.toBe(newId);
    const copied = first.spread;
    expect(copied.decorations[0].parent).toBe(
      `${first.idMap[sourceSpread.mechanisms[0].id]}:right`,
    );
    expect(copied.artwork[0].partId).toBe(copied.decorations[0].id);
    expect(copied.artwork[0].assetId).toBe(copied.decorations[0].cutout!.assetId);
    expect(copied.tabs[0].partId).toBe(first.idMap[triggerTarget]);
    expect(copied.digital[0].triggers![0].target).toBe(
      first.idMap[sourceSpread.digital[0].triggers![0].target],
    );
    expect(copied.digital.at(-1)!.source).toEqual({ kind: 'glb', assetId: first.idMap[assetId] });
    expect(copied.digital.at(-1)!.assetId).toBe(first.idMap[assetId]);
    expect(parseProject(target)).toEqual(target);
  });

  for (const demo of DEMOS) {
    it(`uniformly fits ${demo.id} to a smaller book and remaps all solved inputs`, async () => {
      const target = exampleProject();
      target.pageWidth = 100;
      target.pageHeight = 148;
      const source = buildDemo(demo.id).project,
        prepared = prepareDemoInsertion(target, source);
      const scale = 100 / 148,
        old = source.spreads[0],
        copy = prepared.spread;
      expect(prepared.scale).toBe(scale);
      expect(copy.mechanisms[0].reach).toBeCloseTo(old.mechanisms[0].reach * scale);
      expect(copy.digital[0].scale).toBeCloseTo(old.digital[0].scale * scale);
      expect(copy.digital[0].entrance!.distance).toBeCloseTo(
        old.digital[0].entrance!.distance * scale,
      );
      expect(copy.digital[0].rotation).toEqual(old.digital[0].rotation);
      expect(copy.digital[0].entrance!.start).toBe(old.digital[0].entrance!.start);
      const isolated = { ...target, spreads: [copy], assets: prepared.assets };
      expect(await validateSpread(compileProject(isolated, copy.id))).toEqual([]);
      expect(validateDigitalObjects(compileProject(isolated, copy.id))).toEqual([]);
      if (demo.id === 'butterfly-garden') {
        expect(copy.mechanisms[1].host).toBe(`${copy.mechanisms[0].id}:ridge`);
        expect(copy.digital[0].entrance!.driver.target).toBe(`${copy.mechanisms[1].id}:ridge`);
      }
      if (demo.id === 'crystal-portal')
        expect(copy.digital[0].entrance!.driver.target).toBe(copy.mechanisms[0].id);
      if (copy.decorations.length) {
        expect(copy.decorations[0].glueRegion![0].outline[0][0]).toBeCloseTo(
          old.decorations[0].glueRegion![0].outline[0][0] * scale,
        );
        expect(copy.decorations[0].cutout!.imageWidth).toBe(old.decorations[0].cutout!.imageWidth);
      }
    }, 60000);
  }

  it('does not enlarge demos and leaves a full or invalid book unchanged on failure', () => {
    const source = buildDemo('crystal-portal').project,
      target = exampleProject();
    target.pageWidth = 300;
    target.pageHeight = 400;
    expect(prepareDemoInsertion(target, source).scale).toBe(1);
    target.spreads = Array.from({ length: 100 }, () => structuredClone(target.spreads[0]));
    const before = structuredClone(target);
    expect(() => appendDemo(target, source)).toThrow('100 spreads');
    expect(target).toEqual(before);
    target.spreads = target.spreads.slice(0, 1);
    target.pageWidth = 0;
    const invalid = structuredClone(target);
    expect(() => appendDemo(target, source)).toThrow('dimensions');
    expect(target).toEqual(invalid);
  });
});
