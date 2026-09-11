import type { Vec2 } from '../model';
import type { CompiledSpread, PaperPart, FoldLine, Pose } from './geometry';
import { worldPoint } from './geometry';
import { makeTab, segmentDistance } from './polygon';

export interface TemplateTab { id: string; edge: number; polygon: Vec2[]; match?: string; fold: FoldLine; }
export interface TemplatePart { part: PaperPart; outline: Vec2[]; tabs: TemplateTab[]; footprints: { points: Vec2[]; match: string }[]; }
const same = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]) < .01;
export function partTabs(part: PaperPart, compiled: CompiledSpread): TemplateTab[] {
  const edges = new Map<number, { depth: number; match?: string; kind: FoldLine['kind'] }>();
  for (const fold of part.folds) {
    if (fold.kind !== 'valley' && !(fold.kind === 'mountain' && part.role === 'left')) continue;
    const edge = part.polygon.findIndex((p, i) => (same(p, fold.a) && same(part.polygon[(i + 1) % part.polygon.length], fold.b)) || (same(p, fold.b) && same(part.polygon[(i + 1) % part.polygon.length], fold.a)));
    if (edge >= 0) edges.set(edge, { depth: fold.kind === 'valley' ? 6 : 5, match: fold.match, kind: fold.kind });
  }
  for (const tab of compiled.spread.tabs.filter(t => t.partId === part.id)) edges.set(tab.edge, { depth: tab.depth, kind: 'valley' });
  return [...edges].filter(([edge]) => edge < part.polygon.length).map(([edge, info]) => ({ id: `${part.id}:tab${edge}`, edge, polygon: makeTab(part.polygon, edge, info.depth), match: info.match, fold: { a: part.polygon[edge], b: part.polygon[(edge + 1) % part.polygon.length], kind: info.kind, match: info.match } }));
}
export function templateParts(compiled: CompiledSpread, pose: Pose): TemplatePart[] {
  const parts = pose.parts.map(part => {
    const tabs = partTabs(part, compiled), outline: Vec2[] = [];
    part.polygon.forEach((p, i) => { outline.push(p); const tab = tabs.find(t => t.edge === i); if (tab?.polygon.length === 4) outline.push(tab.polygon[3], tab.polygon[2]); });
    return { part, tabs, outline, footprints: [] } as TemplatePart;
  });
  for (const entry of parts) for (const tab of entry.tabs) {
    const target = parts.find(p => p.part.id === tab.match); if (!target) continue;
    const inverse = target.part.matrix.clone().invert();
    const a = worldPoint(entry.part, tab.fold.a).applyMatrix4(inverse), b = worldPoint(entry.part, tab.fold.b).applyMatrix4(inverse);
    // Glue strip folds onto the recipient's material side of the crease.
    const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy); if (length < .01) continue;
    const depth = segmentDistance(tab.polygon[2], tab.fold.a, tab.fold.b);
    const center = target.part.polygon.reduce((sum, p) => [sum[0] + p[0] / target.part.polygon.length, sum[1] + p[1] / target.part.polygon.length] as Vec2, [0, 0] as Vec2);
    const sign = (-dy * (center[0] - (a.x + b.x) / 2) + dx * (center[1] - (a.y + b.y) / 2)) >= 0 ? 1 : -1;
    const nx = -dy / length * depth * sign, ny = dx / length * depth * sign;
    const bevel = Math.min(depth * 1.5, length / 3);
    target.footprints.push({ points: [[a.x, a.y], [b.x, b.y], [b.x + nx - dx / length * bevel, b.y + ny - dy / length * bevel], [a.x + nx + dx / length * bevel, a.y + ny + dy / length * bevel]], match: entry.part.id });
  }
  // Guide bridges have two glue feet; the middle remains unglued for free strip travel.
  for (const guide of parts.filter(p => p.part.role.startsWith('guide'))) {
    const target = parts.find(p => p.part.id === guide.part.parentIds[0]); if (!target) continue;
    const inverse = target.part.matrix.clone().invert(), w = guide.part.polygon[1][0], h = guide.part.polygon[2][1];
    for (const y of [0, h - 6]) {
      const points = [[0, y], [w, y], [w, y + 6], [0, y + 6]].map(p => { const v = worldPoint(guide.part, p as Vec2).applyMatrix4(inverse); return [v.x, v.y] as Vec2; });
      target.footprints.push({ points, match: guide.part.id });
    }
  }
  return parts;
}
