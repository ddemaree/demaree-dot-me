import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import Markdoc from '@markdoc/markdoc';
import { parse as parseYaml } from 'yaml';

/** Read the repository corpus without running Astro or writing CMS data. */
export async function loadPosts({ root = process.cwd(), slugs } = {}) {
  const directory = path.join(root, 'src/content/posts');
  const wanted = slugs ? new Set(slugs) : undefined;
  const names = (await readdir(directory)).filter((name) => /\.(mdoc|md)$/.test(name)).sort();
  const posts = [];
  for (const name of names) {
    const slug = name.replace(/\.(mdoc|md)$/, '');
    if (wanted && !wanted.has(slug)) continue;
    const file = path.join(directory, name);
    const source = await readFile(file, 'utf8');
    const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    if (!match) throw new Error(`${file}: missing YAML frontmatter`);
    const data = parseYaml(match[1]);
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error(`${file}: frontmatter must be an object`);
    }
    posts.push({ slug, path: file, data, body: source.slice(match[0].length) });
  }
  if (wanted) {
    const found = new Set(posts.map((post) => post.slug));
    const missing = [...wanted].filter((slug) => !found.has(slug));
    if (missing.length) throw new Error(`Unknown post slugs: ${missing.join(', ')}`);
  }
  return posts;
}

/** All image occurrences, including repeated body images and the cover. */
export function collectPostImages(post) {
  const images = [];
  if (post.data.featuredImage) {
    images.push({ src: post.data.featuredImage, alt: post.data.featuredImageAlt ?? '', featured: true });
  }
  for (const node of Markdoc.parse(post.body).walk()) {
    if (node.type === 'image') images.push({ ...node.attributes, featured: false });
  }
  return images;
}

export class MarkdocConversionError extends Error {
  constructor(diagnostics) {
    super(diagnostics.filter((item) => item.severity === 'error').map((item) =>
      `${item.slug}:${item.line ?? '?'} ${item.message}`).join('\n'));
    this.name = 'MarkdocConversionError';
    this.diagnostics = diagnostics;
  }
}

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

function descendants(node) {
  return [node, ...node.children.flatMap(descendants)];
}

/**
 * Convert the Markdoc body to EmDash 1.1 Portable Text. Keys are stable for the
 * same source/slug. The injected resolver owns uploads and must return an
 * explicit browser URL (media.id is not EmDash's storageKey).
 *
 * resolveImage(src, { alt, title, slug }) => { _ref?, url, width?, height? }
 * Returns { blocks, diagnostics, stats }. Unsupported nodes throw, never drop.
 * Complex quotes/lists and inline images use EmDash's editable htmlBlock so
 * opening and saving them cannot flatten their original nesting/placement.
 */
export async function convertMarkdoc(body, { slug = 'document', resolveImage } = {}) {
  const ast = Markdoc.parse(body);
  const diagnostics = [];
  const sourceNodes = {};
  const key = (kind, location) => createHash('sha256').update(`${slug}:${kind}:${location}`).digest('hex').slice(0, 20);
  const report = (severity, code, node, message) => diagnostics.push({
    severity, code, slug, line: node.location?.start?.line === undefined ? undefined : node.location.start.line + 1,
    message,
  });
  const supported = new Set(['document', 'paragraph', 'inline', 'text', 'em', 'strong', 'link',
    'image', 'heading', 'list', 'item', 'hr', 'blockquote', 'hardbreak', 'softbreak', 'code', 'fence']);
  for (const node of descendants(ast)) {
    sourceNodes[node.type] = (sourceNodes[node.type] ?? 0) + 1;
    if (!supported.has(node.type)) report('error', 'unsupported-node', node, `Unsupported Markdoc node ${node.type}`);
    for (const error of node.errors ?? []) report('error', 'parse-error', node, error.message ?? String(error));
    if (node.annotations?.length || Object.keys(node.slots ?? {}).length) {
      report('error', 'unsupported-annotation', node, 'Markdoc annotations or slots need an explicit mapping');
    }
  }
  if (diagnostics.some((item) => item.severity === 'error')) throw new MarkdocConversionError(diagnostics);

  const images = new Map();
  for (const node of descendants(ast).filter((node) => node.type === 'image')) {
    const src = node.attributes.src;
    if (!images.has(src)) {
      let resolved;
      if (resolveImage) {
        resolved = await resolveImage(src, { alt: node.attributes.alt ?? '', title: node.attributes.title, slug });
        if (!resolved || typeof resolved.url !== 'string' || !resolved.url) {
          report('error', 'unresolved-image', node, `Image resolver must return an explicit URL: ${src}`);
        }
      } else {
        resolved = { url: src };
        if (String(src).startsWith('@assets/')) {
          report('warning', 'unresolved-local-image', node, `Read-only conversion retains asset alias; importing requires an image resolver: ${src}`);
        }
      }
      images.set(src, resolved ?? { url: src });
    }
  }
  if (diagnostics.some((item) => item.severity === 'error')) throw new MarkdocConversionError(diagnostics);

  const hasImage = (node) => descendants(node).some((child) => child.type === 'image');
  const hasEmptyLink = (node) => descendants(node).some((child) => child.type === 'link'
    && !hasImage(child) && !descendants(child).some((part) =>
      (part.type === 'text' || part.type === 'code') && part.attributes.content));
  const joinHtml = (node) => node.children.map(toHtml).join('');
  function toHtml(node) {
    const attrs = node.attributes;
    switch (node.type) {
      case 'document': case 'inline': return joinHtml(node);
      case 'text': return escapeHtml(attrs.content);
      case 'paragraph': return `<p>${joinHtml(node)}</p>`;
      case 'heading': return `<h${attrs.level}>${joinHtml(node)}</h${attrs.level}>`;
      case 'em': case 'strong': return `<${node.type}>${joinHtml(node)}</${node.type}>`;
      case 'link': return `<a href="${escapeHtml(attrs.href)}"${attrs.title ? ` title="${escapeHtml(attrs.title)}"` : ''}>${joinHtml(node)}</a>`;
      case 'code': return `<code>${escapeHtml(attrs.content)}</code>`;
      case 'fence': return `<pre><code>${escapeHtml(attrs.content)}</code></pre>`;
      case 'hr': return '<hr>';
      case 'hardbreak': return '<br>';
      case 'softbreak': return ' ';
      case 'blockquote': return `<blockquote>${joinHtml(node)}</blockquote>`;
      case 'list': {
        const tag = attrs.ordered ? 'ol' : 'ul';
        // The PoC's EmDashHtmlBlock extends the native sanitizer with ol.start
        // and a.title so these source attributes survive rendering.
        return `<${tag}${attrs.ordered && attrs.start !== 1 ? ` start="${attrs.start}"` : ''}>${joinHtml(node)}</${tag}>`;
      }
      case 'item': return `<li>${joinHtml(node)}</li>`;
      case 'image': {
        const image = images.get(attrs.src);
        return `<img src="${escapeHtml(image.url)}" alt="${escapeHtml(attrs.alt ?? '')}"${attrs.title ? ` title="${escapeHtml(attrs.title)}"` : ''}${image.width ? ` width="${image.width}"` : ''}${image.height ? ` height="${image.height}"` : ''}>`;
      }
      default: throw new Error(`Preflight missed node: ${node.type}`);
    }
  }

  function htmlBlock(node, location, code, message) {
    report('warning', code, node, message);
    return [{ _type: 'htmlBlock', _key: key('html', location), html: toHtml(node) }];
  }

  function inline(nodes, location) {
    const children = [];
    const markDefs = [];
    const links = new Map();
    function visit(node, marks, at) {
      const attrs = node.attributes;
      const span = (text) => {
        if (!text) return;
        children.push({ _type: 'span', _key: key('span', at), text, ...(marks.length ? { marks: [...marks] } : {}) });
      };
      switch (node.type) {
        case 'inline': node.children.forEach((child, index) => visit(child, marks, `${at}.${index}`)); break;
        case 'text': span(attrs.content); break;
        case 'code': visit({ type: 'text', attributes: attrs }, [...marks, 'code'], at); break;
        case 'em': case 'strong':
          node.children.forEach((child, index) => visit(child, [...marks, node.type], `${at}.${index}`)); break;
        case 'link': {
          const signature = JSON.stringify([attrs.href, attrs.title]);
          if (!links.has(signature)) {
            const linkKey = key('link', `${location}:${signature}`);
            links.set(signature, linkKey);
            markDefs.push({ _type: 'link', _key: linkKey, href: attrs.href, ...(attrs.title ? { title: attrs.title } : {}) });
          }
          node.children.forEach((child, index) => visit(child, [...marks, links.get(signature)], `${at}.${index}`));
          break;
        }
        case 'softbreak': span(' '); break;
        case 'hardbreak':
          // The editor appends breaks to the preceding span. Use that same
          // representation to avoid moving newline marks when an entry is saved.
          if (children.length) children.at(-1).text += '\n';
          else span('\n');
          break;
        default: throw new Error(`Unexpected inline node ${node.type}`);
      }
    }
    nodes.forEach((node, index) => visit(node, [], `${location}.${index}`));
    if (!children.length) children.push({ _type: 'span', _key: key('span', `${location}.empty`), text: '' });
    return { children, ...(markDefs.length ? { markDefs } : {}) };
  }

  function singleImage(node) {
    const all = descendants(node);
    const imageNodes = all.filter((child) => child.type === 'image');
    if (imageNodes.length !== 1 || all.some((child) => child.type === 'code' || child.type === 'text' && child.attributes.content.trim())) return undefined;
    if (all.some((child) => !['paragraph', 'inline', 'image', 'text', 'softbreak', 'link'].includes(child.type))) return undefined;
    return { image: imageNodes[0], link: all.find((child) => child.type === 'link') };
  }

  function textBlock(node, location, style = 'normal', extra = {}) {
    return { _type: 'block', _key: key('block', location), style, ...extra, ...inline(node.children, location) };
  }

  function isSimpleList(node) {
    return node.children.every((item) => {
      const text = item.children.filter((child) => child.type === 'inline' || child.type === 'paragraph');
      return text.length === 1 && !hasImage(item) && !hasEmptyLink(item) && item.children.every((child) =>
        child.type === 'inline' || child.type === 'paragraph' || child.type === 'list' && isSimpleList(child));
    });
  }

  function listBlocks(node, location, level) {
    const listItem = node.attributes.ordered ? 'number' : 'bullet';
    const extra = { listItem, level, ...(node.attributes.ordered ? {
      listId: key('list', location), listStart: node.attributes.start ?? 1,
    } : {}) };
    return node.children.flatMap((item, index) => item.children.flatMap((child, childIndex) => {
      const at = `${location}.${index}.${childIndex}`;
      return child.type === 'list' ? listBlocks(child, at, level + 1) : [textBlock(child.type === 'inline' ? { children: [child] } : child, at, 'normal', extra)];
    }));
  }

  function block(node, location) {
    switch (node.type) {
      case 'document': return node.children.flatMap((child, index) => block(child, `${location}.${index}`));
      case 'paragraph': {
        if (hasEmptyLink(node)) return htmlBlock(node, location, 'preserved-empty-link', 'Empty link destination preserved in an HTML block; the visual editor removes links with no text');
        if (hasImage(node)) {
          const standalone = singleImage(node);
          if (standalone) {
            const attrs = standalone.image.attributes;
            const { _ref, url, width, height } = images.get(attrs.src);
            return [{ _type: 'image', _key: key('image', location),
              asset: { _ref: _ref ?? '', url }, ...(attrs.alt ? { alt: attrs.alt } : {}),
              ...(attrs.title ? { title: attrs.title, caption: '' } : {}), ...(width ? { width } : {}), ...(height ? { height } : {}),
              ...(standalone.link ? { link: { href: standalone.link.attributes.href } } : {}),
            }];
          }
          return htmlBlock(node, location, 'preserved-inline-images', 'Inline/multiple image placement preserved in an HTML block; edit its HTML rather than the visual text editor');
        }
        return [textBlock(node, location)];
      }
      case 'heading':
        if (hasEmptyLink(node)) return htmlBlock(node, location, 'preserved-empty-link', 'Empty link destination preserved in an HTML block; the visual editor removes links with no text');
        if (hasImage(node)) return htmlBlock(node, location, 'preserved-heading-image', 'Image inside a heading preserved in an HTML block');
        return [textBlock(node, location, `h${node.attributes.level}`)];
      case 'fence': return [{ _type: 'code', _key: key('code', location), code: node.attributes.content,
        ...(node.attributes.language ? { language: node.attributes.language } : {}) }];
      case 'hr': return [{ _type: 'break', _key: key('break', location), style: 'lineBreak' }];
      case 'blockquote':
        if (node.children.every((child) => child.type === 'paragraph' && !hasImage(child) && !hasEmptyLink(child))) {
          return node.children.map((child, index) => textBlock(child, `${location}.${index}`, 'blockquote'));
        }
        return htmlBlock(node, location, 'preserved-complex-quote', 'Quoted lists, nested quotes, or other quote blocks preserved in an HTML block; the EmDash visual quote converter drops these structures');
      case 'list':
        if (isSimpleList(node)) return listBlocks(node, location, 1);
        return htmlBlock(node, location, 'preserved-complex-list', 'Multiple paragraphs or non-text list children preserved in an HTML block to keep each list item intact');
      default: throw new Error(`Unexpected block node ${node.type}`);
    }
  }
  const blocks = block(ast, 'root');
  if (diagnostics.some((item) => item.severity === 'error')) throw new MarkdocConversionError(diagnostics);
  return { blocks, diagnostics, stats: { sourceNodes, blocks: blocks.length,
    images: sourceNodes.image ?? 0, htmlBlocks: blocks.filter((item) => item._type === 'htmlBlock').length } };
}
