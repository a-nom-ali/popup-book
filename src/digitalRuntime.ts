import { create } from 'zustand';
import type { Asset, DigitalObject, Spread, Vec3 } from './model';
import type { DigitalRuntimeInputs } from './engine/digital';
import { dispatchDigitalEvent } from './engine/digital';

export interface ModelMeasurements {
  min: Vec3;
  max: Vec3;
  clips: { name: string; duration: number }[];
}
interface DigitalRuntimeState {
  time: number;
  paused: boolean;
  events: DigitalRuntimeInputs['events'];
  startedAt: Record<string, number>;
  signatures: Record<string, string>;
  sourceKeys: Record<string, { descriptor: string; data?: string }>;
  spreadId: string;
  measurements: Record<string, ModelMeasurements>;
  tick: (delta: number) => void;
  reset: () => void;
  sync: (spread: Spread, assets?: Record<string, Asset>) => void;
  trigger: (spread: Spread, target: string) => void;
  preview: (id: string, action: 'entrance' | 'clip' | 'toggle') => void;
  getInputs: (drivers: Record<string, number>) => DigitalRuntimeInputs;
}

/** Session-only clock and clicks. These never enter autosave, history, or portable projects. */
export const useDigitalRuntime = create<DigitalRuntimeState>((set, get) => ({
  time: 0,
  paused: false,
  events: {},
  startedAt: {},
  signatures: {},
  sourceKeys: {},
  spreadId: '',
  measurements: {},
  tick: (delta) => {
    if (!get().paused && Number.isFinite(delta)) set({ time: get().time + Math.max(0, delta) });
  },
  reset: () => set({ time: 0, events: {}, startedAt: {} }),
  sync: (spread, assets) => {
    const s = get();
    if (s.spreadId !== spread.id)
      set({
        spreadId: spread.id,
        time: 0,
        events: {},
        startedAt: {},
        signatures: {},
        sourceKeys: {},
        measurements: {},
      });
    const current = get(),
      events = { ...current.events },
      startedAt = { ...current.startedAt },
      measurements = { ...current.measurements };
    const signatures: Record<string, string> = {};
    const sourceKeys: DigitalRuntimeState['sourceKeys'] = {};
    for (const object of spread.digital) {
      const signature = JSON.stringify([object.source ?? object.assetId, object.clip]);
      const assetId =
        object.source?.kind === 'glb'
          ? object.source.assetId
          : object.source?.kind === 'builtin'
            ? undefined
            : object.assetId;
      // Keep references to immutable asset strings; avoid hashing or serializing
      // potentially large GLBs on every harmless property edit.
      const source = {
        descriptor: JSON.stringify(object.source ?? object.assetId),
        data: assetId ? assets?.[assetId]?.data : undefined,
      };
      const previousSource = current.sourceKeys[object.id];
      const sourceChanged =
        previousSource?.descriptor !== source.descriptor || previousSource?.data !== source.data;
      sourceKeys[object.id] = source;
      signatures[object.id] = signature;
      if (sourceChanged || current.signatures[object.id] !== signature) {
        delete events[object.id];
        startedAt[object.id] = current.time;
      }
      if (sourceChanged) delete measurements[object.id];
    }
    for (const id of Object.keys(events)) if (!signatures[id]) delete events[id];
    for (const id of Object.keys(startedAt)) if (!signatures[id]) delete startedAt[id];
    for (const id of Object.keys(measurements)) if (!signatures[id]) delete measurements[id];
    set({ signatures, sourceKeys, events, startedAt, measurements });
  },
  preview: (id, action) => {
    const s = get(),
      event = { ...s.events[id] };
    if (action === 'entrance') event.entranceAt = s.time;
    if (action === 'clip') event.clipAt = s.time;
    if (action === 'toggle') event.toggled = !(event.toggled ?? false);
    set({ events: { ...s.events, [id]: event } });
  },
  trigger: (spread, target) => {
    set({ events: dispatchDigitalEvent(spread, get().getInputs({}), target).events });
  },
  getInputs: (drivers) => ({
    time: get().time,
    drivers,
    events: get().events,
    startedAt: get().startedAt,
  }),
}));

export function modelDimensions(
  object: DigitalObject,
  measurements?: ModelMeasurements,
): Vec3 | undefined {
  return measurements?.max.map((n, i) => (n - measurements.min[i]) * object.scale * 1000) as
    Vec3 | undefined;
}
