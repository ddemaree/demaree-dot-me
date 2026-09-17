import type { APIRoute } from 'astro';

export const prerender = true;

export const GET: APIRoute = ({ site }) => {
  if (!site) throw new Error('A site URL is required to generate robots.txt.');

  return new Response(`User-agent: *
Allow: /
Disallow: /keystatic/
Disallow: /api/keystatic/

Sitemap: ${new URL('/sitemap.xml', site).href}
`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
