import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Asset } from './model';
import { blankSpread, exampleProject } from './presets';
import { createDigitalObject, updateDigital } from './digitalCommands';
import { useDigitalRuntime } from './digitalRuntime';
import { useStudio } from './store';
import { createDigitalRuntime, evaluateDigitalPresentation } from './engine/digital';
import { compileProject, evaluateSpread } from './engine/geometry';
import { dataFromBytes, loadLocal, packProject, saveLocal, unpackProject } from './io/projects';
import { inspectGLB } from './io/assets';

const fixtures = () => {
  const spread = blankSpread('Runtime fixture');
  spread.digital.push(
    createDigitalObject({ kind: 'builtin', id: 'dragon' }, 'page-right', {
      id: 'dragon',
      behavior: 'loop',
    }),
    createDigitalObject({ kind: 'builtin', id: 'fireflies', seed: 17 }, 'page-left', {
      id: 'lights',
      behavior: 'click',
      triggers: [{ id: 'toggle', target: 'page-left', action: 'toggle' }],
    }),
  );
  return spread;
};
const measurement = {
  min: [0, 0, 0] as [number, number, number],
  max: [0.05, 0.06, 0.02] as [number, number, number],
  clips: [{ name: 'Fly', duration: 2 }],
};

beforeEach(() => {
  useDigitalRuntime.setState({
    time: 0,
    paused: false,
    events: {},
    startedAt: {},
    signatures: {},
    sourceKeys: {},
    spreadId: '',
    measurements: {},
  });
});

describe('experience runtime across document edits', () => {
  it('preserves clocks, click progress and measurements through transform, behavior and property edits', () => {
    const spread = fixtures(),
      runtime = useDigitalRuntime.getState();
    runtime.sync(spread);
    runtime.tick(2.4);
    runtime.preview('dragon', 'clip');
    runtime.trigger(spread, 'page-left');
    runtime.tick(0.6);
    useDigitalRuntime.setState({ measurements: { dragon: measurement } });
    const before = useDigitalRuntime.getState(),
      edit = structuredClone(spread);
    Object.assign(edit.digital[0], {
      position: [20, 30, 4],
      rotation: [10, 20, 30],
      scale: 0.7,
      name: 'Edited dragon',
      behavior: 'angle',
    });
    edit.digital[0].entrance!.end = 130;
    edit.digital[1].motion = { hover: 3, spin: 12 };
    runtime.sync(edit);
    const after = useDigitalRuntime.getState();
    expect(after.time).toBe(3);
    expect(after.events).toEqual(before.events);
    expect(after.startedAt).toEqual(before.startedAt);
    expect(after.measurements).toEqual(before.measurements);
  });

  it('restarts only a changed source or clip while unrelated objects keep their click state and clock', () => {
    const spread = fixtures(),
      runtime = useDigitalRuntime.getState();
    runtime.sync(spread);
    runtime.tick(4);
    runtime.preview('dragon', 'clip');
    runtime.trigger(spread, 'page-left');
    useDigitalRuntime.setState({ measurements: { dragon: measurement, lights: measurement } });
    const sourceEdit = structuredClone(spread);
    sourceEdit.digital[0].source = { kind: 'builtin', id: 'butterfly' };
    runtime.sync(sourceEdit);
    let state = useDigitalRuntime.getState();
    expect(state.time).toBe(4);
    expect(state.startedAt.dragon).toBe(4);
    expect(state.startedAt.lights).toBe(0);
    expect(state.events.dragon).toBeUndefined();
    expect(state.events.lights.toggled).toBe(true);
    expect(state.measurements.dragon).toBeUndefined();
    expect(state.measurements.lights).toEqual(measurement);
    useDigitalRuntime.setState({ measurements: { ...state.measurements, dragon: measurement } });
    runtime.tick(1);
    runtime.preview('dragon', 'clip');
    const clipEdit = structuredClone(sourceEdit);
    clipEdit.digital[0].clip = 1;
    runtime.sync(clipEdit);
    state = useDigitalRuntime.getState();
    expect(state.startedAt.dragon).toBe(5);
    expect(state.startedAt.lights).toBe(0);
    expect(state.events.dragon).toBeUndefined();
    expect(state.events.lights.toggled).toBe(true);
    expect(state.measurements.dragon).toEqual(measurement);
  });

  it('detects replaced bytes under the same GLB asset ID without resetting on an asset rename', () => {
    const spread = fixtures(),
      runtime = useDigitalRuntime.getState();
    spread.digital[0].source = { kind: 'glb', assetId: 'model' };
    spread.digital[0].assetId = 'model';
    const assets: Record<string, Asset> = {
      model: {
        id: 'model',
        name: 'First.glb',
        mime: 'model/gltf-binary',
        data: 'data:model/gltf-binary;base64,AQID',
      },
    };
    runtime.sync(spread, assets);
    runtime.tick(6);
    runtime.preview('dragon', 'clip');
    runtime.trigger(spread, 'page-left');
    runtime.sync(spread, { model: { ...assets.model, name: 'Renamed.glb' } });
    expect(useDigitalRuntime.getState().startedAt.dragon).toBe(0);
    expect(useDigitalRuntime.getState().events.dragon.clipAt).toBe(6);
    runtime.sync(spread, {
      model: { ...assets.model, data: 'data:model/gltf-binary;base64,AQIE' },
    });
    expect(useDigitalRuntime.getState().startedAt.dragon).toBe(6);
    expect(useDigitalRuntime.getState().events.dragon).toBeUndefined();
    expect(useDigitalRuntime.getState().events.lights.toggled).toBe(true);
  });

  it('cleans removed objects and starts a newly selected spread with fresh events', () => {
    const spread = fixtures(),
      runtime = useDigitalRuntime.getState();
    runtime.sync(spread);
    runtime.tick(3);
    runtime.preview('dragon', 'clip');
    useDigitalRuntime.setState({ measurements: { dragon: measurement } });
    const removed = structuredClone(spread);
    removed.digital.shift();
    runtime.sync(removed);
    const state = useDigitalRuntime.getState();
    expect(state.events.dragon).toBeUndefined();
    expect(state.startedAt.dragon).toBeUndefined();
    expect(state.measurements.dragon).toBeUndefined();
    expect(state.sourceKeys.dragon).toBeUndefined();
    const other = fixtures();
    runtime.sync(other);
    expect(useDigitalRuntime.getState().time).toBe(0);
    expect(useDigitalRuntime.getState().events).toEqual({});
    expect(useDigitalRuntime.getState().measurements).toEqual({});
  });

  it('pauses, rewinds while paused, resumes, and ignores invalid or backward time deltas', () => {
    const runtime = useDigitalRuntime.getState(),
      spread = fixtures();
    runtime.sync(spread);
    runtime.tick(2);
    useDigitalRuntime.setState({ paused: true });
    runtime.tick(8);
    runtime.preview('dragon', 'clip');
    expect(useDigitalRuntime.getState().time).toBe(2);
    runtime.reset();
    expect(useDigitalRuntime.getState().paused).toBe(true);
    expect(useDigitalRuntime.getState().time).toBe(0);
    expect(useDigitalRuntime.getState().events).toEqual({});
    runtime.tick(1);
    expect(useDigitalRuntime.getState().time).toBe(0);
    useDigitalRuntime.setState({ paused: false });
    runtime.tick(0.5);
    runtime.tick(-2);
    runtime.tick(NaN);
    runtime.tick(Infinity);
    expect(useDigitalRuntime.getState().time).toBe(0.5);
  });

  it('keeps clicks out of document history and preserves unrelated playback across undo', () => {
    const p = exampleProject();
    p.spreads = [fixtures()];
    useStudio.getState().replaceProject(p);
    const runtime = useDigitalRuntime.getState();
    runtime.sync(p.spreads[0], p.assets);
    runtime.tick(1.5);
    const before = useStudio.getState().project;
    runtime.trigger(p.spreads[0], 'page-left');
    expect(useStudio.getState().project).toBe(before);
    expect(useStudio.getState().past).toEqual([]);
    updateDigital('dragon', { position: [12, 15, 3] });
    runtime.sync(useStudio.getState().project.spreads[0]);
    useStudio.getState().undo();
    runtime.sync(useStudio.getState().project.spreads[0]);
    expect(useDigitalRuntime.getState().time).toBe(1.5);
    expect(useDigitalRuntime.getState().events.lights.toggled).toBe(true);
  });
});

function animatedGLB(): Uint8Array {
  // A self-contained animated node is sufficient to check portable binary
  // preservation; full mesh/skeleton playback is exercised by export tests.
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'Animated marker' }],
    buffers: [{ byteLength: 32 }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 8 },
      { buffer: 0, byteOffset: 8, byteLength: 24 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 2, type: 'SCALAR', min: [0], max: [1] },
      { bufferView: 1, componentType: 5126, count: 2, type: 'VEC3' },
    ],
    animations: [
      {
        name: 'Rise',
        samplers: [{ input: 0, output: 1 }],
        channels: [{ sampler: 0, target: { node: 0, path: 'translation' } }],
      },
    ],
  };
  const text = new TextEncoder().encode(JSON.stringify(json)),
    jsonLength = Math.ceil(text.length / 4) * 4,
    bytes = new Uint8Array(12 + 8 + jsonLength + 8 + 32),
    view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.length, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(32, 20, 20 + jsonLength);
  bytes.set(text, 20);
  view.setUint32(20 + jsonLength, 32, true);
  view.setUint32(24 + jsonLength, 0x004e4942, true);
  const values = [0, 1, 0, 0, 0, 0, 0.05, 0];
  values.forEach((n, i) => view.setFloat32(28 + jsonLength + i * 4, n, true));
  return bytes;
}

it('recovers v3 digital behavior and original PNG/animated GLB bytes while starting a clean runtime', async () => {
  const p = exampleProject(),
    spread = fixtures();
  p.spreads = [spread];
  const bytes = animatedGLB();
  expect(inspectGLB(bytes).clips).toEqual(['Rise']);
  p.assets.model = {
    id: 'model',
    name: 'Animated marker.glb',
    mime: 'model/gltf-binary',
    data: dataFromBytes(bytes, 'model/gltf-binary'),
  };
  spread.artwork.push({
    id: 'art',
    partId: 'page-right',
    assetId: 'reveal-message',
    x: 0,
    y: 0,
    width: 45,
    height: 22,
  });
  spread.digital.push(
    createDigitalObject({ kind: 'glb', assetId: 'model' }, 'page-right', {
      id: 'model-object',
      behavior: 'angle',
      angleStart: 35,
      angleEnd: 150,
      triggers: [{ id: 'replay', target: 'page-left', action: 'clip' }],
    }),
  );
  const roundtrip = unpackProject(packProject(p));
  expect(roundtrip).toEqual(p);
  await saveLocal(roundtrip);
  const recovered = (await loadLocal())!;
  expect(recovered).toEqual(p);
  expect(recovered.assets.model.data).toBe(p.assets.model.data);
  expect(recovered.assets['reveal-message'].data).toBe(p.assets['reveal-message'].data);
  const fresh = createDigitalRuntime(),
    compiled = compileProject(recovered, spread.id),
    pose = evaluateSpread(compiled, 92.5),
    d = recovered.spreads[0].digital.find((d) => d.id === 'model-object')!;
  expect(
    evaluateDigitalPresentation(d, pose, fresh, { clipDuration: 1, compiled }).animationTime,
  ).toBeCloseTo(0.5);
  expect(fresh.events).toEqual({});
  expect('runtime' in recovered).toBe(false);
});
