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
    posts: collection({
      label: 'Posts',
      path: 'src/content/posts/*',
      slugField: 'title',
      entryLayout: 'content',
      format: { contentField: 'content' },
      previewUrl: '/p/{slug}',
      columns: ['title', 'publishedAt', 'draft'],
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
        tags: fields.array(fields.text({ label: 'Tag' }), {
          label: 'Tags',
          itemLabel: ({ value }) => value || 'Untitled tag',
        }),
        featuredImage: fields.image({
          label: 'Featured image',
          ...postImages,
          validation: { isRequired: true },
        }),
        featuredImageAlt: fields.text({
          label: 'Featured image alt text',
        }),
        wordpressId: fields.integer({
          label: 'Original WordPress ID',
          validation: { isRequired: false },
        }),
        sourceUrl: fields.url({
          label: 'Original WordPress URL',
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
