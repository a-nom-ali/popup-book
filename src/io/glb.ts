import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import type { CompiledSpread } from '../engine/geometry';
import { evaluateSpread } from '../engine/geometry';
import { createPaperMesh, disposeObject } from '../engine/scene';
import { loadMedia, setMatrix, updateMedia } from '../engine/media';
import { assemblyTabParts } from '../engine/fabrication';
import type { DigitalRuntimeInputs } from '../engine/digital';

export interface GLBExportOptions {
  mode?: 'pose' | 'opening' | 'digital-demo';
  runtime?: DigitalRuntimeInputs;
}
export function digitalDemoInputs(
  compiled: CompiledSpread,
  time: number,
  drivers: Record<string, number>,
): DigitalRuntimeInputs {
  const values = { ...drivers },
    events: DigitalRuntimeInputs['events'] = {};
  for (const object of compiled.spread.digital) {
    if (object.behavior === 'slider' && object.sliderId)
      values[object.sliderId] = Math.min(1, Math.max(0, time / 6));
    if (object.entrance?.driver.kind === 'slider' && object.entrance.driver.target)
      values[object.entrance.driver.target] = Math.min(1, Math.max(0, time / 6));
    if (time >= 1) {
      const actions = new Set((object.triggers ?? []).map((trigger) => trigger.action));
      if (!object.triggers?.length && object.behavior === 'click') actions.add('clip');
      if (object.entrance?.driver.kind === 'click') actions.add('entrance');
      const event: NonNullable<DigitalRuntimeInputs['events']>[string] = {};
      if (actions.has('entrance')) event.entranceAt = 1;
      if (actions.has('clip')) event.clipAt = 1;
      if (actions.has('toggle')) event.toggled = true;
      if (actions.size) events[object.id] = event;
    }
  }
  return { time, drivers: values, events };
}

export async function exportGLB(
  compiled: CompiledSpread,
  angle: number,
  animated: boolean,
  drivers: Record<string, number>,
  options: GLBExportOptions = {},
): Promise<ArrayBuffer> {
  const mode = options.mode ?? (animated ? 'opening' : 'pose'),
    bake = mode !== 'pose',
    inputsAt = (time: number): DigitalRuntimeInputs =>
      mode === 'digital-demo'
        ? digitalDemoInputs(compiled, time, drivers)
        : { time, drivers, events: {} },
    firstInputs = mode === 'pose' ? (options.runtime ?? inputsAt(0)) : inputsAt(0),
    initial = evaluateSpread(compiled, mode === 'opening' ? 0 : angle, firstInputs.drivers);
  if (initial.diagnostics.some((d) => d.severity === 'error'))
    throw new Error(
      'Repair unsolved mechanisms before exporting a 3D model. The project file can still preserve this design.',
    );
  const scene = new THREE.Scene(),
    book = new THREE.Group();
  book.name = 'Popup_book';
  book.scale.setScalar(0.001);
  book.rotation.x = -Math.PI / 2;
  scene.add(book);
  const parts = new Map<string, THREE.Group>();
  for (const part of [...initial.parts, ...assemblyTabParts(compiled, initial)]) {
    const mesh = createPaperMesh(part);
    setMatrix(mesh, part.matrix); // Outlines are editor overlays, not paper surfaces.
    const lines = mesh.children.filter((c) => c instanceof THREE.Line);
    for (const line of lines) {
      mesh.remove(line);
      disposeObject(line);
    }
    parts.set(part.id, mesh);
    book.add(mesh);
  }
  const media = await loadMedia(compiled, initial);
  if (media.errors.length) {
    disposeObject(scene);
    throw new Error(media.errors.join(' '));
  }
  for (const a of media.attachments) book.add(a.group);
  updateMedia(media.attachments, initial, 0, firstInputs.time, firstInputs, compiled);
  const portableVisibility = () => {
    for (const attachment of media.attachments) {
      if (attachment.digital && !attachment.group.visible) {
        attachment.group.visible = true;
        attachment.group.scale.setScalar(0.000001);
        attachment.group.updateMatrix();
      }
    }
  };
  portableVisibility();
  const clips: THREE.AnimationClip[] = [];
  if (bake) {
    const tracked: THREE.Object3D[] = [];
    book.traverse((node) => {
      if (node !== book) tracked.push(node);
    });
    const samples = tracked.map((node) => ({
        node,
        positions: [] as number[],
        rotations: [] as number[],
        scales: [] as number[],
        morphs: [] as number[],
        previous: new THREE.Quaternion(),
      })),
      times: number[] = [];
    for (let i = 0; i <= 180; i++) {
      const inputs = inputsAt(i / 30),
        pose = evaluateSpread(compiled, mode === 'opening' ? i : angle, inputs.drivers);
      if (pose.diagnostics.some((d) => d.severity === 'error')) {
        disposeObject(scene);
        throw new Error(`Cannot bake an unsolved pose at ${i}°.`);
      }
      for (const part of [...pose.parts, ...assemblyTabParts(compiled, pose)])
        setMatrix(parts.get(part.id)!, part.matrix);
      updateMedia(media.attachments, pose, 0, inputs.time, inputs, compiled);
      portableVisibility();
      times.push(i / 30);
      for (const sample of samples) {
        const node = sample.node,
          q = node.quaternion.clone();
        if (i > 0 && q.dot(sample.previous) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
        sample.previous.copy(q);
        sample.positions.push(...node.position.toArray());
        sample.rotations.push(...q.toArray());
        sample.scales.push(...node.scale.toArray());
        const influences = (node as THREE.Mesh).morphTargetInfluences;
        if (influences) sample.morphs.push(...influences);
      }
    }
    const tracks: THREE.KeyframeTrack[] = [];
    for (const sample of samples) {
      // UUID bindings avoid duplicated mesh names inside imported files.
      tracks.push(
        new THREE.VectorKeyframeTrack(`${sample.node.uuid}.position`, times, sample.positions),
        new THREE.QuaternionKeyframeTrack(
          `${sample.node.uuid}.quaternion`,
          times,
          sample.rotations,
        ),
        new THREE.VectorKeyframeTrack(`${sample.node.uuid}.scale`, times, sample.scales),
      );
      if (sample.morphs.length)
        tracks.push(
          new THREE.NumberKeyframeTrack(
            `${sample.node.uuid}.morphTargetInfluences`,
            times,
            sample.morphs,
          ),
        );
    }
    clips.push(
      new THREE.AnimationClip(
        mode === 'opening' ? 'Open book' : 'Digital demonstration',
        6,
        tracks,
      ),
    );
    const startInputs = inputsAt(0),
      start = evaluateSpread(compiled, mode === 'opening' ? 0 : angle, startInputs.drivers);
    for (const part of [...start.parts, ...assemblyTabParts(compiled, start)])
      setMatrix(parts.get(part.id)!, part.matrix);
    updateMedia(media.attachments, start, 0, startInputs.time, startInputs, compiled);
    portableVisibility();
  }
  try {
    return (await new GLTFExporter().parseAsync(scene, {
      binary: true,
      trs: true,
      animations: clips,
      onlyVisible: false,
      maxTextureSize: 2048,
    })) as ArrayBuffer;
  } finally {
    disposeObject(scene);
  }
}
