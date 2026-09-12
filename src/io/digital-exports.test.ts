import { beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import {
  AnimationClip,
  AnimationMixer,
  BoxGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Vector3,
  VectorKeyframeTrack,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import type { DigitalObject } from '../model';
import { blankSpread, exampleProject, mechanism } from '../presets';
import { BUILTIN_MODELS, createBuiltinModel } from '../engine/digitalModels';
import { compileProject, evaluateSpread } from '../engine/geometry';
import { evaluateDigitalPresentation } from '../engine/digital';
import { loadMedia, updateMedia } from '../engine/media';
import { dataFromBytes } from './projects';
import { digitalDemoInputs, exportGLB } from './glb';

class TestFileReader {
  result: string | ArrayBuffer | null = null;
  onloadend: (() => void) | null = null;
  async readAsArrayBuffer(blob: Blob) {
    this.result = await blob.arrayBuffer();
    this.onloadend?.();
  }
  async readAsDataURL(blob: Blob) {
    this.result = dataFromBytes(new Uint8Array(await blob.arrayBuffer()), blob.type);
    this.onloadend?.();
  }
}
beforeAll(() => {
  vi.stubGlobal('FileReader', TestFileReader);
  mkdirSync('test-results', { recursive: true });
});
function fixture() {
  const project = exampleProject(),
    spread = blankSpread();
  project.spreads = [spread];
  return { project, spread };
}
function object(id: string, source: NonNullable<DigitalObject['source']>): DigitalObject {
  return {
    id,
    name: id,
    source,
    assetId: '',
    parent: 'page-right',
    position: [55, 0, 0],
    rotation: [0, 0, 0],
    scale: 1,
    behavior: 'loop',
    clip: 0,
    angleStart: 0,
    angleEnd: 180,
  };
}
const conversion = () =>
  new Matrix4().makeRotationX(-Math.PI / 2).scale(new Vector3(0.001, 0.001, 0.001));
function sameMatrix(actual: Matrix4, expected: Matrix4, precision = 6) {
  actual.elements.forEach((n, i) => expect(n).toBeCloseTo(expected.elements[i], precision));
}

describe('portable original digital models', () => {
  it('builds six bounded mesh-only props with metre bounds and useful wing clips', () => {
    expect(BUILTIN_MODELS).toHaveLength(6);
    for (const item of BUILTIN_MODELS) {
      const model = createBuiltinModel({ kind: 'builtin', id: item.id });
      expect(model.bounds.isEmpty()).toBe(false);
      expect(model.bounds.getSize(new Vector3()).length()).toBeLessThan(0.2);
      expect(model.scene.getObjectsByProperty('isMesh', true).length).toBeGreaterThan(0);
      expect(model.scene.getObjectsByProperty('isPoints', true)).toHaveLength(0);
      if (item.id === 'dragon' || item.id === 'butterfly') {
        expect(model.animations).toHaveLength(1);
        const mixer = new AnimationMixer(model.scene),
          wing = model.scene.getObjectByName(
            item.id === 'dragon' ? 'Wing_left_flap' : 'Wing_left',
          )!;
        mixer.clipAction(model.animations[0]).play();
        mixer.setTime(model.animations[0].duration / 4);
        expect(wing.quaternion.angleTo(model.scene.quaternion)).toBeGreaterThan(0.5);
      }
    }
  });

  it('uses deterministic bounded mesh particles with unchanged emissive materials', () => {
    for (const id of ['fireflies', 'sparkles', 'portal'] as const) {
      const model = createBuiltinModel({ kind: 'builtin', id, seed: 91 }),
        copy = createBuiltinModel({ kind: 'builtin', id, seed: 91 });
      const particles = model.scene.children.filter((node) =>
        node.name.startsWith('Mote_'),
      ) as Mesh[];
      expect(particles).toHaveLength(16);
      expect(
        createBuiltinModel({ kind: 'builtin', id, count: 900 }).scene.children.filter((node) =>
          node.name.startsWith('Mote_'),
        ),
      ).toHaveLength(64);
      const emission = (particles[0].material as MeshStandardMaterial).emissive.clone();
      model.evaluate!(3.25);
      const at = particles.map((node) => [
        ...node.position.toArray(),
        ...node.scale.toArray(),
        ...node.quaternion.toArray(),
      ]);
      model.evaluate!(10);
      model.evaluate!(3.25);
      copy.evaluate!(3.25);
      expect(
        particles.map((node) => [
          ...node.position.toArray(),
          ...node.scale.toArray(),
          ...node.quaternion.toArray(),
        ]),
      ).toEqual(at);
      expect(
        copy.scene.children
          .filter((node) => node.name.startsWith('Mote_'))
          .map((node) => [
            ...node.position.toArray(),
            ...node.scale.toArray(),
            ...node.quaternion.toArray(),
          ]),
      ).toEqual(at);
      expect((particles[0].material as MeshStandardMaterial).emissive.equals(emission)).toBe(true);
    }
  });
});

describe('digital pose and GLB demonstrations', () => {
  it('isolates cached unnamed GLB animation targets and object clocks between copies', async () => {
    const source = new Group(),
      cube = new Mesh(new BoxGeometry(0.01, 0.01, 0.01), new MeshStandardMaterial());
    source.add(cube);
    const clip = new AnimationClip('Move', 1, [
        new VectorKeyframeTrack(`${cube.uuid}.position`, [0, 1], [0, 0, 0, 0.04, 0, 0]),
      ]),
      bytes = (await new GLTFExporter().parseAsync(source, {
        binary: true,
        animations: [clip],
      })) as ArrayBuffer;
    const { project, spread } = fixture();
    project.assets.cube = {
      id: 'cube',
      name: 'Unnamed cube',
      mime: 'model/gltf-binary',
      data: dataFromBytes(new Uint8Array(bytes), 'model/gltf-binary'),
    };
    spread.digital = [
      object('first', { kind: 'glb', assetId: 'cube' }),
      object('second', { kind: 'glb', assetId: 'cube' }),
    ];
    const compiled = compileProject(project, spread.id),
      pose = evaluateSpread(compiled, 180),
      loaded = await loadMedia(compiled, pose);
    expect(loaded.errors).toEqual([]);
    updateMedia(
      loaded.attachments,
      pose,
      0,
      10.5,
      { time: 10.5, events: {}, drivers: {}, startedAt: { first: 10, second: 10.5 } },
      compiled,
    );
    const first = loaded.attachments[0].group.getObjectsByProperty('isMesh', true)[0] as Mesh,
      second = loaded.attachments[1].group.getObjectsByProperty('isMesh', true)[0] as Mesh;
    expect(first.position.x).toBeCloseTo(0.02, 6);
    expect(second.position.x).toBeCloseTo(0, 6);
    expect(first.geometry).not.toBe(second.geometry);
    expect(first.material).not.toBe(second.material);
  });

  it('preserves editor transform previews and resets procedural age without showing orphaned objects', async () => {
    const { project, spread } = fixture(),
      lights = object('lights', { kind: 'builtin', id: 'sparkles', seed: 9 });
    spread.digital = [lights];
    const compiled = compileProject(project, spread.id),
      pose = evaluateSpread(compiled, 180),
      loaded = await loadMedia(compiled, pose),
      preview = { ...lights, position: [75, 10, 5] as [number, number, number] },
      runtime = { time: 8, events: {}, drivers: {}, startedAt: { lights: 7 } };
    updateMedia(loaded.attachments, pose, 0, 8, runtime, compiled, { lights: preview });
    sameMatrix(
      loaded.attachments[0].group.matrix,
      evaluateDigitalPresentation(preview, pose, runtime, { compiled }).worldMatrix,
    );
    const procedural = createBuiltinModel({ kind: 'builtin', id: 'sparkles', seed: 9 });
    procedural.evaluate!(1);
    expect(
      loaded.attachments[0].group
        .getObjectsByProperty('isMesh', true)
        .find((node) => node.name.includes('_Mote_0_'))!
        .position.distanceTo(procedural.scene.getObjectByName('Mote_0')!.position),
    ).toBeLessThan(1e-8);
    updateMedia(
      loaded.attachments,
      { ...pose, parts: pose.parts.filter((p) => p.id !== lights.parent) },
      0,
      8,
      runtime,
      compiled,
    );
    expect(loaded.attachments[0].group.visible).toBe(false);
  });

  it('preserves the actual clock, click entrance and imported/builtin clip pose in a current export', async () => {
    const { project, spread } = fixture(),
      dragon = object('dragon', { kind: 'builtin', id: 'dragon' });
    dragon.entrance = {
      kind: 'grow',
      driver: { kind: 'click' },
      start: 0,
      end: 1,
      duration: 2,
      distance: 20,
      easing: 'linear',
    };
    spread.digital = [dragon];
    const compiled = compileProject(project, spread.id),
      pose = evaluateSpread(compiled, 135),
      runtime = { time: 3.25, drivers: {}, events: { dragon: { entranceAt: 2.25, clipAt: 3 } } },
      loaded = await loadMedia(compiled, pose);
    expect(loaded.errors).toEqual([]);
    updateMedia(loaded.attachments, pose, 0, runtime.time, runtime, compiled);
    const bytes = await exportGLB(compiled, 135, false, {}, { runtime }),
      gltf = await new GLTFLoader().parseAsync(bytes, '');
    gltf.scene.updateMatrixWorld(true);
    const root = gltf.scene.getObjectByName('digital_dragon')!;
    sameMatrix(
      root.matrixWorld,
      conversion().multiply(
        evaluateDigitalPresentation(dragon, pose, runtime, { clipDuration: 1.2, compiled })
          .worldMatrix,
      ),
    );
    let actualWing: Object3D | undefined, expectedWing: Object3D | undefined;
    root.traverse((node) => {
      if (node.name.includes('Wing_left_flap')) actualWing = node;
    });
    loaded.attachments[0].group.traverse((node) => {
      if (node.name.includes('Wing_left_flap')) expectedWing = node;
    });
    expect(actualWing!.quaternion.angleTo(expectedWing!.quaternion)).toBeLessThan(1e-6);
    expect(gltf.animations).toHaveLength(0);
    writeFileSync('test-results/digital-current.glb', new Uint8Array(bytes));
  });

  it('retains initially hidden mesh effects and bakes later clicks and deterministic particle motion', async () => {
    const { project, spread } = fixture(),
      lights = object('lights', { kind: 'builtin', id: 'fireflies', seed: 7, count: 16 });
    lights.entrance = {
      kind: 'grow',
      driver: { kind: 'click' },
      start: 0,
      end: 1,
      duration: 1,
      distance: 10,
      easing: 'linear',
    };
    lights.triggers = [{ id: 'click-lights', target: 'page-right', action: 'entrance' }];
    spread.digital = [lights];
    const compiled = compileProject(project, spread.id),
      bytes = await exportGLB(compiled, 120, false, {}, { mode: 'digital-demo' }),
      gltf = await new GLTFLoader().parseAsync(bytes, ''),
      root = gltf.scene.getObjectByName('digital_lights')!,
      mixer = new AnimationMixer(gltf.scene);
    expect(root).toBeDefined();
    expect(gltf.animations[0].name).toBe('Digital demonstration');
    expect(root.getObjectsByProperty('isMesh', true)).toHaveLength(16);
    mixer.clipAction(gltf.animations[0]).play();
    mixer.setTime(0);
    expect(root.scale.x).toBeLessThan(0.001);
    for (const time of [1.5, 3, 5]) {
      mixer.setTime(time);
      gltf.scene.updateMatrixWorld(true);
      const inputs = digitalDemoInputs(compiled, time, {}),
        pose = evaluateSpread(compiled, 120),
        expected = evaluateDigitalPresentation(lights, pose, inputs, { compiled });
      sameMatrix(root.matrixWorld, conversion().multiply(expected.worldMatrix), 5);
      const model = createBuiltinModel(
        lights.source as { kind: 'builtin'; id: 'fireflies'; seed: number; count: number },
      );
      model.evaluate!(time);
      const exportedMote = root
        .getObjectsByProperty('isMesh', true)
        .find((node) => node.name.includes('_Mote_0_'))!;
      expect(
        exportedMote.position.distanceTo(model.scene.getObjectByName('Mote_0')!.position),
      ).toBeLessThan(1e-6);
    }
    writeFileSync('test-results/digital-demonstration.glb', new Uint8Array(bytes));
  });

  it('holds sliders during opening export and sweeps only referenced sliders in a digital demonstration', async () => {
    const { project, spread } = fixture(),
      slider = mechanism('slider', { reach: 75, stroke: 30 }),
      crystal = object('crystal', { kind: 'builtin', id: 'crystal' });
    spread.mechanisms = [slider];
    crystal.entrance = {
      kind: 'grow',
      driver: { kind: 'slider', target: slider.id },
      start: 0,
      end: 1,
      duration: 1,
      distance: 0,
      easing: 'linear',
    };
    spread.digital = [crystal];
    const compiled = compileProject(project, spread.id),
      held = { [slider.id]: 0.7, another: 0.3 };
    expect(digitalDemoInputs(compiled, 3, held).drivers).toEqual({
      [slider.id]: 0.5,
      another: 0.3,
    });
    const bytes = await exportGLB(compiled, 120, true, held),
      gltf = await new GLTFLoader().parseAsync(bytes, ''),
      mixer = new AnimationMixer(gltf.scene);
    mixer.clipAction(gltf.animations[0]).play();
    mixer.setTime(3);
    gltf.scene.updateMatrixWorld(true);
    const strip = gltf.scene.getObjectByName(
      `part_${slider.id.replaceAll(/[^a-zA-Z0-9_]/g, '_')}_strip`,
    )!;
    sameMatrix(
      strip.matrixWorld,
      conversion().multiply(
        evaluateSpread(compiled, 90, held).parts.find((p) => p.id === `${slider.id}:strip`)!.matrix,
      ),
    );
  });
});
