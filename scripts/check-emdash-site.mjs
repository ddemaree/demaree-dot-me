#!/usr/bin/env node
/** Acceptance checks for a CMS deployment; only CMS reads and anonymous GETs. */
import { readPublishedEmDashPosts } from './lib/emdash-published.mjs';
import { loadPosts } from './lib/emdash-convert.mjs';
import { emdashOrigin } from './lib/emdash-auth.mjs';

const started = Date.now();
const failures = [];
const stats = { pages: 0, taxonomyArchives: 0, redirects: 0, imageUrls: 0 };
const images = new Set();
const taxonomies = new Set();
let target;

function fail(path, check, actual) { failures.push({ path, check, ...(actual !== undefined ? { actual } : {}) }); }
function expect(condition, path, check, actual) { if (!condition) fail(path, check, actual); }
function decode(value = '') {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity) => {
    if (!entity.startsWith('#')) return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[entity.toLowerCase()];
    const point = parseInt(entity.slice(entity[1].toLowerCase() === 'x' ? 2 : 1), entity[1].toLowerCase() === 'x' ? 16 : 10);
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : match;
  });
}
function text(html = '') { return decode(html.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim(); }
function attributes(tag) {
  return Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/gs)].map(([, key, , value]) => [key.toLowerCase(), decode(value)]));
}
function meta(html, name) {
  return [...html.matchAll(/<meta\b[^>]*>/gi)].map(([tag]) => attributes(tag))
    .find((attrs) => attrs.property === name || attrs.name === name)?.content;
}
function hrefs(html) { return [...html.matchAll(/<a\b[^>]*>/gi)].map(([tag]) => attributes(tag).href).filter(Boolean); }
function taxonomyHrefs(html) {
  // Editorial body links can reference retired archives. Only the template's
  // native topic/tag navigation defines archives that must exist in the sitemap.
  return [...html.matchAll(/(<nav\b[^>]*>)([\s\S]*?)<\/nav>/gi)]
    .filter(([, tag]) => attributes(tag)['aria-label'] === 'Post topics and tags')
    .flatMap(([, , content]) => hrefs(content));
}
function postPaths(html) {
  return new Set(hrefs(html).map((href) => new URL(href, target).pathname).filter((path) => /^\/p\/[^/]+\/$/.test(path)));
}
function expectedPath(post) { return `/p/${encodeURIComponent(post.slug || post.id)}/`; }
function bodyFragments(value) {
  if (Array.isArray(value)) return value.flatMap(bodyFragments);
  if (!value || typeof value !== 'object') return [];
  const own = typeof value.text === 'string' ? value.text
    : value._type === 'code' && typeof value.code === 'string' ? value.code
    : value._type === 'htmlBlock' && typeof value.html === 'string' ? text(value.html) : '';
  return [own.replace(/\s+/g, ' ').trim(), ...bodyFragments(value.children), ...bodyFragments(value.content)]
    .filter((fragment) => fragment.length > 2);
}
function checkBody(html, post, path) {
  const rendered = text(html);
  const missing = bodyFragments(post.data.content).filter((fragment) => !rendered.includes(fragment));
  expect(!missing.length, path, 'published CMS body text rendered in full', missing.slice(0, 3).map((fragment) => fragment.slice(0, 100)));
}
function checkSet(actual, expected, path, name) {
  const missing = [...expected].filter((value) => !actual.has(value));
  const extra = [...actual].filter((value) => !expected.has(value));
  expect(!missing.length && !extra.length, path, name, { missing: missing.slice(0, 8), extra: extra.slice(0, 8) });
}
async function concurrent(values, action) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, values.length) }, async () => {
    while (next < values.length) {
      const value = values[next++];
      try { await action(value); }
      catch (error) { fail(typeof value === 'string' ? value : expectedPath(value), 'request/check failed', error.message); }
    }
  }));
}
async function get(path) {
  const response = await fetch(new URL(path, target), { redirect: 'manual', signal: AbortSignal.timeout(30_000) });
  return { response, html: await response.text() };
}
function checkPage(path, response, html, expectedStatus = 200) {
  stats.pages++;
  expect(response.status === expectedStatus, path, `HTTP ${expectedStatus}`, response.status);
  expect((response.headers.get('cache-control') ?? '').includes('no-store'), path, 'no-store cache policy', response.headers.get('cache-control'));
  if (expectedStatus === 200) expect((response.headers.get('content-type') ?? '').includes('text/html'), path, 'HTML content type');
  const preview = new URL(target).hostname !== 'demaree.me';
  if (preview || expectedStatus !== 200) {
    expect((response.headers.get('x-robots-tag') ?? '').includes('noindex'), path, 'noindex response header');
    expect((meta(html, 'robots') ?? '').includes('noindex'), path, 'noindex page metadata');
  } else {
    const canonical = [...html.matchAll(/<link\b[^>]*>/gi)].map(([tag]) => attributes(tag)).find((attrs) => attrs.rel === 'canonical')?.href;
    expect(canonical === `https://demaree.me${path.split('?')[0]}`, path, 'production canonical', canonical);
    expect(!(meta(html, 'robots') ?? '').includes('noindex'), path, 'production indexing enabled');
  }
}
function collectImages(html) {
  for (const [tag] of html.matchAll(/<img\b[^>]*>/gi)) {
    const attrs = attributes(tag);
    const urls = [attrs.src, ...(attrs.srcset ?? '').split(/,\s*/).map((candidate) => candidate.split(/\s+/)[0])].filter(Boolean);
    for (const src of urls) {
      const url = new URL(src, target);
      if (decodeURIComponent(url.href).includes('/_emdash/api/media/file/')) images.add(url.href);
    }
  }
}
async function redirect(path, destination) {
  const { response } = await get(path);
  stats.redirects++;
  expect(response.status === 301, path, '301 redirect', response.status);
  expect(response.headers.get('location') === destination, path, 'redirect destination', response.headers.get('location'));
}
function xmlTag(xml, name) { return decode(xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`))?.[1] ?? ''); }

async function main() {
  if (!process.env.EMDASH_SITE_URL) throw new Error('Set EMDASH_SITE_URL explicitly to the deployment origin to check.');
  target = emdashOrigin(process.env.EMDASH_SITE_URL);
  const [posts, sources] = await Promise.all([readPublishedEmDashPosts(), loadPosts()]);
  const sourcePublished = sources.filter((post) => !post.data.draft);
  const drafts = sources.filter((post) => post.data.draft).map((post) => post.slug);
  const retired = 'filtering-github-email-notifications';
  const slugs = new Set(posts.map((post) => post.slug || post.id));
  stats.source = { published: sourcePublished.length, drafts: drafts.length };
  stats.cms = { published: posts.length, additional: posts.filter((post) => !sourcePublished.some((source) => source.slug === (post.slug || post.id))).length };
  expect(posts.length > 0, 'CMS', 'published corpus is nonempty');
  for (const source of sourcePublished) expect(slugs.has(source.slug), 'CMS', `source post imported: ${source.slug}`);
  for (const slug of [...drafts, retired]) expect(!slugs.has(slug), 'CMS', `draft/retired post excluded: ${slug}`);
  const publishedPaths = new Set(posts.map(expectedPath));

  await concurrent(posts, async (post) => {
    const path = expectedPath(post);
    const { response, html } = await get(path);
    checkPage(path, response, html);
    expect(text(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]) === post.data.title.replace(/\s+/g, ' ').trim(), path, 'CMS title rendered');
    expect(Date.parse(meta(html, 'article:published_time')) === Date.parse(post.publishedAt), path, 'CMS publication instant rendered', meta(html, 'article:published_time'));
    expect(!html.includes('@assets/') && !html.includes('/emdash-test/'), path, 'public rendering has no import aliases or sample links');
    for (const href of taxonomyHrefs(html)) {
      const url = new URL(href, target);
      if (url.origin === target && /^\/(topics|labels)\/[^/]+\/$/.test(url.pathname)) taxonomies.add(url.pathname);
    }
    checkBody(html, post, path);
    collectImages(html);
  });
  for (const slug of [...drafts, retired]) {
    const path = `/p/${encodeURIComponent(slug)}/`;
    const { response, html } = await get(path);
    checkPage(path, response, html, 404);
  }

  for (const path of ['/', '/about/', '/blog/', '/topics/', '/labels/']) {
    const { response, html } = await get(path);
    checkPage(path, response, html);
    if (path === '/blog/') checkSet(postPaths(html), publishedPaths, path, 'archive contains exactly published CMS posts');
    if (path === '/') {
      const recent = [...posts].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt) || (b.slug || b.id).localeCompare(a.slug || a.id)).slice(0, 5);
      checkSet(postPaths(html), new Set(recent.map(expectedPath)), path, 'home latest five CMS posts');
    }
    collectImages(html);
  }
  if (sourcePublished.some((post) => post.data.tags?.length)) {
    expect([...taxonomies].some((path) => path.startsWith('/labels/')), '/blog/', 'native tag links remain exposed for the imported corpus');
  }
  expect([...taxonomies].some((path) => path.startsWith('/topics/')), '/blog/', 'CMS topic navigation remains exposed');
  await concurrent([...taxonomies], async (path) => {
    const { response, html } = await get(path);
    checkPage(path, response, html);
    stats.taxonomyArchives++;
    const paths = postPaths(html);
    expect(paths.size > 0 && [...paths].every((postPath) => publishedPaths.has(postPath)), path, 'taxonomy archive has only published CMS posts');
  });

  const feed = await get('/feed.xml');
  expect(feed.response.status === 200, '/feed.xml', 'HTTP 200', feed.response.status);
  expect((feed.response.headers.get('content-type') ?? '').includes('application/rss+xml'), '/feed.xml', 'RSS content type');
  expect((feed.response.headers.get('cache-control') ?? '').includes('no-store'), '/feed.xml', 'no-store cache policy');
  if (new URL(target).hostname !== 'demaree.me') expect((feed.response.headers.get('x-robots-tag') ?? '').includes('noindex'), '/feed.xml', 'preview noindex');
  const items = [...feed.html.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, item]) => item);
  const recent = [...posts].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt) || (b.slug || b.id).localeCompare(a.slug || a.id)).slice(0, 10);
  stats.feedItems = items.length;
  expect(items.length === recent.length, '/feed.xml', 'latest ten published items', items.length);
  for (let index = 0; index < Math.min(items.length, recent.length); index++) {
    const item = items[index], post = recent[index], path = expectedPath(post);
    expect(xmlTag(item, 'title') === post.data.title, '/feed.xml', `CMS feed title: ${path}`);
    expect(xmlTag(item, 'link') === `https://demaree.me${path}`, '/feed.xml', `canonical feed link: ${path}`);
    expect(xmlTag(item, 'guid') === (post.data.wordpress_id ? `https://demaree.me/?p=${post.data.wordpress_id}` : `https://demaree.me${path}`), '/feed.xml', `stable GUID: ${path}`);
    expect(Date.parse(xmlTag(item, 'pubDate')) === Math.floor(Date.parse(post.publishedAt) / 1000) * 1000, '/feed.xml', `publication instant: ${path}`);
    const content = xmlTag(item, 'content:encoded');
    checkBody(content, post, `/feed.xml:${path}`);
    expect(Boolean(content.trim()) || !(post.data.content?.length), '/feed.xml', `full body rendered: ${path}`);
    for (const [, , value] of content.matchAll(/\b(?:href|src|poster)=(['"])([^'"]*)\1/g)) {
      expect(/^[a-z][\w+.-]*:/i.test(decode(value)), '/feed.xml', `absolute content URL: ${path}`, value);
    }
    for (const [, , candidates] of content.matchAll(/\bsrcset=(['"])(.*?)\1/g)) {
      for (const candidate of decode(candidates).split(/,\s*/)) {
        const value = candidate.split(/\s+/)[0];
        expect(/^[a-z][\w+.-]*:/i.test(value), '/feed.xml', `absolute responsive image URL: ${path}`, value);
      }
    }
    collectImages(content);
  }

  const sitemap = await get('/sitemap.xml');
  expect(sitemap.response.status === 200, '/sitemap.xml', 'HTTP 200', sitemap.response.status);
  expect((sitemap.response.headers.get('cache-control') ?? '').includes('no-store'), '/sitemap.xml', 'no-store cache policy');
  if (new URL(target).hostname !== 'demaree.me') expect((sitemap.response.headers.get('x-robots-tag') ?? '').includes('noindex'), '/sitemap.xml', 'preview noindex');
  const locations = [...sitemap.html.matchAll(/<loc>([\s\S]*?)<\/loc>/g)].map(([, loc]) => decode(loc));
  stats.sitemapUrls = locations.length;
  expect(locations.every((loc) => new URL(loc).origin === 'https://demaree.me'), '/sitemap.xml', 'canonical production origin');
  const sitemapPaths = new Set(locations.map((loc) => new URL(loc).pathname));
  checkSet(new Set([...sitemapPaths].filter((path) => path.startsWith('/p/'))), publishedPaths, '/sitemap.xml', 'exact published CMS post set');
  for (const path of taxonomies) expect(sitemapPaths.has(path), '/sitemap.xml', `native taxonomy URL: ${path}`);
  for (const slug of [...drafts, retired]) expect(!sitemapPaths.has(`/p/${slug}/`), '/sitemap.xml', `draft/retired URL excluded: ${slug}`);

  for (const path of ['/feed/', '/feed/rss/', '/feed/rss2/', '/feed/atom/']) await redirect(path, '/feed.xml');
  for (const format of ['rss', 'rss2', 'atom']) await redirect(`/?feed=${format}`, '/feed/');
  await redirect('/emdash-test/', '/blog/');
  if (posts.length) await redirect(`/emdash-test/${encodeURIComponent(posts[0].slug || posts[0].id)}/`, expectedPath(posts[0]));
  const robots = await get('/robots.txt');
  expect(robots.response.status === 200, '/robots.txt', 'HTTP 200', robots.response.status);
  if (new URL(target).hostname !== 'demaree.me') expect(/Disallow:\s*\/\s*(?:\n|$)/.test(robots.html), '/robots.txt', 'preview crawling disallowed');
  else expect(robots.html.includes('Sitemap: https://demaree.me/sitemap.xml'), '/robots.txt', 'production sitemap discovery');

  stats.imageUrls = images.size;
  await concurrent([...images], async (url) => {
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(30_000) });
    expect(response.status === 200, url, 'CMS image HTTP 200', response.status);
    expect((response.headers.get('content-type') ?? '').startsWith('image/'), url, 'CMS image content type', response.headers.get('content-type'));
    const reader = response.body?.getReader();
    const chunk = await reader?.read();
    expect(Boolean(chunk?.value?.byteLength), url, 'CMS image body is nonempty');
    await reader?.cancel();
  });
}

try { await main(); }
catch (error) { fail(target || 'configuration', 'acceptance check could not finish', error.message); }
console.log(JSON.stringify({ target, ok: failures.length === 0, ...stats, elapsedSeconds: Math.round((Date.now() - started) / 1000), failureCount: failures.length, failures: failures.slice(0, 30), omittedFailures: Math.max(0, failures.length - 30) }, null, 2));
if (failures.length) process.exitCode = 1;
