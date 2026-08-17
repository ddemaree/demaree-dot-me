import { getCollection, getEntry, type CollectionEntry } from 'astro:content';

export function slugifyTag(name: string) {
  return name
    .trim()
    .replace(/^i(Pad|Phone|OS)$/i, (_, part: string) => `i-${part.toLowerCase()}`)
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export type PostEntry = CollectionEntry<'posts'>;
export type TopicEntry = CollectionEntry<'topics'>;

export function formatDate(date: Date) {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'long',
    timeZone: 'America/New_York',
  }).format(date);
}

export async function getPublishedPosts() {
  return (await getCollection('posts', ({ data }) => !data.draft)).sort(
    (a, b) => b.data.publishedAt.valueOf() - a.data.publishedAt.valueOf(),
  );
}

export async function getTopics() {
  return (await getCollection('topics')).sort(
    (a, b) => a.data.navOrder - b.data.navOrder || a.data.title.localeCompare(b.data.title),
  );
}

export async function getNavTopics() {
  return (await getTopics()).filter((topic) => topic.data.inNav);
}

export async function getTopic(slug: string) {
  return getEntry('topics', slug);
}

export function postTopicId(post: PostEntry) {
  const topic = post.data.topic;
  if (!topic) return 'notebook';
  return typeof topic === 'string' ? topic : topic.id;
}

export async function getPostsByTopic(slug: string) {
  const posts = await getPublishedPosts();
  return posts.filter((post) => postTopicId(post) === slug);
}

export function postTagSlugs(post: PostEntry) {
  return post.data.tags.map((tag) => ({ tag, slug: slugifyTag(tag) }));
}

export async function getPostsByTag(slug: string) {
  const posts = await getPublishedPosts();
  return posts.filter((post) => post.data.tags.some((tag) => slugifyTag(tag) === slug));
}

const SOURCE_TAGS = new Set(['From Tumblr', 'From Substack', 'From Medium']);

export async function getTagIndex() {
  const counts = new Map<string, { tag: string; slug: string; count: number }>();

  for (const post of await getPublishedPosts()) {
    for (const tag of post.data.tags) {
      if (SOURCE_TAGS.has(tag)) continue;
      const slug = slugifyTag(tag);
      const current = counts.get(slug);
      if (current) current.count += 1;
      else counts.set(slug, { tag, slug, count: 1 });
    }
  }

  return [...counts.values()].sort(
    (a, b) => b.count - a.count || a.tag.localeCompare(b.tag),
  );
}

export function tagLabelFromPosts(slug: string, posts: PostEntry[]) {
  for (const post of posts) {
    const match = post.data.tags.find((tag) => slugifyTag(tag) === slug);
    if (match) return match;
  }
  return slug;
}
