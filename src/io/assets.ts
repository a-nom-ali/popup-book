import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { Asset } from '../model';
import { uid } from '../model';
import { dataFromBytes, bytesFromData } from './projects';
import { disposeObject } from '../engine/scene';

export function inspectGLB(bytes: Uint8Array): { clips: string[] } {
  if (bytes.length < 20) throw new Error('The GLB file is incomplete.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    view.getUint32(0, true) !== 0x46546c67 ||
    view.getUint32(4, true) !== 2 ||
    view.getUint32(8, true) !== bytes.length ||
    view.getUint32(16, true) !== 0x4e4f534a
  )
    throw new Error('Choose a valid binary glTF 2.0 (.glb) file.');
  const length = view.getUint32(12, true);
  if (length > bytes.length - 20) throw new Error('The GLB JSON chunk is truncated.');
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length)));
  for (const resource of [...(json.buffers ?? []), ...(json.images ?? [])])
    if (resource.uri && !resource.uri.startsWith('data:'))
      throw new Error('Use a self-contained GLB with embedded buffers and images.');
  const supported = new Set([
    'KHR_materials_unlit',
    'KHR_materials_clearcoat',
    'KHR_materials_ior',
    'KHR_materials_specular',
    'KHR_materials_transmission',
    'KHR_materials_volume',
    'KHR_materials_sheen',
    'KHR_materials_emissive_strength',
    'KHR_materials_iridescence',
    'KHR_materials_anisotropy',
    'KHR_texture_transform',
    'KHR_mesh_quantization',
    'KHR_lights_punctual',
    'EXT_mesh_gpu_instancing',
  ]);
  for (const ext of json.extensionsRequired ?? [])
    if (!supported.has(ext))
      throw new Error(
        `This prototype does not decode ${ext}. Export an uncompressed GLB with PNG/JPEG textures.`,
      );
  return {
    clips: (json.animations ?? []).map(
      (a: { name?: string }, i: number) => a.name || `Animation ${i + 1}`,
    ),
  };
}
export async function importAsset(file: File): Promise<Asset> {
  if (file.size > 50 * 1024 * 1024) throw new Error('Choose an asset smaller than 50 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  let mime: string;
  if (/\.glb$/i.test(file.name)) {
    inspectGLB(bytes);
    const gltf = await new GLTFLoader().parseAsync(new Uint8Array(bytes).buffer, '');
    disposeObject(gltf.scene);
    mime = 'model/gltf-binary';
  } else if (bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71)
    mime = 'image/png';
  else if (bytes[0] === 255 && bytes[1] === 216) mime = 'image/jpeg';
  else throw new Error('Choose a PNG, JPEG, or self-contained GLB.');
  return { id: uid('asset'), name: file.name, mime, data: dataFromBytes(bytes, mime) };
}
export function assetClipNames(asset?: Asset) {
  try {
    return asset?.data && asset.mime === 'model/gltf-binary'
      ? inspectGLB(bytesFromData(asset.data)).clips
      : [];
  } catch {
    return [];
  }
}
