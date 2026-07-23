import type { InvenTreePluginContext } from '@inventreedb/ui';

const BASE = '/plugin/ai-part-importer';

export interface TaggedField {
  value: string | null;
  source: string;
  verified?: boolean;
}

export interface ExistingMatch {
  part_pk: number;
  part_name: string;
  manufacturer_part_pk: number | null;
  manufacturer: string | null;
  mpn: string | null;
}

export interface PriceBreak {
  quantity: number;
  price: number;
}

export interface SupplierLink {
  supplier: 'digikey' | 'mouser' | string;
  sku: string | null;
  url: string | null;
  price_breaks: PriceBreak[];
}

export interface AlreadySet {
  name: boolean;
  description: boolean;
  manufacturer: boolean;
  mpn: boolean;
}

export interface ParameterEntry {
  name: string;
  value: string;
  source: string;
}

export interface DraftCandidate {
  confidence: number;
  manufacturer: TaggedField | null;
  mpn: TaggedField | null;
  name: TaggedField | null;
  description: TaggedField | null;
  category_guess: { path: string; source: string } | null;
  datasheet_url: TaggedField | null;
  image_url: TaggedField | null;
  parameters: ParameterEntry[];
  supplier_links: SupplierLink[];
  existing_matches: ExistingMatch[];
  already_set?: AlreadySet;
}

export interface Draft {
  source: { kind: string; raw_text: string | null; had_image: boolean };
  candidates: DraftCandidate[];
}

export interface EnrichDraft extends Draft {
  part_pk: number;
  existing_category: { pk: number; pathstring: string } | null;
}

export async function identifyText(
  context: InvenTreePluginContext,
  text: string,
): Promise<Draft> {
  const response = await context.api.post(`${BASE}/identify/text/`, { text });
  return response.data;
}

export const MAX_IMAGE_UPLOAD_BYTES = 8 * 1024 * 1024;

export async function identifyPhoto(
  context: InvenTreePluginContext,
  image: File,
  text: string,
): Promise<Draft> {
  const form = new FormData();
  form.append('image', image);
  if (text) {
    form.append('text', text);
  }

  const response = await context.api.post(`${BASE}/identify/photo/`, form);
  return response.data;
}

export async function enrichPart(
  context: InvenTreePluginContext,
  partPk: number,
  text: string,
): Promise<EnrichDraft> {
  const response = await context.api.post(`${BASE}/enrich/${partPk}/`, { text });
  return response.data;
}

export interface CommitResult {
  part_pk: number;
  part_name: string;
  warnings: string[];
}

export type DatasheetAction = 'link_only' | 'download_attach' | 'skip';

export interface CommitOptions {
  partPk?: number;
  supplierLinks?: SupplierLink[];
  datasheetUrl?: string | null;
  datasheetAction?: DatasheetAction;
  imageUrl?: string | null;
  parameters?: ParameterEntry[];
}

export async function commitDraft(
  context: InvenTreePluginContext,
  categoryPk: number,
  resolved: Record<string, TaggedField | null>,
  options: CommitOptions = {},
): Promise<CommitResult> {
  const response = await context.api.post(`${BASE}/commit/`, {
    category_pk: categoryPk,
    resolved,
    part_pk: options.partPk ?? null,
    supplier_links: options.supplierLinks ?? [],
    datasheet_url: options.datasheetUrl ?? null,
    datasheet_action: options.datasheetAction ?? 'skip',
    image_url: options.imageUrl ?? null,
    parameters: options.parameters ?? [],
  });
  return response.data;
}

export interface CategoryMatch {
  pk: number;
  name?: string;
  pathstring?: string;
}

export async function searchCategories(
  context: InvenTreePluginContext,
  search: string,
): Promise<CategoryMatch[]> {
  const params: Record<string, string | number> = { limit: 20 };
  if (search) {
    params.search = search;
  }

  const response = await context.api.get('/api/part/category/', { params });

  const results = response.data.results ?? response.data ?? [];

  return results.map((c: any) => ({ pk: c.pk, name: c.name, pathstring: c.pathstring }));
}

export interface TestConnectionResult {
  ok: boolean;
  error?: string;
}

export async function testConnection(context: InvenTreePluginContext): Promise<TestConnectionResult> {
  const response = await context.api.get(`${BASE}/test-connection/`);
  return response.data;
}
