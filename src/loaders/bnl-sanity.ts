import type { LiveLoader } from 'astro/loaders';

const SITE_ORIGIN = 'https://www.bitsandletters.com';
const IMAGE_ORIGIN = 'https://cdn.sanity.io';

interface BnlPost {
  title: string;
  description: string;
  publishedAt: Date;
  url: string;
  image?: string;
  imageAlt?: string;
}

interface SanityPost {
  slug: string;
  title: string;
  description: string;
  publishedAt: string;
  asset: { url: string; dimensions: { width: number; height: number } | null } | null;
  crop: { left: number; top: number; right: number; bottom: number } | null;
  legacyImage: string | null;
  imageAlt: string | null;
}

interface EntryFilter {
  id: string;
}

interface CollectionFilter {
  limit?: number;
}

function featuredImage(post: SanityPost) {
  const assetUrl = URL.parse(post.asset?.url ?? '');
  if (assetUrl?.origin !== IMAGE_ORIGIN) {
    const legacyUrl = URL.parse(post.legacyImage ?? '');
    return legacyUrl?.protocol === 'https:' ? legacyUrl.href : undefined;
  }

  const dimensions = post.asset?.dimensions;
  if (post.crop && dimensions) {
    const { width, height } = dimensions;
    const { left, top, right, bottom } = post.crop;
    const x = Math.round(left * width);
    const y = Math.round(top * height);
    const croppedWidth = width - x - Math.round(right * width);
    const croppedHeight = height - y - Math.round(bottom * height);
    if (croppedWidth > 0 && croppedHeight > 0) {
      assetUrl.searchParams.set('rect', `${x},${y},${croppedWidth},${croppedHeight}`);
    }
  }

  assetUrl.searchParams.set('w', '720');
  assetUrl.searchParams.set('fit', 'max');
  assetUrl.searchParams.set('auto', 'format');
  return assetUrl.href;
}

export function bnlSanityLoader({ projectId, dataset }: { projectId: string; dataset: string }): LiveLoader<BnlPost, EntryFilter, CollectionFilter> {
  const endpoint = `https://${projectId}.apicdn.sanity.io/v2025-02-19/data/query/${dataset}`;

  async function loadPosts(limit?: number, slug?: string) {
    const url = new URL(endpoint);
    url.searchParams.set('perspective', 'published');
    url.searchParams.set('$slug', JSON.stringify(slug ?? null));
    if (limit !== undefined) url.searchParams.set('$limit', String(Math.max(0, Math.floor(limit))));
    url.searchParams.set('query', `
      *[_type == "post" && hidden != true && defined(slug.current) && defined(dateTime(publishedAt))
        && ($slug == null || slug.current == $slug)]
        | order(publishedAt desc)${limit === undefined ? '' : '[0...$limit]'} {
        "slug": slug.current,
        "title": coalesce(title, "Untitled idea"),
        "description": coalesce(excerpt, ""),
        publishedAt,
        "asset": featuredImage.asset->{url, "dimensions": metadata.dimensions},
        "crop": featuredImage.crop,
        "legacyImage": featuredImageURL,
        "imageAlt": coalesce(featuredImage.alt, featuredImageAlt)
      }
    `);

    const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error(`B&L Sanity query returned ${response.status}`);
    const { result } = await response.json() as { result: SanityPost[] };

    return result.map((post) => ({
      id: post.slug,
      data: {
        title: post.title,
        description: post.description,
        publishedAt: new Date(post.publishedAt),
        url: new URL(`/ideas/${encodeURIComponent(post.slug)}`, SITE_ORIGIN).href,
        image: featuredImage(post),
        imageAlt: post.imageAlt ?? undefined,
      },
    }));
  }

  return {
    name: 'bnl-sanity-loader',
    loadCollection: async ({ filter }) => {
      try {
        const entries = await loadPosts(filter?.limit);
        return { entries, cacheHint: { lastModified: entries[0]?.data.publishedAt } };
      } catch (cause) {
        return { error: new Error('Unable to load B&L posts', { cause }) };
      }
    },
    loadEntry: async ({ filter }) => {
      try {
        const [entry] = await loadPosts(1, filter.id);
        return entry;
      } catch (cause) {
        return { error: new Error('Unable to load B&L post', { cause }) };
      }
    },
  };
}
