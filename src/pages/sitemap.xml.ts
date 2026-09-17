import type { APIRoute } from 'astro';
import { getPublishedPosts, getTopics, postTagSlugs } from '../lib/taxonomy';
import { escapeXml } from '../lib/xml';

export const prerender = true;

export const GET: APIRoute = async ({ site }) => {
  if (!site) throw new Error('A site URL is required to generate the sitemap.');

  const [posts, topics] = await Promise.all([getPublishedPosts(), getTopics()]);
  const tags = new Set(posts.flatMap((post) => postTagSlugs(post).map(({ slug }) => slug)));
  const paths = [
    '/',
    '/blog/',
    '/topics/',
    '/labels/',
    ...topics.map((topic) => `/topics/${topic.id}/`),
    ...[...tags].filter(Boolean).sort().map((tag) => `/labels/${tag}/`),
  ];
  const urls = paths.map((path) => `<url><loc>${escapeXml(new URL(path, site).href)}</loc></url>`);

  for (const post of posts) {
    const url = new URL(`/p/${post.id}/`, site).href;
    const lastModified = post.data.updatedAt ?? post.data.publishedAt;
    urls.push(`<url><loc>${escapeXml(url)}</loc><lastmod>${lastModified.toISOString()}</lastmod></url>`);
  }

  return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>`, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};
