import type { APIRoute } from 'astro';
import { isProductionSite } from '../lib/site-origin';

export const prerender = false;

export const GET: APIRoute = ({ site, url }) => {
  if (!site) throw new Error('A site URL is required to generate robots.txt.');

  const content = isProductionSite(url) ? `User-agent: *
Allow: /
Disallow: /_emdash/
Disallow: /emdash-test/
Disallow: /keystatic/
Disallow: /api/keystatic/

Sitemap: ${new URL('/sitemap.xml', site).href}
` : `User-agent: *
Disallow: /
`;

  return new Response(content, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
};
