import { beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import {
  AnimationMixer,
  DoubleSide,
  FrontSide,
  Matrix4,
  MeshStandardMaterial,
  Texture,
  Vector3,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { PaperDecoration, Vec2 } from '../model';
import { blankSpread, exampleProject, mechanism } from '../presets';
import { createIllustratedSpread, createSceneryAssembly } from '../scenery';
import { compileProject, evaluateSpread, type PaperPart } from '../engine/geometry';
import { cutoutToParent } from '../engine/cutouts';
import { assemblyTabParts, templateParts } from '../engine/fabrication';
import { createArtworkMesh } from '../engine/media';
import { area } from '../engine/polygon';
import {
  collisionsAt,
  isCoplanarAttachment,
  isDeclaredGlueStack,
  partsIntersect,
  physicalPaperPose,
  validateStatic,
} from '../engine/validation';
import { dataFromBytes } from './projects';
import { exportGLB } from './glb';
import { exportPDF, exportSVG, MM } from './templates';

const rectangle = (x: number, y: number, w: number, h: number): Vec2[] => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
];

function fixture() {
  const project = exampleProject(),
    spread = blankSpread(),
    host = mechanism('tent');
  project.spreads = [spread];
  spread.mechanisms = [host];
  const cutout: PaperDecoration = {
    id: 'castle-cutout',
    name: 'Illustrated castle',
    parent: `${host.id}:left`,
    outline: [
      [0, 0],
      [5, 0],
      [5, 4],
      [15, 4],
      [15, 0],
      [20, 0],
      [20, 30],
      [0, 30],
    ],
    holes: [rectangle(7, 10, 6, 7)],
    position: [12, -10],
    rotation: 15,
    color: '#fffdf7',
    glueRegion: [{ outline: rectangle(2, 21, 16, 7), holes: [] }],
    cutout: {
      assetId: 'reveal-message',
      threshold: 0.5,
      tolerance: 0.25,
      imageWidth: 200,
      imageHeight: 300,
      width: 20,
      height: 30,
      imageX: 0,
      imageY: 0,
    },
  };
  spread.decorations = [cutout];
  spread.artwork = [
    {
      id: 'castle-ink',
      partId: cutout.id,
      assetId: 'reveal-message',
      x: 0,
      y: 0,
      width: 20,
      height: 30,
    },
  ];
  return { project, spread, cutout, compiled: compileProject(project, spread.id) };
}

class TestFileReader {
  result: string | ArrayBuffer | null = null;
  onloadend: (() => void) | null = null;
  async readAsArrayBuffer(blob: Blob) {
    this.result = await blob.arrayBuffer();
    this.onloadend?.();
  }
  async readAsDataURL(blob: Blob) {
    this.result = dataFromBytes(new Uint8Array(await blob.arrayBuffer()), blob.type);
    this.onloadend?.();
  }
}
beforeAll(() => {
  vi.stubGlobal('FileReader', TestFileReader);
  mkdirSync('test-results', { recursive: true });
});

describe('illustrated cut-out fabrication', () => {
  it('exports the bundled forest and castle with full-size artwork and separate reverse guides', async () => {
    const project = exampleProject(),
      { spread, assets } = createIllustratedSpread();
    project.spreads = [spread];
    Object.assign(project.assets, assets);
    const compiled = compileProject(project, spread.id),
      svg = exportSVG(compiled, []),
      bytes = await exportPDF(compiled, [], 'A4');
    expect(svg.match(/data-reverse-glue=/g)).toHaveLength(3);
    expect(svg.match(/<image /g)).toHaveLength(3);
    expect(
      spread.decorations.find((d) => d.cutout?.assetId.includes('castle'))?.holes.length,
    ).toBeGreaterThan(0);
    expect(validateStatic(compiled).filter((d) => d.severity === 'error')).toEqual([]);
    writeFileSync('test-results/illustrated-example.svg', svg);
    writeFileSync('test-results/illustrated-example.pdf', bytes);
  });

  it('places matching glue on the rotated support and only a reverse guide on the illustration', async () => {
    const { compiled, cutout } = fixture(),
      pose = evaluateSpread(compiled, 180),
      entries = templateParts(compiled, pose),
      child = entries.find((e) => e.part.id === cutout.id)!,
      host = entries.find((e) => e.part.id === cutout.parent)!,
      footprint = host.footprints.find((f) => f.match === cutout.id)!;
    expect(child.footprints).toEqual([]);
    expect(child.reverseGlue[0].points).toEqual(cutout.glueRegion![0].outline);
    expect(footprint.points).toEqual(
      cutout.glueRegion![0].outline.map((p) => cutoutToParent(cutout, p)),
    );
    expect(validateStatic(compiled).filter((d) => d.code === 'cutout-glue')).toEqual([]);
    const svg = exportSVG(compiled, []);
    expect(svg).toContain('data-reverse-glue="castle-cutout"');
    expect(svg).toContain('REVERSE GLUE GUIDE');
    expect(svg).toContain('Mirrored back');
    expect(svg).toContain('clip-rule="evenodd"');
    expect(svg).toContain('width="20" height="30" preserveAspectRatio="none"');
    const bytes = await exportPDF(compiled, [], 'A4'),
      pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(entries.length + 1);
    for (const page of pdf.getPages()) expect(page.getWidth()).toBeCloseTo(210 * MM, 8);
    writeFileSync('test-results/cutout-templates.svg', svg);
    writeFileSync('test-results/cutout-templates.pdf', bytes);
  });

  it('preserves glue holes and diagnoses damaged attachment material and closed-page overflow', () => {
    const { compiled, cutout } = fixture();
    cutout.glueRegion = [{ outline: rectangle(1, 7, 18, 22), holes: cutout.holes }];
    const entries = templateParts(compiled, evaluateSpread(compiled, 180)),
      footprint = entries
        .find((e) => e.part.id === cutout.parent)!
        .footprints.find((f) => f.match === cutout.id)!;
    expect(footprint.holes![0]).toEqual(cutout.holes[0].map((p) => cutoutToParent(cutout, p)));
    expect(validateStatic(compiled).filter((d) => d.code === 'cutout-glue')).toEqual([]);
    cutout.glueRegion[0].holes = [];
    expect(validateStatic(compiled).some((d) => d.code === 'cutout-glue')).toBe(true);
    cutout.glueRegion = [];
    expect(validateStatic(compiled).some((d) => d.code === 'cutout-glue')).toBe(true);
    cutout.position = [500, 0];
    expect(
      validateStatic(compiled).some(
        (d) => d.code === 'closed-bounds' && d.partIds.includes(cutout.id),
      ),
    ).toBe(true);
  });

  it('only exempts actual coplanar bonding, and checks unrelated overlapping paper', () => {
    const parent: PaperPart = {
      id: 'support',
      name: 'Support',
      role: 'left',
      polygon: rectangle(-10, -10, 20, 20),
      holes: [],
      matrix: new Matrix4(),
      color: '#fff',
      folds: [],
      parentIds: [],
    };
    const child: PaperPart = {
      ...parent,
      id: 'cutout',
      name: 'Cut-out',
      role: 'decoration',
      parentIds: [parent.id],
      matrix: new Matrix4().makeTranslation(0, 0, 0.05),
    };
    expect(isCoplanarAttachment(child, parent)).toBe(true);
    expect(
      collisionsAt({ parts: [parent, child], angle: 90, hinges: [], diagnostics: [] }),
    ).toEqual([]);
    child.matrix = new Matrix4()
      .makeTranslation(0, 0, 1)
      .multiply(new Matrix4().makeRotationX(0.5));
    expect(isCoplanarAttachment(child, parent)).toBe(false);
    expect(
      collisionsAt({ parts: [parent, child], angle: 90, hinges: [], diagnostics: [] }),
    ).toHaveLength(1);
    child.matrix = new Matrix4();
    child.parentIds = ['another-part'];
    expect(
      collisionsAt({ parts: [parent, child], angle: 90, hinges: [], diagnostics: [] }),
    ).toHaveLength(1);
  });
});

describe('declared cut-out glue contact', () => {
  it('checks real paper planes and allows only validated coplanar tab contact on the same recipient', () => {
    const { project, spread } = fixture(),
      assembly = createSceneryAssembly('pine');
    spread.mechanisms = assembly.mechanisms;
    spread.decorations = assembly.decorations;
    spread.artwork = assembly.artwork;
    Object.assign(project.assets, assembly.assets);
    const compiled = compileProject(project, spread.id),
      display = evaluateSpread(compiled, 1),
      physical = physicalPaperPose(display, compiled),
      parts = [...physical.parts, ...assemblyTabParts(compiled, physical)],
      cutout = parts.find((p) => p.role === 'decoration')!,
      tab = parts.find((p) => p.role === 'glue-tab' && p.parentIds[1] === cutout.parentIds[0])!,
      parent = parts.find((p) => p.id === cutout.parentIds[0])!,
      relative = parent.matrix.clone().invert().multiply(cutout.matrix);
    expect(Math.abs(relative.elements[14])).toBeLessThan(1e-8);
    expect(partsIntersect(cutout, tab)).toBe(true);
    expect(isDeclaredGlueStack(cutout, tab, parts, compiled)).toBe(true);
    expect(collisionsAt(display, compiled)).toEqual([]);
    expect(
      isDeclaredGlueStack(cutout, { ...tab, parentIds: ['a', 'unrelated'] }, parts, compiled),
    ).toBe(false);
    expect(
      isDeclaredGlueStack(
        cutout,
        { ...tab, matrix: tab.matrix.clone().multiply(new Matrix4().makeRotationX(0.2)) },
        parts,
        compiled,
      ),
    ).toBe(false);
    spread.decorations[0].glueRegion = [];
    expect(isDeclaredGlueStack(cutout, tab, parts, compiled)).toBe(false);
    expect(
      collisionsAt(display, compiled).some(
        (d) => d.partIds.includes(cutout.id) && d.partIds.includes(tab.id),
      ),
    ).toBe(true);
  });

  it('reports tiny glue geometry without claiming to measure paper or adhesive strength', () => {
    const { compiled, cutout } = fixture();
    cutout.glueRegion = [{ outline: rectangle(3, 22, 0.2, 4), holes: [] }];
    const diagnostics = validateStatic(compiled);
    expect(diagnostics.some((d) => d.code === 'cutout-glue')).toBe(false);
    expect(diagnostics.find((d) => d.code === 'cutout-glue-small')?.message).toContain('0.80 mm²');
    expect(diagnostics.find((d) => d.code === 'cutout-glue-small')?.message).toContain(
      'do not assess bond strength',
    );
  });
});

describe('illustrated cut-out rendering and GLB', () => {
  it('keeps image UV registration, real holes and front-only triangle orientation on either paper face', () => {
    const { compiled, cutout } = fixture(),
      part = evaluateSpread(compiled, 180).parts.find((p) => p.id === cutout.id)!;
    for (const front of [1, -1] as const) {
      const mesh = createArtworkMesh({ ...part, front }, new Texture(), true),
        geometry = mesh.geometry,
        position = geometry.getAttribute('position'),
        indices = geometry.index!,
        uv = geometry.getAttribute('uv');
      expect((mesh.material as MeshStandardMaterial).side).toBe(FrontSide);
      let surfaceArea = 0;
      for (let i = 0; i < indices.count; i += 3) {
        const a = new Vector3().fromBufferAttribute(position, indices.getX(i)),
          b = new Vector3().fromBufferAttribute(position, indices.getX(i + 1)),
          c = new Vector3().fromBufferAttribute(position, indices.getX(i + 2)),
          cross = b.sub(a).cross(c.sub(a));
        expect(Math.sign(cross.z)).toBe(front);
        surfaceArea += cross.length() / 2;
      }
      expect(surfaceArea).toBeCloseTo(
        Math.abs(area(cutout.outline)) - Math.abs(area(cutout.holes[0])),
        6,
      );
      for (let i = 0; i < position.count; i++) {
        expect(uv.getX(i)).toBeCloseTo(position.getX(i) / 20, 6);
        expect(uv.getY(i)).toBeCloseTo(1 - position.getY(i) / 30, 6);
      }
    }
    expect(
      (createArtworkMesh(part, new Texture(), false).material as MeshStandardMaterial).side,
    ).toBe(DoubleSide);
  });

  it('reimports a shaped cut-out and baked opening with its parent motion and millimetre scale intact', async () => {
    const { compiled, spread, cutout } = fixture();
    spread.artwork = []; // Canvas image decoding is exercised in browser QA; geometry runs in Node.
    const bytes = await exportGLB(compiled, 180, true, {}),
      gltf = await new GLTFLoader().parseAsync(bytes, ''),
      mixer = new AnimationMixer(gltf.scene);
    mixer.clipAction(gltf.animations[0]).play();
    const conversion = new Matrix4()
      .makeRotationX(-Math.PI / 2)
      .scale(new Vector3(0.001, 0.001, 0.001));
    for (const angle of [0, 45, 90, 135]) {
      mixer.setTime(angle / 30);
      gltf.scene.updateMatrixWorld(true);
      const part = evaluateSpread(compiled, angle).parts.find((p) => p.id === cutout.id)!,
        object = gltf.scene.getObjectByName('part_castle_cutout')!,
        expected = conversion.clone().multiply(part.matrix);
      for (let i = 0; i < 16; i++)
        expect(object.matrixWorld.elements[i]).toBeCloseTo(expected.elements[i], 6);
    }
    writeFileSync('test-results/cutout-opening.glb', new Uint8Array(bytes));
  });
});
