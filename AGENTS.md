# Project instructions

This repository is the in-progress Astro rebuild of `demaree.me`. The current
site is mostly static: Astro prerenders the home page, blog index, and published
post pages. Topic and tag archives render on demand. The Vercel adapter also
packages the Keystatic server endpoints.

## Toolchain

- Use the package manager pinned by `packageManager`: pnpm 11.21.0.
- Use Node.js 22.12 or newer.
- Do not substitute npm or Yarn commands or generate another lockfile.
- TypeScript extends Astro's strict configuration.
- There is no separate test runner or linter configured. Validate changes with
  `pnpm check` and `pnpm build`.

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

Before starting a server, check its status. Stop any server you started when it
is no longer needed. The site runs at `http://localhost:4321`; the local
Keystatic UI runs at `/keystatic`.

Astro's local-font build pipeline opens a temporary loopback listener. If
`pnpm build` fails with a sandbox-level `listen EPERM`, rerun it with the
permission needed to bind that listener rather than changing project code.

## Architecture and conventions

- `src/pages/` owns file-based routes. The implemented public routes are `/`,
 `/blog/`, `/p/[slug]/`, `/topics/`, `/topics/[slug]/`, `/labels/`, and
 `/labels/[slug]/`.
- Topic and tag archives are rendered on demand (`prerender = false`) so the
 build does not generate a static page for every label.
- `src/layouts/BaseLayout.astro` owns the document shell and shared site chrome.
- `src/components/` contains shared Astro components. React is installed and
  integrated, but the current pages do not use React components.
- `src/styles/global.css` contains the site styles and imports Tailwind CSS 4.
- `src/assets/` is for assets processed by Astro. `public/` is for files copied
  unchanged and referenced by root-relative URLs.
- Local fonts and their CSS variables are configured in `astro.config.mjs`.
- The `@assets/*` alias maps to `src/assets/*`.
- The Vercel adapter is the deployment target. Do not remove it solely because
  the public pages are prerendered; Keystatic also contributes server routes.
- Preserve trailing slashes in internal page links, matching the existing site.
- Some About and topic links intentionally target the existing production site;
  corresponding local routes do not exist yet.

## Content and Keystatic

- Posts are Markdoc files in `src/content/posts/`.
- Keep `src/content.config.ts` and `keystatic.config.ts` aligned when changing
 post fields, validation, or asset paths. Topic documents live in
 `src/content/topics/` and must stay aligned as well.
- Keystatic uses local storage. Editing at `/keystatic` changes repository files
  directly; it has no remote storage or authentication configuration.
- Both the blog index and `getStaticPaths()` explicitly exclude posts whose
  `draft` field is true. Preserve that behavior unless the task says otherwise.
- Store post images in `src/assets/images/posts/<slug>/` and reference them as
  `@assets/images/posts/<slug>/<filename>`.
- The WordPress importer fetches every published post. Existing local files are
  skipped unless `--force` is passed. Do not run it unless the task calls for
  an import. `--force` can replace locally edited content.
- `pnpm import:publications` imports Substack (`letters.demaree.me`) and Medium
  posts that are not already present. Existing local slugs and matching titles
  are skipped unless `--force` is passed. Do not run it unless the task calls
  for an import.

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
- [Vercel deployment](https://docs.astro.build/en/guides/integrations-guide/vercel/)
