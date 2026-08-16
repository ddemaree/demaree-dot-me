import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { classifyEntry } from './taxonomy.mjs';

const postsDirectory = path.join(process.cwd(), 'src/content/posts');

function parseList(frontmatter, key) {
  const block = frontmatter.match(new RegExp(`^${key}:\\n((?:  - .*\\n)*)`, 'm'));
  if (block) {
    return [...block[1].matchAll(/- "((?:\\.|[^"\\])*)"/g)].map((match) =>
      parseYamlScalar(`"${match[1]}"`),
    );
  }

  if (new RegExp(`^${key}: \\[]$`, 'm').test(frontmatter)) return [];
  return [];
}

function parseYamlScalar(raw) {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('"')) return trimmed;
  return trimmed.replace(/^"/, '').replace(/"$/, '').replace(/\\"/g, '"');
}

function parseField(frontmatter, key) {
  const match = frontmatter.match(new RegExp(`^${key}: (.+)$`, 'm'));
  if (!match) return '';
  return parseYamlScalar(match[1]);
}

function serializeTags(tags) {
  if (tags.length === 0) return 'tags: []';
  return ['tags:', ...tags.map((tag) => `  - ${JSON.stringify(tag)}`)].join('\n');
}

function upsertField(frontmatter, key, line) {
  const pattern = new RegExp(`^${key}:.*$`, 'm');
  if (pattern.test(frontmatter)) return frontmatter.replace(pattern, line);
  if (/^draft: .+$/m.test(frontmatter)) {
    return frontmatter.replace(/^(draft: .+)$/m, `$1\n${line}`);
  }
  return `${frontmatter.trimEnd()}\n${line}\n`;
}

function replaceTags(frontmatter, tags) {
  if (/^tags:\n(?:  - .+\n)*/m.test(frontmatter)) {
    return frontmatter.replace(/^tags:\n(?:  - .+\n)*/m, `${serializeTags(tags)}\n`);
  }
  if (/^tags: \[\]$/m.test(frontmatter)) {
    return frontmatter.replace(/^tags: \[\]$/m, serializeTags(tags));
  }
  return upsertField(frontmatter, 'tags', serializeTags(tags));
}

const files = (await readdir(postsDirectory)).filter((name) => name.endsWith('.mdoc'));
const counts = new Map();

for (const filename of files) {
  const filePath = path.join(postsDirectory, filename);
  const original = await readFile(filePath, 'utf8');
  const match = original.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) {
    console.warn(`Skipping ${filename}: missing front matter`);
    continue;
  }

  const frontmatter = match[1];
  const classification = classifyEntry({
    slug: filename.replace(/\.mdoc$/, ''),
    title: parseField(frontmatter, 'title'),
    description: parseField(frontmatter, 'description'),
    tags: parseList(frontmatter, 'tags'),
    format: parseField(frontmatter, 'format') || 'standard',
  });

  let next = replaceTags(frontmatter, classification.tags);
  next = upsertField(next, 'topic', `topic: ${JSON.stringify(classification.topic)}`);
  counts.set(classification.topic, (counts.get(classification.topic) ?? 0) + 1);

  if (next !== frontmatter) {
    await writeFile(filePath, original.replace(frontmatter, next));
  }
}

console.log(`Updated ${files.length} posts.`);
for (const [topic, count] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${count} ${topic}`);
}
