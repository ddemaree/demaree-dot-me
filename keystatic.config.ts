import { collection, config, fields } from '@keystatic/core';

const postImages = {
  directory: 'src/assets/images/posts',
  publicPath: '@assets/images/posts/',
} as const;

export default config({
  storage: {
    kind: 'local',
  },
  ui: {
    brand: {
      name: 'David Demaree',
    },
  },
  collections: {
    topics: collection({
      label: 'Topics',
      path: 'src/content/topics/*',
      slugField: 'title',
      format: { data: 'yaml' },
      previewUrl: '/topics/{slug}/',
      columns: ['title', 'inNav'],
      schema: {
        title: fields.slug({
          name: { label: 'Title' },
          slug: {
            label: 'URL slug',
            description: 'Used in /topics/{slug}/ and when assigning a post to this mini-blog.',
          },
        }),
        description: fields.text({
          label: 'Description',
          multiline: true,
          description: 'Shown on the topic archive and used in page metadata.',
        }),
        inNav: fields.checkbox({
          label: 'Show in main navigation',
          defaultValue: false,
          description: 'Featured topics appear in the header as mini-blogs.',
        }),
        navOrder: fields.integer({
          label: 'Navigation order',
          defaultValue: 0,
          description: 'Lower numbers appear first among featured topics.',
        }),
      },
    }),
    posts: collection({
      label: 'Posts',
      path: 'src/content/posts/*',
      slugField: 'title',
      entryLayout: 'content',
      format: { contentField: 'content' },
      previewUrl: '/p/{slug}',
      columns: ['title', 'publishedAt', 'topic', 'draft'],
      schema: {
        title: fields.slug({
          name: { label: 'Title' },
          slug: {
            label: 'URL slug',
            description: 'This becomes the post filename and public URL.',
          },
        }),
        description: fields.text({
          label: 'Description',
          multiline: true,
          description: 'Used in post listings and page metadata.',
        }),
        publishedAt: fields.datetime({
          label: 'Published at',
          validation: { isRequired: true },
        }),
        updatedAt: fields.datetime({
          label: 'Updated at',
          validation: { isRequired: false },
        }),
        draft: fields.checkbox({
          label: 'Draft',
          defaultValue: true,
          description: 'Draft posts are excluded from the public static build.',
        }),
        topic: fields.relationship({
          label: 'Topic',
          description:
            'Which mini-blog this post belongs to. Create and edit topics in the Topics collection.',
          collection: 'topics',
        }),
        tags: fields.array(fields.text({ label: 'Tag' }), {
          label: 'Tags',
          description:
            'Freeform labels. Each tag gets an on-demand archive at /labels/{slug}/.',
          itemLabel: ({ value }) => value || 'Untitled tag',
        }),
        format: fields.select({
          label: 'Format',
          description: 'WordPress post format. Link posts store an external URL.',
          options: [
            { label: 'Standard', value: 'standard' },
            { label: 'Aside', value: 'aside' },
            { label: 'Link', value: 'link' },
          ],
          defaultValue: 'standard',
        }),
        subtitle: fields.text({
          label: 'Subtitle',
          description: 'Optional dek shown below the title.',
        }),
        linkUrl: fields.url({
          label: 'External link URL',
          description: 'Required for link-format posts; the original linked article.',
          validation: { isRequired: false },
        }),
        featuredImage: fields.image({
          label: 'Featured image',
          ...postImages,
          validation: { isRequired: false },
        }),
        featuredImageAlt: fields.text({
          label: 'Featured image alt text',
        }),
        wordpressId: fields.integer({
          label: 'Original WordPress ID',
          validation: { isRequired: false },
        }),
        sourceUrl: fields.url({
          label: 'Original source URL',
          description:
            'Canonical URL on WordPress, Substack, Medium, or another original publication.',
          validation: { isRequired: false },
        }),
        content: fields.markdoc({
          label: 'Content',
          extension: 'mdoc',
          options: {
            heading: [2, 3, 4],
            image: postImages,
            codeBlock: true,
            table: true,
          },
        }),
      },
    }),
  },
});
