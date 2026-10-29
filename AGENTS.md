# Project instructions

This repository is the in-progress Astro rebuild of `demaree.me`.
EmDash 1.2.0 is the public content backend. Astro
uses server output and the Cloudflare adapter; home, blog, post, topic, tag,
feed, and sitemap routes read CMS data at request time. The experimental
Worker remains the deployment target; the production domain has not moved.

## EmDash and Cloudflare

Follow [docs/emdash-poc.md](docs/emdash-poc.md) for setup, import commands,
authentication, and verification evidence. Follow
[docs/emdash-cutover-2026-10-29.md](docs/emdash-cutover-2026-10-29.md) for the
current deployment connection and domain/passkey transfer sequence.

- Preserve the Cloudflare adapter, server output, `DB`/`MEDIA` bindings, Astro
  sessions, and Worker scheduled handler. D1 `session: 'disabled'` refers to
  replica sessions, not disabling Astro authentication.
- Normal public queries must use published CMS snapshots, including requests
  from an editor's session. Explicit authenticated draft previews must stay
  private, uncached, and excluded from indexing. Do not expose drafts in public
  indexes, topic/tag archives, feeds, or sitemaps.
- `src/lib/taxonomy.ts` owns public CMS queries and normalization. Use native
  topic relations and taxonomy terms, rather than imported legacy tag fields.
  Missing content is 404; actual CMS dependency failures are 503.
- Public content responses currently use `no-store` for immediate publication
  and removal visibility. Do not introduce caching without verifying
  invalidation and draft exclusion.
- Keep preview hosts excluded from indexing. Domain cutover requires updating
  the CMS origin and authentication setup; deploying code alone does not move
  `demaree.me`.
- Keep local bindings local with `remoteBindings: false`. Local D1/R2 data does
  not transfer on deployment. Remote imports require an explicit target and
  authorization for that target.
- `pnpm import:emdash` defaults to dry-run. `--all` selects the remaining full
  corpus, `--apply` writes CMS data, and `--update` permits replacing changed
  imports. It is not a merge operation. Preserve importer conflict checks and
  historical date handling.
- Keep `.dev.vars`, `.emdash/`, `.wrangler/`, and generated `emdash-env.d.ts`
  out of commits. Never commit credentials or encryption keys.
- Licensed fonts load from their existing hosted CSS configuration. Do not
  replace them or add font binaries to the repository.

## Toolchain and validation

- Use the package manager pinned by `packageManager`: pnpm 11.21.0.
- Use Node.js 22.16 or newer; Node 24 was used for migration verification.
- Do not substitute npm or Yarn commands or generate another lockfile.
- TypeScript extends Astro's strict configuration.
- There is no separate test runner or linter. Validate code with `pnpm check`
  and `pnpm build`.
- For converter or Portable Text renderer changes, also run
  `pnpm check:emdash`. Browser editor interaction and remote deployment
  behavior require separate verification.

## Development server

Always run the development server in background mode from the repository root:

```sh
pnpm dev --background
```

Manage that process with repository-local Astro commands:

```sh
pnpm astro dev status
pnpm astro dev logs
pnpm astro dev logs --follow
pnpm astro dev stop
```

Check status before starting a server, and stop any server you started when it
is no longer needed. The site runs at `http://localhost:4321`; EmDash admin is
at `/_emdash/admin`, and the legacy local Keystatic editor is at `/keystatic`.

## Architecture and conventions

- `src/pages/` owns file-based routes. Public routes include `/`, `/about/`,
  `/blog/`, `/p/[slug]/`, `/topics/`, `/topics/[slug]/`, `/labels/`,
  `/labels/[slug]/`, `/feed.xml`, `/sitemap.xml`, and `/robots.txt`.
- CMS-dependent pages and navigation render on demand. Do not prerender CMS
  snapshots during the build. Old `/emdash-test/` URLs redirect to the normal
  public blog/post routes.
- `src/layouts/BaseLayout.astro` owns the document shell and shared site chrome.
- `src/components/` contains shared UI and Portable Text renderers.
- `src/styles/global.css` contains site styles and imports Tailwind CSS 4.
- `src/assets/` holds assets processed by Astro; `public/` holds files copied
  unchanged and referenced by root-relative URLs. The `@assets/*` alias maps
  to `src/assets/*`.
- Preserve trailing slashes in internal page links.
- Preserve existing WordPress RSS GUIDs and the ten-post feed window.

## Legacy source and Keystatic

- Markdoc posts in `src/content/posts/` and topic documents in
  `src/content/topics/` remain import source / historical archive. Public
  routes read EmDash, so editing these files does not publish a live change.
- Keep `src/content.config.ts` and `keystatic.config.ts` aligned when changing
  source fields, validation, or asset paths.
- Keystatic uses local storage and changes repository files directly. It has
  no remote storage or authentication setup. Keep its UI and API excluded from
  production builds.
- Offset-free source timestamps mean `America/New_York`, independent of the
  host time zone. Use `src/lib/dates.mjs` for source parsing and importer
  conversion; verify source date changes with
  `node scripts/check-content-dates.mjs`.
- Store source post images in `src/assets/images/posts/<slug>/` and reference
  them as `@assets/images/posts/<slug>/<filename>`. Preserve body images when
  the same image is also featured.
- The WordPress importer fetches every published post. Existing local files
  are skipped unless `--force` is passed, which can replace local edits. Do
  not run it unless the task calls for an import.
- `pnpm import:publications` imports Substack and Medium posts missing from
  the source archive. Existing local slugs and matching titles are skipped
  unless `--force` is passed. Do not run it unless the task calls for an import.
- Source importers and `pnpm taxonomy:assign` affect repository files only;
  live editorial changes are made in EmDash.

## Generated files

Do not edit or commit generated output in `dist/`, `.astro/`, `.vercel/`, or
`node_modules/`.

## Relevant documentation

Consult the appropriate official guide before changing the related area:

- [Routing](https://docs.astro.build/en/guides/routing/)
- [Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Framework components](https://docs.astro.build/en/guides/framework-components/)
- [Content collections](https://docs.astro.build/en/guides/content-collections/)
- [Styling](https://docs.astro.build/en/guides/styling/)
- [Cloudflare deployment](https://docs.astro.build/en/guides/deploy/cloudflare/)
- [EmDash documentation](https://docs.emdashcms.com/)
