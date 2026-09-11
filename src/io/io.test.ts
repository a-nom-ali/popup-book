import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import {
  AnimationClip,
  AnimationMixer,
  BoxGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Vector3,
  VectorKeyframeTrack,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { exampleProject } from '../presets';
import { compileProject, evaluateSpread } from '../engine/geometry';
import { partTabs, templateParts } from '../engine/fabrication';
import { exportPDF, exportSVG, MM, tileLayout, registrationPoints } from './templates';
import {
  assertArchiveCapacity,
  MAX_ARCHIVE_BYTES,
  MAX_EXPANDED_BYTES,
  dataFromBytes,
  loadLocal,
  packProject,
  saveLocal,
  unpackProject,
} from './projects';
import { exportGLB } from './glb';
import { inspectGLB } from './assets';
import { parseProject } from '../model';
import { useStudio } from '../store';
import { loadMedia, updateMedia } from '../engine/media';
import { validateStatic } from '../engine/validation';

// GLTFExporter uses FileReader even when all buffers stay in memory.
class TestFileReader {
  result: string | ArrayBuffer | null = null;
  onloadend: (() => void) | null = null;
  onload: (() => void) | null = null;
  async readAsArrayBuffer(blob: Blob) {
    this.result = await blob.arrayBuffer();
    this.onload?.();
    this.onloadend?.();
  }
  async readAsDataURL(blob: Blob) {
    this.result = dataFromBytes(new Uint8Array(await blob.arrayBuffer()), blob.type);
    this.onload?.();
    this.onloadend?.();
  }
}
beforeAll(() => {
  vi.stubGlobal('FileReader', TestFileReader);
  mkdirSync('test-results', { recursive: true });
});

describe('portable document and editor history', () => {
  it('round-trips embedded assets, custom contours and invalid but editable dimensions', async () => {
    const project = exampleProject(),
      m = project.spreads[0].mechanisms[0];
    m.width = -12;
    m.outlines.left = [
      [0, 0],
      [20, 0],
      [20, 30],
    ];
    project.assets.fixture = {
      id: 'fixture',
      name: 'test.png',
      mime: 'image/png',
      data: dataFromBytes(new Uint8Array([137, 80, 78, 71]), 'image/png'),
    };
    const bytes = packProject(project);
    expect(unpackProject(bytes)).toEqual(project);
    await saveLocal(project);
    expect(await loadLocal()).toEqual(project);
    writeFileSync('test-results/roundtrip.popupbook', bytes);
  });
  it('rejects corrupt, unsupported-version and duplicate-ID projects', () => {
    expect(() => unpackProject(new Uint8Array([1, 2, 3]))).toThrow();
    expect(() => parseProject({ ...exampleProject(), version: 3 })).toThrow();
    const p = exampleProject();
    p.spreads[1].id = p.spreads[0].id;
    expect(() => parseProject(p)).toThrow('duplicate');
  });
  it('reports missing embedded artwork rather than silently certifying its export', () => {
    const p = exampleProject(),
      s = p.spreads[2];
    p.assets['reveal-message'].data = '';
    expect(validateStatic(compileProject(p, s.id)).some((d) => d.code === 'missing-asset')).toBe(
      true,
    );
    writeFileSync('test-results/example.popupbook', packProject(exampleProject()));
  });
  it('uses a shared portable capacity policy and invalidates stale diagnostic results', () => {
    expect(() =>
      assertArchiveCapacity(
        [MAX_ARCHIVE_BYTES, MAX_ARCHIVE_BYTES, MAX_EXPANDED_BYTES - 2 * MAX_ARCHIVE_BYTES],
        MAX_ARCHIVE_BYTES,
      ),
    ).not.toThrow();
    expect(() => assertArchiveCapacity([MAX_ARCHIVE_BYTES + 1])).toThrow();
    expect(() => assertArchiveCapacity([], MAX_ARCHIVE_BYTES + 1)).toThrow();
    expect(() =>
      assertArchiveCapacity([MAX_ARCHIVE_BYTES, MAX_ARCHIVE_BYTES, MAX_ARCHIVE_BYTES]),
    ).toThrow();
    useStudio.getState().replaceProject(exampleProject());
    useStudio.getState().set({ checked: true });
    useStudio.getState().edit('rename', (p) => {
      p.name = 'Edited';
    });
    expect(useStudio.getState().checked).toBe(false);
    useStudio.getState().set({ checked: true });
    useStudio.getState().selectSpread(useStudio.getState().project.spreads[1].id);
    expect(useStudio.getState().checked).toBe(false);
  });
  it('restores dimensions and spread attachments with undo and redo', () => {
    const project = exampleProject();
    useStudio.getState().replaceProject(project);
    useStudio.getState().edit('width', (p) => {
      p.spreads[0].mechanisms[0].width = 80;
    });
    expect(useStudio.getState().project.spreads[0].mechanisms[0].width).toBe(80);
    useStudio.getState().undo();
    expect(useStudio.getState().project).toEqual(project);
    useStudio.getState().redo();
    expect(useStudio.getState().project.spreads[0].mechanisms[0].width).toBe(80);
    useStudio.getState().duplicateSpread();
    const copy = useStudio.getState().project.spreads[1];
    expect(copy.mechanisms[1].host).toBe(`${copy.mechanisms[0].id}:ridge`);
    expect(copy.mechanisms[0].id).not.toBe(project.spreads[0].mechanisms[0].id);
  });
});

describe('fabrication export', () => {
  it('uses matched tabs and the same outlines in SVG and PDF, with physical A4 dimensions', async () => {
    const p = exampleProject(),
      compiled = compileProject(p, p.spreads[0].id),
      pose = evaluateSpread(compiled, 180),
      entries = templateParts(compiled, pose);
    const tabs = partTabs(pose.parts[2], compiled);
    expect(tabs.length).toBe(2);
    expect(entries[0].footprints.length).toBeGreaterThan(0);
    p.spreads[0].digital.push({
      id: 'exclude-digital',
      name: 'DIGITAL_ONLY_FIXTURE',
      assetId: 'absent-digital',
      parent: 'page-left',
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: 1,
      behavior: 'loop',
      clip: 0,
      angleStart: 0,
      angleEnd: 180,
    });
    const svg = exportSVG(compiled, []);
    expect(svg).toContain('width="20" height="20"');
    expect(svg).toContain('GLUE P');
    expect(svg).toContain('clip-rule="evenodd"');
    expect(svg).not.toContain('DIGITAL_ONLY_FIXTURE');
    const bytes = await exportPDF(compiled, [], 'A4'),
      pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(entries.length + 1);
    for (const page of pdf.getPages()) {
      expect(page.getWidth()).toBeCloseTo(210 * MM, 8);
      expect(page.getHeight()).toBeCloseTo(297 * MM, 8);
    }
    const prefs = pdf.catalog.getOrCreateViewerPreferences();
    expect(prefs.getPrintScaling()).toBe('None');
    writeFileSync(
      'test-results/story-templates.pdf',
      await exportPDF(compileProject(p, p.spreads[2].id), [], 'Letter'),
    );
    writeFileSync('test-results/garden-templates.svg', svg);
    writeFileSync('test-results/garden-templates.pdf', bytes);
  });
  it('tiles oversize drawings with 5 mm overlap and does not fit them to the sheet', async () => {
    const layout = tileLayout(520, 340, 'Letter');
    expect(layout.cols).toBe(3);
    expect(layout.rows).toBe(2);
    expect(layout.tiles[1].x).toBeCloseTo(layout.cw - 5, 10);
    const first = registrationPoints(layout.cw, layout.ch, 0, 0),
      next = registrationPoints(layout.cw, layout.ch, layout.tiles[1].x, 0),
      below = registrationPoints(layout.cw, layout.ch, 0, layout.ch - 5);
    expect(first[2].sourceX).toBeCloseTo(next[0].sourceX, 10);
    expect(first[1].sourceY).toBeCloseTo(below[0].sourceY, 10);
    const p = exampleProject();
    p.pageWidth = 340;
    p.pageHeight = 420;
    p.spreads[0].mechanisms = [];
    const bytes = await exportPDF(compileProject(p, p.spreads[0].id), [], 'Letter');
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(9); // instructions + 2 pages * 2x2 tiles
    for (const page of pdf.getPages()) expect(page.getWidth()).toBeCloseTo(215.9 * MM, 8);
    writeFileSync('test-results/oversize-templates.pdf', bytes);
  });
});

describe('GLB geometry and animation', () => {
  it('round-trips a posed spread with all paper transforms and metre scale intact', async () => {
    const p = exampleProject(),
      compiled = compileProject(p, p.spreads[0].id);
    for (const angle of [0, 90, 180]) {
      const bytes = await exportGLB(compiled, angle, false, {}),
        gltf = await new GLTFLoader().parseAsync(bytes, ''),
        pose = evaluateSpread(compiled, angle);
      gltf.scene.updateMatrixWorld(true);
      const conversion = new Matrix4()
        .makeRotationX(-Math.PI / 2)
        .scale(new Vector3(0.001, 0.001, 0.001));
      for (const part of pose.parts) {
        const name = `part_${part.id.replaceAll(/[^a-zA-Z0-9_]/g, '_')}`,
          exported = gltf.scene.getObjectByName(name)!;
        expect(exported).toBeDefined();
        const expected = conversion.clone().multiply(part.matrix),
          actual = exported.matrixWorld;
        for (let i = 0; i < 16; i++)
          expect(actual.elements[i]).toBeCloseTo(expected.elements[i], 6);
      }
      if (angle === 180) writeFileSync('test-results/garden-open.glb', new Uint8Array(bytes));
    }
  });
  it('bakes a six-second opening whose midpoint matches the solver', async () => {
    const p = exampleProject(),
      compiled = compileProject(p, p.spreads[1].id),
      bytes = await exportGLB(compiled, 140, true, {}),
      gltf = await new GLTFLoader().parseAsync(bytes, '');
    expect(inspectGLB(new Uint8Array(bytes)).clips).toEqual(['Open book']);
    const mixer = new AnimationMixer(gltf.scene);
    mixer.clipAction(gltf.animations[0]).play();
    mixer.setTime(3);
    gltf.scene.updateMatrixWorld(true);
    const pose = evaluateSpread(compiled, 90),
      conversion = new Matrix4()
        .makeRotationX(-Math.PI / 2)
        .scale(new Vector3(0.001, 0.001, 0.001));
    for (const part of pose.parts) {
      const obj = gltf.scene.getObjectByName(`part_${part.id.replaceAll(/[^a-zA-Z0-9_]/g, '_')}`)!;
      const expected = conversion.clone().multiply(part.matrix);
      for (let i = 0; i < 16; i++)
        expect(obj.matrixWorld.elements[i]).toBeCloseTo(expected.elements[i], 5);
    }
    writeFileSync('test-results/pavilion-opening.glb', new Uint8Array(bytes));
  });
  it('loads animated digital models, holds their exact end pose, and scrubs backwards', async () => {
    const group = new Group(),
      cube = new Mesh(
        new BoxGeometry(0.04, 0.04, 0.04),
        new MeshStandardMaterial({ color: '#dba477' }),
      );
    cube.name = 'Cube';
    group.add(cube);
    const clip = new AnimationClip('Rise', 1, [
      new VectorKeyframeTrack('Cube.position', [0, 1], [0, 0.02, 0, 0, 0.06, 0]),
    ]);
    const bytes = (await new GLTFExporter().parseAsync(group, {
      binary: true,
      animations: [clip],
      trs: true,
    })) as ArrayBuffer;
    writeFileSync('test-results/animated-cube.glb', new Uint8Array(bytes));
    const p = exampleProject(),
      s = p.spreads[0];
    p.assets.cube = {
      id: 'cube',
      name: 'Cube.glb',
      mime: 'model/gltf-binary',
      data: dataFromBytes(new Uint8Array(bytes), 'model/gltf-binary'),
    };
    s.digital.push({
      id: 'test-digital',
      name: 'Cube',
      assetId: 'cube',
      parent: 'page-right',
      position: [50, 0, 0],
      rotation: [0, 0, 0],
      scale: 1,
      behavior: 'angle',
      clip: 0,
      angleStart: 30,
      angleEnd: 150,
    });
    expect(unpackProject(packProject(p))).toEqual(p);
    const compiled = compileProject(p, s.id),
      loaded = await loadMedia(compiled, evaluateSpread(compiled, 180));
    expect(loaded.errors).toEqual([]);
    const attachment = loaded.attachments[0],
      object = attachment.group.getObjectsByProperty('type', 'Mesh')[0];
    for (const [angle, expected] of [
      [30, 0.02],
      [90, 0.04],
      [150, 0.06],
      [180, 0.06],
      [90, 0.04],
      [30, 0.02],
    ]) {
      updateMedia(loaded.attachments, evaluateSpread(compiled, angle), 0);
      expect(object.position.y).toBeCloseTo(expected, 6);
    }
    s.digital[0].angleStart = 100;
    s.digital[0].angleEnd = 100.5;
    updateMedia(loaded.attachments, evaluateSpread(compiled, 100.25), 0);
    expect(object.position.y).toBeCloseTo(0.04, 6);
    updateMedia(loaded.attachments, evaluateSpread(compiled, 100.5), 0);
    expect(object.position.y).toBeCloseTo(0.06, 6);
    const exported = await exportGLB(compiled, 180, true, {});
    expect(inspectGLB(new Uint8Array(exported)).clips).toEqual(['Open book']);
  });
  it('keeps animation targets unique when imported names sanitize to the same string', async () => {
    const group = new Group();
    for (const name of ['left+wing', 'left_wing']) {
      const mesh = new Mesh(new BoxGeometry(0.01, 0.01, 0.01), new MeshStandardMaterial());
      mesh.name = name;
      group.add(mesh);
    }
    const clip = new AnimationClip('Two wings', 1, [
      new VectorKeyframeTrack('left+wing.position', [0, 1], [0, 0, 0, 1, 0, 0]),
      new VectorKeyframeTrack('left_wing.position', [0, 1], [0, 0, 0, 2, 0, 0]),
    ]);
    const bytes = (await new GLTFExporter().parseAsync(group, {
      binary: true,
      animations: [clip],
      trs: true,
    })) as ArrayBuffer;
    const p = exampleProject(),
      s = p.spreads[0];
    p.assets.wings = {
      id: 'wings',
      name: 'Wings.glb',
      mime: 'model/gltf-binary',
      data: dataFromBytes(new Uint8Array(bytes), 'model/gltf-binary'),
    };
    s.digital = [
      {
        id: 'wings-model',
        name: 'Wings',
        assetId: 'wings',
        parent: 'page-left',
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: 1,
        behavior: 'angle',
        clip: 0,
        angleStart: 0,
        angleEnd: 180,
      },
    ];
    const c = compileProject(p, s.id),
      pose = evaluateSpread(c, 90),
      loaded = await loadMedia(c, pose);
    expect(loaded.errors).toEqual([]);
    updateMedia(loaded.attachments, pose, 0);
    const meshes = loaded.attachments[0].group.getObjectsByProperty('type', 'Mesh');
    expect(meshes[0].position.x).toBeCloseTo(0.5, 6);
    expect(meshes[1].position.x).toBeCloseTo(1, 6);
  });
});
