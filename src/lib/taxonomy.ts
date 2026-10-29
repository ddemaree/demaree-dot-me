import { getEmDashCollection, getEmDashEntry, getRequestContext, runWithContext, type ContentEntry, type EmDashRequestContext } from 'emdash';
import { getDb } from 'emdash/runtime';
import sanitizeHtml from 'sanitize-html';
import { emdashDate, type EmDashPostData } from './emdash-post';

export type PostPageEntry = ContentEntry<Omit<EmDashPostData, 'publishedAt' | 'updatedAt'> & {
  publishedAt?: Date;
  updatedAt?: Date;
  description: string;
  tags: string[];
  topic?: { id: string };
  wordpressId?: number;
}>;
export type PostEntry = PostPageEntry & { data: PostPageEntry['data'] & { publishedAt: Date } };
interface TopicData {
  title: string;
  description?: string;
  in_nav?: boolean;
  nav_order?: number;
  translationGroup?: string;
  status?: string;
}
export type TopicEntry = ContentEntry<TopicData & { description: string; inNav: boolean; navOrder: number }>;

// Archives, navigation, feeds, and sitemap read published snapshots even in
// an editor session. Single-post previews use the validated original context.
const publicContexts = new WeakMap<EmDashRequestContext, EmDashRequestContext>();
const requestData = new WeakMap<EmDashRequestContext, Map<string, Promise<unknown>>>();
function publicQuery<T>(key: string, query: () => Promise<T>): Promise<T> {
  const context = getRequestContext();
  if (!context) return runWithContext({ editMode: false }, query);
  let publicContext = publicContexts.get(context);
  if (!publicContext) {
    publicContext = { ...context, editMode: false, preview: undefined };
    publicContexts.set(context, publicContext);
    publicContexts.set(publicContext, publicContext);
  }
  let cache = requestData.get(publicContext);
  if (!cache) { cache = new Map(); requestData.set(publicContext, cache); }
  const existing = cache.get(key);
  if (existing) return existing as Promise<T>;
  const promise = runWithContext(publicContext, query);
  cache.set(key, promise);
  return promise;
}

async function publishedCollection<T>(collection: string): Promise<ContentEntry<T>[]> {
  const entries: ContentEntry<T>[] = [];
  let cursor: string | undefined;
  do {
    const result = await getEmDashCollection<string, T>(collection, {
      status: 'published', limit: 500, cursor,
      orderBy: { published_at: 'desc', id: 'desc' },
    });
    if (result.error) throw result.error;
    entries.push(...result.entries);
    cursor = result.nextCursor;
  } while (cursor);
  return entries;
}

export function slugifyTag(name: string) {
  return name.trim().toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
export function formatDate(date: Date) {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'America/New_York' }).format(date);
}

function htmlText(html: string) {
  const text = sanitizeHtml(
    html.replace(/<\/(?:p|div|li|h[1-6]|blockquote|tr)>|<br\s*\/?\s*>/gi, ' '),
    { allowedTags: [], allowedAttributes: {} },
  );
  // sanitize-html decodes source entities, then escapes text when serializing.
  // Decode that safe plain-text serialization before Astro escapes metadata.
  const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity: string) => {
    if (!entity.startsWith('#')) return entities[entity.toLowerCase()] ?? match;
    const point = entity[1].toLowerCase() === 'x'
      ? Number.parseInt(entity.slice(2), 16)
      : Number.parseInt(entity.slice(1), 10);
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : match;
  });
}
function contentText(value: unknown, inline = false): string {
  if (Array.isArray(value)) return value.map((node) => contentText(node)).join(inline ? '' : ' ');
  if (!value || typeof value !== 'object') return '';
  const block = value as Record<string, unknown>;
  if (block._type === 'code' || block._type === 'image') return '';
  if (typeof block.text === 'string') return block.text;
  if (typeof block.html === 'string') return htmlText(block.html);
  // Text spans belong to one paragraph: joining them with spaces separates
  // punctuation and words split by emphasis/link marks.
  return block.children ? contentText(block.children, true) : contentText(block.content);
}
function description(data: EmDashPostData) {
  const supplied = data.description?.trim();
  if (supplied) return supplied;
  const text = contentText(data.content).replace(/\s+/g, ' ').trim();
  if (!text) return data.title;
  return text.length <= 240 ? text : `${text.slice(0, 239).replace(/\s+\S*$/, '').trimEnd()}…`;
}
function normalizePagePost(post: Pick<ContentEntry<EmDashPostData>, 'id' | 'data' | 'edit'>, topic?: string): PostPageEntry {
  return {
    ...post,
    data: {
      ...post.data,
      publishedAt: emdashDate(post.data.publishedAt),
      // EmDash is now the editorial source. Import-time writes are updates;
      // original historical timestamps remain stored as migration provenance.
      updatedAt: emdashDate(post.data.updatedAt) ?? emdashDate(post.data.original_updated_at),
      description: description(post.data),
      tags: (post.data.terms?.tag ?? []).map((term) => term.label),
      topic: topic ? { id: topic } : undefined,
      wordpressId: typeof post.data.wordpress_id === 'number' ? post.data.wordpress_id : undefined,
    },
  };
}
function normalizePost(post: ContentEntry<EmDashPostData>, topic?: string): PostEntry {
  const normalized = normalizePagePost(post, topic);
  const publishedAt = normalized.data.publishedAt;
  if (!publishedAt) throw new Error(`Published post ${post.id} has no valid publication date.`);
  return { ...normalized, data: { ...normalized.data, publishedAt } };
}
function normalizeTopic(topic: ContentEntry<TopicData>): TopicEntry {
  return {
    ...topic,
    data: { ...topic.data, description: topic.data.description ?? '', inNav: Boolean(topic.data.in_nav), navOrder: topic.data.nav_order ?? 0 },
  };
}

export function getTopics(): Promise<TopicEntry[]> {
  return publicQuery('topics', async () => (await publishedCollection<TopicData>('topics')).map(normalizeTopic).sort((a, b) => a.data.navOrder - b.data.navOrder || a.data.title.localeCompare(b.data.title)));
}
export async function getNavTopics() { return (await getTopics()).filter((topic) => topic.data.inNav); }
export async function getTopic(slug: string) { return (await getTopics()).find((topic) => topic.id === slug); }

function postTopics(): Promise<Map<string, string>> {
  return publicQuery('post-topics', async () => {
    const [db, topics] = await Promise.all([getDb(), getTopics()]);
    const topicIds = new Map(topics.map((topic) => [topic.data.translationGroup, topic.id]));
    // EmDash 1.1.0 stores published relations here; pending selections remain
    // in draft revisions. One bulk read avoids a query for each archive post.
    const links = await db.selectFrom('_emdash_content_references as links')
      .innerJoin('_emdash_relations as relations', 'relations.id', 'links.relation_id')
      .select(['links.child_group', 'links.parent_group'])
      .where('relations.slug', '=', 'post_topic')
      .where('relations.parent_collection', '=', 'topics')
      .where('relations.child_collection', '=', 'posts')
      .execute();
    const assignments = new Map<string, string>();
    for (const link of links) {
      const topic = topicIds.get(link.parent_group);
      if (topic) assignments.set(link.child_group, topic);
    }
    return assignments;
  });
}
export function getPublishedPosts(): Promise<PostEntry[]> {
  return publicQuery('posts', async () => {
    const [posts, assignments] = await Promise.all([publishedCollection<EmDashPostData>('posts'), postTopics()]);
    return posts.map((post) => normalizePost(post, assignments.get(post.data.translationGroup ?? '')))
      .sort((a, b) => b.data.publishedAt.valueOf() - a.data.publishedAt.valueOf() || b.id.localeCompare(a.id));
  });
}
export function getPublishedPost(slug: string): Promise<PostEntry | undefined> {
  return publicQuery(`post:${slug}`, async () => {
    const result = await getEmDashEntry<'posts', EmDashPostData>('posts', slug);
    if (result.error) throw result.error;
    if (!result.entry || result.entry.data.status !== 'published') return undefined;
    const assignments = await postTopics();
    return normalizePost(result.entry, assignments.get(result.entry.data.translationGroup ?? ''));
  });
}
/** Only EmDash middleware can grant preview/edit access; URL parameters alone cannot. */
export async function getPostForPage(slug: string): Promise<{
  post?: PostPageEntry;
  topic?: TopicEntry;
  isPreview: boolean;
}> {
  const context = getRequestContext();
  if (!context?.editMode && context?.preview?.collection !== 'posts') {
    const post = await getPublishedPost(slug);
    return { post, topic: post ? await getTopic(postTopicId(post)) : undefined, isPreview: false };
  }

  // The native query verifies item-scoped preview grants and supplies the
  // pending revision, references, and inline edit metadata only when permitted.
  const result = await getEmDashEntry<'posts', EmDashPostData, { topic: true }>('posts', slug, {
    references: { topic: true },
  });
  if (result.error) throw result.error;
  if (!result.entry) return { isPreview: false };
  if (!result.isPreview) {
    const post = await getPublishedPost(slug);
    return { post, topic: post ? await getTopic(postTopicId(post)) : undefined, isPreview: false };
  }
  const reference = result.entry.references?.topic?.entries[0];
  const topic = reference ? normalizeTopic(reference) : undefined;
  return { post: normalizePagePost(result.entry, topic?.id), topic, isPreview: true };
}
export function postTopicId(post: PostPageEntry) { return post.data.topic?.id ?? 'notebook'; }
export async function getPostsByTopic(slug: string) { return (await getPublishedPosts()).filter((post) => postTopicId(post) === slug); }
export function postTagSlugs(post: PostPageEntry) { return (post.data.terms?.tag ?? []).map((term) => ({ tag: term.label, slug: term.slug })); }
export async function getPostsByTag(slug: string) { return (await getPublishedPosts()).filter((post) => postTagSlugs(post).some((term) => term.slug === slug)); }
const SOURCE_TAGS = new Set(['From Tumblr', 'From Substack', 'From Medium']);
export async function getTagIndex() {
  const counts = new Map<string, { tag: string; slug: string; count: number }>();
  for (const post of await getPublishedPosts()) {
    for (const { tag, slug } of postTagSlugs(post)) {
      if (SOURCE_TAGS.has(tag)) continue;
      const existing = counts.get(slug);
      if (existing) existing.count += 1;
      else counts.set(slug, { tag, slug, count: 1 });
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}
export function tagLabelFromPosts(slug: string, posts: PostEntry[]) {
  for (const post of posts) {
    const term = postTagSlugs(post).find((term) => term.slug === slug);
    if (term) return term.tag;
  }
  return slug;
}
