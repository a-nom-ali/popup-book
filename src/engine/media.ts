import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import type { CompiledSpread, PaperPart, Pose } from './geometry';
import { polygonBounds, triangulate } from './geometry';
import { bytesFromData } from '../io/projects';
import { inspectGLB } from '../io/assets';
import type { DigitalObject } from '../model';
import { evaluateDigitalPresentation, type DigitalRuntimeInputs } from './digital';
import { createBuiltinModel, type BuiltinModel } from './digitalModels';

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
  bounds?: THREE.Box3;
  clips?: { name: string; duration: number }[];
  procedural?: Pick<BuiltinModel, 'evaluate'>;
}
const importedModels = new Map<string, { data: string; result: Promise<GLTF> }>();
/** Decode once per asset revision; callers own independent geometry, materials and mixers. */
export async function loadDigitalModel(
  object: DigitalObject,
  compiled: CompiledSpread,
): Promise<BuiltinModel> {
  if (object.source?.kind === 'builtin') return createBuiltinModel(object.source);
  const assetId = object.source?.kind === 'glb' ? object.source.assetId : object.assetId,
    asset = compiled.project.assets[assetId];
  if (!asset?.data) throw new Error('The model asset is missing. Reimport its GLB file.');
  let cached = importedModels.get(assetId);
  if (!cached || cached.data !== asset.data) {
    const bytes = bytesFromData(asset.data);
    inspectGLB(bytes);
    cached = {
      data: asset.data,
      result: new GLTFLoader().parseAsync(new Uint8Array(bytes).buffer, ''),
    };
    importedModels.set(assetId, cached);
    if (importedModels.size > 4) importedModels.delete(importedModels.keys().next().value!);
  }
  const loaded = await cached.result,
    scene = cloneSkeleton(loaded.scene) as THREE.Group,
    originalNodes: THREE.Object3D[] = [],
    clonedNodes: THREE.Object3D[] = [];
  loaded.scene.traverse((node) => originalNodes.push(node));
  scene.traverse((node) => clonedNodes.push(node));
  const clonedIds = new Map(originalNodes.map((node, i) => [node.uuid, clonedNodes[i].uuid]));
  scene.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry = mesh.geometry.clone();
    const copy = (source: THREE.Material) => {
      const mat = source.clone();
      for (const key of Object.keys(mat)) {
        const value = (mat as unknown as Record<string, unknown>)[key];
        if (value instanceof THREE.Texture)
          (mat as unknown as Record<string, unknown>)[key] = value.clone();
      }
      return mat;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(copy) : copy(mesh.material);
  });
  const animations = loaded.animations.map((clip) => clip.clone());
  for (const clip of animations)
    for (const track of clip.tracks) {
      const dot = track.name.indexOf('.'),
        target = track.name.slice(0, dot);
      if (clonedIds.has(target)) track.name = clonedIds.get(target)! + track.name.slice(dot);
    }
  return { scene, animations, bounds: new THREE.Box3().setFromObject(scene) };
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
      const part = pose.parts.find((p) => p.id === object.parent);
      if (!part) throw new Error('The paper attachment is missing. Choose another parent.');
      const gltf = await loadDigitalModel(object, compiled);
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
        action.setLoop(THREE.LoopOnce, 1);
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
        bounds: gltf.bounds,
        clips: gltf.animations.map((clip) => ({ name: clip.name, duration: clip.duration })),
        procedural: gltf.evaluate ? { evaluate: gltf.evaluate } : undefined,
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
  runtimeInputs?: DigitalRuntimeInputs,
  compiled?: CompiledSpread,
  objectOverrides?: Record<string, DigitalObject>,
) {
  for (const a of attachments) {
    if (a.digital && compiled) {
      const current =
        objectOverrides?.[a.id] ?? compiled.spread.digital.find((object) => object.id === a.id);
      if (current) {
        a.digital = current;
        a.parent = current.parent;
      }
    }
    const parent = pose.parts.find((p) => p.id === a.parent);
    if (!parent) {
      a.group.visible = false;
      continue;
    }
    if (!a.digital) {
      a.group.visible = true;
      setMatrix(
        a.group,
        parent.matrix
          .clone()
          .multiply(new THREE.Matrix4().makeTranslation(0, 0, (parent.front ?? 1) * 0.08)),
      );
      continue;
    }
    const d = a.digital;
    if (absoluteTime !== undefined) a.elapsed = absoluteTime;
    else a.elapsed += delta;
    const runtime: DigitalRuntimeInputs = runtimeInputs ?? {
      time: a.elapsed,
      drivers: {},
      events: a.clicked ? { [a.id]: { clipAt: 0 } } : {},
    };
    const presentation = evaluateDigitalPresentation(d, pose, runtime, {
      clipDuration: a.duration,
      compiled,
    });
    setMatrix(a.group, presentation.worldMatrix);
    a.group.visible = presentation.visible;
    a.procedural?.evaluate?.(Math.max(0, runtime.time - (runtime.startedAt?.[a.id] ?? 0)));
    if (!a.mixer || !a.action || !a.duration) continue;
    a.action.enabled = true;
    a.action.paused = false;
    a.mixer.setTime(presentation.animationTime);
  }
}
