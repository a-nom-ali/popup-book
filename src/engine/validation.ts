import { Box3, Matrix4, Triangle, Vector3 } from 'three';
import type { Diagnostic } from '../model';
import {
  area,
  inMaterial,
  inside,
  selfIntersects,
  segmentsCross,
  segmentInMaterial,
  segmentDistance,
} from './polygon';
import { compileProject, diagnostic, evaluateSpread, triangulate, worldPoint } from './geometry';
import type { CompiledSpread, PaperPart, Pose } from './geometry';
import { templateParts, assemblyTabParts } from './fabrication';
import type { Vec2 } from '../model';
import { glueRegionValid, regionArea, regionContained } from './cutouts';

export function validateStatic(compiled: CompiledSpread): Diagnostic[] {
  const pose = evaluateSpread(compiled, 180),
    out = [...pose.diagnostics];
  for (const part of pose.parts) {
    if (
      part.polygon.length < 3 ||
      Math.abs(area(part.polygon)) < 0.01 ||
      selfIntersects(part.polygon)
    )
      out.push(
        diagnostic(
          'invalid-outline',
          `${part.name}: use a non-crossing outline with at least three vertices.`,
          [part.id],
        ),
      );
    for (const hole of part.holes) {
      const crosses = hole.some((a, i) =>
        part.polygon.some((b, j) =>
          segmentsCross(
            a,
            hole[(i + 1) % hole.length],
            b,
            part.polygon[(j + 1) % part.polygon.length],
          ),
        ),
      );
      if (
        hole.length < 3 ||
        Math.abs(area(hole)) < 0.01 ||
        selfIntersects(hole) ||
        !hole.every((p) => inside(p, part.polygon, false)) ||
        crosses
      )
        out.push(
          diagnostic(
            'invalid-cutout',
            `${part.name}: cutouts must be closed and fully inside the paper.`,
            [part.id],
          ),
        );
    }
    for (let i = 0; i < part.holes.length; i++)
      for (let j = i + 1; j < part.holes.length; j++) {
        const a = part.holes[i],
          b = part.holes[j];
        if (
          a.some((p) => inside(p, b)) ||
          b.some((p) => inside(p, a)) ||
          a.some((p, k) =>
            b.some((q, l) => segmentsCross(p, a[(k + 1) % a.length], q, b[(l + 1) % b.length])),
          )
        )
          out.push(
            diagnostic(
              'overlapping-cutouts',
              `${part.name}: cutouts overlap or touch. Keep separate holes disjoint.`,
              [part.id],
            ),
          );
      }
    for (const fold of part.folds) {
      const points = Array.from(
        { length: 11 },
        (_, i) =>
          [
            fold.a[0] + ((fold.b[0] - fold.a[0]) * i) / 10,
            fold.a[1] + ((fold.b[1] - fold.a[1]) * i) / 10,
          ] as [number, number],
      );
      if (!segmentInMaterial(fold.a, fold.b, part.polygon, part.holes))
        out.push(
          diagnostic(
            'hinge-material',
            `${part.name}: an essential fold has lost its supporting paper. Restore the outline or move the cutout.`,
            [part.id],
          ),
        );
      if (fold.kind === 'valley' && fold.match) {
        const host = pose.parts.find((p) => p.id === fold.match);
        if (host) {
          const inverse = host.matrix.clone().invert();
          const local = points.map((p) => worldPoint(part, p).applyMatrix4(inverse));
          if (
            !local.every((p) => Math.abs(p.z) < 0.01) ||
            !segmentInMaterial(
              [local[0].x, local[0].y],
              [local.at(-1)!.x, local.at(-1)!.y],
              host.polygon,
              host.holes,
            )
          )
            out.push(
              diagnostic(
                'attachment-bounds',
                `${part.name}: its attachment crease extends beyond ${host.name}.`,
                [part.id, host.id],
              ),
            );
        }
      }
    }
  }
  const materialContains = (region: Vec2[], part: PaperPart) =>
    region.every((p, i) =>
      segmentInMaterial(p, region[(i + 1) % region.length], part.polygon, part.holes),
    ) && !part.holes.some((h) => h.some((p) => inside(p, region)));
  for (const m of compiled.order.filter((m) => m.kind === 'slider')) {
    const strip = pose.parts.find((p) => p.id === `${m.id}:strip`);
    if (!strip) continue;
    const region = (x1: number, x2: number, y1 = 0, y2 = m.width): Vec2[] => [
      [x1, y1],
      [x2, y1],
      [x2, y2],
      [x1, y2],
    ];
    // Swept channel footprints cover every translation, not just the sampled poses.
    if (
      ![region(3, m.stroke + 8), region(m.reach - 8 - m.stroke, m.reach - 3)].every((r) =>
        materialContains(r, strip),
      )
    )
      out.push(
        diagnostic(
          'slider-engagement',
          `${m.name}: edited strip material does not stay under both guides throughout its travel.`,
          [strip.id],
        ),
      );
    if (
      ![region(0, 3, -4, m.width + 4), region(m.reach - 3, m.reach, -4, m.width + 4)].every((r) =>
        materialContains(r, strip),
      )
    )
      out.push(
        diagnostic(
          'slider-stops',
          `${m.name}: restore the widened end stops to retain the guided strip.`,
          [strip.id],
        ),
      );
  }
  for (const item of [...compiled.spread.artwork, ...compiled.spread.digital]) {
    if (!compiled.project.assets[item.assetId]?.data)
      out.push(
        diagnostic(
          'missing-asset',
          'An attached asset is missing or has no data. Reimport the image or model.',
          [item.id],
        ),
      );
    const parentId = 'partId' in item ? item.partId : item.parent;
    if (!pose.parts.some((p) => p.id === parentId))
      out.push(
        diagnostic('missing-host', 'An image or digital object has a missing paper parent.', [
          item.id,
        ]),
      );
  }
  for (const item of compiled.spread.digital)
    if (
      item.behavior === 'angle' &&
      (item.angleStart < 0 || item.angleEnd > 180 || item.angleEnd <= item.angleStart)
    )
      out.push(
        diagnostic(
          'animation-range',
          `${item.name}: use an increasing animation angle range within 0–180°.`,
          [item.id],
        ),
      );
  for (const decoration of compiled.spread.decorations) {
    const parent = pose.parts.find((p) => p.id === decoration.parent);
    if (!parent) continue; // The geometry compiler already reports missing attachments.
    if (decoration.cutout || decoration.glueRegion !== undefined) {
      if (!glueRegionValid(decoration, parent))
        out.push(
          diagnostic(
            'cutout-glue',
            `${decoration.name}: define a positive-area glue patch contained in both the cut-out and ${parent.name}, away from their holes. Move, redraw, or suggest its glue area.`,
            [decoration.id, parent.id],
          ),
        );
      else {
        const regions = decoration.glueRegion!,
          size = regionArea(regions),
          minimumSpan = Math.min(
            ...regions.map((r) =>
              Math.min(
                ...r.outline.map((p, i) => {
                  const q = r.outline[(i + 1) % r.outline.length],
                    dx = q[0] - p[0],
                    dy = q[1] - p[1],
                    length = Math.hypot(dx, dy);
                  if (length < 1e-8) return Infinity;
                  const projected = r.outline.map((v) => (-dy * v[0] + dx * v[1]) / length);
                  return Math.max(...projected) - Math.min(...projected);
                }),
              ),
            ),
          );
        if (size < 4 || minimumSpan < 1)
          out.push(
            diagnostic(
              'cutout-glue-small',
              `${decoration.name}: its glue region has ${size.toFixed(2)} mm² of material and a narrowest outline span of ${minimumSpan.toFixed(2)} mm. Review glue access in a physical prototype; these measurements do not assess bond strength or paper stiffness.`,
              [decoration.id, parent.id],
              undefined,
              'warning',
            ),
          );
      }
    }
  }
  for (const entry of templateParts(compiled, pose))
    for (const footprint of entry.footprints) {
      if (
        !regionContained([{ outline: footprint.points, holes: footprint.holes ?? [] }], {
          outline: entry.part.polygon,
          holes: entry.part.holes,
        })
      )
        out.push(
          diagnostic(
            'glue-footprint',
            `${entry.part.name}: a matching glue area extends outside its paper. Reduce or move the attached mechanism.`,
            [entry.part.id, footprint.match],
          ),
        );
    }
  const boundsSeen = new Set<string>();
  for (const drivers of sliderSamples(compiled)) {
    const sampled = evaluateSpread(compiled, 0, drivers);
    for (const part of [...sampled.parts, ...assemblyTabParts(compiled, sampled)].filter(
      (p) => p.role !== 'page',
    )) {
      if (
        !boundsSeen.has(part.id) &&
        part.polygon.some((p) => {
          const v = worldPoint(part, p);
          return (
            v.x < -compiled.project.pageWidth - 0.05 ||
            v.x > 0.05 ||
            Math.abs(v.y) > compiled.project.pageHeight / 2 + 0.05 ||
            Math.abs(v.z) > 0.75
          );
        })
      ) {
        boundsSeen.add(part.id);
        out.push({
          ...diagnostic(
            'closed-bounds',
            `${part.name} extends outside the closed page envelope.`,
            [part.id],
            0,
            'warning',
          ),
          drivers,
        });
      }
    }
  }
  return out;
}
function geometry(part: PaperPart) {
  const data = triangulate(part),
    vertices = data.points.map((p) => worldPoint(part, p)),
    triangles: Triangle[] = [];
  for (let i = 0; i < data.indices.length; i += 3)
    triangles.push(
      new Triangle(
        vertices[data.indices[i]],
        vertices[data.indices[i + 1]],
        vertices[data.indices[i + 2]],
      ),
    );
  return { triangles, bounds: new Box3().setFromPoints(vertices) };
}
function edgePierces(a: Vector3, b: Vector3, triangle: Triangle) {
  const n = triangle.getNormal(new Vector3()),
    da = n.dot(a.clone().sub(triangle.a)),
    db = n.dot(b.clone().sub(triangle.a));
  if (da * db >= -1e-8 || Math.abs(da) < 1e-5 || Math.abs(db) < 1e-5) return false;
  const p = a.clone().lerp(b, da / (da - db)),
    bary = triangle.getBarycoord(p, new Vector3());
  return bary !== null && bary.x > 1e-7 && bary.y > 1e-7 && bary.z > 1e-7;
}
export function partsIntersect(a: PaperPart, b: PaperPart): boolean {
  const A = geometry(a),
    B = geometry(b);
  if (!A.bounds.intersectsBox(B.bounds)) return false;
  return A.triangles.some((t) =>
    B.triangles.some((u) => {
      const ta = [t.a, t.b, t.c],
        tb = [u.a, u.b, u.c];
      const n = t.getNormal(new Vector3()),
        un = u.getNormal(new Vector3());
      if (Math.abs(n.dot(un)) > 0.9999999 && Math.abs(n.dot(u.a.clone().sub(t.a))) < 0.00001) {
        const drop =
          Math.abs(n.x) > Math.abs(n.y) && Math.abs(n.x) > Math.abs(n.z)
            ? 0
            : Math.abs(n.y) > Math.abs(n.z)
              ? 1
              : 2;
        const project = (v: Vector3) => v.toArray().filter((_, i) => i !== drop) as Vec2;
        const p = ta.map(project),
          q = tb.map(project),
          strictInside = (point: Vec2, polygon: Vec2[]) =>
            inside(point, polygon, false) &&
            polygon.every(
              (a, i) => segmentDistance(point, a, polygon[(i + 1) % polygon.length]) > 1e-6,
            );
        const center = (poly: Vec2[]): Vec2 => [
          poly.reduce((a, p) => a + p[0], 0) / 3,
          poly.reduce((a, p) => a + p[1], 0) / 3,
        ];
        if (
          p.some((v) => strictInside(v, q)) ||
          q.some((v) => strictInside(v, p)) ||
          strictInside(center(p), q) ||
          strictInside(center(q), p) ||
          p.some((a, i) => q.some((b, j) => segmentsCross(a, p[(i + 1) % 3], b, q[(j + 1) % 3])))
        )
          return true;
      }
      return (
        ta.some((p, i) => edgePierces(p, ta[(i + 1) % 3], u)) ||
        tb.some((p, i) => edgePierces(p, tb[(i + 1) % 3], t))
      );
    }),
  );
}
export function isCoplanarAttachment(child: PaperPart, parent: PaperPart): boolean {
  const relative = parent.matrix.clone().invert().multiply(child.matrix),
    normal = new Vector3(0, 0, 1).transformDirection(relative);
  // The renderer separates stacked zero-thickness sheets by 0.05 mm to avoid z-fighting.
  return (
    Math.abs(normal.z) > 1 - 1e-8 &&
    child.polygon.every(
      (p) => Math.abs(new Vector3(p[0], p[1], 0).applyMatrix4(relative).z) <= 0.051,
    )
  );
}
/** Remove display-only sheet separation before zero-thickness intersection checks. */
export function physicalPaperPose(pose: Pose, compiled: CompiledSpread): Pose {
  const byId = new Map(pose.parts.map((p) => [p.id, p])),
    resolved = new Map<string, PaperPart>(),
    resolving = new Set<string>();
  const resolve = (part: PaperPart): PaperPart => {
    if (resolved.has(part.id)) return resolved.get(part.id)!;
    if (resolving.has(part.id)) return part;
    resolving.add(part.id);
    const decoration = compiled.spread.decorations.find((d) => d.id === part.id),
      parent = decoration && byId.get(decoration.parent);
    const physical =
      decoration && parent
        ? {
            ...part,
            matrix: resolve(parent)
              .matrix.clone()
              .multiply(
                new Matrix4().makeTranslation(decoration.position[0], decoration.position[1], 0),
              )
              .multiply(new Matrix4().makeRotationZ(((decoration.rotation ?? 0) * Math.PI) / 180)),
          }
        : part;
    resolving.delete(part.id);
    resolved.set(part.id, physical);
    return physical;
  };
  return { ...pose, parts: pose.parts.map(resolve) };
}
export function isDeclaredGlueStack(
  a: PaperPart,
  b: PaperPart,
  parts: PaperPart[],
  compiled: CompiledSpread,
): boolean {
  const decoration = a.role === 'decoration' ? a : b.role === 'decoration' ? b : undefined,
    tab = a.role === 'glue-tab' ? a : b.role === 'glue-tab' ? b : undefined;
  if (!decoration || !tab || tab.parentIds[1] !== decoration.parentIds[0]) return false;
  const parent = parts.find((p) => p.id === tab.parentIds[1]),
    authored = compiled.spread.decorations.find((d) => d.id === decoration.id);
  // A ridge tab and a cut-out may both lie flat on the same recipient. This is
  // declared stacking only when the cut-out has a valid bond and both are coplanar.
  return (
    !!parent &&
    !!authored &&
    glueRegionValid(authored, parent) &&
    isCoplanarAttachment(decoration, parent) &&
    isCoplanarAttachment(tab, parent)
  );
}
export function collisionsAt(pose: Pose, compiled?: CompiledSpread): Diagnostic[] {
  if (pose.angle <= 0.001) return []; // closed-sheet stacking is intentional contact in a zero-thickness model
  if (compiled) pose = physicalPaperPose(pose, compiled);
  const out: Diagnostic[] = [];
  const parts = compiled ? [...pose.parts, ...assemblyTabParts(compiled, pose)] : pose.parts;
  for (let i = 0; i < parts.length; i++)
    for (let j = i + 1; j < parts.length; j++) {
      const a = parts[i],
        b = parts[j];
      if (
        (a.role === 'decoration' && a.parentIds.includes(b.id) && isCoplanarAttachment(a, b)) ||
        (b.role === 'decoration' && b.parentIds.includes(a.id) && isCoplanarAttachment(b, a))
      )
        continue;
      if (
        (a.role === 'glue-tab' && a.parentIds.includes(b.id)) ||
        (b.role === 'glue-tab' && b.parentIds.includes(a.id))
      )
        continue;
      if (compiled && isDeclaredGlueStack(a, b, parts, compiled)) continue;
      // Two declared glue tabs bonded onto the same recipient are intentional stacking.
      if (
        a.role === 'glue-tab' &&
        b.role === 'glue-tab' &&
        a.parentIds[1] &&
        a.parentIds[1] === b.parentIds[1]
      )
        continue;
      if (partsIntersect(a, b))
        out.push(
          diagnostic(
            'intersection',
            `${a.name} crosses ${b.name} at ${pose.angle}°.`,
            [a.id, b.id],
            pose.angle,
            'warning',
          ),
        );
    }
  return out;
}
export function sliderSamples(compiled: CompiledSpread): Record<string, number>[] {
  const zero = Object.fromEntries(
    compiled.order.filter((m) => m.kind === 'slider').map((m) => [m.id, 0]),
  );
  return [
    zero,
    ...Object.keys(zero).flatMap((id) => [0.5, 1].map((value) => ({ ...zero, [id]: value }))),
  ];
}
export async function validateSpread(
  compiled: CompiledSpread,
  onProgress?: (angle: number) => void,
): Promise<Diagnostic[]> {
  const out = validateStatic(compiled),
    seen = new Set(out.map((d) => `${d.code}:${d.partIds.join()}`));
  for (let angle = 0; angle <= 180; angle++) {
    for (const drivers of sliderSamples(compiled)) {
      const pose = evaluateSpread(compiled, angle, drivers);
      for (const d of [...pose.diagnostics, ...collisionsAt(pose, compiled)]) {
        const key = `${d.code}:${d.partIds.join()}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push({
            ...d,
            drivers,
            message: `${d.message}${
              Object.values(drivers).some(Boolean)
                ? ` Pull tabs: ${Object.entries(drivers)
                    .filter(([, value]) => value)
                    .map(
                      ([id, value]) =>
                        `${compiled.order.find((m) => m.id === id)?.name} ${value * 100}%`,
                    )
                    .join(', ')}.`
                : ''
            }`,
          });
        }
      }
    }
    if (angle % 10 === 0) {
      onProgress?.(angle);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  return out;
}
export { compileProject };
