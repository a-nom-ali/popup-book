import { Box3, Triangle, Vector3 } from 'three';
import type { Diagnostic } from '../model';
import { area, inMaterial, inside, selfIntersects, segmentsCross } from './polygon';
import { compileProject, diagnostic, evaluateSpread, triangulate, worldPoint } from './geometry';
import type { CompiledSpread, PaperPart, Pose } from './geometry';
import { templateParts } from './fabrication';

export function validateStatic(compiled: CompiledSpread): Diagnostic[] {
  const pose = evaluateSpread(compiled, 180), out = [...pose.diagnostics];
  for (const part of pose.parts) {
    if (part.polygon.length < 3 || Math.abs(area(part.polygon)) < 0.01 || selfIntersects(part.polygon)) out.push(diagnostic('invalid-outline', `${part.name}: use a non-crossing outline with at least three vertices.`, [part.id]));
    for (const hole of part.holes) {
      const crosses = hole.some((a, i) => part.polygon.some((b, j) => segmentsCross(a, hole[(i + 1) % hole.length], b, part.polygon[(j + 1) % part.polygon.length])));
      if (hole.length < 3 || Math.abs(area(hole)) < 0.01 || selfIntersects(hole) || !hole.every(p => inside(p, part.polygon, false)) || crosses) out.push(diagnostic('invalid-cutout', `${part.name}: cutouts must be closed and fully inside the paper.`, [part.id]));
    }
    for (const fold of part.folds) {
      const points = Array.from({ length: 11 }, (_, i) => [fold.a[0] + (fold.b[0] - fold.a[0]) * i / 10, fold.a[1] + (fold.b[1] - fold.a[1]) * i / 10] as [number, number]);
      if (!points.every(p => inMaterial(p, part.polygon, part.holes))) out.push(diagnostic('hinge-material', `${part.name}: an essential fold has lost its supporting paper. Restore the outline or move the cutout.`, [part.id]));
      if (fold.kind === 'valley' && fold.match) {
        const host = pose.parts.find(p => p.id === fold.match);
        if (host) {
          const inverse = host.matrix.clone().invert();
          const local = points.map(p => worldPoint(part, p).applyMatrix4(inverse));
          if (!local.every(p => Math.abs(p.z) < 0.01 && inMaterial([p.x, p.y], host.polygon, host.holes))) out.push(diagnostic('attachment-bounds', `${part.name}: its attachment crease extends beyond ${host.name}.`, [part.id, host.id]));
        }
      }
    }
  }
  for (const item of [...compiled.spread.artwork, ...compiled.spread.digital]) {
    if (!compiled.project.assets[item.assetId]) out.push(diagnostic('missing-asset', 'An attached asset is missing. Reimport the image or model.', [item.id]));
    const parentId = 'partId' in item ? item.partId : item.parent;
    if (!pose.parts.some(p => p.id === parentId)) out.push(diagnostic('missing-host', 'An image or digital object has a missing paper parent.', [item.id]));
  }
  for (const entry of templateParts(compiled, pose)) for (const footprint of entry.footprints) {
    if (!footprint.points.every(p => inMaterial(p, entry.part.polygon, entry.part.holes))) out.push(diagnostic('glue-footprint', `${entry.part.name}: a matching glue area extends outside its paper. Reduce or move the attached mechanism.`, [entry.part.id, footprint.match]));
  }
  const closed = evaluateSpread(compiled, 0);
  for (const part of closed.parts.filter(p => p.role !== 'page')) {
    if (part.polygon.some(p => { const v = worldPoint(part, p); return v.x < -compiled.project.pageWidth - 0.05 || v.x > 0.05 || Math.abs(v.y) > compiled.project.pageHeight / 2 + 0.05 || Math.abs(v.z) > 0.5; })) out.push(diagnostic('closed-bounds', `${part.name} extends outside the closed page envelope.`, [part.id], 0, 'warning'));
  }
  return out;
}
function geometry(part: PaperPart) {
  const data = triangulate(part), vertices = data.points.map(p => worldPoint(part, p)), triangles: Triangle[] = [];
  for (let i = 0; i < data.indices.length; i += 3) triangles.push(new Triangle(vertices[data.indices[i]], vertices[data.indices[i + 1]], vertices[data.indices[i + 2]]));
  return { triangles, bounds: new Box3().setFromPoints(vertices) };
}
function edgePierces(a: Vector3, b: Vector3, triangle: Triangle) {
  const n = triangle.getNormal(new Vector3()), da = n.dot(a.clone().sub(triangle.a)), db = n.dot(b.clone().sub(triangle.a));
  if (da * db >= -1e-8 || Math.abs(da) < 1e-5 || Math.abs(db) < 1e-5) return false;
  const p = a.clone().lerp(b, da / (da - db)), bary = triangle.getBarycoord(p, new Vector3());
  return bary !== null && bary.x > 1e-7 && bary.y > 1e-7 && bary.z > 1e-7;
}
export function partsIntersect(a: PaperPart, b: PaperPart): boolean {
  const A = geometry(a), B = geometry(b); if (!A.bounds.intersectsBox(B.bounds)) return false;
  return A.triangles.some(t => B.triangles.some(u => {
    const ta = [t.a, t.b, t.c], tb = [u.a, u.b, u.c];
    return ta.some((p, i) => edgePierces(p, ta[(i + 1) % 3], u)) || tb.some((p, i) => edgePierces(p, tb[(i + 1) % 3], t));
  }));
}
export function collisionsAt(pose: Pose): Diagnostic[] {
  if (pose.angle <= 0.001) return []; // closed-sheet stacking is intentional contact in a zero-thickness model
  const out: Diagnostic[] = [];
  for (let i = 0; i < pose.parts.length; i++) for (let j = i + 1; j < pose.parts.length; j++) {
    const a = pose.parts[i], b = pose.parts[j];
    if (a.role === 'decoration' && a.parentIds.includes(b.id) || b.role === 'decoration' && b.parentIds.includes(a.id)) continue;
    if (partsIntersect(a, b)) out.push(diagnostic('intersection', `${a.name} crosses ${b.name} at ${pose.angle}°.`, [a.id, b.id], pose.angle, 'warning'));
  }
  return out;
}
export async function validateSpread(compiled: CompiledSpread, onProgress?: (angle: number) => void): Promise<Diagnostic[]> {
  const out = validateStatic(compiled), seen = new Set(out.map(d => `${d.code}:${d.partIds.join()}`));
  for (let angle = 0; angle <= 180; angle++) {
    const pose = evaluateSpread(compiled, angle);
    for (const d of [...pose.diagnostics, ...collisionsAt(pose)]) { const key = `${d.code}:${d.partIds.join()}`; if (!seen.has(key)) { seen.add(key); out.push(d); } }
    if (angle % 10 === 0) { onProgress?.(angle); await new Promise(resolve => setTimeout(resolve, 0)); }
  }
  return out;
}
export { compileProject };
