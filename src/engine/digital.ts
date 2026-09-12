import { Euler, Matrix4, Vector3 } from 'three';
import type { Diagnostic, DigitalObject, Spread } from '../model';
import type { CompiledSpread, PaperPart, Pose } from './geometry';
import { clamp, diagnostic, evaluateSpread, rad } from './geometry';

export interface DigitalEventState {
  entranceAt?: number;
  clipAt?: number;
  toggled?: boolean;
}
export interface DigitalRuntimeInputs {
  /** Monotonic experience clock, in seconds. Opening-angle seeking does not change it. */
  time: number;
  drivers: Record<string, number>;
  events: Record<string, DigitalEventState>;
  startedAt?: Record<string, number>;
}
export interface DigitalPresentation {
  attachmentMatrix: Matrix4;
  presentationMatrix: Matrix4;
  worldMatrix: Matrix4;
  visible: boolean;
  animationTime: number;
  progress: number;
}
export const createDigitalRuntime = (): DigitalRuntimeInputs => ({
  time: 0,
  drivers: {},
  events: {},
  startedAt: {},
});
export function resetDigitalRuntime(
  runtime: DigitalRuntimeInputs,
  objectIds?: string[],
): DigitalRuntimeInputs {
  if (!objectIds) return { ...createDigitalRuntime(), drivers: { ...runtime.drivers } };
  const events = { ...runtime.events },
    startedAt = { ...runtime.startedAt };
  for (const id of objectIds) {
    delete events[id];
    startedAt[id] = runtime.time;
  }
  return { ...runtime, events, startedAt };
}
export function dispatchDigitalEvent(
  spread: Spread,
  runtime: DigitalRuntimeInputs,
  clickedId: string,
): DigitalRuntimeInputs {
  const events = { ...runtime.events };
  for (const object of spread.digital) {
    const actions = new Set(
      (object.triggers ?? []).filter((t) => t.target === clickedId).map((t) => t.action),
    );
    if (object.id === clickedId) {
      if (object.behavior === 'click') actions.add('clip');
      if (object.entrance?.driver.kind === 'click') actions.add('entrance');
    }
    if (!actions.size) continue;
    const event = { ...events[object.id] };
    if (actions.has('entrance')) event.entranceAt = runtime.time;
    if (actions.has('clip')) event.clipAt = runtime.time;
    if (actions.has('toggle')) event.toggled = !(event.toggled ?? false);
    events[object.id] = event;
  }
  return { ...runtime, events };
}
/** Stable seeded generator for bounded effect instances; no Math.random during playback. */
export function seededRandom(seed = 1): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Canonical millimetre frame: decorations inherit physical, zero-offset parents. */
export function physicalPaperFrame(
  part: PaperPart,
  pose: Pose,
  compiled?: CompiledSpread,
): Matrix4 {
  if (!compiled) return part.matrix.clone();
  const seen = new Set<string>();
  const resolve = (current: PaperPart): Matrix4 => {
    if (seen.has(current.id)) throw new Error('A digital attachment belongs to a paper cycle.');
    seen.add(current.id);
    const decoration = compiled.spread.decorations.find((d) => d.id === current.id),
      parent = decoration && pose.parts.find((p) => p.id === decoration.parent);
    if (!decoration || !parent) return current.matrix.clone();
    return resolve(parent)
      .multiply(new Matrix4().makeTranslation(...decoration.position, 0))
      .multiply(new Matrix4().makeRotationZ(rad(decoration.rotation ?? 0)));
  };
  return resolve(part);
}
export function digitalAttachmentMatrix(
  object: DigitalObject,
  pose: Pose,
  compiled?: CompiledSpread,
): Matrix4 {
  const part = pose.parts.find((p) => p.id === object.parent);
  if (!part) throw new Error(`${object.name}: choose an existing paper parent.`);
  const front = part.front ?? 1;
  // Source-less records are legacy imports: retaining their display frame keeps
  // their exact prior appearance while authored v3 sources use physical frames.
  const frame = object.source ? physicalPaperFrame(part, pose, compiled) : part.matrix.clone();
  return frame
    .multiply(
      new Matrix4().makeTranslation(
        object.position[0],
        object.position[1],
        object.position[2] * front,
      ),
    )
    .multiply(new Matrix4().makeRotationX((front * Math.PI) / 2))
    .multiply(
      new Matrix4().makeRotationFromEuler(
        new Euler(...(object.rotation.map(rad) as [number, number, number])),
      ),
    );
}
export function digitalBaseMatrix(
  object: DigitalObject,
  pose: Pose,
  compiled?: CompiledSpread,
): Matrix4 {
  return digitalAttachmentMatrix(object, pose, compiled).multiply(
    new Matrix4().makeScale(object.scale * 1000, object.scale * 1000, object.scale * 1000),
  );
}
const interval = (value: number, start: number, end: number) =>
  clamp((value - start) / Math.max(1e-6, end - start), 0, 1);
const finiteTime = (value?: number) => (Number.isFinite(value) ? value! : 0);

/** Pure digital pose evaluation shared by authoring, reader, baking and future AR. */
export function evaluateDigitalPresentation(
  object: DigitalObject,
  pose: Pose,
  runtime: DigitalRuntimeInputs,
  options: { clipDuration?: number; compiled?: CompiledSpread } = {},
): DigitalPresentation {
  let attachmentMatrix: Matrix4;
  try {
    attachmentMatrix = digitalAttachmentMatrix(object, pose, options.compiled);
  } catch {
    return {
      attachmentMatrix: new Matrix4(),
      presentationMatrix: new Matrix4(),
      worldMatrix: new Matrix4(),
      visible: false,
      animationTime: 0,
      progress: 0,
    };
  }
  const time = Math.max(0, finiteTime(runtime.time)),
    event = runtime.events[object.id] ?? {},
    age = Math.max(0, time - finiteTime(runtime.startedAt?.[object.id]));
  const entrance = object.entrance;
  let progress = 1;
  if (entrance) {
    const driver = entrance.driver;
    if (driver.kind === 'opening') progress = interval(pose.angle, entrance.start, entrance.end);
    else if (driver.kind === 'hinge') {
      const hinge = pose.hinges.find((h) => h.id === driver.target);
      progress = hinge ? interval((hinge.angle * 180) / Math.PI, entrance.start, entrance.end) : 0;
    } else if (driver.kind === 'slider')
      progress =
        driver.target && Number.isFinite(runtime.drivers[driver.target])
          ? interval(runtime.drivers[driver.target], entrance.start, entrance.end)
          : 0;
    else
      progress =
        event.entranceAt === undefined
          ? 0
          : clamp((time - event.entranceAt) / entrance.duration, 0, 1);
    if (
      event.entranceAt !== undefined &&
      time >= event.entranceAt &&
      time - event.entranceAt <= entrance.duration
    )
      progress = clamp((time - event.entranceAt) / entrance.duration, 0, 1);
    if (entrance.easing === 'smooth') progress = progress * progress * (3 - 2 * progress);
  }
  if (event.toggled !== undefined || object.triggers?.some((t) => t.action === 'toggle'))
    progress = event.toggled ? 1 : 0;
  const hover = (object.motion?.hover ?? 0) * Math.sin(age * Math.PI),
    spin = rad((object.motion?.spin ?? 0) * age);
  const rise = entrance?.kind === 'rise' ? -entrance.distance * (1 - progress) : 0;
  const growth = entrance?.kind === 'grow' ? Math.max(progress, 1e-6) : 1;
  // Rise/hover follow the supporting paper front even when the model is tilted.
  // attachmentMatrix includes authored rotation, so express that normal in the
  // model frame before composing the presentation translation.
  const translation = new Vector3(0, rise + hover, 0).applyMatrix4(
    new Matrix4()
      .makeRotationFromEuler(new Euler(...(object.rotation.map(rad) as [number, number, number])))
      .invert(),
  );
  const presentationMatrix = new Matrix4()
    .makeTranslation(translation.x, translation.y, translation.z)
    .multiply(new Matrix4().makeRotationY(spin))
    .multiply(new Matrix4().makeScale(growth, growth, growth));
  const worldMatrix = attachmentMatrix
    .clone()
    .multiply(presentationMatrix)
    .multiply(
      new Matrix4().makeScale(object.scale * 1000, object.scale * 1000, object.scale * 1000),
    );
  const duration = Math.max(0, options.clipDuration ?? 0);
  let animationTime = 0;
  if (duration > 0) {
    if (object.behavior === 'angle')
      animationTime = interval(pose.angle, object.angleStart, object.angleEnd) * duration;
    else if (object.behavior === 'slider')
      animationTime =
        interval(runtime.drivers[object.sliderId ?? ''] ?? 0, object.angleStart, object.angleEnd) *
        duration;
    else if (object.behavior === 'loop') animationTime = age % duration;
    else if (event.clipAt !== undefined) animationTime = clamp(time - event.clipAt, 0, duration);
    // Explicit paper/model hotspots replay a clip regardless of its default mode.
    if (
      event.clipAt !== undefined &&
      object.behavior !== 'click' &&
      time >= event.clipAt &&
      time - event.clipAt <= duration
    )
      animationTime = clamp(time - event.clipAt, 0, duration);
  }
  return {
    attachmentMatrix,
    presentationMatrix,
    worldMatrix,
    visible: progress > 1e-6,
    animationTime,
    progress,
  };
}

export function validateDigitalObjects(
  compiled: CompiledSpread,
  pose = evaluateSpread(compiled, 180),
): Diagnostic[] {
  const issues: Diagnostic[] = [],
    spread = compiled.spread;
  const targets = new Set([...pose.parts.map((p) => p.id), ...spread.digital.map((d) => d.id)]);
  const sliders = new Set(spread.mechanisms.filter((m) => m.kind === 'slider').map((m) => m.id));
  for (const object of spread.digital) {
    const add = (code: string, message: string, severity: Diagnostic['severity'] = 'error') =>
      issues.push(diagnostic(code, `${object.name}: ${message}`, [object.id], undefined, severity));
    if (!pose.parts.some((p) => p.id === object.parent))
      add('digital-parent', 'choose an existing paper parent.');
    const assetId =
      object.source?.kind === 'glb'
        ? object.source.assetId
        : object.source?.kind === 'builtin'
          ? undefined
          : object.assetId;
    if (assetId !== undefined) {
      const asset = compiled.project.assets[assetId];
      if (!asset?.data || asset.mime !== 'model/gltf-binary')
        add(
          'digital-source',
          'the embedded GLB is missing or has the wrong type. Reimport or choose a source.',
        );
    }
    if (
      object.behavior === 'angle' &&
      (object.angleStart < 0 || object.angleEnd > 180 || object.angleEnd <= object.angleStart)
    )
      add('digital-clip-range', 'clip opening interval must increase within 0–180°.');
    if (object.behavior === 'slider' && !sliders.has(object.sliderId ?? ''))
      add('digital-slider', 'choose an existing slider for clip playback.');
    if (
      object.behavior === 'slider' &&
      (object.angleStart < 0 || object.angleEnd > 1 || object.angleEnd <= object.angleStart)
    )
      add('digital-clip-range', 'clip slider interval must increase within 0–1.');
    const entrance = object.entrance;
    if (entrance) {
      const driver = entrance.driver,
        max = driver.kind === 'slider' ? 1 : 180;
      if (
        driver.kind !== 'click' &&
        (entrance.start < 0 || entrance.end > max || entrance.end <= entrance.start)
      )
        add(
          'digital-entrance-range',
          `entrance interval must increase within 0–${max}${max === 180 ? '°' : ''}.`,
        );
      if (entrance.distance < 0 || entrance.duration <= 0)
        add(
          'digital-entrance-values',
          'rise distance must be nonnegative and playback duration positive.',
        );
      if (driver.kind === 'hinge' && !pose.hinges.some((h) => h.id === driver.target))
        add('digital-hinge', 'choose an existing moving hinge.');
      if (driver.kind === 'slider' && !sliders.has(driver.target ?? ''))
        add('digital-slider', 'choose an existing slider for the entrance.');
      if (driver.kind === 'click') {
        const accessibleTrigger = object.triggers?.some(
          (t) =>
            t.target !== object.id &&
            (t.action === 'entrance' || t.action === 'toggle') &&
            (pose.parts.some((p) => p.id === t.target) ||
              spread.digital.some(
                (d) =>
                  d.id === t.target &&
                  d.entrance?.driver.kind !== 'click' &&
                  !d.triggers?.some((trigger) => trigger.action === 'toggle'),
              )),
        );
        if (!accessibleTrigger)
          add(
            'digital-hidden-trigger',
            'this click entrance starts hidden. Add an entrance or toggle trigger on a visible paper part or another visible digital object.',
            'warning',
          );
      }
    }
    for (const trigger of object.triggers ?? [])
      if (!targets.has(trigger.target))
        add(
          'digital-trigger',
          'a click trigger points to a missing paper part or digital object. Choose another target.',
        );
  }
  return issues;
}
export const validateDigitalReferences = validateDigitalObjects;

/** Lowest point after authored rotation/scale, measured along the paper front. */
export function digitalBaseOffset(
  object: DigitalObject,
  bounds: { min: [number, number, number]; max: [number, number, number] },
): number {
  const rotation = new Matrix4().makeRotationFromEuler(
    new Euler(...(object.rotation.map(rad) as [number, number, number])),
  );
  let minY = Infinity;
  for (const x of [bounds.min[0], bounds.max[0]])
    for (const y of [bounds.min[1], bounds.max[1]])
      for (const z of [bounds.min[2], bounds.max[2]])
        minY = Math.min(minY, new Vector3(x, y, z).applyMatrix4(rotation).y * object.scale * 1000);
  return -minY;
}
