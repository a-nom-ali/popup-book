import { describe, expect, it } from 'vitest';
import { unzlibSync } from 'fflate';
import type { Project, Spread, Vec2 } from './model';
import { parseProject } from './model';
import { blankSpread } from './presets';
import { SCENERY, createIllustratedSpread, createSceneryAssembly } from './scenery';
import { compileProject, evaluateSpread, worldPoint } from './engine/geometry';
import { validateSpread } from './engine/validation';
import { glueRegionValid, regionContained } from './engine/cutouts';

function projectFor(spread: Spread, assets: Project['assets'], pageHeight = 210): Project {
  return {
    version: 3,
    id: 'scenery-fixture',
    name: 'Scenery fixture',
    pageWidth: 148,
    pageHeight,
    spreads: [spread],
    assets,
    updatedAt: '2026-09-12T00:00:00.000Z',
  };
}

// Small PNG reader verifies actual bundled alpha, without a native image dependency.
function pngPixels(data: string) {
  const bytes = Uint8Array.from(atob(data.split(',')[1]), (c) => c.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  const width = view.getUint32(16),
    height = view.getUint32(20);
  expect(bytes[24]).toBe(8); // 8-bit RGBA, as emitted by the original SVG rasterizer.
  expect(bytes[25]).toBe(6);
  const compressed: number[] = [];
  for (let cursor = 8; cursor < bytes.length;) {
    const length = view.getUint32(cursor);
    const type = String.fromCharCode(...bytes.slice(cursor + 4, cursor + 8));
    if (type === 'IDAT')
      for (const value of bytes.subarray(cursor + 8, cursor + 8 + length)) compressed.push(value);
    cursor += length + 12;
  }
  const filtered = unzlibSync(Uint8Array.from(compressed));
  const pixels = new Uint8Array(width * height * 4),
    stride = width * 4;
  const paeth = (a: number, b: number, c: number) => {
    const p = a + b - c,
      x = Math.abs(p - a),
      y = Math.abs(p - b),
      z = Math.abs(p - c);
    return x <= y && x <= z ? a : y <= z ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const filter = filtered[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const at = y * stride + x;
      const left = x >= 4 ? pixels[at - 4] : 0,
        above = y ? pixels[at - stride] : 0;
      const corner = y && x >= 4 ? pixels[at - stride - 4] : 0;
      const predicted =
        filter === 0
          ? 0
          : filter === 1
            ? left
            : filter === 2
              ? above
              : filter === 3
                ? Math.floor((left + above) / 2)
                : paeth(left, above, corner);
      pixels[at] = filtered[y * (stride + 1) + x + 1] + predicted;
    }
  }
  return {
    width,
    height,
    alpha: (x: number, y: number) => pixels[(Math.floor(y) * width + Math.floor(x)) * 4 + 3],
  };
}
const center = (points: Vec2[]): Vec2 => [
  points.reduce((sum, p) => sum + p[0], 0) / points.length,
  points.reduce((sum, p) => sum + p[1], 0) / points.length,
];

describe('original printable scenery', () => {
  it('provides four original transparent PNGs with registered real window holes', () => {
    expect(SCENERY.map((item) => item.id)).toEqual(['oak', 'pine', 'castle', 'tower']);
    for (const item of SCENERY) {
      const png = pngPixels(item.asset.data);
      expect([png.width, png.height]).toEqual([item.trace.imageWidth, item.trace.imageHeight]);
      expect(png.alpha(0, 0)).toBe(0);
      expect(item.physicallyTested).toBe(false);
      expect(regionContained(item.glueRegion, item.trace.pieces[0])).toBe(true);
      for (const hole of item.trace.pieces[0].holes) {
        const [x, y] = center(hole);
        expect(
          png.alpha((x / item.trace.width) * png.width, (y / item.trace.height) * png.height),
        ).toBe(0);
      }
      const [x, y] = center(item.glueRegion[0].outline);
      expect(
        png.alpha((x / item.trace.width) * png.width, (y / item.trace.height) * png.height),
      ).toBe(255);
    }
    expect(SCENERY.find((item) => item.id === 'castle')!.trace.pieces[0].holes).toHaveLength(3);
  });

  for (const item of SCENERY) {
    it(`${item.id} remains attached and clears the complete 0–180° opening sweep`, async () => {
      const additions = createSceneryAssembly(item.id),
        spread = blankSpread(item.name);
      Object.assign(spread, {
        mechanisms: additions.mechanisms,
        decorations: additions.decorations,
        artwork: additions.artwork,
      });
      const project = projectFor(spread, additions.assets),
        compiled = compileProject(project, spread.id);
      expect(parseProject(project)).toEqual(project);
      const diagnostics = await validateSpread(compiled);
      expect(diagnostics).toEqual([]);
      for (const angle of [0, 30, 90, 180]) {
        const pose = evaluateSpread(compiled, angle),
          decoration = spread.decorations[0];
        const cutout = pose.parts.find((part) => part.id === decoration.id)!;
        const parent = pose.parts.find((part) => part.id === decoration.parent)!;
        expect(glueRegionValid(decoration, parent)).toBe(true);
        const local = cutout.matrix.clone().premultiply(parent.matrix.clone().invert()).elements;
        expect(local[0]).toBeCloseTo(0, 8);
        expect(local[1]).toBeCloseTo(1, 8);
        expect(local[12]).toBeCloseTo(decoration.position[0], 8);
        expect(local[13]).toBeCloseTo(decoration.position[1], 8);
        expect(cutout.matrix.elements.every(Number.isFinite)).toBe(true);
        if (angle === 180) {
          const ridge = pose.hinges.find(
            (hinge) => hinge.id === `${additions.mechanisms[0].id}:ridge`,
          )!;
          expect(Math.max(...cutout.polygon.map((p) => worldPoint(cutout, p).z))).toBeGreaterThan(
            ridge.origin.z + 20,
          );
        }
      }
    }, 60000);
  }

  it('creates a new illustrated spread with three independent collision-free assemblies', async () => {
    const { spread, assets } = createIllustratedSpread();
    expect(spread.mechanisms).toHaveLength(3);
    expect(spread.decorations).toHaveLength(3);
    expect(spread.subtitle).toContain('Physical prototype required');
    expect(await validateSpread(compileProject(projectFor(spread, assets), spread.id))).toEqual([]);
  }, 60000);

  it('scales geometry, artwork and glue together for shorter pages without changing library data', async () => {
    const before = JSON.stringify(SCENERY);
    const { spread, assets } = createIllustratedSpread(148);
    expect(
      await validateSpread(compileProject(projectFor(spread, assets, 148), spread.id)),
    ).toEqual([]);
    const first = createSceneryAssembly('castle'),
      second = createSceneryAssembly('castle');
    expect(first.mechanisms[0].id).not.toBe(second.mechanisms[0].id);
    expect(first.decorations[0].id).not.toBe(second.decorations[0].id);
    first.decorations[0].outline[0][0] = -999;
    first.decorations[0].glueRegion![0].outline[0][0] = -999;
    expect(JSON.stringify(SCENERY)).toBe(before);
    expect(second.decorations[0].outline[0][0]).toBeGreaterThan(0);
  }, 60000);
});
