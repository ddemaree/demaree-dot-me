import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import TurndownService from 'turndown';

const siteUrl = 'https://demaree.me';
const force = process.argv.includes('--force');
const selectedSlugs = [
  'hey-siri-call-google',
  'betterdisplay-mac-display-manager',
  'where-the-web-fonts-go',
];

const featuredImageAltOverrides = {
  'betterdisplay-mac-display-manager': 'BetterDisplay settings window on macOS',
};

const inlineImageAltOverrides = {
  'screenshot-do-panel-403420ea6':
    'DigitalOcean control panel for configuring Spaces',
  'screenshot-transmit-webfonts-4036c6cad': 'Web font files in Transmit',
  'screenshot-webfont-code-nova-403814577':
    'Hugo template code for loading CDN-hosted web fonts',
};

const root = process.cwd();
const contentDirectory = path.join(root, 'src/content/posts');
const imageDirectory = path.join(root, 'src/assets/images/posts');

const turndown = new TurndownService({
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  emDelimiter: '*',
  headingStyle: 'atx',
  strongDelimiter: '**',
});

turndown.remove(['script', 'style']);
turndown.addRule('figureCaption', {
  filter: 'figcaption',
  replacement(content) {
    return content.trim() ? `\n\n*${content.trim()}*\n\n` : '';
  },
});

function plainText(html) {
  return turndown
    .turndown(html)
    .replace(/\\([\[\]])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function yamlString(value) {
  return JSON.stringify(value);
}

function keystaticDatetime(value) {
  const match = value?.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
  if (!match) throw new Error(`Invalid WordPress datetime: ${value}`);
  return match[0];
}

function assetIdentity(rawUrl) {
  const url = new URL(rawUrl.replaceAll('&amp;', '&'));
  const cloudinaryVersion = url.pathname.match(/\/v\d+\/(.+)$/);

  if (cloudinaryVersion) return `cloudinary:${cloudinaryVersion[1]}`;

  return `url:${url.pathname.replace(/-\d+x\d+(?=\.[^.]+$)/, '')}`;
}

function optimizedUrl(rawUrl) {
  const url = new URL(rawUrl.replaceAll('&amp;', '&'));

  if (url.hostname === 'res.cloudinary.com') {
    url.pathname = url.pathname.replace(
      /^\/demaree\/images\/.*?(?=\/v\d+\/)/,
      '/demaree/images/w_1600,c_limit/f_webp,q_auto',
    );
    return url.toString();
  }

  return url.toString();
}

function imageExtension(rawUrl) {
  const url = new URL(rawUrl.replaceAll('&amp;', '&'));
  if (url.hostname === 'res.cloudinary.com') return 'webp';

  const extension = path.extname(url.pathname).slice(1).toLowerCase();
  return extension === 'jpeg' ? 'jpg' : extension || 'bin';
}

function imageBasename(rawUrl) {
  const url = new URL(rawUrl.replaceAll('&amp;', '&'));
  return path
    .basename(url.pathname, path.extname(url.pathname))
    .replace(/-\d+x\d+$/, '')
    .replace(/[^a-z0-9-]+/gi, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

function imageSources(html) {
  return [...html.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)].map(
    (match) => match[1],
  );
}

async function downloadImage(remoteUrl, outputPath) {
  const response = await fetch(optimizedUrl(remoteUrl));
  if (!response.ok) {
    throw new Error(`Could not download ${remoteUrl}: ${response.status}`);
  }

  await writeFile(outputPath, new Uint8Array(await response.arrayBuffer()));
}

function frontmatter(post, featuredImage, featuredImageAlt, tags) {
  const fields = [
    '---',
    `title: ${yamlString(plainText(post.title.rendered))}`,
    `description: ${yamlString(plainText(post.excerpt.rendered))}`,
    `publishedAt: ${yamlString(keystaticDatetime(post.date))}`,
  ];

  if (post.modified && post.modified !== post.date) {
    fields.push(`updatedAt: ${yamlString(keystaticDatetime(post.modified))}`);
  }

  fields.push('draft: false');
  if (tags.length === 0) {
    fields.push('tags: []');
  } else {
    fields.push('tags:');
    for (const tag of tags) fields.push(`  - ${yamlString(tag)}`);
  }
  fields.push(`featuredImage: ${yamlString(featuredImage)}`);
  fields.push(`featuredImageAlt: ${yamlString(featuredImageAlt)}`);
  fields.push(`wordpressId: ${post.id}`);
  fields.push(`sourceUrl: ${yamlString(post.link)}`);
  fields.push('---');

  return fields.join('\n');
}

async function importPost(post) {
  const slug = post.slug;
  const contentPath = path.join(contentDirectory, `${slug}.mdoc`);

  if (!force) {
    try {
      await access(contentPath);
      throw new Error(
        `${contentPath} already exists. Rerun with --force only if you intend to replace local edits.`,
      );
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  const postImageDirectory = path.join(imageDirectory, slug);
  await mkdir(postImageDirectory, { recursive: true });

  const featuredMedia = post._embedded?.['wp:featuredmedia']?.[0];
  if (!featuredMedia?.source_url) {
    throw new Error(`${slug} does not have a featured image`);
  }

  const featuredIdentity = assetIdentity(featuredMedia.source_url);
  const sources = imageSources(post.content.rendered);
  const matchingInlineSource = sources.find(
    (source) => assetIdentity(source) === featuredIdentity,
  );
  const featuredRemoteUrl = matchingInlineSource ?? featuredMedia.source_url;
  const featuredExtension = imageExtension(featuredRemoteUrl);
  const featuredFilename = `featuredImage.${featuredExtension}`;
  const featuredOutput = path.join(postImageDirectory, featuredFilename);
  await downloadImage(featuredRemoteUrl, featuredOutput);

  const assetPaths = new Map([
    [
      featuredIdentity,
      `@assets/images/posts/${slug}/${featuredFilename}`,
    ],
  ]);

  for (const source of sources) {
    const identity = assetIdentity(source);
    if (assetPaths.has(identity)) continue;

    const extension = imageExtension(source);
    const filename = `${imageBasename(source)}.${extension}`;
    await downloadImage(source, path.join(postImageDirectory, filename));
    assetPaths.set(identity, `@assets/images/posts/${slug}/${filename}`);
  }

  const featuredImageAlt =
    featuredImageAltOverrides[slug] ?? featuredMedia.alt_text?.trim() ?? '';
  const legacyExternalLink = new RegExp(
    `https://demaree\\.me/p/${slug}/(?=(?:www\\.)?[a-z0-9.-]+\\.[a-z]{2,})`,
    'gi',
  );
  const normalizedHtml = post.content.rendered.replace(legacyExternalLink, 'https://');
  let removedBodyFeaturedImage = false;
  const rewrittenHtml = normalizedHtml.replace(
    /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi,
    (tag, source) => {
      const identity = assetIdentity(source);
      const localSource = assetPaths.get(identity);
      if (!localSource) return tag;

      if (identity === featuredIdentity && !removedBodyFeaturedImage) {
        removedBodyFeaturedImage = true;
        return '';
      }

      let rewritten = tag
        .replace(/\s+srcset\s*=\s*["'][^"']*["']/i, '')
        .replace(/\s+sizes\s*=\s*["'][^"']*["']/i, '')
        .replace(source, localSource);

      const inlineAlt = inlineImageAltOverrides[imageBasename(source)];
      if (inlineAlt && /\balt\s*=\s*["']\s*["']/i.test(rewritten)) {
        rewritten = rewritten.replace(
          /\balt\s*=\s*["']\s*["']/i,
          `alt="${inlineAlt}"`,
        );
      }

      if (
        identity === featuredIdentity &&
        featuredImageAlt &&
        /\balt\s*=\s*["']\s*["']/i.test(rewritten)
      ) {
        rewritten = rewritten.replace(
          /\balt\s*=\s*["']\s*["']/i,
          `alt="${featuredImageAlt.replaceAll('"', '&quot;')}"`,
        );
      }

      return rewritten;
    },
  );

  const body = turndown
    .turndown(rewrittenHtml)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const tags = (post._embedded?.['wp:term'] ?? [])
    .flat()
    .filter((term) => term.taxonomy === 'post_tag')
    .map((term) => term.name);
  const featuredImage = `@assets/images/posts/${slug}/${featuredFilename}`;
  const document = `${frontmatter(
    post,
    featuredImage,
    featuredImageAlt,
    tags,
  )}\n\n${body}\n`;

  await writeFile(contentPath, document);
  console.log(`Imported ${post.title.rendered} (${slug})`);
}

await mkdir(contentDirectory, { recursive: true });
await mkdir(imageDirectory, { recursive: true });

const endpoint = new URL('/wp-json/wp/v2/posts', siteUrl);
endpoint.searchParams.set('slug', selectedSlugs.join(','));
endpoint.searchParams.set('per_page', String(selectedSlugs.length));
endpoint.searchParams.set('_embed', '1');

const response = await fetch(endpoint);
if (!response.ok) {
  throw new Error(`WordPress request failed: ${response.status}`);
}

const posts = await response.json();
if (posts.length !== selectedSlugs.length) {
  throw new Error(`Expected ${selectedSlugs.length} posts, received ${posts.length}`);
}

for (const slug of selectedSlugs) {
  const post = posts.find((candidate) => candidate.slug === slug);
  if (!post) throw new Error(`WordPress did not return ${slug}`);
  await importPost(post);
}
