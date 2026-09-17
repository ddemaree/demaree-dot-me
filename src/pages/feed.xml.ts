import type { APIRoute } from 'astro';
import { render } from 'astro:content';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { getPostDescription } from '../lib/post-description';
import { getPublishedPosts } from '../lib/taxonomy';
import { escapeXml } from '../lib/xml';

export const prerender = true;

export const GET: APIRoute = async ({ site }) => {
  if (!site) throw new Error('A site URL is required to generate the RSS feed.');

  // Keep the existing feed's ten-item window and WordPress GUIDs so subscribers
  // do not receive previously read articles as new posts after the migration.
  const posts = (await getPublishedPosts()).slice(0, 10);
  const container = await AstroContainer.create();
  const items: string[] = [];

  for (const post of posts) {
    const link = new URL(`/p/${post.id}/`, site).href;
    const guid = post.data.wordpressId
      ? `https://demaree.me/?p=${post.data.wordpressId}`
      : link;
    const { Content } = await render(post);
    const html = await container.renderToString(Content, {
      request: new Request(link),
      partial: true,
    });
    // Feed readers need absolute URLs, including fragment links that belong to
    // the article and root-relative paths emitted by Astro's image renderer.
    const content = html
      .replace(/\b(href|src|poster)=(['"])([^'"]*)\2/g, (_match, attr, quote, path) =>
        `${attr}=${quote}${new URL(path, link).href}${quote}`,
      )
      .replace(/\bsrcset=(['"])(.*?)\1/g, (_match, quote, candidates: string) =>
        `srcset=${quote}${candidates.replace(/(^|,\s*)(\/(?!\/)[^\s,]+)/g, (_candidate, separator, path) =>
          `${separator}${new URL(path, site).href}`,
        )}${quote}`,
      );
    const description = getPostDescription(post);

    items.push(`    <item>
      <title>${escapeXml(post.data.title)}</title>
      <link>${escapeXml(link)}</link>
      <guid isPermaLink="${!post.data.wordpressId}">${escapeXml(guid)}</guid>
      <pubDate>${post.data.publishedAt.toUTCString()}</pubDate>
      <dc:creator>David Demaree</dc:creator>
      ${post.data.tags.map((tag) => `<category>${escapeXml(tag)}</category>`).join('\n      ')}
      <description>${escapeXml(description)}</description>
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
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  });
};
