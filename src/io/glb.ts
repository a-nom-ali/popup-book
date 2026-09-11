import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import type { CompiledSpread } from '../engine/geometry';
import { evaluateSpread } from '../engine/geometry';
import { createPaperMesh, disposeObject } from '../engine/scene';
import { loadMedia, setMatrix, updateMedia } from '../engine/media';

export async function exportGLB(compiled: CompiledSpread, angle: number, animated: boolean, drivers: Record<string, number>): Promise<ArrayBuffer> {
  const initial = evaluateSpread(compiled, animated ? 0 : angle, drivers);
  if (initial.diagnostics.some(d => d.severity === 'error')) throw new Error('Repair unsolved mechanisms before exporting a 3D model. The project file can still preserve this design.');
  const scene = new THREE.Scene(), book = new THREE.Group(); book.name = 'Popup_book'; book.scale.setScalar(.001); book.rotation.x = -Math.PI / 2; scene.add(book);
  const parts = new Map<string, THREE.Group>();
  for (const part of initial.parts) { const mesh = createPaperMesh(part); setMatrix(mesh, part.matrix); // Outlines are editor overlays, not paper surfaces.
    const lines = mesh.children.filter(c => c instanceof THREE.Line); for (const line of lines) { mesh.remove(line); disposeObject(line); } parts.set(part.id, mesh); book.add(mesh); }
  const media = await loadMedia(compiled, initial); if (media.errors.length) { disposeObject(scene); throw new Error(media.errors.join(' ')); }
  for (const a of media.attachments) book.add(a.group); updateMedia(media.attachments, initial, 0, 0);
  const clips: THREE.AnimationClip[] = [];
  if (animated) {
    const tracked: THREE.Object3D[] = []; book.traverse(node => { if (node !== book) tracked.push(node); });
    const samples = tracked.map(node => ({ node, positions: [] as number[], rotations: [] as number[], scales: [] as number[], morphs: [] as number[], previous: new THREE.Quaternion() })), times: number[] = [];
    for (let i = 0; i <= 180; i++) {
      const pose = evaluateSpread(compiled, i, drivers); if (pose.diagnostics.some(d => d.severity === 'error')) { disposeObject(scene); throw new Error(`Cannot bake an unsolved pose at ${i}°.`); }
      for (const part of pose.parts) setMatrix(parts.get(part.id)!, part.matrix); updateMedia(media.attachments, pose, 0, i / 30); times.push(i / 30);
      for (const sample of samples) {
        const node = sample.node, q = node.quaternion.clone(); if (i > 0 && q.dot(sample.previous) < 0) q.set(-q.x, -q.y, -q.z, -q.w); sample.previous.copy(q);
        sample.positions.push(...node.position.toArray()); sample.rotations.push(...q.toArray()); sample.scales.push(...node.scale.toArray());
        const influences = (node as THREE.Mesh).morphTargetInfluences; if (influences) sample.morphs.push(...influences);
      }
    }
    const tracks: THREE.KeyframeTrack[] = [];
    for (const sample of samples) {
      // UUID bindings avoid duplicated mesh names inside imported files.
      tracks.push(new THREE.VectorKeyframeTrack(`${sample.node.uuid}.position`, times, sample.positions), new THREE.QuaternionKeyframeTrack(`${sample.node.uuid}.quaternion`, times, sample.rotations), new THREE.VectorKeyframeTrack(`${sample.node.uuid}.scale`, times, sample.scales));
      if (sample.morphs.length) tracks.push(new THREE.NumberKeyframeTrack(`${sample.node.uuid}.morphTargetInfluences`, times, sample.morphs));
    }
    clips.push(new THREE.AnimationClip('Open book', 6, tracks));
    const start = evaluateSpread(compiled, 0, drivers); for (const part of start.parts) setMatrix(parts.get(part.id)!, part.matrix); updateMedia(media.attachments, start, 0, 0);
  }
  try { return await new GLTFExporter().parseAsync(scene, { binary: true, trs: true, animations: clips, maxTextureSize: 2048 }) as ArrayBuffer; } finally { disposeObject(scene); }
}
