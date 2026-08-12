# demaree.me

The in-progress Astro rebuild of David Demaree's personal site. It currently
contains a home page, a blog index, and statically generated post pages backed
by local Markdoc content.

## Stack

- Astro 7 with TypeScript in strict mode
- Markdoc and Astro content collections for posts
- Keystatic with local file storage for editing posts
- Tailwind CSS 4 through its Vite plugin, plus the site's global CSS
- Licensed web fonts served from a Cloudflare R2 custom domain
- React integration for future interactive components
- Astro's image and local-font pipelines
- Vercel adapter for deployment

## Requirements

- Node.js 22.12 or newer
- pnpm 11.21.0 (the version pinned in `package.json`)

Install dependencies from the repository root:

```sh
pnpm install
```

## Development

Start Astro in background mode:

```sh
pnpm dev --background
```

The site is then available at <http://localhost:4321>. Manage the background
process with:

```sh
pnpm astro dev status
pnpm astro dev logs
pnpm astro dev logs --follow
pnpm astro dev stop
```

The local Keystatic editor is available at <http://localhost:4321/keystatic>.
It writes post documents and their images directly to this repository; there
is no remote Keystatic storage or authentication configured.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev --background` | Start the background development server |
| `pnpm check` | Run Astro and TypeScript diagnostics |
| `pnpm build` | Create the production build in `dist/` and Vercel output in `.vercel/output/` |
| `pnpm preview` | Preview the production build locally |
| `pnpm import:wordpress` | Import the three posts selected in `scripts/import-wordpress.mjs` |
| `pnpm astro --help` | Show Astro CLI help |

There is currently no separate test or lint command. Run both `pnpm check` and
`pnpm build` before considering a change verified.

## Project structure

```text
├── astro.config.mjs          # Integrations and Vercel adapter
├── keystatic.config.ts       # Local post-editor schema
├── scripts/
│   └── import-wordpress.mjs # One-off importer for selected legacy posts
├── public/                   # Files copied to the site unchanged
└── src/
    ├── assets/               # Images processed by Astro
    ├── components/           # Shared site header and footer
    ├── content/posts/        # Markdoc post documents
    ├── content.config.ts     # Astro content collection schema
    ├── layouts/              # Shared HTML shell
    ├── pages/                # File-based routes
    └── styles/global.css     # Site-wide styles and Tailwind import
```

The public routes currently implemented are:

- `/` — home page
- `/blog/` — reverse-chronological list of published posts
- `/p/[slug]/` — statically generated post pages

Some navigation links still point to pages on the existing production
`demaree.me` site because those routes have not been rebuilt here yet.

## Posts

Posts live in `src/content/posts` as `.mdoc` files. Their schema is defined in
`src/content.config.ts` and mirrored in `keystatic.config.ts`. Drafts are
excluded from both the blog index and generated post routes.

Each post requires a title, description, publication date, and featured image.
Post images belong under `src/assets/images/posts/<slug>/` and are referenced
through the `@assets/*` TypeScript alias.

The WordPress importer fetches a hard-coded set of legacy posts and downloads
their images. It refuses to replace existing post files by default. Passing
`--force` (for example, `pnpm import:wordpress -- --force`) can overwrite local
content, so use it only when intentionally refreshing those imports.
