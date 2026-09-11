import * as THREE from 'three';
import { triangulate } from './geometry';
import type { PaperPart } from './geometry';

export function createPaperMesh(part: PaperPart): THREE.Group {
  const { points, indices } = triangulate(part);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points.flatMap(p => [p[0], p[1], 0]), 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(points.flatMap(p => [p[0] / 100, p[1] / 100]), 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({ color: part.color, side: THREE.DoubleSide, roughness: 0.91, metalness: 0, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  const mesh = new THREE.Mesh(geometry, material); mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.userData.partId = part.id;
  const group = new THREE.Group(); group.name = `part_${part.id.replaceAll(/[^a-zA-Z0-9_]/g, '_')}`; group.userData.partId = part.id;
  group.add(mesh);
  for (const polygon of [part.polygon, ...part.holes]) {
    const outline = new THREE.BufferGeometry().setFromPoints([...polygon, polygon[0]].map(p => new THREE.Vector3(p[0], p[1], 0.035)));
    const line = new THREE.Line(outline, new THREE.LineBasicMaterial({ color: part.role === 'page' ? '#d0cabb' : '#3e493e', transparent: true, opacity: 0.45 }));
    line.userData.outline = true; group.add(line);
  }
  group.matrixAutoUpdate = false; group.matrix.copy(part.matrix); return group;
}
export function disposeObject(object: THREE.Object3D) {
  object.traverse(child => {
    const o = child as THREE.Mesh;
    o.geometry?.dispose();
    if (o.material) for (const m of Array.isArray(o.material) ? o.material : [o.material]) { const mat = m as THREE.MeshStandardMaterial; mat.map?.dispose(); m.dispose(); }
  });
}
