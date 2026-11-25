import { z } from 'zod';

export const MIN_YEAR = -3000;
export const MAX_YEAR = 2100;

export const yearSchema = z
  .number()
  .int()
  .min(MIN_YEAR)
  .max(MAX_YEAR)
  .refine((y) => y !== 0, { message: "L'an 0 n'existe pas" });

const position = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
const ring = z.array(position).min(4);

export const pointSchema = z.object({ type: z.literal('Point'), coordinates: position });
export const zoneSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('Polygon'), coordinates: z.array(ring).min(1) }),
  z.object({ type: z.literal('MultiPolygon'), coordinates: z.array(z.array(ring).min(1)).min(1) }),
]);
export const geometrySchema = z.union([pointSchema, zoneSchema]);

export const kindSchema = z.enum(['point', 'zone']);
export type Kind = z.infer<typeof kindSchema>;

export const versionSchema = z
  .object({
    startYear: yearSchema,
    endYear: yearSchema.nullable(),
    label: z.string().trim().max(200).nullable().optional(),
    geometry: geometrySchema,
  })
  .refine((v) => v.endYear === null || v.endYear >= v.startYear, {
    message: "L'année de fin doit être postérieure ou égale à l'année de début",
  });

export const versionPatchSchema = z.object({
  startYear: yearSchema.optional(),
  endYear: yearSchema.nullable().optional(),
  label: z.string().trim().max(200).nullable().optional(),
  geometry: geometrySchema.optional(),
});

export const entityFieldsSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(20000).default(''),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#a0442c'),
  category: z.string().trim().max(100).default(''),
});

export const entityCreateSchema = entityFieldsSchema.extend({
  kind: kindSchema,
  version: versionSchema,
  wikiPageIds: z.array(z.number().int()).default([]),
});

export const idParam = z.object({ id: z.coerce.number().int().positive() });

/** Vérifie qu'une géométrie correspond au type d'entité (point ou zone). */
export function geometryMatchesKind(kind: Kind, geometry: z.infer<typeof geometrySchema>): boolean {
  return kind === 'point' ? geometry.type === 'Point' : geometry.type !== 'Point';
}
