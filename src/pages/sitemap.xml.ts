import type { APIRoute } from 'astro';
import { getPublishedPosts, getTopics, postTagSlugs } from '../lib/taxonomy';
import { isProductionSite } from '../lib/site-origin';
import { escapeXml } from '../lib/xml';

export const prerender = false;

export const GET: APIRoute = async ({ site, url }) => {
  try {
    if (!site) throw new Error('A site URL is required to generate the sitemap.');

    const [posts, topics] = await Promise.all([getPublishedPosts(), getTopics()]);
    const tags = new Set(posts.flatMap((post) => postTagSlugs(post).map(({ slug }) => slug)));
    const paths = [
      '/',
      '/about/',
      '/blog/',
      '/topics/',
      '/labels/',
      ...topics.map((topic) => `/topics/${encodeURIComponent(topic.id)}/`),
      ...[...tags].filter(Boolean).sort().map((tag) => `/labels/${encodeURIComponent(tag)}/`),
    ];
    const urls = paths.map((path) => `<url><loc>${escapeXml(new URL(path, site).href)}</loc></url>`);

    for (const post of posts) {
      const link = new URL(`/p/${encodeURIComponent(post.id)}/`, site).href;
      const lastModified = post.data.updatedAt ?? post.data.publishedAt;
      urls.push(`<url><loc>${escapeXml(link)}</loc><lastmod>${lastModified.toISOString()}</lastmod></url>`);
    }

    return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>`, {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'no-store',
        ...(!isProductionSite(url) ? { 'X-Robots-Tag': 'noindex' } : {}),
      },
    });
  } catch (error) {
    console.error('[Sitemap] Failed to load published content:', error);
    return new Response('The sitemap is temporarily unavailable. Please try again soon.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
};
