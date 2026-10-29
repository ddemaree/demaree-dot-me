#!/usr/bin/env node
/**
 * Import Markdoc posts through EmDash's authenticated REST API.
 * Dry-run is the default and does not connect to a CMS or modify local files.
 *
 * Sample: node scripts/import-emdash.mjs
 * All:    node scripts/import-emdash.mjs --all
 * Local:  node scripts/import-emdash.mjs --all --apply
 * Serial: node scripts/import-emdash.mjs --all --apply --concurrency=1
 * Remote: pnpm login:emdash --url https://the-experiment.workers.dev
 *         node scripts/import-emdash.mjs --all --target=https://the-experiment.workers.dev --apply
 * EMDASH_API_TOKEN / EMDASH_TOKEN can supply a PAT instead of CLI credentials.
 * Credentials stay in memory and are never written to import manifests.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { validateSeed } from 'emdash/seed';
import { parseContentDate } from '../src/lib/dates.mjs';
import { collectPostImages, convertMarkdoc, loadPosts } from './lib/emdash-convert.mjs';
import { loadOAuthCredential, refreshOAuthCredential, validBearerToken } from './lib/emdash-auth.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const sampleSlugs = [
  'hey-siri-call-google',
  '1-finishing-things-in-an-uncertain',
  'fuji-x100v-camera-review',
  'parcel-post',
  'ageism-really',
  'how-valid-is-the-implied-legal-advice-in-jay-zs',
  'iphone-os-four',
  'test-content',
];
const hash = (value) => createHash('sha256').update(value).digest('hex');
const stableJson = (value) => JSON.stringify(value, (_key, item) =>
  item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right))) : item);
function containsExpected(actual, expected) {
  if (!expected || typeof expected !== 'object' || Array.isArray(expected)) return isDeepStrictEqual(actual, expected);
  return actual && typeof actual === 'object'
    && Object.entries(expected).every(([key, value]) => containsExpected(actual[key], value));
}
const apiPath = (collection, id = '') =>
  `/content/${encodeURIComponent(collection)}${id ? `/${encodeURIComponent(id)}` : ''}`;
const tagSlug = (label) => label.normalize('NFKD').replace(/\p{Diacritic}/gu, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function runConcurrent(entries, concurrency, action) {
  let next = 0;
  let failed = false;
  let failure;
  await Promise.all(Array.from({ length: Math.min(concurrency, entries.length) }, async () => {
    while (!failed && next < entries.length) {
      const entry = entries[next++];
      try { await action(entry); }
      catch (error) {
        if (!failed) { failed = true; failure = error; }
      }
    }
  }));
  // Let work already in flight finish and save its checkpoints before failing.
  if (failed) throw failure;
}

async function options() {
  const { values } = parseArgs({ options: {
    all: { type: 'boolean', default: false },
    apply: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    update: { type: 'boolean', default: false },
    concurrency: { type: 'string', default: '4' },
    target: { type: 'string' },
    slugs: { type: 'string' },
    help: { type: 'boolean', default: false },
  } });
  if (values.help) {
    console.log('Usage: node scripts/import-emdash.mjs [--apply] [--update] [--target=URL] [--all | --slugs=slug,slug] [--concurrency=4]\n'
      + 'Default: dry-run of eight representative posts. --all selects every source post, including drafts.\n'
      + '--all and --slugs cannot be combined. --update explicitly allows replacing a changed imported entry.\n'
      + '--concurrency accepts 1–8 workers (default 4); 1 preserves sequential operation.\n'
      + 'External targets require an explicit --target and existing EmDash CLI credentials or EMDASH_API_TOKEN.');
    process.exit(0);
  }
  if (values.apply && values['dry-run']) throw new Error('Choose --apply or --dry-run, not both.');
  if (values.all && values.slugs !== undefined) throw new Error('Choose --all or --slugs, not both.');
  const concurrency = Number(values.concurrency);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) {
    throw new Error('--concurrency must be an integer from 1 to 8.');
  }
  const target = new URL(values.target ?? 'http://localhost:4321');
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password
    || target.search || target.hash || !['', '/'].includes(target.pathname)) {
    throw new Error('--target must be an HTTP(S) origin without a path, credentials, query, or fragment.');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname);
  if (!local && target.protocol !== 'https:') throw new Error('External targets must use HTTPS.');
  const slugs = values.all ? (await loadPosts({ root })).map((post) => post.slug)
    : values.slugs ? values.slugs.split(',').filter(Boolean) : sampleSlugs;
  if (!slugs.length || new Set(slugs).size !== slugs.length
    || slugs.some((slug) => !/^[a-z0-9][a-z0-9-]*$/.test(slug))) {
    throw new Error('--slugs must contain unique comma-separated post slugs.');
  }
  return { apply: values.apply, update: values.update, concurrency, target: target.origin, local, slugs };
}

async function readJson(filename, fallback) {
  try { return JSON.parse(await readFile(filename, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT' && fallback !== undefined) return fallback; throw error; }
}

async function makePlan(slugs) {
  const seed = await readJson(path.join(root, 'seed/emdash-poc.json'));
  const validation = validateSeed(seed);
  if (!validation.valid) throw new Error(`Invalid EmDash seed: ${validation.errors.join('; ')}`);
  const converterHash = hash(await readFile(path.join(root, 'scripts/lib/emdash-convert.mjs')));
  const posts = await loadPosts({ root, slugs });
  const missing = slugs.filter((slug) => !posts.some((post) => post.slug === slug));
  if (missing.length) throw new Error(`Missing source posts: ${missing.join(', ')}`);
  const images = new Map();
  const topics = new Map();
  const tags = new Map();
  for (const post of posts) {
    post.publishedAt = parseContentDate(post.data.publishedAt).toISOString();
    post.updatedAt = post.data.updatedAt ? parseContentDate(post.data.updatedAt).toISOString() : null;
    if (!post.data.title || typeof post.data.draft !== 'boolean') {
      throw new Error(`${post.slug}: title and draft are required.`);
    }
    const imageSources = collectPostImages(post).map((image) => typeof image === 'string' ? image : image.src);
    for (const src of new Set(imageSources)) {
      if (images.has(src)) continue;
      if (!src?.startsWith('@assets/images/posts/')) {
        throw new Error(`${post.slug}: only repository post-image aliases are supported, found ${src}.`);
      }
      const filename = path.resolve(root, 'src/assets', src.slice('@assets/'.length));
      const imagesRoot = path.join(root, 'src/assets/images/posts') + path.sep;
      if (!filename.startsWith(imagesRoot)) throw new Error(`Image escapes post asset directory: ${src}`);
      const bytes = await readFile(filename);
      images.set(src, { src, filename, bytes, hash: hash(bytes) });
    }
    if (post.data.topic && !topics.has(post.data.topic)) {
      if (!/^[a-z0-9-]+$/.test(post.data.topic)) throw new Error(`Invalid topic: ${post.data.topic}`);
      const topicFile = path.join(root, 'src/content/topics', `${post.data.topic}.yaml`);
      const source = await readFile(topicFile, 'utf8');
      topics.set(post.data.topic, { slug: post.data.topic, data: parseYaml(source), hash: hash(source) });
    }
    for (const label of post.data.tags ?? []) {
      const slug = tagSlug(label);
      if (!slug) throw new Error(`Cannot create a tag slug for ${label}`);
      if (tags.has(slug) && tags.get(slug) !== label) throw new Error(`Tag slug collision: ${label}`);
      tags.set(slug, label);
    }
    const source = await readFile(post.path);
    post.importHash = hash(JSON.stringify({ version: 1, source: hash(source), converterHash,
      seedHash: hash(JSON.stringify(seed)), images: imageSources.map((src) => [src, images.get(src).hash]) }));
    const converted = await convertMarkdoc(post.body, { slug: post.slug, resolveImage: async (src) => {
      const image = images.get(src);
      if (!image) throw new Error(`Unplanned image: ${src}`);
      return { _ref: `dry-run-${image.hash.slice(0, 16)}`, url: `/dry-run/${path.basename(image.filename)}` };
    } });
    post.diagnostics = converted.diagnostics;
    post.blockCount = converted.blocks.length;
    console.log(`${post.data.draft ? 'draft    ' : 'published'} ${post.slug}: ${post.blockCount} blocks, `
      + `${new Set(imageSources).size} images, ${post.publishedAt}`);
    for (const diagnostic of converted.diagnostics) {
      console.log(`  ${diagnostic.severity ?? 'warning'}: ${diagnostic.message ?? JSON.stringify(diagnostic)}`);
    }
  }
  return { seed, posts, images, topics, tags };
}

class Api {
  constructor(target, credential) {
    if (credential.accessToken && !validBearerToken(credential.accessToken)) {
      throw new Error('EmDash API credential is invalid; log in again or check the token environment variable.');
    }
    this.target = target;
    this.credential = credential;
  }
  async request(method, endpoint, body, optional = false) {
    let headers;
    try { headers = new Headers(this.credential.customHeaders ?? {}); }
    catch { throw new Error('Stored EmDash request headers are invalid; their contents were not printed.'); }
    if (this.credential.accessToken) headers.set('Authorization', `Bearer ${this.credential.accessToken}`);
    if (this.credential.cookie) headers.set('Cookie', this.credential.cookie);
    if (method !== 'GET') {
      headers.set('X-EmDash-Request', '1');
      headers.set('Origin', this.target);
    }
    if (body !== undefined && !(body instanceof FormData)) headers.set('Content-Type', 'application/json');
    const response = await fetch(`${this.target}/_emdash/api${endpoint}`, {
      method, headers, body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual', signal: AbortSignal.timeout(60_000),
    });
    const contentType = response.headers.get('content-type') ?? '';
    const payload = contentType.includes('json') ? await response.json() : null;
    if (optional && response.status === 404 && payload?.error?.code === 'NOT_FOUND') return null;
    if (!response.ok || !payload?.success) {
      const detail = payload?.error ? `${payload.error.code}: ${payload.error.message}` : 'non-JSON response';
      throw new Error(`${method} ${endpoint}: HTTP ${response.status}, ${detail}`);
    }
    return payload.data;
  }
  async get(collection, slug) {
    return this.request('GET', apiPath(collection, slug), undefined, true);
  }
}

async function authenticate(config) {
  const envToken = process.env.EMDASH_API_TOKEN ?? process.env.EMDASH_TOKEN;
  if (envToken) return { accessToken: envToken };
  if (config.local) {
    // This route is built into EmDash and rejects all production requests.
    const response = await fetch(`${config.target}/_emdash/api/setup/dev-bypass?content=0&token=1`, {
      redirect: 'manual', signal: AbortSignal.timeout(60_000),
    });
    const payload = await response.json();
    if (!response.ok || !payload.success || !payload.data.token) {
      throw new Error('Local development setup failed. Run an EmDash development server; production requires a real administrator.');
    }
    console.log('Local EmDash schema and development administrator initialized.');
    return { accessToken: payload.data.token };
  }
  const stored = await loadOAuthCredential(config.target);
  if (!stored?.accessToken) {
    throw new Error(`No EmDash credentials for ${config.target}. Complete its admin setup, then run pnpm login:emdash --url ${config.target}.`);
  }
  if (stored.expiresAt && new Date(stored.expiresAt).valueOf() <= Date.now() + 30_000) {
    const refreshed = await refreshOAuthCredential(config.target, stored);
    return { accessToken: refreshed.accessToken, customHeaders: stored.customHeaders };
  }
  return { accessToken: stored.accessToken, customHeaders: stored.customHeaders };
}

async function assertSchema(api, seed, concurrency) {
  const checks = seed.collections.map((collection) => async () => {
    const { item } = await api.request('GET', `/schema/collections/${collection.slug}?includeFields=true`);
    for (const field of collection.fields) {
      const actual = item.fields.find((candidate) => candidate.slug === field.slug);
      if (!actual || actual.type !== field.type) throw new Error(`Target schema mismatch: ${collection.slug}.${field.slug}`);
    }
  });
  checks.push(async () => {
    const definitions = await api.request('GET', '/taxonomies');
    if (!definitions.taxonomies.some((taxonomy) => taxonomy.name === 'tag')) throw new Error('Target is missing tag taxonomy.');
  });
  await runConcurrent(checks, concurrency, (check) => check());
}

function postData(post, blocks, featured) {
  return {
    title: post.data.title,
    description: post.data.description ?? '',
    subtitle: post.data.subtitle ?? '',
    content: blocks,
    format: post.data.format ?? 'standard',
    link_url: post.data.linkUrl ?? null,
    featured_image: featured ?? null,
    featured_image_alt: post.data.featuredImageAlt ?? '',
    tags: post.data.tags ?? [],
    draft: post.data.draft,
    wordpress_id: post.data.wordpressId ?? null,
    source_url: post.data.sourceUrl ?? null,
    original_published_at: post.publishedAt,
    original_updated_at: post.updatedAt,
    original_metadata: post.data,
    import_hash: post.importHash,
  };
}

function imageValue(media, alt = '') {
  return { provider: 'local', id: media.id, alt, width: media.width, height: media.height,
    mimeType: media.mimeType, filename: media.filename, meta: { storageKey: media.storageKey } };
}

async function apply(config, plan) {
  const api = new Api(config.target, await authenticate(config));
  await assertSchema(api, plan.seed, config.concurrency);
  const manifestPath = path.join(root, '.emdash/imports', `${hash(config.target).slice(0, 20)}.json`);
  const manifest = await readJson(manifestPath, { version: 1, target: config.target, posts: {}, topics: {}, media: {} });
  if (manifest.version !== 1 || manifest.target !== config.target) throw new Error('Import manifest target mismatch.');
  let manifestWrites = Promise.resolve();
  const saveManifest = () => {
    manifestWrites = manifestWrites.catch(() => {}).then(async () => {
      await mkdir(path.dirname(manifestPath), { recursive: true });
      const temporary = `${manifestPath}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
      await rename(temporary, manifestPath);
    });
    return manifestWrites;
  };
  const existingPosts = new Map();
  const existingTopics = new Map();
  // Check every conflicting slug before the first content or media write.
  const preflight = [
    ['posts', plan.posts, existingPosts], ['topics', [...plan.topics.values()], existingTopics],
  ].flatMap(([collection, entries, found]) => entries.map((entry) => ({ collection, entry, found })));
  await runConcurrent(preflight, config.concurrency, async ({ collection, entry, found }) => {
    const response = await api.get(collection, entry.slug);
    const current = response?.item;
    if (current && !current.data.import_hash) throw new Error(`Refusing to replace untracked ${collection}/${entry.slug}.`);
    const expectedHash = entry.importHash ?? entry.hash;
    if (current && current.data.import_hash !== expectedHash && !config.update) {
      throw new Error(`${collection}/${entry.slug} changed since its import. Review the dry-run and pass --update to replace it.`);
    }
    const importedContentHash = collection === 'posts' ? manifest.posts[entry.slug]?.contentHash : undefined;
    if (current && importedContentHash && importedContentHash !== hash(stableJson(current.data.content)) && !config.update) {
      throw new Error(`${entry.slug} was edited in EmDash after import; its content is preserved. Review it before passing --update.`);
    }
    found.set(entry.slug, response);
  });

  for (const topic of plan.topics.values()) {
    const current = existingTopics.get(topic.slug);
    if (current?.item.data.import_hash === topic.hash && current.item.status === 'published') {
      topic.id = current.item.id;
    } else {
      const body = { data: { title: topic.data.title, description: topic.data.description,
        in_nav: topic.data.inNav ?? false, nav_order: topic.data.navOrder ?? 0, import_hash: topic.hash } };
      const saved = await api.request(current ? 'PUT' : 'POST', apiPath('topics', current?.item.id), {
        ...body, ...(current ? { _rev: current._rev } : { slug: topic.slug, status: 'draft' }),
      });
      topic.id = saved.item.id;
      await api.request('POST', `${apiPath('topics', topic.id)}/publish`);
      console.log(`Imported topic ${topic.slug}.`);
    }
    manifest.topics[topic.slug] = { id: topic.id, hash: topic.hash };
    await saveManifest();
  }

  const terms = await api.request('GET', '/taxonomies/tag/terms?includeCounts=false');
  const termLabels = new Map(terms.terms.map((term) => [term.slug, term.label]));
  for (const [slug, label] of plan.tags) {
    if (termLabels.has(slug) && termLabels.get(slug) !== label) throw new Error(`Target tag label collision: ${slug}`);
    if (!termLabels.has(slug)) await api.request('POST', '/taxonomies/tag/terms', { slug, label });
  }

  const uploaded = new Map();
  async function upload(src, { alt = '' } = {}) {
    if (!uploaded.has(src)) uploaded.set(src, uploadOnce(src, alt));
    return uploaded.get(src);
  }
  async function uploadOnce(src, alt) {
    const image = plan.images.get(src);
    if (!image) throw new Error(`Unplanned image: ${src}`);
    const cacheKey = `${src}:${image.hash}`;
    let media = manifest.media[cacheKey];
    if (media) {
      const stillExists = await api.request('GET', `/media/${encodeURIComponent(media.id)}`, undefined, true);
      media = stillExists?.item;
    }
    if (!media) {
      const contentType = ({ '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
        '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif' })[path.extname(image.filename).toLowerCase()];
      if (!contentType) throw new Error(`Unsupported post image extension: ${image.filename}`);
      const form = new FormData();
      form.set('file', new Blob([image.bytes], { type: contentType }), path.basename(image.filename));
      form.set('deduplicate', 'true');
      form.set('alt', alt);
      media = (await api.request('POST', '/media', form)).item;
      if (!media.id || !media.storageKey) throw new Error(`Upload lacks a media ID/storage key: ${src}`);
      // The multipart uploader does not persist alt text in EmDash 1.1.0.
      // Keep it on each content reference and on the library record as well.
      if (alt && media.alt !== alt) {
        media = (await api.request('PUT', `/media/${encodeURIComponent(media.id)}`, { alt })).item;
      }
      manifest.media[cacheKey] = media;
      await saveManifest();
      console.log(`Uploaded ${src}.`);
    }
    return media;
  }

  let imported = 0;
  let skipped = 0;
  async function preparePost(post) {
    const converted = await convertMarkdoc(post.body, { slug: post.slug, resolveImage: async (src, context) => {
      const media = await upload(src, context);
      return { _ref: media.id, url: `/_emdash/api/media/file/${media.storageKey}`, width: media.width, height: media.height };
    } });
    const featured = post.data.featuredImage ? imageValue(await upload(post.data.featuredImage,
      { alt: post.data.featuredImageAlt }), post.data.featuredImageAlt) : undefined;
    return { converted, data: postData(post, converted.blocks, featured) };
  }
  await runConcurrent(plan.posts, config.concurrency, async (post) => {
    const current = existingPosts.get(post.slug);
    const expectedStatus = post.data.draft ? 'draft' : 'published';
    const previous = manifest.posts[post.slug];
    const contentEdited = current && previous?.contentHash
      && previous.contentHash !== hash(stableJson(current.item.data.content));
    if (current?.item.data.import_hash === post.importHash && current.item.status === expectedStatus && !contentEdited) {
      // An earlier run may have saved/published successfully and stopped during
      // verification. Reconstruct and compare its actual content before adopting it.
      const prepared = await preparePost(post);
      await verifyPost(api, current.item.id, post, plan.topics, prepared.data);
      manifest.posts[post.slug] = { id: current.item.id, hash: post.importHash, status: expectedStatus,
        publishedAt: post.publishedAt, originalUpdatedAt: post.updatedAt,
        contentHash: hash(stableJson(current.item.data.content)) };
      await saveManifest();
      skipped++;
      console.log(`Verified and skipped unchanged ${post.slug}.`);
      return;
    }
    const { converted, data } = await preparePost(post);
    const body = { data,
      references: { topic: post.data.topic ? [plan.topics.get(post.data.topic).id] : [] },
      taxonomies: { tag: (post.data.tags ?? []).map(tagSlug) },
      publishedAt: post.data.draft ? null : post.publishedAt };
    const saved = await api.request(current ? 'PUT' : 'POST', apiPath('posts', current?.item.id), {
      ...body, ...(current ? { _rev: current._rev } : { slug: post.slug, status: 'draft' }),
    });
    const id = saved.item.id;
    if (post.data.draft) {
      if (saved.item.status !== 'draft') await api.request('POST', `${apiPath('posts', id)}/unpublish`);
    } else {
      await api.request('POST', `${apiPath('posts', id)}/publish`, { publishedAt: post.publishedAt });
    }
    await verifyPost(api, id, post, plan.topics, body.data);
    manifest.posts[post.slug] = { id, hash: post.importHash, status: expectedStatus,
      publishedAt: post.publishedAt, originalUpdatedAt: post.updatedAt,
      contentHash: hash(stableJson(converted.blocks)) };
    await saveManifest();
    imported++;
    console.log(`Imported and verified ${post.slug} (${expectedStatus}).`);
  });
  console.log(`Finished: ${imported} imported, ${skipped} unchanged; ${plan.posts.filter((post) => !post.data.draft).length} published, `
    + `${plan.posts.filter((post) => post.data.draft).length} draft. Manifest: ${path.relative(root, manifestPath)}`);
}

async function verifyPost(api, id, post, topics, expectedData) {
  const { item } = await api.get('posts', id);
  if (item.status !== (post.data.draft ? 'draft' : 'published')
    || item.data.import_hash !== post.importHash
    || (!post.data.draft && item.publishedAt !== post.publishedAt)
    || (item.data.original_updated_at ?? null) !== post.updatedAt
    || !isDeepStrictEqual(item.data.original_metadata, post.data)) {
    throw new Error(`Imported status, dates, or metadata failed verification: ${post.slug}`);
  }
  if (expectedData) {
    // Match the actual JSON sent over the API (undefined object keys are omitted).
    for (const [field, value] of Object.entries(JSON.parse(JSON.stringify(expectedData)))) {
      // The CMS omits optional null scalar values when it hydrates data.
      // Image fields are hydrated with additional library metadata (LQIP,
      // caption, focal point). Every imported property must still match.
      const actual = field === 'draft' && [0, 1].includes(item.data[field])
        ? Boolean(item.data[field]) : item.data[field];
      const matches = field === 'featured_image' && value !== null
        ? containsExpected(actual, value) : isDeepStrictEqual(actual, value);
      if (!(value === null && item.data[field] === undefined) && !matches) {
        throw new Error(`Imported field failed verification: ${post.slug}.${field}`);
      }
    }
  }
  const selection = item.references?.topic?.children ?? [];
  const expectedIds = post.data.topic ? [topics.get(post.data.topic).id] : [];
  if (!isDeepStrictEqual(selection.map((entry) => entry.id).sort(), expectedIds.sort())) {
    throw new Error(`Imported topic failed verification: ${post.slug}`);
  }
  const { terms } = await api.request('GET', `${apiPath('posts', id)}/terms/tag`);
  if (!isDeepStrictEqual(terms.map((term) => term.slug).sort(), (post.data.tags ?? []).map(tagSlug).sort())) {
    throw new Error(`Imported tags failed verification: ${post.slug}`);
  }
}

try {
  const config = await options();
  console.log(`${config.apply ? 'APPLY' : 'DRY RUN'}: ${config.target}`);
  const plan = await makePlan(config.slugs);
  console.log(`Plan: ${plan.posts.length} posts, ${plan.topics.size} topics, ${plan.tags.size} tags, ${plan.images.size} distinct images.`);
  if (config.apply) await apply(config, plan);
  else console.log('No CMS requests or file writes made. Pass --apply to import this plan.');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
