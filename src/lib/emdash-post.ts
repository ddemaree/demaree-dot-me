import type { ContentEntry, ImageValue, PortableTextBlock, TaxonomyTerm } from 'emdash';

/** CMS fields used by the public blog. */
export interface EmDashPostData {
  id: string;
  slug: string | null;
  status: string;
  translationGroup?: string;
  wordpress_id?: number;
  title: string;
  description?: string;
  subtitle?: string;
  format?: string;
  link_url?: string;
  content?: PortableTextBlock[];
  featured_image?: ImageValue;
  featured_image_alt?: string;
  tags?: string[];
  terms?: Record<string, TaxonomyTerm[]>;
  original_metadata?: Record<string, unknown>;
  original_updated_at?: string | Date | null;
  publishedAt?: Date | null;
  updatedAt?: Date;
}

export type EmDashPostEntry = ContentEntry<EmDashPostData>;

export function emdashPostUrl(post: Pick<EmDashPostEntry, 'id'>) {
  return `/p/${encodeURIComponent(post.id)}/`;
}

export function emdashDate(value: Date | string | null | undefined) {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.valueOf()) ? undefined : date;
}

export function formatEmDashDate(date: Date) {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'long',
    timeZone: 'America/New_York',
  }).format(date);
}

/** Resolve social metadata through the same storage URL used by CMS media. */
export function emdashSocialImage(
  image: ImageValue | undefined,
  resolve?: (key: string) => string,
  origin?: string,
) {
  if (!image) return undefined;
  const key = image.meta?.storageKey;
  const src = image.src || (typeof key === 'string' && resolve
    ? resolve(key)
    : `/_emdash/api/media/file/${encodeURIComponent(image.id)}`);
  return { src: origin ? new URL(src, origin).href : src, width: image.width, height: image.height };
}
