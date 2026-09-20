#!/usr/bin/env node
/**
 * Publish site.standard.* records to the AT graph.
 *
 * Usage:
 *   node scripts/publish-standard.mjs [options]
 *
 * Options:
 *   --create-publication  Create the publication record first time
 *   --dry-run             Show what would be published without posting
 *   --post <slug>         Publish a single post by slug
 *
 * Environment variables:
 *   STANDARD_SITE_HANDLE        Bluesky handle (e.g. demar.ee)
 *   STANDARD_SITE_REFRESH_TX    App password refresh token triplet (tx)
 *   STANDARD_SITE_REFRESH_T     App password refresh token (t)
 *   STANDARD_SITE_REFRESH_S     App password refresh token (s)
 *   STANDARD_SITE_DID           DID (did:plc:...) — auto-resolved if omitted
 *   STANDARD_SITE_PUBLICATION_URI  AT-URI of publication record
 */
import { BskyAgent } from '@atproto/api';
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';

const BSKY_SERVICE = 'https://bsky.social';
const PUBLICATION_NSID = 'site.standard.publication';
const DOCUMENT_NSID = 'site.standard.document';
const SITE_URL = 'https://demaree.me';

const createPublication = process.argv.includes('--create-publication');
const dryRun = process.argv.includes('--dry-run');
const singlePostIdx = process.argv.indexOf('--post');
const singlePost = singlePostIdx !== -1 ? process.argv[singlePostIdx + 1] : null;

// --- Env ---
const handle = process.env.STANDARD_SITE_HANDLE;
const appPassword = process.env.STANDARD_SITE_APP_PASSWORD;
const did = process.env.STANDARD_SITE_DID;
const pubUriEnv = process.env.STANDARD_SITE_PUBLICATION_URI;

if (!handle || !appPassword) {
  console.error(
    'Missing credentials. Set STANDARD_SITE_HANDLE and STANDARD_SITE_APP_PASSWORD.',
  );
  process.exit(1);
}

if (!did && !dryRun) {
  console.error('Missing DID. Set STANDARD_SITE_DID or pass --resolve-did.');
  process.exit(1);
}

// --- Helpers ---
function documentUri(did, slug) {
  return `at://${did}/${DOCUMENT_NSID}/posts/${slug}`;
}

function publicationUriFor(did) {
  return `at://${did}/${PUBLICATION_NSID}/main`;
}

/**
 * Parse Markdoc frontmatter (YAML between --- delimiters).
 * Returns an object with the frontmatter fields, or null if parsing fails.
 */
function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;

  const yaml = match[1];
  const fields = {};
  let currentKey = null;
  let currentArray = null;

  for (const line of yaml.split('\n')) {
    const arrayMatch = line.match(/^  - (.+)$/);
    if (arrayMatch && currentKey) {
      if (!currentArray) currentArray = [];
      const value = arrayMatch[1].trim();
      currentArray.push(value.startsWith('"') && value.endsWith('"')
        ? value.slice(1, -1)
        : value.startsWith("'") && value.endsWith("'")
          ? value.slice(1, -1)
          : value);
      fields[currentKey] = currentArray;
      continue;
    }

    const kvMatch = line.match(/^(\w+):\s*(.*)$/);
    if (kvMatch) {
      currentKey = kvMatch[1];
      currentArray = null;
      let value = kvMatch[2].trim();
      // Strip quotes
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      fields[currentKey] = value;
    }
  }

  return fields;
}

/**
 * Read all published (non-draft) posts from content directory.
 */
async function readPosts() {
  const posts = [];
  const postsDir = './src/content/posts';

  const files = readdirSync(postsDir, { recursive: true }).map(
    (name) => `${postsDir}/${name}`,
  );

  for (const file of files) {
    if (!file.endsWith('.mdoc')) continue;

    const content = readFileSync(file, 'utf-8');
    const fm = parseFrontmatter(content);
    if (!fm) continue;
    if (fm.draft === 'true') continue;

    const slug = file.match(/posts\/([^/]+)\.mdoc$/)?.[1];
    if (!slug) continue;

    posts.push({
      slug,
      title: fm.title,
      description: fm.description || '',
      url: `${SITE_URL}/p/${slug}/`,
      publishedAt: fm.publishedAt,
    });
  }

  return posts;
}

// --- Agent ---
async function createAgent() {
  const agent = BskyAgent.create({
    service: BSKY_SERVICE,
  });

  await agent.login({
    identifier: handle,
    password: appPassword,
  });

  return agent;
}

// --- Actions ---
async function createPubRecord(agent, effectiveDid) {
  if (dryRun) {
    console.log('[dry-run] Would create publication record');
    console.log(`  URI: ${publicationUriFor(effectiveDid)}`);
    return publicationUriFor(effectiveDid);
  }

  const result = await agent.com.atproto.repo.putRecord({
    repo: effectiveDid,
    collection: PUBLICATION_NSID,
    rkey: 'main',
    record: {
      $type: PUBLICATION_NSID,
      url: SITE_URL,
      name: 'David Demaree',
      description: 'Writing by David Demaree.',
    },
  });

  console.log(`Created publication record: ${result.uri}`);
  return result.uri;
}

/**
 * Write the .well-known verification file.
 * This static file is served at /.well-known/site.standard.publication
 * and must contain the AT-URI of the publication record.
 */
function writeWellKnownFile(pubUri) {
  const wellKnownDir = './public/.well-known';
  const outputPath = `${wellKnownDir}/site.standard.publication`;

  mkdirSync(wellKnownDir, { recursive: true });
  writeFileSync(outputPath, pubUri, 'utf-8');
  console.log(`Written verification file: ${outputPath}`);
  console.log(`  → https://demaree.me/.well-known/site.standard.publication`);
}

async function publishDocument(agent, effectiveDid, pubUri, post) {
  const uri = documentUri(effectiveDid, post.slug);

  if (dryRun) {
    console.log(`[dry-run] Would publish document: ${post.slug}`);
    console.log(`  URI: ${uri}`);
    console.log(`  Title: ${post.title}`);
    return;
  }

  await agent.com.atproto.repo.putRecord({
    repo: effectiveDid,
    collection: DOCUMENT_NSID,
    rkey: `posts/${post.slug}`,
    record: {
      $type: DOCUMENT_NSID,
      title: post.title,
      description: post.description,
      url: post.url,
      createdAt: post.publishedAt,
      publication: pubUri,
    },
  });

  console.log(`Published: ${post.title} (${post.slug})`);
}

// --- Main ---
async function main() {
  if (dryRun && !did) {
    // For dry-run without DID, use a placeholder
    console.log('Dry-run mode (no DID set, using placeholder)');
    const placeholderDid = 'did:plc:placeholder';
    const posts = await readPosts();
    const filtered = singlePost ? posts.filter(p => p.slug === singlePost) : posts;

    console.log(`\nWould publish ${filtered.length} document records:\n`);
    for (const post of filtered) {
      console.log(`  ${documentUri(placeholderDid, post.slug)} — ${post.title}`);
    }
    return;
  }

  const agent = await createAgent();
  const effectiveDid = agent.session?.did ?? did;
  if (!effectiveDid) {
    throw new Error('Could not resolve DID');
  }

  let pubUri = pubUriEnv;
  if (!pubUri) {
    pubUri = publicationUriFor(effectiveDid);
  }

  if (createPublication) {
    pubUri = await createPubRecord(agent, effectiveDid);
    if (!dryRun) {
      writeWellKnownFile(pubUri);
    }
    console.log(`\nSet STANDARD_SITE_PUBLICATION_URI=${pubUri}\n`);
  }

  if (!pubUri) {
    console.error('No publication URI. Run with --create-publication or set STANDARD_SITE_PUBLICATION_URI.');
    process.exit(1);
  }

  // Ensure the .well-known verification file exists (even for non-first runs)
  if (!dryRun && !createPublication) {
    writeWellKnownFile(pubUri);
  }

  const posts = await readPosts();
  const filtered = singlePost ? posts.filter(p => p.slug === singlePost) : posts;

  console.log(`Publishing ${filtered.length} document(s)...\n`);

  let published = 0;
  let failed = 0;

  for (const post of filtered) {
    try {
      await publishDocument(agent, effectiveDid, pubUri, post);
      published++;
      // Rate limiting: small delay between writes
      if (!dryRun) {
        await new Promise(r => setTimeout(r, 300));
      }
    } catch (error) {
      failed++;
      console.error(`Failed ${post.slug}: ${error.message}`);
    }
  }

  console.log(`\nDone. ${published} published, ${failed} failed out of ${filtered.length}.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
