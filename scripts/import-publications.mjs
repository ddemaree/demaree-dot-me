import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import TurndownService from 'turndown';
import { classifyEntry } from './taxonomy.mjs';

const force = process.argv.includes('--force');
const sources = new Set(
  process.argv
    .filter((arg) => arg.startsWith('--source='))
    .flatMap((arg) => arg.slice('--source='.length).split(',')),
);
const importSubstack = sources.size === 0 || sources.has('substack');
const importMedium = sources.size === 0 || sources.has('medium');

const SUBSTACK_ORIGIN = 'https://letters.demaree.me';
const MEDIUM_FEEDS = [
  'https://ddemaree.medium.com/feed',
  'https://medium.com/feed/words-by-demaree',
];
const MEDIUM_EXTRA_URLS = [
  'https://ddemaree.medium.com/apple-s-new-keyboard-and-mouse-reviewed-6a7a2e9f0b96',
];
const USER_AGENT =
  'Mozilla/5.0 (compatible; demaree.me-importer/1.0; +https://demaree.me/)';

const root = process.cwd();
const contentDirectory = path.join(root, 'src/content/posts');
const imageDirectory = path.join(root, 'src/assets/images/posts');
const extrasPath = path.join(root, 'scripts/data/medium-extras.json');

const turndown = new TurndownService({
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  emDelimiter: '*',
  headingStyle: 'atx',
  strongDelimiter: '**',
});

turndown.remove(['script', 'style', 'button', 'svg', 'form', 'iframe']);
turndown.addRule('figureCaption', {
  filter: 'figcaption',
  replacement(content) {
    return content.trim() ? `\n\n*${content.trim()}*\n\n` : '';
  },
});
turndown.addRule('imageCaption', {
  filter(node) {
    return /\bimage-caption\b/.test(node.getAttribute('class') || '');
  },
  replacement(content) {
    return content.trim() ? `\n\n*${content.trim()}*\n\n` : '';
  },
});

function yamlString(value) {
  return JSON.stringify(value);
}

function parseYamlScalar(raw) {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('"')) return trimmed;
  return trimmed.replace(/^"/, '').replace(/"$/, '').replace(/\\"/g, '"');
}

function normalizeTitle(value) {
  return value
    .toLowerCase()
    .replace(/^#\d+:\s*/, '')
    .replace(/[''"“”‘’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function slugify(value) {
  return trimSlug(
    value
      .toLowerCase()
      .replace(/['’]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, ''),
  );
}

function trimSlug(value, maxLength = 70) {
  if (value.length <= maxLength) return value;
  const sliced = value.slice(0, maxLength);
  const boundary = sliced.lastIndexOf('-');
  return (boundary > 40 ? sliced.slice(0, boundary) : sliced).replace(/-+$/g, '');
}

function keystaticDatetime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) {
    throw new Error(`Invalid datetime: ${value}`);
  }

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const read = (type) => parts.find((part) => part.type === type)?.value;
  return `${read('year')}-${read('month')}-${read('day')}T${read('hour')}:${read('minute')}`;
}

function plainText(html) {
  return turndown
    .turndown(html)
    .replace(/\\([\[\]])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function excerptFrom(html, fallback = '') {
  const withoutMedia = html
    .replace(/<img\b[^>]*>/gi, '')
    .replace(/<figure\b[^>]*>[\s\S]*?<\/figure>/gi, '')
    .replace(/<h[1-6]\b[^>]*>[\s\S]*?<\/h[1-6]>/gi, '');
  const firstParagraph = withoutMedia.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i);
  const text = plainText(firstParagraph ? firstParagraph[1] : withoutMedia) || fallback;
  if (text.length <= 240) return text;
  const slice = text.slice(0, 240);
  const boundary = slice.lastIndexOf(' ');
  return `${(boundary > 160 ? slice.slice(0, boundary) : slice).trim()}…`;
}

function expandTruncatedTitle(title, html) {
  const truncated =
    /[…]$/.test(title) ||
    title.endsWith('...') ||
    (title.includes('(') && !title.includes(')'));
  if (!truncated) return title;

  const firstParagraph = html.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i);
  const first = plainText(firstParagraph ? firstParagraph[1] : '');
  const stem = title.replace(/[.…]+$/, '').trim();
  if (!first.toLowerCase().startsWith(stem.toLowerCase().slice(0, 40))) return stem;

  const sentence = first.match(/^[^.!?]+[.!]?/);
  return (sentence ? sentence[0] : first).replace(/[.]$/, '').trim();
}

function extractDek(html) {
  const match = html.match(/^\s*<(h[34])\b[^>]*>([\s\S]*?)<\/\1>/i);
  if (!match) return { html, subtitle: '' };
  const subtitle = plainText(match[2]);
  if (!subtitle || subtitle.length > 180) return { html, subtitle: '' };
  return { html: html.slice(match[0].length), subtitle };
}

function decodeXmlEntities(value) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function titleCaseTag(value) {
  const mapped = {
    ai: 'Artificial Intelligence',
    'artificial-intelligence': 'Artificial Intelligence',
    'gpt-3': 'GPT-3',
    gpt: 'GPT-3',
    'product-management': 'Product Management',
    'web-development': 'Web Development',
    'new-job': 'Personal News',
    announcements: 'Personal News',
    'ipad-pro': 'iPad',
    ipad: 'iPad',
    apple: 'Apple',
    macbook: 'Mac',
    keyboard: 'Gadgets',
  };
  const key = value.trim().toLowerCase();
  if (mapped[key]) return mapped[key];
  return key
    .split(/[-_]/g)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json, application/rss+xml, text/html;q=0.9, */*;q=0.8',
    },
  });
  if (!response.ok) {
    throw new Error(`${url} failed: ${response.status}`);
  }
  return response.text();
}

async function fetchJson(url) {
  return JSON.parse(await fetchText(url));
}

function imageSources(html) {
  return [...html.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)]
    .map((match) => match[1])
    .filter(
      (src) =>
        src &&
        !src.includes('medium.com/_/stat') &&
        !src.includes('/image/youtube/') &&
        !src.startsWith('data:'),
    );
}

function originalImageUrl(rawUrl) {
  const url = new URL(rawUrl.replaceAll('&amp;', '&'));

  if (url.hostname === 'substackcdn.com') {
    const embedded = url.pathname.match(/\/(https?%3A%2F%2F.+)$/i);
    if (embedded) {
      try {
        return decodeURIComponent(embedded[1]);
      } catch {
        return url.toString();
      }
    }
  }

  if (url.hostname.includes('medium.com')) {
    url.search = '';
  }

  return url.toString();
}

function optimizedImageUrl(rawUrl) {
  const url = new URL(rawUrl.replaceAll('&amp;', '&'));

  if (url.hostname === 'substackcdn.com') {
    url.pathname = url.pathname.replace(
      /\/image\/fetch\/[^/]+/,
      '/image/fetch/w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep',
    );
    return url.toString();
  }

  if (url.hostname.startsWith('cdn-images') && url.hostname.endsWith('medium.com')) {
    url.pathname = url.pathname.replace(/\/max\/\d+\//, '/max/1600/');
    return url.toString();
  }

  return url.toString();
}

function assetIdentity(rawUrl) {
  const original = originalImageUrl(rawUrl);
  const url = new URL(original);
  return `url:${url.pathname.replace(/-\d+x\d+(?=\.[^.]+$)/, '')}`;
}

function imageExtension(rawUrl) {
  const url = new URL(originalImageUrl(rawUrl));
  const extension = path.extname(url.pathname).slice(1).toLowerCase();
  if (extension === 'jpeg') return 'jpg';
  if (['jpg', 'png', 'gif', 'webp', 'avif', 'svg'].includes(extension)) return extension;
  return 'jpg';
}

function imageBasename(rawUrl) {
  const url = new URL(originalImageUrl(rawUrl));
  return path
    .basename(url.pathname, path.extname(url.pathname))
    .replace(/-\d+x\d+$/, '')
    .replace(/[^a-z0-9-]+/gi, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 60);
}

async function downloadImage(remoteUrl, outputPath) {
  const candidates = [...new Set([originalImageUrl(remoteUrl), remoteUrl, optimizedImageUrl(remoteUrl)])];
  let lastError;

  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate, {
        headers: { 'User-Agent': USER_AGENT },
      });
      if (!response.ok) {
        lastError = new Error(`Could not download ${candidate}: ${response.status}`);
        continue;
      }
      await writeFile(outputPath, new Uint8Array(await response.arrayBuffer()));
      return;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error(`Could not download ${remoteUrl}`);
}

function cleanHtml(html) {
  let next = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<button\b[^>]*>[\s\S]*?<\/button>/gi, '')
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, '')
    .replace(/<picture\b[^>]*>[\s\S]*?(<img\b[^>]*>)[\s\S]*?<\/picture>/gi, '$1')
    .replace(
      /<img\b[^>]*src="https:\/\/cdn\.substack\.com\/image\/youtube\/[^"]*\/([A-Za-z0-9_-]+)"[^>]*>/gi,
      (_match, id) =>
        `<p><a href="https://www.youtube.com/watch?v=${id}">https://www.youtube.com/watch?v=${id}</a></p>`,
    )
    .replace(
      /<a\b[^>]*href="https:\/\/(?:substackcdn\.com|cdn-images-[^"]+\.medium\.com)[^"]*"[^>]*>[\s\S]*?<img\b[^>]*>[\s\S]*?<\/a>/gi,
      (match) => match.match(/<img\b[^>]*>/i)?.[0] ?? match,
    )
    .replace(/<a\b[^>]*class="[^"]*image-link[^"]*"[^>]*>\s*(<img\b[^>]*>)\s*<\/a>/gi, '$1')
    .replace(/\s+srcset\s*=\s*["'][^"']*["']/gi, '')
    .replace(/\s+sizes\s*=\s*["'][^"']*["']/gi, '')
    .replace(/\s+data-attrs\s*=\s*["'][^"']*["']/gi, '')
    .replace(/<img\b[^>]*medium\.com\/_\/stat[^>]*>/gi, '')
    .replace(/Get [\s\S]*?stories in your inbox[\s\S]*?Remember me for faster sign in/gi, '')
    .replace(/(<br\s*\/?>\s*){2,}/gi, '</p><p>');

  if (!/<p[\s>]/i.test(next) && next.includes('</p><p>')) {
    next = `<p>${next}</p>`;
  }

  return next;
}

function frontmatter({
  title,
  description,
  publishedAt,
  updatedAt,
  topic,
  tags,
  subtitle,
  featuredImage,
  featuredImageAlt,
  sourceUrl,
}) {
  const fields = [
    '---',
    `title: ${yamlString(title)}`,
    `description: ${yamlString(description)}`,
    `publishedAt: ${yamlString(publishedAt)}`,
  ];

  if (updatedAt && updatedAt !== publishedAt) {
    fields.push(`updatedAt: ${yamlString(updatedAt)}`);
  }

  fields.push('draft: false');
  fields.push(`topic: ${yamlString(topic)}`);
  if (tags.length === 0) {
    fields.push('tags: []');
  } else {
    fields.push('tags:');
    for (const tag of tags) fields.push(`  - ${yamlString(tag)}`);
  }
  fields.push('format: "standard"');
  if (subtitle) fields.push(`subtitle: ${yamlString(subtitle)}`);
  if (featuredImage) {
    fields.push(`featuredImage: ${yamlString(featuredImage)}`);
    fields.push(`featuredImageAlt: ${yamlString(featuredImageAlt ?? '')}`);
  }
  fields.push(`sourceUrl: ${yamlString(sourceUrl)}`);
  fields.push('---');
  return fields.join('\n');
}

async function loadExistingPosts() {
  const files = (await readdir(contentDirectory)).filter((name) => name.endsWith('.mdoc'));
  const slugs = new Set();
  const titles = new Set();
  const wordpressSlugs = new Set();

  for (const filename of files) {
    const slug = filename.replace(/\.mdoc$/, '');
    slugs.add(slug);
    const text = await readFile(path.join(contentDirectory, filename), 'utf8');
    const title = text.match(/^title: (.+)$/m);
    if (title) titles.add(normalizeTitle(parseYamlScalar(title[1])));
    if (/^wordpressId: /m.test(text)) wordpressSlugs.add(slug);
  }

  return { slugs, titles, wordpressSlugs };
}

function skipReason(existing, { slug, title }) {
  const normalized = normalizeTitle(title);
  if (existing.wordpressSlugs.has(slug)) return 'wordpress';
  if (normalized && existing.titles.has(normalized) && !existing.slugs.has(slug)) {
    return 'title';
  }
  if (existing.slugs.has(slug) && !force) return 'slug';
  return undefined;
}

async function writePost(existing, entry) {
  const {
    slug,
    title,
    html,
    description,
    publishedAt,
    updatedAt,
    subtitle,
    sourceUrl,
    sourceTag,
    importedTags = [],
    coverUrl,
  } = entry;

  const reason = skipReason(existing, { slug, title });
  if (reason) {
    console.log(`Skipped ${title} (${slug}) — existing ${reason}`);
    return 'skipped';
  }

  const postImageDirectory = path.join(imageDirectory, slug);
  const cleaned = cleanHtml(html);
  const sources = imageSources(cleaned);
  const assetPaths = new Map();
  let featuredFilename;
  let featuredImageAlt = '';

  const coverIdentity = coverUrl ? assetIdentity(coverUrl) : undefined;
  const allSources = coverUrl ? [coverUrl, ...sources] : sources;

  for (const source of allSources) {
    if (source.includes('/image/youtube/')) continue;
    const identity = assetIdentity(source);
    if (assetPaths.has(identity)) continue;

    const extension = imageExtension(source);
    const isCover = identity === coverIdentity;
    const filename = isCover
      ? `featuredImage.${extension}`
      : `${imageBasename(source)}.${extension}`;

    await mkdir(postImageDirectory, { recursive: true });
    try {
      await downloadImage(source, path.join(postImageDirectory, filename));
      assetPaths.set(identity, `@assets/images/posts/${slug}/${filename}`);
      if (isCover) {
        featuredFilename = filename;
        featuredImageAlt = '';
      }
    } catch (error) {
      console.warn(`Keeping remote image for ${slug}: ${error.message}`);
    }
  }

  const rewrittenHtml = cleaned.replace(
    /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi,
    (tag, source) => {
      const localSource = assetPaths.get(assetIdentity(source));
      if (!localSource) return tag;
      return tag.replace(source, localSource);
    },
  );

  const body = turndown
    .turndown(rewrittenHtml)
    .replace(/\\([\[\]])/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const { topic, tags } = classifyEntry({
    slug,
    title,
    description,
    tags: [sourceTag, ...importedTags],
  });
  const featuredImage = featuredFilename
    ? `@assets/images/posts/${slug}/${featuredFilename}`
    : undefined;
  const document = `${frontmatter({
    title,
    description,
    publishedAt,
    updatedAt,
    topic,
    tags,
    subtitle,
    featuredImage,
    featuredImageAlt,
    sourceUrl,
  })}\n\n${body}\n`;

  await writeFile(path.join(contentDirectory, `${slug}.mdoc`), document);
  existing.slugs.add(slug);
  existing.titles.add(normalizeTitle(title));
  console.log(`Imported ${title} (${slug})`);
  return 'imported';
}

async function fetchSubstackPosts() {
  const archive = await fetchJson(
    `${SUBSTACK_ORIGIN}/api/v1/archive?sort=new&limit=50`,
  );
  if (!Array.isArray(archive)) {
    throw new Error('Unexpected Substack archive response');
  }

  const posts = [];
  for (const item of archive) {
    const slug = item.slug;
    if (!slug) continue;
    const post = await fetchJson(`${SUBSTACK_ORIGIN}/api/v1/posts/${slug}`);
    const html = post.body_html || '';
    const subtitle = (post.subtitle || '').trim();
    const description = (
      post.search_engine_description ||
      subtitle ||
      excerptFrom(html, post.title)
    ).trim();

    posts.push({
      slug,
      title: post.title,
      html,
      description,
      publishedAt: keystaticDatetime(post.post_date),
      updatedAt: post.updated_at ? keystaticDatetime(post.updated_at) : undefined,
      subtitle,
      sourceUrl: post.canonical_url || `${SUBSTACK_ORIGIN}/p/${slug}`,
      sourceTag: 'From Substack',
      coverUrl: post.cover_image || undefined,
    });
    console.log(`Fetched Substack post ${posts.length}/${archive.length}: ${slug}`);
  }

  return posts;
}

function parseRssItems(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((match) => {
    const item = match[1];
    const read = (tag) => {
      const tagged = item.match(
        new RegExp(`<${tag}(?:\\s[^>]*)?>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))</${tag}>`),
      );
      return tagged ? decodeXmlEntities((tagged[1] ?? tagged[2] ?? '').trim()) : '';
    };
    const encoded = item.match(
      /<content:encoded>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))<\/content:encoded>/,
    );
    const categories = [...item.matchAll(/<category>(?:<!\[CDATA\[(.*?)\]\]>|(.*?))<\/category>/g)]
      .map((category) => decodeXmlEntities((category[1] ?? category[2] ?? '').trim()))
      .filter(Boolean);

    return {
      title: read('title'),
      url: read('link').split('?')[0],
      publishedAt: read('pubDate') || read('dc:date'),
      html: encoded ? decodeXmlEntities(encoded[1] ?? encoded[2] ?? '') : '',
      categories,
    };
  });
}

function mediumSlugFromUrl(url, title) {
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop() ?? '';
    const withoutHash = last.replace(/-[0-9a-f]{8,}$/i, '');
    if (withoutHash && withoutHash !== 'series') return trimSlug(withoutHash);
  } catch {
    // Fall through to the title slug.
  }
  return slugify(title);
}

async function fetchMediumPosts() {
  const seen = new Set();
  const posts = [];

  for (const feed of MEDIUM_FEEDS) {
    const xml = await fetchText(feed);
    const items = parseRssItems(xml);
    console.log(`Fetched Medium feed ${feed} (${items.length} items)`);

    for (const item of items) {
      if (!item.url || seen.has(item.url)) continue;
      seen.add(item.url);

      const title = expandTruncatedTitle(item.title.trim(), item.html);
      const extracted = extractDek(item.html);
      const subtitle =
        extracted.subtitle &&
        normalizeTitle(extracted.subtitle) !== normalizeTitle(title)
          ? extracted.subtitle
          : '';
      const html = extracted.html;
      const cover = imageSources(html)[0];
      posts.push({
        slug: mediumSlugFromUrl(item.url, title),
        title,
        html,
        description: excerptFrom(html, title),
        publishedAt: keystaticDatetime(item.publishedAt),
        subtitle,
        sourceUrl: item.url,
        sourceTag: 'From Medium',
        importedTags: item.categories.map(titleCaseTag),
        coverUrl: cover,
      });
    }
  }

  let extras = [];
  try {
    extras = JSON.parse(await readFile(extrasPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  for (const extra of extras) {
    if (!extra.url || seen.has(extra.url)) continue;
    seen.add(extra.url);
    posts.push({
      slug: extra.slug || mediumSlugFromUrl(extra.url, extra.title),
      title: extra.title,
      html: extra.html,
      description: extra.description || excerptFrom(extra.html, extra.title),
      publishedAt: keystaticDatetime(extra.publishedAt),
      subtitle: extra.subtitle || '',
      sourceUrl: extra.url,
      sourceTag: 'From Medium',
      importedTags: extra.tags ?? [],
      coverUrl: extra.coverUrl,
    });
  }

  for (const url of MEDIUM_EXTRA_URLS) {
    if (seen.has(url)) continue;
    try {
      const html = await fetchText(url);
      console.warn(`Fetched extra Medium URL without a local extra: ${url} (${html.length} bytes)`);
    } catch (error) {
      console.warn(`Could not fetch extra Medium URL ${url}: ${error.message}`);
    }
  }

  return posts;
}

await mkdir(contentDirectory, { recursive: true });
await mkdir(imageDirectory, { recursive: true });

const existing = await loadExistingPosts();
const results = { imported: 0, skipped: 0, failed: 0 };
const failures = [];
const queue = [];

if (importSubstack) queue.push(...(await fetchSubstackPosts()));
if (importMedium) queue.push(...(await fetchMediumPosts()));

for (const entry of queue) {
  try {
    const result = await writePost(existing, entry);
    results[result] += 1;
  } catch (error) {
    results.failed += 1;
    failures.push(`${entry.slug}: ${error.message}`);
    console.error(`Failed ${entry.slug}: ${error.message}`);
  }
}

console.log(
  `Done. Imported ${results.imported}, skipped ${results.skipped}, failed ${results.failed} of ${queue.length} posts.`,
);

if (failures.length > 0) {
  throw new Error(`Failed to import ${failures.length} posts:\n${failures.join('\n')}`);
}
