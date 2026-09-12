import type { DigitalObject, DigitalSource, Project, Vec3 } from './model';
import { digitalObjectSchema, uid } from './model';
import { compileProject, evaluateSpread, polygonBounds } from './engine/geometry';
import { digitalBaseOffset } from './engine/digital';
import { useStudio } from './store';

export function createDigitalObject(
  source: DigitalSource,
  parentId: string,
  options: Partial<DigitalObject> = {},
): DigitalObject {
  const object: DigitalObject = {
    id: uid('digital'),
    name:
      source.kind === 'builtin' ? source.id[0].toUpperCase() + source.id.slice(1) : 'Digital model',
    assetId: source.kind === 'glb' ? source.assetId : '',
    parent: parentId,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: 1,
    behavior: 'loop',
    clip: 0,
    angleStart: 0,
    angleEnd: 180,
    entrance: {
      kind: 'rise',
      driver: { kind: 'opening' },
      start: 25,
      end: 100,
      distance: 20,
      easing: 'smooth',
      duration: 1.2,
    },
    motion: { hover: 0, spin: 0 },
    triggers: [],
    ...options,
    source: structuredClone(source),
  };
  // The compatibility field always points to the same GLB as the explicit source.
  object.assetId = source.kind === 'glb' ? source.assetId : '';
  if (object.behavior === 'slider' && options.angleEnd === undefined) object.angleEnd = 1;
  return digitalObjectSchema.parse(object);
}

function checkReferences(
  project: Project,
  spreadId: string,
  object: DigitalObject,
  fields?: Set<'parent' | 'source' | 'entrance' | 'clip' | 'triggers'>,
) {
  const checks = (field: 'parent' | 'source' | 'entrance' | 'clip' | 'triggers') =>
    !fields || fields.has(field);
  const spread = project.spreads.find((s) => s.id === spreadId);
  if (!spread) throw new Error('The destination spread no longer exists.');
  const pose = evaluateSpread(compileProject(project, spreadId), 180);
  if (checks('parent') && !pose.parts.some((p) => p.id === object.parent))
    throw new Error('Choose an existing paper panel or cut-out as the digital parent.');
  const source = object.source;
  if (checks('source') && (!source || source.kind === 'glb')) {
    const asset = project.assets[source?.assetId ?? object.assetId];
    if (!asset?.data || asset.mime !== 'model/gltf-binary')
      throw new Error('Choose an existing embedded GLB asset.');
  }
  const driver = object.entrance?.driver;
  if (
    checks('entrance') &&
    driver?.kind === 'hinge' &&
    !pose.hinges.some((h) => h.id === driver.target)
  )
    throw new Error('Choose an existing hinge for this entrance.');
  const sliders = new Set(spread.mechanisms.filter((m) => m.kind === 'slider').map((m) => m.id));
  if (checks('entrance') && driver?.kind === 'slider' && !sliders.has(driver.target ?? ''))
    throw new Error('Choose an existing slider for this entrance.');
  if (checks('clip') && object.behavior === 'slider' && !sliders.has(object.sliderId ?? ''))
    throw new Error('Choose an existing slider for clip playback.');
  const targets = new Set([
    ...pose.parts.map((p) => p.id),
    ...spread.digital.map((d) => d.id),
    object.id,
  ]);
  if (checks('triggers') && object.triggers?.some((t) => !targets.has(t.target)))
    throw new Error('A click trigger must target an existing paper part or digital object.');
  if (new Set(object.triggers?.map((t) => t.id)).size !== (object.triggers?.length ?? 0))
    throw new Error('Click triggers need distinct IDs.');
}
export function addDigitalToProject(
  project: Project,
  spreadId: string,
  source: DigitalSource,
  parentId: string,
  options: Partial<DigitalObject> = {},
): DigitalObject {
  const object = createDigitalObject(source, parentId, options);
  checkReferences(project, spreadId, object);
  const ids = new Set(
    project.spreads.flatMap((s) =>
      [...s.mechanisms, ...s.decorations, ...s.digital].map((o) => o.id),
    ),
  );
  if (ids.has(object.id)) throw new Error('This digital object ID is already in the book.');
  project.spreads.find((s) => s.id === spreadId)!.digital.push(object);
  return object;
}
export function updateDigitalInProject(
  project: Project,
  spreadId: string,
  id: string,
  patch: Partial<DigitalObject>,
): DigitalObject {
  const spread = project.spreads.find((s) => s.id === spreadId),
    index = spread?.digital.findIndex((d) => d.id === id) ?? -1;
  if (!spread || index < 0) throw new Error('This digital object no longer exists.');
  const object = digitalObjectSchema.parse({
    ...spread.digital[index],
    ...structuredClone(patch),
    id,
  });
  if (patch.source) object.assetId = patch.source.kind === 'glb' ? patch.source.assetId : '';
  // Imported damaged references must remain editable: only revalidate reference
  // fields when the user changes them. Geometry issues remain diagnostics.
  const fields = new Set<'parent' | 'source' | 'entrance' | 'clip' | 'triggers'>();
  if (patch.parent !== undefined) fields.add('parent');
  if (patch.source !== undefined || patch.assetId !== undefined) fields.add('source');
  if (patch.entrance !== undefined) fields.add('entrance');
  if (patch.behavior !== undefined || patch.sliderId !== undefined) fields.add('clip');
  if (patch.triggers !== undefined) fields.add('triggers');
  checkReferences(project, spreadId, object, fields);
  spread.digital[index] = object;
  return object;
}
export function insertDigital(
  source: DigitalSource,
  parentId?: string,
  options: Partial<DigitalObject> = {},
): string {
  const state = useStudio.getState(),
    pose = evaluateSpread(
      compileProject(state.project, state.activeSpreadId),
      state.angle,
      state.drivers,
    );
  const parent =
    pose.parts.find((p) => p.id === (parentId ?? state.selectedId)) ??
    (!parentId ? pose.parts.find((p) => p.id === 'page-right') : undefined);
  if (!parent) throw new Error('Select an existing paper parent before inserting digital content.');
  const bounds = polygonBounds(parent.polygon),
    position: Vec3 = [(bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2, 0];
  const object = createDigitalObject(source, parent.id, { position, ...options });
  checkReferences(state.project, state.activeSpreadId, object);
  state.edit(`${object.name} digital layer added`, (p) => {
    p.spreads.find((s) => s.id === state.activeSpreadId)!.digital.push(object);
  });
  state.set({ selectedId: object.id, view: '3d', tool: 'select' });
  return object.id;
}
export function updateDigital(id: string, patch: Partial<DigitalObject>, record = true): void {
  const state = useStudio.getState();
  state.edit(
    'Digital layer updated',
    (p) => {
      updateDigitalInProject(p, state.activeSpreadId, id, patch);
    },
    record,
  );
}
export function duplicateDigital(id: string): string {
  const state = useStudio.getState(),
    spread = state.project.spreads.find((s) => s.id === state.activeSpreadId)!,
    original = spread.digital.find((d) => d.id === id);
  if (!original) throw new Error('This digital object no longer exists.');
  const copy = structuredClone(original);
  copy.id = uid('digital');
  copy.name += ' copy';
  copy.position[0] += 5;
  copy.triggers = copy.triggers?.map((t) => ({
    ...t,
    id: uid('trigger'),
    target: t.target === original.id ? copy.id : t.target,
  }));
  state.edit('Digital layer duplicated', (p) => {
    p.spreads.find((s) => s.id === state.activeSpreadId)!.digital.push(copy);
  });
  state.set({ selectedId: copy.id });
  return copy.id;
}
export function removeDigital(id: string): void {
  const state = useStudio.getState();
  state.edit('Digital layer removed · external triggers kept for repair', (p) => {
    const spread = p.spreads.find((s) => s.id === state.activeSpreadId)!;
    spread.digital = spread.digital.filter((d) => d.id !== id);
  });
  if (state.selectedId === id) state.set({ selectedId: null });
}
export function placeDigitalBase(id: string, bounds: { min: Vec3; max: Vec3 }): void {
  if (
    ![...bounds.min, ...bounds.max].every(Number.isFinite) ||
    bounds.min.some((n, i) => n > bounds.max[i])
  )
    throw new Error('The model has no measurable finite bounds.');
  const state = useStudio.getState(),
    object = state.project.spreads
      .find((s) => s.id === state.activeSpreadId)!
      .digital.find((d) => d.id === id);
  if (!object) throw new Error('This digital object no longer exists.');
  updateDigital(id, {
    position: [object.position[0], object.position[1], digitalBaseOffset(object, bounds)],
  });
}
