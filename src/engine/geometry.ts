import { Matrix4, Vector2, Vector3, ShapeUtils } from 'three';
import type { Diagnostic, Mechanism, Project, Spread, Vec2 } from '../model';

export const rad = (d: number) => d * Math.PI / 180;
export const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));
export interface FoldLine { a: Vec2; b: Vec2; kind: 'mountain' | 'valley' | 'glue'; match?: string; }
export interface PaperPart {
  id: string; name: string; mechanismId?: string; role: string; polygon: Vec2[]; holes: Vec2[][];
  color: string; matrix: Matrix4; folds: FoldLine[]; parentIds: string[];
}
export interface HingePort {
  id: string; origin: Vector3; axis: Vector3; left: Vector3; right: Vector3;
  leftPart: string; rightPart: string; length: number; angle: number;
}
export interface CompiledSpread { project: Project; spread: Spread; order: Mechanism[]; diagnostics: Diagnostic[]; }
export interface Pose { parts: PaperPart[]; hinges: HingePort[]; diagnostics: Diagnostic[]; angle: number; }
const basis = (origin: Vector3, x: Vector3, y: Vector3) => new Matrix4().makeBasis(x, y, x.clone().cross(y).normalize()).setPosition(origin);
const rect = (w: number, h: number): Vec2[] => [[0, 0], [w, 0], [w, h], [0, h]];
export const diagnostic = (code: string, message: string, partIds: string[], angle?: number, severity: Diagnostic['severity'] = 'error'): Diagnostic => ({ id: `${code}:${partIds.join(':')}:${angle ?? ''}`, code, message, partIds, angle, severity });
export function compileProject(project: Project, spreadId: string): CompiledSpread {
  const spread = project.spreads.find(s => s.id === spreadId) ?? project.spreads[0];
  const order: Mechanism[] = [], diagnostics: Diagnostic[] = [];
  const visited = new Set<string>(), visiting = new Set<string>();
  const visit = (m: Mechanism) => {
    if (visited.has(m.id)) return;
    if (visiting.has(m.id)) { diagnostics.push(diagnostic('cycle', 'Attachment cycle: reconnect this mechanism to an earlier hinge.', [m.id])); return; }
    visiting.add(m.id);
    if (!['spine', 'page-left', 'page-right'].includes(m.host)) {
      const parent = spread.mechanisms.find(p => m.host.startsWith(`${p.id}:`));
      if (!parent) diagnostics.push(diagnostic('missing-host', `${m.name} has a missing host. Select an available hinge.`, [m.id]));
      else visit(parent);
    }
    visiting.delete(m.id); visited.add(m.id); order.push(m);
  };
  spread.mechanisms.forEach(visit);
  return { project, spread, order, diagnostics };
}

/** Closed-flat spherical linkage. Input angles in radians; output in the oriented host frame. */
export function solveVFold(a: number, b: number, g: number, theta: number): Vector3 {
  if (!(a > 0 && b > 0 && a < Math.PI / 2 && b < Math.PI / 2 && g > a + b && g < Math.PI)) throw new Error('The ridge angle must exceed the sum of the base angles and remain below 180°.');
  const sg = Math.sin(g), cg = Math.cos(g);
  if (theta < 1e-12) return new Vector3(sg, cg, 0);
  if (Math.PI - theta < 1e-12) {
    const x = sg * Math.sin(a - b) / Math.sin(a + b);
    const y = cg + 2 * sg * Math.sin(a) * Math.sin(b) / Math.sin(a + b);
    return new Vector3(x, y, Math.sqrt(Math.max(0, 1 - x * x - y * y)));
  }
  const dh = (a - b) / 2, ah = (a + b) / 2, s2 = Math.sin(theta / 2) ** 2, st = Math.sin(theta);
  const sa = Math.sin(a), sb = Math.sin(b), ca = Math.cos(a), k = 2 * sa * sb * s2;
  const minus = 2 * Math.sin(dh) ** 2 + k, plus = 2 * Math.cos(dh) ** 2 - k;
  const sum = new Vector3(2 * Math.sin(ah) * Math.cos(dh) - 2 * sb * s2, 2 * Math.cos(ah) * Math.cos(dh), sb * st);
  const diff = new Vector3(2 * Math.cos(ah) * Math.sin(dh) + 2 * sb * s2, -2 * Math.sin(ah) * Math.sin(dh), -sb * st);
  const cross = new Vector3(ca * sb * st, -sa * sb * st, Math.sin(a - b) + 2 * ca * sb * s2);
  const determinant = k * (1 - minus - Math.cos(2 * g - a - b));
  return sum.multiplyScalar(2 * Math.cos(g - ah) * Math.cos(dh) / (2 * plus))
    .addScaledVector(diff, 2 * Math.sin(g - ah) * Math.sin(dh) / (2 * minus))
    .addScaledVector(cross, Math.sqrt(Math.max(0, determinant)) / (minus * plus));
}

/** Planar four-bar circle intersection with an explicit closed-flat assembly branch. */
export function solveTent(left: number, right: number, reach: number, theta: number): Vector2 {
  if (!(left > 0 && right > 0 && reach > left + right)) throw new Error('Closed reach must exceed both anchor distances combined.');
  if (theta < 1e-10) return new Vector2(reach, 0);
  const A = new Vector2(left, 0), B = new Vector2(right * Math.cos(theta), right * Math.sin(theta));
  const delta = B.clone().sub(A), d = delta.length(), l = reach - left, r = reach - right;
  const along = (l * l - r * r + d * d) / (2 * d), height2 = l * l - along * along;
  if (height2 < -1e-5) throw new Error('The tent cannot close at this hinge angle.');
  const e = delta.divideScalar(d);
  return A.addScaledVector(e, along).add(new Vector2(e.y, -e.x).multiplyScalar(Math.sqrt(Math.max(0, height2))));
}

function hingeAngle(left: Vector3, right: Vector3, axis: Vector3): number {
  const a = Math.atan2(right.dot(left.clone().cross(axis)), clamp(right.dot(left), -1, 1));
  return Math.abs(a) < 1e-10 ? 0 : a;
}
export function evaluateSpread(compiled: CompiledSpread, angle: number, drivers: Record<string, number> = {}): Pose {
  const { project, spread, order } = compiled;
  const theta = rad(clamp(angle, 0, 180)), axis = new Vector3(0, -1, 0), left = new Vector3(-1, 0, 0), right = new Vector3(-Math.cos(theta), 0, Math.sin(theta));
  const parts: PaperPart[] = [], hinges: HingePort[] = [], diagnostics = [...compiled.diagnostics];
  const origin = new Vector3();
  const pagePolygon: Vec2[] = [[0, -project.pageHeight / 2], [project.pageWidth, -project.pageHeight / 2], [project.pageWidth, project.pageHeight / 2], [0, project.pageHeight / 2]];
  parts.push({ id: 'page-left', name: 'Left page', role: 'page', polygon: pagePolygon, holes: [], color: '#f7f4e9', matrix: basis(origin, left, axis), folds: [], parentIds: [] });
  parts.push({ id: 'page-right', name: 'Right page', role: 'page', polygon: pagePolygon, holes: [], color: '#f7f4e9', matrix: basis(origin, right, axis), folds: [], parentIds: [] });
  hinges.push({ id: 'spine', origin, axis, left, right, leftPart: 'page-left', rightPart: 'page-right', length: project.pageHeight, angle: theta });
  for (const m of order) {
    try {
      if (!(m.width > 0 && m.reach > 0)) throw new Error('Width and reach must be positive.');
      if (m.kind === 'slider') {
        const parent = parts.find(p => p.id === m.host);
        if (!parent) throw new Error('A slider needs an existing paper panel as its host.');
        const raw = drivers[m.id] ?? 0, travel = clamp(raw, 0, 1) * m.stroke;
        if (raw < 0 || raw > 1 || m.stroke < 0 || m.stroke > m.reach - 18) diagnostics.push(diagnostic('slider-travel', `${m.name}: keep the strip engaged in both guides throughout its travel.`, [m.id], angle));
        const mat = parent.matrix.clone().multiply(new Matrix4().makeTranslation(m.left + travel, m.offset, 0.12));
        parts.push({ id: `${m.id}:strip`, name: m.name, mechanismId: m.id, role: 'strip', polygon: m.outlines.strip ?? rect(m.reach, m.width), holes: m.cutouts.strip ?? [], color: m.color, matrix: mat, folds: [], parentIds: [parent.id] });
        for (let i = 0; i < 2; i++) {
          const guideX = m.left + m.stroke + 3 + i * 9;
          parts.push({ id: `${m.id}:guide${i}`, name: `${m.name} guide ${i + 1}`, mechanismId: m.id, role: `guide${i}`, polygon: rect(5, m.width + 12), holes: [], color: '#e6dfca', matrix: parent.matrix.clone().multiply(new Matrix4().makeTranslation(guideX, m.offset - 6, 0.3)), folds: [{ a: [0, 6], b: [5, 6], kind: 'glue', match: parent.id }, { a: [0, m.width + 6], b: [5, m.width + 6], kind: 'glue', match: parent.id }], parentIds: [parent.id] });
        }
        continue;
      }
      const host = hinges.find(h => h.id === m.host);
      if (!host) throw new Error('This host hinge is unavailable. Reattach the mechanism.');
      if (host.angle < -1e-7 || host.angle > Math.PI + 1e-7) throw new Error('The host folds outside the supported 0–180° range.');
      const hAngle = clamp(host.angle, 0, Math.PI), hZ = host.left.clone().cross(host.axis).normalize();
      const at = host.origin.clone().addScaledVector(host.axis, m.offset);
      if (m.kind === 'vfold') {
        const a = rad(m.alpha), b = rad(m.alpha), g = rad(m.alpha + m.beta);
        const localRidge = solveVFold(a, b, g, hAngle);
        if (m.branch === -1) throw new Error('Only the outward, closed-flat V-fold branch is supported.');
        const ridge = host.left.clone().multiplyScalar(localRidge.x).addScaledVector(host.axis, localRidge.y).addScaledVector(hZ, localRidge.z).normalize();
        const uL = host.left.clone().multiplyScalar(Math.sin(a)).addScaledVector(host.axis, Math.cos(a));
        const uR = host.right.clone().multiplyScalar(Math.sin(b)).addScaledVector(host.axis, Math.cos(b));
        const sector = rad(m.beta), wedge: Vec2[] = [[0, 0], [m.width, 0], [m.reach * Math.cos(sector), m.reach * Math.sin(sector)]];
        for (const [role, u, parent] of [['left', uL, host.leftPart], ['right', uR, host.rightPart]] as const) {
          const y = ridge.clone().addScaledVector(u, -Math.cos(sector)).divideScalar(Math.sin(sector));
          parts.push({ id: `${m.id}:${role}`, name: `${m.name} · ${role}`, mechanismId: m.id, role, polygon: m.outlines[role] ?? wedge, holes: m.cutouts[role] ?? [], color: m.color, matrix: basis(at, u, y), folds: [{ a: [0, 0], b: [m.width, 0], kind: 'valley', match: parent }, { a: [0, 0], b: wedge[2], kind: 'mountain', match: `${m.id}:${role === 'left' ? 'right' : 'left'}` }], parentIds: [parent] });
        }
        const l = uR.clone().addScaledVector(ridge, -Math.cos(sector)).normalize(), r = uL.clone().addScaledVector(ridge, -Math.cos(sector)).normalize();
        hinges.push({ id: `${m.id}:ridge`, origin: at, axis: ridge, left: l, right: r, leftPart: `${m.id}:right`, rightPart: `${m.id}:left`, length: m.reach, angle: hingeAngle(l, r, ridge) });
      } else {
        const ridge2 = solveTent(m.left, m.right, m.reach, hAngle);
        const ridgeAt = at.clone().addScaledVector(host.left, ridge2.x).addScaledVector(hZ, ridge2.y);
        const AL = at.clone().addScaledVector(host.left, m.left), AR = at.clone().addScaledVector(host.right, m.right);
        const dL = ridgeAt.clone().sub(AL).normalize(), dR = ridgeAt.clone().sub(AR).normalize();
        for (const [role, anchor, away, len, parent] of [['left', AL, dL, m.reach - m.left, host.leftPart], ['right', AR, dR, m.reach - m.right, host.rightPart]] as const) {
          const polygon: Vec2[] = [[0, -m.width / 2], [len, -m.width / 2], [len, m.width / 2], [0, m.width / 2]];
          parts.push({ id: `${m.id}:${role}`, name: `${m.name} · ${role}`, mechanismId: m.id, role, polygon: m.outlines[role] ?? polygon, holes: m.cutouts[role] ?? [], color: m.color, matrix: basis(anchor, away, host.axis), folds: [{ a: [0, -m.width / 2], b: [0, m.width / 2], kind: 'valley', match: parent }, { a: [len, -m.width / 2], b: [len, m.width / 2], kind: 'mountain', match: `${m.id}:${role === 'left' ? 'right' : 'left'}` }], parentIds: [parent] });
        }
        const l = dR.clone().negate(), r = dL.clone().negate();
        hinges.push({ id: `${m.id}:ridge`, origin: ridgeAt, axis: host.axis.clone(), left: l, right: r, leftPart: `${m.id}:right`, rightPart: `${m.id}:left`, length: m.width, angle: hingeAngle(l, r, host.axis) });
      }
    } catch (error) { diagnostics.push(diagnostic('unsolved', `${m.name}: ${error instanceof Error ? error.message : String(error)}`, [m.id], angle)); }
  }
  for (const d of spread.decorations) {
    const parent = parts.find(p => p.id === d.parent);
    if (!parent) { diagnostics.push(diagnostic('missing-host', `${d.name} has a missing parent.`, [d.id])); continue; }
    parts.push({ id: d.id, name: d.name, role: 'decoration', polygon: d.outline, holes: d.holes, color: d.color, matrix: parent.matrix.clone().multiply(new Matrix4().makeTranslation(d.position[0], d.position[1], 0.05)), folds: [], parentIds: [d.parent] });
  }
  return { parts, hinges, diagnostics, angle };
}

export function triangulate(part: Pick<PaperPart, 'polygon' | 'holes'>): { points: Vec2[]; indices: number[] } {
  const contour = part.polygon.map(p => new Vector2(...p)), holes = part.holes.map(h => h.map(p => new Vector2(...p)));
  return { points: [...part.polygon, ...part.holes.flat()], indices: ShapeUtils.triangulateShape(contour, holes).flat() };
}
export const worldPoint = (part: PaperPart, p: Vec2) => new Vector3(p[0], p[1], 0).applyMatrix4(part.matrix);
export function polygonBounds(polygon: Vec2[]) {
  const xs = polygon.map(p => p[0]), ys = polygon.map(p => p[1]);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}
