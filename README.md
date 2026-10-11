# demaree.me

The in-progress Astro rebuild of David Demaree's personal site. This branch
uses EmDash 1.1.0 as the content backend and renders the public blog through
Astro on Cloudflare Workers. Home, post, topic, tag, feed, and sitemap routes
read published CMS content at request time; editing and publishing no longer
require a site rebuild.

The deployment target remains the experimental `demaree-emdash-poc` Worker.
The production `demaree.me` domain has not been moved. See
[the EmDash setup and verification notes](docs/emdash-poc.md) for bindings,
imports, authentication, and the outstanding cutover checks. This branch is
based on `standard-site`, whose existing pull request is #4 to `main`.

## Stack

- Astro 7 with TypeScript in strict mode and server output
- EmDash 1.1.0 with Portable Text posts, topic references, and native tags
- Cloudflare Workers with D1 content, R2 media, and KV sessions
- A Worker scheduled handler for EmDash's scheduled publishing
- Tailwind CSS 4 through its Vite plugin, plus the site's global CSS
- Licensed web fonts served from a Cloudflare R2 custom domain
- React integration and Astro image handling
- Markdoc collections and development-only Keystatic retained for legacy source files

## Requirements

- Node.js 22.16 or newer (Node 24 was used for the migration checks)
- pnpm 11.21.0 (the version pinned in `package.json`)

Install dependencies from the repository root:

```sh
pnpm install
```

## Development

Check the server status before starting Astro in background mode:

```sh
pnpm astro dev status
pnpm dev --background
```

The site is available at <http://localhost:4321>. Manage the background process
with:

```sh
pnpm astro dev logs
pnpm astro dev logs --follow
pnpm astro dev stop
```

EmDash's admin interface is at `/_emdash/admin`. Local D1, R2, and session data
are separate from the deployed Worker's data; deployment does not copy them.
Follow the EmDash setup guide before importing content or signing in.

The legacy Keystatic editor remains at <http://localhost:4321/keystatic> in
development only. It edits repository Markdoc, topic files, and source images.
Those edits do not change the live CMS until explicitly imported. Keystatic's
UI and file APIs are excluded from production builds.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev --background` | Start the background development server |
| `pnpm check` | Run Astro and TypeScript diagnostics |
| `pnpm check:emdash` | Validate Markdoc conversion and Portable Text round trips |
| `EMDASH_SITE_URL=https://… pnpm check:emdash-site` | Check every published page, archives, feeds, sitemap, redirects, and rendered CMS images |
| `node scripts/check-content-dates.mjs` | Verify source dates and DST behavior across host time zones |
| `pnpm build` | Create the Cloudflare production build in `dist/` |
| `pnpm preview` | Preview the production build locally |
| `pnpm exec wrangler deploy` | Deploy the built Worker to the configured Cloudflare target |
| `pnpm login:emdash` | Authenticate the importer with a specified CMS origin |
| `pnpm import:emdash` | Plan an import; `--apply` writes locally, or remotely with `--target=URL` |
| `pnpm import:wordpress` | Import published WordPress posts missing from the local archive |
| `pnpm import:publications` | Import Substack and Medium posts missing from the local archive |
| `pnpm taxonomy:assign` | Apply topic/tag classification rules to local source front matter |
| `pnpm standard:publish -- --dry-run` | Preview site.standard records from published EmDash posts |
| `pnpm astro --help` | Show Astro CLI help |

There is no separate test runner or linter. Run `pnpm check` and `pnpm build`
before considering code verified, plus `pnpm check:emdash` for converter or
renderer changes. Deployment, authentication, and editorial workflows need
separate browser/runtime verification.

## Project structure

```text
├── astro.config.mjs          # Integrations, server output, and Cloudflare adapter
├── wrangler.jsonc            # Worker target, bindings, and schedule
├── seed/emdash-poc.json       # CMS collections, fields, relation, and taxonomy
├── keystatic.config.ts       # Legacy local source-editor schema
├── scripts/                  # CMS importer, source importers, and publishing tools
├── public/                   # Files copied to the site unchanged
└── src/
    ├── assets/               # Site assets and archived source images
    ├── components/           # Shared UI and Portable Text rendering
    ├── content/posts/        # Markdoc import source / historical archive
    ├── content/topics/       # Topic import source
    ├── lib/                  # CMS queries, dates, taxonomy, and rendering helpers
    ├── content.config.ts     # Legacy source collection schema
    ├── live.config.ts        # EmDash and external B&L live collections
    ├── layouts/              # Shared HTML shell
    ├── pages/                # File-based routes
    ├── worker.ts             # Cloudflare fetch and EmDash scheduled handlers
    └── styles/global.css     # Site-wide styles and Tailwind import
```

## Public routes and content

- `/` — home page with recent published posts
- `/about/` — About Me
- `/blog/` — reverse-chronological published archive
- `/p/[slug]/` — CMS post pages rendered on demand
- `/topics/` and `/topics/[slug]/` — curated topic archives
- `/labels/` and `/labels/[slug]/` — native tag archives
- `/feed.xml` — full-content RSS, with `/feed/` and legacy path aliases redirecting here
- `/sitemap.xml` and `/robots.txt` — search discovery for published public pages
- `/404` — custom not-found page

Old `/emdash-test/` links redirect to the public blog and post routes. Preview
hosts remain excluded from search indexing pending the domain move. Normal
public requests show published content only; authenticated EmDash preview
flows must remain private and excluded from indexing. Missing posts and
archives return 404, while CMS dependency failures return 503. Public content
responses currently use `no-store` so publishing and removal are immediately
visible on the next request.

The RSS feed keeps the ten-post window and existing WordPress GUIDs. Post
metadata uses editorial descriptions when present, otherwise a plain-text
excerpt. Featured images supply social metadata. Topics control navigation;
native CMS references and taxonomy terms determine the live archive links.

## AT Protocol publishing

`pnpm standard:publish` reads published EmDash posts dated January 1, 2026 or
later. Use `--dry-run` to inspect records without logging in or publishing.
Document record keys are deterministic `posts-<slug>` values; the publisher
and page verification links share the same identity helper. Records use the
[Standard.site document schema](https://standard.site/docs/lexicons/document/)
(`site`, `path`, and `publishedAt`). [AT record keys](https://atproto.com/specs/record-key)
cannot contain slashes.

The read-only migration audit found no existing Standard.site publication or
document records for the documented `demar.ee` identity, and production's
publication verification endpoint returned 404. No AT records were published
as part of this migration. Publication setup and a real publish remain
separate actions.

## Legacy source and imports

Markdoc files in `src/content/posts/` and topic files in `src/content/topics/`
remain import sources rather than the public site's content backend. Their
schemas in `src/content.config.ts` and `keystatic.config.ts` must stay aligned.
Source images belong under `src/assets/images/posts/<slug>/` and use the
`@assets/*` alias. Body images must remain in article content even when they
also serve as featured images.

Offset-free source timestamps mean `America/New_York`, independent of the
host time zone. `src/lib/dates.mjs` handles source parsing and importer
conversion, rejects nonexistent spring DST times, and preserves explicit
instants. CMS publication timestamps identify instants and are formatted in
New York time on the public site.

`pnpm import:emdash` defaults to dry-run and a representative subset. `--all`
selects the remaining full corpus; `--apply` writes locally by default, and
remote writes require `--target=URL`; `--update` permits replacing a changed import. It is a source
importer, not a merge tool for edits made in the CMS. See the setup guide for
exact commands and credential handling.

The WordPress importer fetches every published post and downloads local image
copies. Existing files are skipped unless `--force` is passed, which can
replace local edits. `pnpm import:publications` pulls Substack issues from
`letters.demaree.me` and Medium essays, skipping matching slugs or titles by
default. Limit that run with `--source=substack` or `--source=medium`. These
commands update the local archive only; neither publishes into EmDash.

WordPress formats (`standard`, `aside`, `link`), subtitles, link URLs, and
historical metadata remain available in the imported CMS schema. Local
classification commands likewise affect source front matter; live taxonomy
changes are made in EmDash.
