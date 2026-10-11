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
 *   STANDARD_SITE_APP_PASSWORD  Bluesky app password (publishing only)
 *   STANDARD_SITE_DID           DID (did:plc:...), required for publishing
 *   STANDARD_SITE_PUBLICATION_URI  AT-URI of publication record
 *   EMDASH_SITE_URL             CMS origin (default https://demaree.me)
 *   EMDASH_API_TOKEN / EMDASH_TOKEN  CMS read token; otherwise use saved OAuth
 *
 * --dry-run reads EmDash but never logs in to Bluesky or writes records/files.
 */
import { BskyAgent } from '@atproto/api';
import { writeFileSync, mkdirSync } from 'node:fs';
import { Temporal } from '@js-temporal/polyfill';
import { readPublishedEmDashPosts } from './lib/emdash-published.mjs';
import { documentRkey, documentUri, publicationUri } from '../src/lib/standard-site.mjs';

const BSKY_SERVICE = 'https://bsky.social';
const PUBLICATION_NSID = 'site.standard.publication';
const DOCUMENT_NSID = 'site.standard.document';
const SITE_URL = 'https://demaree.me';

const createPublication = process.argv.includes('--create-publication');
const dryRun = process.argv.includes('--dry-run');
const singlePostIdx = process.argv.indexOf('--post');
const singlePost = singlePostIdx !== -1 ? process.argv[singlePostIdx + 1] : null;

// Preserve the original January 1 cutoff at midnight in America/New_York.
// CMS system timestamps identify instants, so compare milliseconds.
const PUBLISH_AFTER = Temporal.Instant.from('2026-01-01T00:00:00-05:00').epochMilliseconds;

if (singlePostIdx !== -1 && (!singlePost || singlePost.startsWith('--'))) {
  throw new Error('--post requires a post slug.');
}

// --- Env ---
const handle = process.env.STANDARD_SITE_HANDLE;
const appPassword = process.env.STANDARD_SITE_APP_PASSWORD;
const did = process.env.STANDARD_SITE_DID;
const pubUriEnv = process.env.STANDARD_SITE_PUBLICATION_URI;

if (!dryRun && (!handle || !appPassword)) {
  console.error(
    'Missing credentials. Set STANDARD_SITE_HANDLE and STANDARD_SITE_APP_PASSWORD.',
  );
  process.exit(1);
}

if (!did && !dryRun) {
  console.error('Missing DID. Set STANDARD_SITE_DID.');
  process.exit(1);
}

/** Read published CMS posts and assign stable document identities. */
async function readPosts() {
  const posts = [];
  for (const entry of await readPublishedEmDashPosts()) {
    if (!entry.publishedAt) throw new Error(`Published CMS post ${entry.slug || entry.id} has no publication date.`);
    const instant = Temporal.Instant.from(entry.publishedAt);
    if (instant.epochMilliseconds < PUBLISH_AFTER) continue;

    const slug = entry.slug || entry.id;
    if (!slug || typeof entry.data.title !== 'string' || !entry.data.title.trim()) {
      throw new Error('A published CMS post is missing its slug or title.');
    }
    posts.push({
      slug,
      title: entry.data.title,
      description: typeof entry.data.description === 'string' ? entry.data.description : '',
      path: `/p/${encodeURIComponent(slug)}/`,
      url: `${SITE_URL}/p/${encodeURIComponent(slug)}/`,
      publishedAt: instant.toString(),
    });
  }
  return posts;
}

// --- Agent ---
async function createAgent() {
  const agent = new BskyAgent({
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
    console.log(`  URI: ${publicationUri(effectiveDid)}`);
    return publicationUri(effectiveDid);
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
    console.log(`  URL: ${post.url}`);
    console.log(`  Published: ${post.publishedAt}`);
    return;
  }

  await agent.com.atproto.repo.putRecord({
    repo: effectiveDid,
    collection: DOCUMENT_NSID,
    rkey: documentRkey(post.slug),
    record: {
      $type: DOCUMENT_NSID,
      title: post.title,
      description: post.description,
      site: pubUri,
      path: post.path,
      publishedAt: post.publishedAt,
    },
  });

  console.log(`Published: ${post.title} (${post.slug})`);
}

// --- Main ---
async function main() {
  const posts = await readPosts();
  const filtered = singlePost ? posts.filter(p => p.slug === singlePost) : posts;

  if (dryRun) {
    const effectiveDid = did || 'did:plc:placeholder';
    const pubUri = pubUriEnv || publicationUri(effectiveDid);
    if (!did) console.log('Dry-run mode (no DID set, using placeholder)');
    if (createPublication) await createPubRecord(null, effectiveDid);
    console.log(`\nWould publish ${filtered.length} document records from EmDash:\n`);
    for (const post of filtered) {
      await publishDocument(null, effectiveDid, pubUri, post);
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
    pubUri = publicationUri(effectiveDid);
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
  console.error(err.message);
  process.exit(1);
});
