import type { LiveLoader } from 'astro/loaders';

const FEED_ORIGIN = 'https://www.bitsandletters.com';

export interface BnlPost {
  title: string;
  description: string;
  publishedAt: Date;
  url: string;
}

interface EntryFilter {
  id: string;
}

interface CollectionFilter {
  limit?: number;
}

function decodeXml(value: string) {
  const entities: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    quot: '"',
  };

  return value
    .replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1')
    .replace(/&#(x?[0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code.replace(/^x/i, ''), code.startsWith('x') ? 16 : 10)),
    )
    .replace(/&([a-z]+);/gi, (entity, name: string) => entities[name] ?? entity)
    .trim();
}

function element(item: string, name: string) {
  const match = item.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return match ? decodeXml(match[1]) : '';
}

function parseFeed(xml: string): BnlPost[] {
  const rss = xml.match(/<rss(?:\s[^>]*)?>([\s\S]*?)<\/rss>/i);
  const channel = rss?.[1].match(/<channel(?:\s[^>]*)?>([\s\S]*?)<\/channel>/i);
  if (!channel) throw new Error('B&L feed did not contain an RSS channel');

  return [...channel[1].matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].flatMap((match) => {
    const title = element(match[1], 'title');
    const description = element(match[1], 'description');
    const link = element(match[1], 'link');
    const publishedAt = new Date(element(match[1], 'pubDate'));

    if (!title || !link || Number.isNaN(publishedAt.valueOf())) return [];

    const url = new URL(link, FEED_ORIGIN);
    if (url.origin !== FEED_ORIGIN) return [];

    return [{ title, description, publishedAt, url: url.href }];
  });
}

function postId(post: BnlPost) {
  return new URL(post.url).pathname.replace(/^\/ideas\/|\/$/g, '');
}

export function bnlRssLoader(options: { feedUrl: string }): LiveLoader<BnlPost, EntryFilter, CollectionFilter> {
  async function loadPosts() {
    const response = await fetch(options.feedUrl, {
      headers: { accept: 'application/rss+xml, application/xml;q=0.9' },
      signal: AbortSignal.timeout(5_000),
    });

    if (!response.ok) throw new Error(`B&L feed returned ${response.status}`);
    return parseFeed(await response.text());
  }

  return {
    name: 'bnl-rss-loader',
    loadCollection: async ({ filter }) => {
      try {
        const posts = await loadPosts();
        const limit = Math.max(0, filter?.limit ?? posts.length);

        return {
          entries: posts.slice(0, limit).map((post) => ({ id: postId(post), data: post })),
          cacheHint: { lastModified: posts[0]?.publishedAt },
        };
      } catch (cause) {
        return { error: new Error('Unable to load B&L posts', { cause }) };
      }
    },
    loadEntry: async ({ filter }) => {
      try {
        const post = (await loadPosts()).find((candidate) => postId(candidate) === filter.id);
        return post ? { id: filter.id, data: post } : undefined;
      } catch (cause) {
        return { error: new Error('Unable to load B&L post', { cause }) };
      }
    },
  };
}
