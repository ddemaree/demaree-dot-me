#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, symlink, writeFile, access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Markdoc from '@markdoc/markdoc';
import { loadPosts, collectPostImages, convertMarkdoc, MarkdocConversionError } from './lib/emdash-convert.mjs';
import { sanitizeEmDashHtml as sanitize } from '../src/lib/emdash-html.mjs';

const require = createRequire(import.meta.url);
const emdashRequire = createRequire(require.resolve('emdash'));
const normalize = (value) => String(value).replace(/\s+/g, ' ').trim();
const clean = (value) => JSON.parse(JSON.stringify(value));
const decode = (value) => value.replace(/&(?:amp|lt|gt|quot|#39);/g, (entity) =>
  ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" })[entity]);
const htmlText = (html) => decode(html.replace(/<\/(?:p|li|h[1-6]|blockquote|pre|ul|ol)>|<br\s*\/?\s*>/g, ' ').replace(/<[^>]*>/g, ''));
function astText(node) {
  if (node.type === 'text' || node.type === 'code' || node.type === 'fence') return node.attributes.content;
  if (node.type === 'image') return '';
  if (node.type === 'softbreak' || node.type === 'hardbreak') return ' ';
  const separator = ['document', 'blockquote', 'list', 'item'].includes(node.type) ? ' ' : '';
  return node.children.map(astText).join(separator);
}
function ptText(blocks) {
  return blocks.map((block) => block._type === 'block' ? block.children.map((child) => child.text).join('')
    : block._type === 'code' ? block.code : block._type === 'htmlBlock' ? htmlText(block.html) : '').join(' ');
}
function assertEditorRoundTrip(converters, blocks, slug) {
  const saved = clean(converters.prosemirrorToPortableText(converters.portableTextToProsemirror(blocks)));
  assert.equal(saved.length, blocks.length, `${slug}: editor changed the block count`);
  for (const [index, block] of blocks.entries()) {
    try {
      assert.deepEqual(saved[index], clean(block));
    } catch (error) {
      throw new Error(`${slug}: editor changed block ${index + 1} (${block._type})\n${error.message.slice(0, 1200)}`);
    }
  }
}
function htmlAttributes(html, tag, attribute) {
  return [...html.matchAll(new RegExp(`<${tag}\\b[^>]*?\\b${attribute}="([^"]*)"[^>]*>`, 'g'))].map((match) => decode(match[1]));
}
function checkDestinationsAndImages(ast, blocks, slug) {
  const nodes = [ast, ...ast.walk()];
  const links = nodes.filter((node) => node.type === 'link').map((node) => node.attributes.href);
  const destinations = blocks.flatMap((block) => block._type === 'block'
    ? (block.markDefs ?? []).filter((mark) => mark._type === 'link').map((mark) => mark.href)
    : block._type === 'image' ? (block.link ? [block.link.href] : [])
    : block._type === 'htmlBlock' ? htmlAttributes(block.html, 'a', 'href') : []);
  assert.deepEqual(new Set(destinations), new Set(links), `${slug}: link destinations differ`);
  const imageNodes = nodes.filter((node) => node.type === 'image');
  const sourceImages = imageNodes.map((node) => JSON.stringify([
    `/audit-media/${encodeURIComponent(node.attributes.src)}`, node.attributes.alt ?? '', node.attributes.title ?? '',
  ])).sort();
  const convertedImages = blocks.flatMap((block) => block._type === 'image'
    ? [JSON.stringify([block.asset.url, block.alt ?? '', block.title ?? ''])]
    : block._type === 'htmlBlock' ? [...block.html.matchAll(/<img\b[^>]*>/g)].map(([image]) => JSON.stringify([
      htmlAttributes(image, 'img', 'src')[0], htmlAttributes(image, 'img', 'alt')[0] ?? '', htmlAttributes(image, 'img', 'title')[0] ?? '',
    ])) : []).sort();
  assert.deepEqual(convertedImages, sourceImages, `${slug}: image sources/alt/title differ`);
}
function validateKeys(blocks, slug) {
  const blockKeys = new Set();
  for (const block of blocks) {
    assert.ok(block._key && !blockKeys.has(block._key), `${slug}: missing/duplicate block key`);
    blockKeys.add(block._key);
    if (block._type !== 'block') continue;
    const spans = new Set();
    const definitions = new Set((block.markDefs ?? []).map((mark) => mark._key));
    const marks = new Set(['strong', 'em', 'code']);
    for (const span of block.children) {
      assert.equal(span._type, 'span');
      assert.ok(span._key && !spans.has(span._key), `${slug}: missing/duplicate span key`);
      spans.add(span._key);
      assert.equal(typeof span.text, 'string');
      for (const mark of span.marks ?? []) assert.ok(marks.has(mark) || definitions.has(mark), `${slug}: dangling mark ${mark}`);
    }
  }
}

/**
 * EmDash publishes the admin converter implementations, but does not re-export
 * their test aliases from the package entry point. Instrument a temporary copy
 * of that installed bundle to exercise the real converters. Never modify the
 * package, use the git checkout as an oracle, or replace them with a facsimile.
 * This deliberately fails if a new EmDash version renames the functions.
 */
async function withPublishedEditorConverters(run) {
  const adminEntry = emdashRequire.resolve('@emdash-cms/admin');
  const adminDirectory = path.dirname(adminEntry);
  const source = await readFile(adminEntry, 'utf8');
  for (const name of ['portableTextToProsemirror', 'prosemirrorToPortableText']) {
    assert.ok(source.includes(`function ${name}(`), `Installed EmDash admin no longer has ${name}; update this validation harness`);
  }
  const directory = await mkdtemp(path.join(os.tmpdir(), 'emdash-editor-check-'));
  try {
    // Relative chunks resolve to their original location. Bare imports resolve
    // via a temporary symlink to the installed admin's dependency directory.
    await symlink(path.resolve(adminDirectory, '../../../'), path.join(directory, 'node_modules'), 'dir');
    const instrumented = source.replace(/^(import[^\n]*?["'])(\.[^"']+)(["'];?)$/gm,
      (_match, start, specifier, end) => `${start}${pathToFileURL(path.resolve(adminDirectory, specifier)).href}${end}`)
      + '\nexport { portableTextToProsemirror, prosemirrorToPortableText };\n';
    const file = path.join(directory, 'admin-check.mjs');
    await writeFile(file, instrumented);
    const converters = await import(pathToFileURL(file).href);
    await run(converters, emdashRequire);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const fixtureResolver = async (src) => ({
  _ref: `audit-${createHash('sha256').update(src).digest('hex').slice(0, 16)}`,
  url: `/audit-media/${encodeURIComponent(src)}`, width: 800, height: 600,
});

async function runFixtures(converters) {
  const markdown = [
    '# Heading',
    '',
    'Text ***both marks*** and [**bold link**](https://example.com/?x=1&y=2 "Tooltip") plus `inline <code>`.',
    '',
    'soft',
    'break  ',
    'hard',
    '',
    '3. third',
    '4. fourth',
    '   - nested',
    '',
    '> First **quoted** paragraph.',
    '>',
    '> Second quoted paragraph.',
    '',
    '> Outside quote',
    '>',
    '> > Nested quote',
    '>',
    '> - Quoted list',
    '> - List two',
    '',
    '- First paragraph',
    '',
    '  Second paragraph, same list item.',
    '',
    '[![linked alt](@assets/images/posts/fixture/linked.png "Image title")](https://example.com/image)',
    '',
    'Before ![one](@assets/images/posts/fixture/one.png) between ![two](@assets/images/posts/fixture/two.png) after.',
    '',
    '```js',
    'const escaped = "<b>";',
    '```',
    '',
    '---',
  ].join('\n');
  const { blocks, diagnostics } = await convertMarkdoc(markdown, { slug: 'fixture', resolveImage: fixtureResolver });
  validateKeys(blocks, 'fixture');
  assert.ok(blocks.find((block) => block.style === 'h1'));
  const both = blocks.flatMap((block) => block.children ?? []).find((span) => span.text === 'both marks');
  assert.deepEqual(new Set(both.marks), new Set(['strong', 'em']));
  const boldLink = blocks.find((block) => block.children?.some((span) => span.text === 'bold link'));
  const linkSpan = boldLink.children.find((span) => span.text === 'bold link');
  assert.ok(linkSpan.marks.includes('strong') && linkSpan.marks.includes(boldLink.markDefs[0]._key));
  assert.equal(boldLink.markDefs[0].href, 'https://example.com/?x=1&y=2');
  assert.equal(boldLink.markDefs[0].title, 'Tooltip');
  const ordered = blocks.filter((block) => block.listItem === 'number');
  assert.equal(ordered.length, 2);
  assert.ok(ordered.every((block) => block.listStart === 3 && block.listId === ordered[0].listId));
  assert.ok(blocks.find((block) => block.listItem === 'bullet' && block.level === 2));
  assert.equal(blocks.filter((block) => block.style === 'blockquote').length, 2);
  assert.ok(blocks.find((block) => block._type === 'htmlBlock' && /<blockquote>.*<blockquote>.*<ul>/.test(block.html)));
  assert.ok(blocks.find((block) => block._type === 'htmlBlock' && /<li><p>First paragraph<\/p><p>Second paragraph/.test(block.html)));
  const linkedImage = blocks.find((block) => block._type === 'image');
  assert.equal(linkedImage.alt, 'linked alt');
  assert.equal(linkedImage.title, 'Image title');
  assert.equal(linkedImage.caption, '');
  assert.deepEqual(linkedImage.link, { href: 'https://example.com/image' });
  const mixedImages = blocks.find((block) => block._type === 'htmlBlock' && block.html.includes('Before'));
  assert.match(mixedImages.html, /Before <img[^>]+alt="one"[^>]*> between <img[^>]+alt="two"[^>]*> after/);
  assert.ok(blocks.find((block) => block._type === 'code' && block.code === 'const escaped = "<b>";\n'));
  assert.ok(blocks.find((block) => block._type === 'break'));
  assert.ok(blocks.some((block) => block.children?.map((span) => span.text).join('').includes('soft break\n')));
  assert.equal(diagnostics.length, 3);
  const again = await convertMarkdoc(markdown, { slug: 'fixture', resolveImage: fixtureResolver });
  assert.deepEqual(blocks, again.blocks, 'Conversion keys must be deterministic');
  assertEditorRoundTrip(converters, blocks, 'fixture');
  checkDestinationsAndImages(Markdoc.parse(markdown), blocks, 'fixture');

  await assert.rejects(convertMarkdoc('{% unknown %}text{% /unknown %}', { slug: 'unsupported-fixture' }),
    (error) => error instanceof MarkdocConversionError && error.diagnostics.some((item) => item.code === 'unsupported-node'));
  await assert.rejects(convertMarkdoc('![missing](image.png)', { resolveImage: async () => ({ _ref: 'id-without-storage-url' }) }),
    (error) => error.diagnostics.some((item) => item.code === 'unresolved-image'));
  const emptyLink = await convertMarkdoc('[](https://example.com/empty)', { slug: 'empty-link-fixture' });
  assert.equal(emptyLink.blocks[0]._type, 'htmlBlock');
  assert.match(emptyLink.blocks[0].html, /href="https:\/\/example.com\/empty"/);
  assertEditorRoundTrip(converters, emptyLink.blocks, 'empty-link-fixture');
  const complexOrdered = await convertMarkdoc('3. First paragraph\n\n   Same item second paragraph.', { slug: 'complex-ordered-fixture' });
  assert.match(sanitize(complexOrdered.blocks[0].html), /<ol start="3">/);
  assert.match(sanitize('<a href="https://example.com" title="Tooltip">label</a>'), /title="Tooltip"/);
  const unsafe = sanitize('<script>alert(1)</script><a href="javascript:alert(1)">label</a><img src="https://example.com/x.png" onerror="alert(1)">');
  assert.ok(!unsafe.includes('script') && !unsafe.includes('javascript:') && !unsafe.includes('onerror'));
}

await withPublishedEditorConverters(async (converters) => {
  await runFixtures(converters);
  const posts = await loadPosts();
  const totals = { posts: posts.length, blocks: 0, bodyImages: 0, htmlBlocks: 0, localImages: 0, externalImages: 0, editorRoundTrips: 0 };
  const warnings = {};
  const fallbackPosts = {};
  for (const post of posts) {
    for (const image of collectPostImages(post)) {
      if (image.src.startsWith('@assets/')) {
        await access(path.join(process.cwd(), 'src/assets', image.src.slice('@assets/'.length)));
        totals.localImages++;
      } else {
        totals.externalImages++;
      }
    }
    const conversion = await convertMarkdoc(post.body, { slug: post.slug, resolveImage: fixtureResolver });
    const { blocks, diagnostics, stats } = conversion;
    validateKeys(blocks, post.slug);
    const ast = Markdoc.parse(post.body);
    assert.equal(normalize(ptText(blocks)), normalize(astText(ast)), `${post.slug}: converted text differs`);
    checkDestinationsAndImages(ast, blocks, post.slug);
    assertEditorRoundTrip(converters, blocks, post.slug);
    for (const block of blocks.filter((block) => block._type === 'htmlBlock')) {
      const rendered = sanitize(block.html);
      assert.equal(normalize(htmlText(rendered)), normalize(htmlText(block.html)), `${post.slug}: renderer sanitization changed HTML text`);
      for (const tag of ['blockquote', 'li', 'img']) {
        assert.equal((rendered.match(new RegExp(`<${tag}(?:\\s|>)`, 'g')) ?? []).length,
          (block.html.match(new RegExp(`<${tag}(?:\\s|>)`, 'g')) ?? []).length, `${post.slug}: sanitizer dropped ${tag}`);
      }
    }
    totals.blocks += stats.blocks;
    totals.bodyImages += stats.images;
    totals.htmlBlocks += stats.htmlBlocks;
    totals.editorRoundTrips++;
    for (const diagnostic of diagnostics) {
      warnings[diagnostic.code] = (warnings[diagnostic.code] ?? 0) + 1;
      (fallbackPosts[diagnostic.code] ??= new Set()).add(post.slug);
    }
  }
  console.log(JSON.stringify({ fixtures: 'passed', corpus: totals, diagnostics: warnings,
    fallbackPosts: Object.fromEntries(Object.entries(fallbackPosts).map(([code, slugs]) => [code, [...slugs]])),
    limitations: ['Editor checks exercise the installed published conversion functions on ProseMirror JSON; browser interaction remains a separate check.',
      'HTML fallbacks preserve structure and can be edited as HTML; complex structures are not editable as ordinary visual rich text.',
      'External image availability is not tested by this read-only audit.'] }, null, 2));
}).catch((error) => {
  console.error(error.message.slice(0, 6000));
  process.exitCode = 1;
});
