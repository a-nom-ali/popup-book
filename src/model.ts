import { z } from 'zod';

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
export type MechanismKind = 'vfold' | 'tent' | 'slider';
export type PresetKind = MechanismKind | 'bloom' | 'pavilion' | 'scene';
export interface Mechanism {
  id: string;
  name: string;
  kind: MechanismKind;
  host: string;
  offset: number;
  width: number;
  reach: number;
  left: number;
  right: number;
  alpha: number;
  beta: number;
  branch: 1 | -1;
  color: string;
  stroke: number;
  outlines: Record<string, Vec2[]>;
  cutouts: Record<string, Vec2[][]>;
}
export interface PaperDecoration {
  id: string;
  name: string;
  parent: string;
  outline: Vec2[];
  holes: Vec2[][];
  position: Vec2;
  color: string;
  /** In-plane rotation in degrees; absent in legacy projects. */
  rotation?: number;
  /** Bonded material, expressed in this decoration's millimetre frame. */
  glueRegion?: PaperRegion[];
  cutout?: CutoutSource;
}
export interface PaperRegion {
  outline: Vec2[];
  holes: Vec2[][];
}
export interface CutoutSource {
  assetId: string;
  threshold: number;
  tolerance: number;
  imageWidth: number;
  imageHeight: number;
  width: number;
  height: number;
  imageX: number;
  imageY: number;
  /** All disconnected pieces of a single trace share this ID. */
  traceGroup?: string;
}
export interface GlueTab {
  id: string;
  partId: string;
  edge: number;
  depth: number;
}
export interface Artwork {
  id: string;
  partId: string;
  assetId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface DigitalObject {
  id: string;
  name: string;
  assetId: string;
  parent: string;
  position: Vec3;
  rotation: Vec3;
  scale: number;
  behavior: 'loop' | 'click' | 'angle';
  clip: number;
  angleStart: number;
  angleEnd: number;
}
export interface Spread {
  id: string;
  name: string;
  subtitle: string;
  color: string;
  mechanisms: Mechanism[];
  decorations: PaperDecoration[];
  tabs: GlueTab[];
  artwork: Artwork[];
  digital: DigitalObject[];
}
export interface Asset {
  id: string;
  name: string;
  mime: string;
  data: string;
}
export interface Project {
  version: 2;
  id: string;
  name: string;
  pageWidth: number;
  pageHeight: number;
  spreads: Spread[];
  assets: Record<string, Asset>;
  updatedAt: string;
}
export interface Diagnostic {
  id: string;
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  partIds: string[];
  angle?: number;
  drivers?: Record<string, number>;
}
export const uid = (prefix = 'id') => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
const point = z.tuple([z.number().finite(), z.number().finite()]);
const vector = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const number = z.number().finite();
const mechanismSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['vfold', 'tent', 'slider']),
  host: z.string(),
  offset: number,
  width: number,
  reach: number,
  left: number,
  right: number,
  alpha: number,
  beta: number,
  branch: z.union([z.literal(1), z.literal(-1)]),
  color: z.string(),
  stroke: number,
  outlines: z.record(z.string(), z.array(point)),
  cutouts: z.record(z.string(), z.array(z.array(point))),
});
export const projectSchema = z.object({
  version: z.literal(2),
  id: z.string(),
  name: z.string(),
  pageWidth: number.positive().max(2000),
  pageHeight: number.positive().max(2000),
  updatedAt: z.string(),
  assets: z.record(
    z.string(),
    z.object({ id: z.string(), name: z.string(), mime: z.string(), data: z.string() }),
  ),
  spreads: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        subtitle: z.string(),
        color: z.string(),
        mechanisms: z.array(mechanismSchema),
        decorations: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            parent: z.string(),
            outline: z.array(point),
            holes: z.array(z.array(point)),
            position: point,
            color: z.string(),
            rotation: number.optional(),
            glueRegion: z
              .array(z.object({ outline: z.array(point), holes: z.array(z.array(point)) }))
              .optional(),
            cutout: z
              .object({
                assetId: z.string(),
                threshold: number.min(0).max(1),
                tolerance: number.nonnegative(),
                imageWidth: number.positive(),
                imageHeight: number.positive(),
                width: number.positive(),
                height: number.positive(),
                imageX: number.default(0),
                imageY: number.default(0),
                traceGroup: z.string().optional(),
              })
              .optional(),
          }),
        ),
        tabs: z.array(
          z.object({
            id: z.string(),
            partId: z.string(),
            edge: number.int().nonnegative(),
            depth: number.positive(),
          }),
        ),
        artwork: z.array(
          z.object({
            id: z.string(),
            partId: z.string(),
            assetId: z.string(),
            x: number,
            y: number,
            width: number.positive(),
            height: number.positive(),
          }),
        ),
        digital: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            assetId: z.string(),
            parent: z.string(),
            position: vector,
            rotation: vector,
            scale: number.positive(),
            behavior: z.enum(['loop', 'click', 'angle']),
            clip: number.int().nonnegative(),
            angleStart: number,
            angleEnd: number,
          }),
        ),
      }),
    )
    .min(1)
    .max(100),
});
export function parseProject(input: unknown): Project {
  // Version 1 used the same panel and artwork coordinate frames. No geometric
  // migration is necessary, and leaving optional fields absent preserves it.
  const migrated =
    input && typeof input === 'object' && 'version' in input && input.version === 1
      ? { ...input, version: 2 }
      : input;
  const project = projectSchema.parse(migrated) as Project;
  const ids = [
    project.id,
    ...project.spreads.flatMap((s) => [
      s.id,
      ...s.mechanisms.map((m) => m.id),
      ...s.decorations.map((d) => d.id),
      ...s.digital.map((d) => d.id),
    ]),
  ];
  if (new Set(ids).size !== ids.length) throw new Error('Project contains duplicate object IDs.');
  return project;
}
