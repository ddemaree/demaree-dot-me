import type { CollectionEntry } from 'astro:content';

const htmlEntities: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** Use an editorial description, or quote the beginning of the post as plain text. */
export function getPostDescription(post: CollectionEntry<'posts'>) {
  const description = post.data.description.trim();
  if (description) return description;

  const text = (post.body ?? '')
    .replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, ' ')
    .replace(/{%[\s\S]*?%}/g, ' ')
    .replace(/^\s*\[[^\]]+\]:.*$/gm, '')
    .replace(/!\[[^\]]*\]\([^)]*\)|!\[[^\]]*\]\[[^\]]*\]/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)|\[([^\]]+)\]\[[^\]]*\]/g, (_match, inline, reference) => inline ?? reference)
    .replace(/<[^>]*>/g, ' ')
    .replace(/(?:^|\n)\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/g, ' ')
    .replace(/\\([\\`*_{}\[\]()#+\-.!>])/g, '$1')
    .replace(/[*_~`]/g, '')
    .replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity: string) => {
      if (!entity.startsWith('#')) return htmlEntities[entity.toLowerCase()] ?? match;
      const codePoint = entity[1].toLowerCase() === 'x'
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10);
      return codePoint > 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : match;
    })
    .replace(/\s+/g, ' ')
    .trim();

  if (!text) return post.data.title;
  if (text.length <= 240) return text;
  return `${text.slice(0, 239).replace(/\s+\S*$/, '').trimEnd()}…`;
}
