import type { APIRoute } from 'astro';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import EmDashContent from '../components/EmDashContent.astro';
import { getPublishedPosts } from '../lib/taxonomy';
import { isProductionSite } from '../lib/site-origin';
import { escapeXml } from '../lib/xml';

export const prerender = false;

export const GET: APIRoute = async ({ site, locals, url }) => {
  try {
    if (!site) throw new Error('A site URL is required to generate the RSS feed.');

    // Keep the existing ten-item window and WordPress GUIDs so subscribers do
    // not receive previously read articles as new posts after the migration.
    const posts = (await getPublishedPosts()).slice(0, 10);
    const container = await AstroContainer.create();
    const items: string[] = [];

    for (const post of posts) {
      const path = `/p/${encodeURIComponent(post.id)}/`;
      const link = new URL(path, site).href;
      const guid = post.data.wordpressId
        ? `https://demaree.me/?p=${post.data.wordpressId}`
        : link;
      const html = await container.renderToString(EmDashContent, {
        props: { post, priority: false, editable: false },
        request: new Request(new URL(path, url.origin)),
        locals,
        partial: true,
      });
      // Feed readers need absolute URLs, including fragment links that belong
      // to the article and paths emitted by the CMS image renderer.
      const content = html
        .replace(/\b(href|src|poster)=(['"])([^'"]*)\2/g, (_match, attr, quote, path) =>
          `${attr}=${quote}${new URL(path, attr === 'href' ? link : url.origin).href}${quote}`,
        )
        .replace(/\bsrcset=(['"])(.*?)\1/g, (_match, quote, candidates: string) =>
          `srcset=${quote}${candidates.replace(/(^|,\s*)([^\s,]+)(?=\s|$)/g, (_candidate, separator, path) =>
            `${separator}${new URL(path, url.origin).href}`,
          )}${quote}`,
        );

      items.push(`    <item>
      <title>${escapeXml(post.data.title)}</title>
      <link>${escapeXml(link)}</link>
      <guid isPermaLink="${!post.data.wordpressId}">${escapeXml(guid)}</guid>
      <pubDate>${post.data.publishedAt.toUTCString()}</pubDate>
      <dc:creator>David Demaree</dc:creator>
      ${post.data.tags.map((tag) => `<category>${escapeXml(tag)}</category>`).join('\n      ')}
      <description>${escapeXml(post.data.description)}</description>
      <content:encoded>${escapeXml(content)}</content:encoded>
    </item>`);
    }

    const latestDate = posts.reduce<Date | undefined>((latest, post) => {
      const date = post.data.updatedAt ?? post.data.publishedAt;
      return !latest || date > latest ? date : latest;
    }, undefined);

    return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>David Demaree</title>
    <link>${escapeXml(site.href)}</link>
    <description>A good man, and thorough.</description>
    <language>en-US</language>
    <atom:link href="${escapeXml(new URL('/feed.xml', site).href)}" rel="self" type="application/rss+xml" />
    ${latestDate ? `<lastBuildDate>${latestDate.toUTCString()}</lastBuildDate>` : ''}
${items.join('\n')}
  </channel>
</rss>`, {
      headers: {
        'Content-Type': 'application/rss+xml; charset=utf-8',
        'Cache-Control': 'no-store',
        ...(!isProductionSite(url) ? { 'X-Robots-Tag': 'noindex' } : {}),
      },
    });
  } catch (error) {
    console.error('[RSS feed] Failed to load published content:', error);
    return new Response('The feed is temporarily unavailable. Please try again soon.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
};
