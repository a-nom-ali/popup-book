import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { CompiledSpread, PaperPart, Pose } from './geometry';
import { polygonBounds, triangulate } from './geometry';
import { bytesFromData } from '../io/projects';
import { inspectGLB } from '../io/assets';
import type { DigitalObject } from '../model';

export interface MediaAttachment {
  id: string;
  parent: string;
  group: THREE.Group;
  digital?: DigitalObject;
  mixer?: THREE.AnimationMixer;
  action?: THREE.AnimationAction;
  duration?: number;
  elapsed: number;
  clicked: boolean;
}
export function mountMatrix(part: PaperPart, object: DigitalObject): THREE.Matrix4 {
  const front = part.front ?? 1;
  return part.matrix
    .clone()
    .multiply(
      new THREE.Matrix4().makeTranslation(
        object.position[0],
        object.position[1],
        object.position[2] * front,
      ),
    )
    .multiply(new THREE.Matrix4().makeRotationX((front * Math.PI) / 2))
    .multiply(
      new THREE.Matrix4().makeRotationFromEuler(
        new THREE.Euler(
          ...(object.rotation.map((d) => (d * Math.PI) / 180) as [number, number, number]),
        ),
      ),
    )
    .multiply(
      new THREE.Matrix4().makeScale(object.scale * 1000, object.scale * 1000, object.scale * 1000),
    );
}
export function setMatrix(object: THREE.Object3D, matrix: THREE.Matrix4) {
  object.matrixAutoUpdate = false;
  object.matrix.copy(matrix);
  matrix.decompose(object.position, object.quaternion, object.scale);
}
/** Printed ink follows the paper's declared front, including right-page attachments. */
export function createArtworkMesh(
  part: PaperPart,
  texture: THREE.Texture,
  singleSided: boolean,
): THREE.Mesh {
  const b = polygonBounds(part.polygon),
    w = Math.max(0.001, b.maxX - b.minX),
    h = Math.max(0.001, b.maxY - b.minY),
    data = triangulate(part),
    geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      data.points.flatMap((p) => [p[0], p[1], 0]),
      3,
    ),
  );
  geometry.setAttribute(
    'uv',
    new THREE.Float32BufferAttribute(
      data.points.flatMap((p) => [(p[0] - b.minX) / w, 1 - (p[1] - b.minY) / h]),
      2,
    ),
  );
  // BackSide materials do not survive glTF export; orient the actual triangles instead.
  const indices = [...data.indices];
  if (singleSided && part.front === -1)
    for (let i = 0; i < indices.length; i += 3)
      [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      map: texture,
      transparent: true,
      side: singleSided ? THREE.FrontSide : THREE.DoubleSide,
      roughness: 0.9,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
  );
  mesh.userData.partId = part.id;
  mesh.userData.printedFrontOnly = singleSided;
  return mesh;
}
export async function loadMedia(
  compiled: CompiledSpread,
  pose: Pose,
): Promise<{ attachments: MediaAttachment[]; errors: string[] }> {
  const attachments: MediaAttachment[] = [],
    errors: string[] = [];
  for (const artwork of compiled.spread.artwork) {
    try {
      const part = pose.parts.find((p) => p.id === artwork.partId),
        asset = compiled.project.assets[artwork.assetId];
      if (!part || !asset?.data) throw new Error('Missing image or parent part.');
      const image = new Image();
      image.src = asset.data;
      await image.decode();
      const b = polygonBounds(part.polygon),
        w = b.maxX - b.minX,
        h = b.maxY - b.minY,
        resolution = Math.min(5, 2048 / Math.max(w, h));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.ceil(w * resolution));
      canvas.height = Math.max(1, Math.ceil(h * resolution));
      const ctx = canvas.getContext('2d')!;
      ctx.scale(resolution, resolution);
      ctx.translate(-b.minX, -b.minY);
      ctx.beginPath();
      for (const poly of [part.polygon, ...part.holes]) {
        ctx.moveTo(...poly[0]);
        poly.slice(1).forEach((p) => ctx.lineTo(...p));
        ctx.closePath();
      }
      ctx.clip('evenodd');
      ctx.drawImage(image, artwork.x, artwork.y, artwork.width, artwork.height);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      const singleSided = !!compiled.spread.decorations.find((d) => d.id === part.id && d.cutout);
      const mesh = createArtworkMesh(part, texture, singleSided);
      const group = new THREE.Group();
      group.name = `art_${artwork.id}`;
      group.add(mesh);
      setMatrix(
        group,
        part.matrix
          .clone()
          .multiply(new THREE.Matrix4().makeTranslation(0, 0, (part.front ?? 1) * 0.08)),
      );
      attachments.push({ id: artwork.id, parent: part.id, group, elapsed: 0, clicked: false });
    } catch (error) {
      errors.push(`Artwork: ${(error as Error).message}`);
    }
  }
  for (const object of compiled.spread.digital) {
    try {
      const asset = compiled.project.assets[object.assetId],
        part = pose.parts.find((p) => p.id === object.parent);
      if (!part || !asset?.data) throw new Error('Missing model or parent part.');
      const bytes = bytesFromData(asset.data);
      inspectGLB(bytes);
      const gltf = await new GLTFLoader().parseAsync(new Uint8Array(bytes).buffer, '');
      // Namespace imported animation targets so multiple copies do not compete.
      const names = new Map<string, string>();
      gltf.scene.traverse((node) => {
        const old = node.name || node.uuid,
          name = `${object.id}_${old}`.replaceAll(/[^a-zA-Z0-9_-]/g, '_') + '_' + node.uuid;
        names.set(old, name);
        node.name = name;
        node.userData.digitalId = object.id;
        const mesh = node as THREE.Mesh;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      });
      for (const clip of gltf.animations)
        for (const track of clip.tracks) {
          const dot = track.name.indexOf('.'),
            old = track.name.slice(0, dot);
          if (names.has(old)) track.name = names.get(old)! + track.name.slice(dot);
        }
      const group = new THREE.Group();
      group.name = `digital_${object.id}`;
      group.userData.digitalId = object.id;
      group.add(gltf.scene);
      setMatrix(group, mountMatrix(part, object));
      const mixer = new THREE.AnimationMixer(gltf.scene),
        clip = gltf.animations[object.clip],
        action = clip ? mixer.clipAction(clip) : undefined;
      if (action) {
        action.play();
        action.clampWhenFinished = true;
        if (object.behavior !== 'loop') action.setLoop(THREE.LoopOnce, 1);
      }
      attachments.push({
        id: object.id,
        parent: object.parent,
        group,
        digital: object,
        mixer,
        action,
        duration: clip?.duration,
        elapsed: 0,
        clicked: false,
      });
    } catch (error) {
      errors.push(`${object.name}: ${(error as Error).message}`);
    }
  }
  return { attachments, errors };
}
export function updateMedia(
  attachments: MediaAttachment[],
  pose: Pose,
  delta: number,
  absoluteTime?: number,
) {
  for (const a of attachments) {
    const parent = pose.parts.find((p) => p.id === a.parent);
    if (!parent) continue;
    if (!a.digital) {
      setMatrix(
        a.group,
        parent.matrix
          .clone()
          .multiply(new THREE.Matrix4().makeTranslation(0, 0, (parent.front ?? 1) * 0.08)),
      );
      continue;
    }
    const d = a.digital;
    setMatrix(a.group, mountMatrix(parent, d));
    if (!a.mixer || !a.action || !a.duration) continue;
    if (absoluteTime !== undefined) a.elapsed = absoluteTime;
    else a.elapsed += delta;
    let time = 0;
    if (d.behavior === 'angle')
      time =
        Math.min(
          1,
          Math.max(0, (pose.angle - d.angleStart) / Math.max(1e-6, d.angleEnd - d.angleStart)),
        ) * a.duration;
    else if (d.behavior === 'loop') time = a.elapsed % a.duration;
    else if (a.clicked) time = Math.min(a.elapsed, a.duration);
    a.action.enabled = true;
    a.action.paused = false;
    a.mixer.setTime(time);
  }
}
