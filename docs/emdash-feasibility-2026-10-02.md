# EmDash feasibility assessment — October 2, 2026

EmDash is a credible replacement for this site's Markdoc + Keystatic backend. The recommended experiment is to add it to a worktree of the existing site, using the Cloudflare starter as a configuration reference. The design, routes, branding assets, fonts, and B&L integration can carry forward. Content conversion and production authentication deserve the most attention.

Update after the experiment: existing-project integration succeeded in the
`codex/emdash-poc` worktree, and [the Cloudflare preview](https://demaree-emdash-poc.bitsandletters.workers.dev/emdash-test/)
is running on the Bits and Letters account. The broken-image post “Filtering
GitHub email notifications” was retired from the experimental branch. Both
local and remote imports now contain the remaining 385 published posts, one
draft, five topics, 68 tags, and 199 deduplicated images. Repeat imports verified
all 386 entries without creating duplicates. All remaining source posts passed
conversion/editor-JSON round-trip checks; deployed browser edit, save, publish,
and restore tests passed for the Fuji review and Ageism post. Remote scheduled
publication also passed. Type checking, build, and date checks passed.
Public route migration is now implemented; see the [October 11 cutover report](emdash-cutover-2026-10-11.md) for current evidence. Domain cutover remains pending. The owner considers the
experimental database disposable, so additional backup and conflict-protection
work is outside this proof. Cleaner importer tag URLs are accepted without
legacy redirects. Current commands and evidence are in `docs/emdash-poc.md` in
that worktree. The assessment below records the initial findings and proposed
proof, including requirements subsequently simplified by these decisions.

This assessment inspected the current checkout, published package metadata for `emdash@1.1.0` and `@emdash-cms/cloudflare@1.1.0`, and upstream source commit [`9d4962125370ca03b43179232740da47409f4088`](https://github.com/emdash-cms/emdash/tree/9d4962125370ca03b43179232740da47409f4088). It includes a content audit and an executed probe of the upstream Markdown converter. At the time of this initial assessment, the build and account deployment had not yet been tested.

| Exploration | Finding | Remaining proof |
| --- | --- | --- |
| Existing site versus starter | Existing-project integration is supported; current dependency versions satisfy declared requirements. | Install pinned EmDash packages in an isolated worktree and render CMS content through the existing layout. |
| Import and data environments | The local corpus is manageable, but the built-in Markdown converter and seed publishing are unsuitable for preserving it faithfully. | Implement and verify an AST converter, media import, historical dates, and a repeatable import. |
| Cloudflare | Workers + D1 + R2 are the documented deployment stack. Several differences from the current config are identified below. | Authenticate Wrangler, deploy a separate experimental Worker, and test admin/content/media behavior remotely. |

**1. Preserve the current codebase and replace its content access gradually.**

The actual code is already on Astro 7.3.3, React 19, Cloudflare adapter 14.3.2, and Wrangler 4.134.0. Node is 24.20.0, and pnpm resolves to the required 11.21.0. EmDash requires Node 22.16 or newer; the current site meets that requirement. The README and AGENTS.md describe an older Vercel/local-font setup: the live configuration selects Cloudflare, and font CSS loads licensed fonts from `fonts.demaree.me`.

EmDash is an Astro integration and has an [existing-project guide](https://docs.emdashcms.com/existing-project/). Its [Astro guide](https://docs.emdashcms.com/coming-from/astro/) permits file collections and CMS collections to coexist. Starting over with the starter would require restoring established routes, feed semantics, metadata, and visual components. A starter deployment can still serve as a useful control experiment if the integrated site fails.

For the first experiment, preserve the existing rendering mode and add a small `/emdash-test/` route with `prerender = false`. Register EmDash with D1 and R2, enable Astro sessions, and add its `_emdash` live loader alongside the existing `bnlPosts` loader in `src/live.config.ts`. This tests the CMS without immediately converting every page. EmDash's injected admin/API routes already render on demand.

For the completed migration:

- Configure the Posts collection URL pattern as `/p/{slug}/`; preserve current slugs and trailing slashes.
- Replace local post queries with `getEmDashCollection()` / `getEmDashEntry()`. Replace Markdoc rendering with EmDash's Portable Text component and adapt component props and taxonomy helpers.
- Render CMS-dependent home, blog, post, archive, feed, and sitemap responses at request time. Publishing then becomes visible without rebuilding. Public queries must retain published-only behavior and honor the published revision. [Query guide](https://docs.emdashcms.com/guides/querying-content/).
- When switching to `output: "server"`, replace `/p/[slug]/`'s `getStaticPaths()` and `Astro.props.post` together. Changing only the output mode would leave that route without its expected props.
- Keep `BaseLayout`, header/footer, styles, About page, branding assets, fonts, and the B&L server island. Adapt `BaseLayout`'s featured-image prop from Astro `ImageMetadata` to CMS media metadata.
- Migrate the existing feed and sitemap explicitly. EmDash detects user-defined sitemap/robots routes and leaves them in charge. Retain full-content RSS, the ten-item window, WordPress GUIDs, metadata, and draft exclusion.
- Update `scripts/publish-standard.mjs` to consume CMS content if AT Protocol publishing should continue after cutover.

Use a Topics collection plus a one-topic relation initially: that preserves `title`, `description`, `inNav`, and `navOrder` directly. Tags map to an EmDash taxonomy. A topic taxonomy plus CMS navigation is another viable model, but needs an explicit mapping for the extra navigation fields. [Relations](https://docs.emdashcms.com/guides/relations/), [taxonomies](https://docs.emdashcms.com/guides/taxonomies/).

**2. Import the local corpus through a custom, repeatable converter.**

The repository contains 387 posts: 386 published and one draft (`test-content`), five topics, 69 distinct tags, and 201 post-image files totaling 58,486,964 bytes. Formats are 107 standard, 279 link, and one aside. The local files are the canonical migration input because they contain the current edits and publication imports. Preserve existing tag slug rules (including `i-pad`, `i-phone`, and `i-os`) and the public label index's exclusion of source tags.

An audit using the installed Markdoc parser found ordinary Markdown structure with no custom Markdoc tags, tables, or raw HTML nodes. Relevant cases include 1,393 emphasis nodes, 823 links, 343 blockquotes, 50 horizontal rules, 29 fenced code blocks, and 187 body images. There are nested quotes/lists, formatted link labels, and two images in one paragraph in the Fuji review. One body image uses an external `cl.ly` URL; its availability remains unverified. All local asset references resolve. Two of the 201 files duplicate other files byte for byte.

The upstream [`markdownToPortableText()` source](https://github.com/emdash-cms/emdash/blob/9d4962125370ca03b43179232740da47409f4088/packages/core/src/client/portable-text.ts#L179) was executed against small fixtures:

| Input | Observed output | Migration consequence |
| --- | --- | --- |
| `*important*` | Literal asterisks, no emphasis mark | All 1,393 existing emphasis nodes use this marker. |
| A horizontal rule (`---`) | A paragraph containing `---` | Rules need a supported block representation. |
| A paragraph wrapped across two source lines | Two paragraph blocks | Paragraph structure changes. |
| An image using `@assets/...` | `asset.url` retains the alias | Files are not uploaded and the browser cannot resolve the alias. |

Use Markdoc's AST rather than regex conversion. Map paragraphs, headings, spans/marks, link annotations, code, list nesting, quotes, breaks, and images to EmDash-supported block shapes. Unsupported structures must produce a diagnostic with the source slug/location; they must not silently disappear. Compare text, link destinations, block structure, and rendered output against the current site. Preserve image placement and captions/alt text, including inline or consecutive images.

Editor round trips are a separate acceptance requirement: the inspected [ProseMirror-to-Portable-Text quote conversion](https://github.com/emdash-cms/emdash/blob/9d4962125370ca03b43179232740da47409f4088/packages/core/src/content/converters/prosemirror-to-portable-text.ts#L310) handles paragraph children. The 11 quotes containing lists or nested quotes need a tested custom/preserved block strategy. Open and save those posts in the admin and compare the resulting data/rendering; importing valid-looking JSON alone does not prove the editor preserves it.

Suggested field mapping:

| Current value | EmDash destination |
| --- | --- |
| Filename slug | Entry slug |
| `title`, `description` | Title and editorial description fields |
| Markdoc body | Rich-text field containing Portable Text |
| `publishedAt` | Historical CMS publish timestamp supplied as a top-level API override; optionally preserve the original string as migration metadata |
| `updatedAt` | Original-update field, separate from the CMS's new editorial modification timestamp |
| `draft` | Draft/published lifecycle state |
| `topic`, `tags` | Topic relation and tag term assignments |
| `featuredImage`, body images | Uploaded media references; retain alt text |
| `format`, `subtitle`, `linkUrl` | Equivalent custom fields |
| `wordpressId`, `sourceUrl` | Equivalent fields for feed identity and provenance |

Parse dates with the existing `parseContentDate()` and serialize instants with explicit offsets or UTC. The current offset-free values mean New York wall time. A naive host-local `new Date(value)` would change historical instants on another machine.

EmDash's loader exposes system timestamps under camelCase names such as `data.publishedAt`. Do not define a custom field with that name and expect it to override the system publication date. Preserve the 113 original update dates in a separate field. Most editorial descriptions are currently empty (326 posts), so retain the existing excerpt fallback rather than make populated descriptions an import requirement.

Use a seed for schema/structure, then import actual content separately. The inspected [seed application code](https://github.com/emdash-cms/emdash/blob/9d4962125370ca03b43179232740da47409f4088/packages/core/src/seed/apply.ts#L1025) publishes seed entries with the current time. The [REST publish schema](https://github.com/emdash-cms/emdash/blob/9d4962125370ca03b43179232740da47409f4088/packages/core/src/api/schemas/content.ts#L296) accepts a historical `publishedAt` override with `content:publish_any`. Create imported entries as drafts, verify them, then publish the 386 published sources with their historical timestamps. Preserve `test-content` as a draft and verify it is inaccessible publicly.

Make the importer default to dry-run, identify entries by source slug/identity, and record source hashes and source-to-media/entry mappings per target environment. A repeat run should skip identical entries; if a CMS entry has been edited since import, report a conflict rather than overwrite it. Upload media once per content hash, then resolve references. Seed/schema changes, media upload, entry creation, relation assignment, and publication should have separate resumable stages.

For data environments, use local emulated D1/R2/KV with the Cloudflare adapter, separate experimental remote resources, and a production database/bucket/session namespace. Local state lives under `.wrangler/state/v3` and is distinct from remote data. Set `cloudflare({ remoteBindings: false })` during the experiment to enforce local bindings. Do not expect `wrangler deploy` to transfer local content. After verifying a complete local import, EmDash's [site-transfer package](https://docs.emdashcms.com/guides/site-transfer/) can move schema, content/history, and media into an empty target across database types. It excludes credentials/secrets, and is not a recurring merge into an existing production CMS. After cutover, production becomes the editorial source; use exports/backups or a separate fixture dataset for development.

**3. Verify Cloudflare with an experimental Worker and explicit runtime configuration.**

The current `wrangler.jsonc` has static assets and an Astro Worker entry point, but no CMS database/media bindings, scheduled handler, or `nodejs_compat`. Enable Astro sessions: `session: false` currently opts out, and EmDash sign-in needs a session driver. The installed Cloudflare adapter supplies its KV driver and a generated `SESSION` binding when sessions are enabled. Inspect the generated config to confirm the deployed namespace. D1 database sessions are a different feature. [Astro sessions](https://docs.astro.build/en/guides/sessions/), [EmDash session check](https://github.com/emdash-cms/emdash/blob/9d4962125370ca03b43179232740da47409f4088/packages/core/src/astro/integration/index.ts#L282).

Add matching `DB`/`MEDIA` bindings and `nodejs_compat`; use EmDash's Worker wrapper and Cron handler. Configure runtime secrets and the intended sign-in origin. Named environments must repeat their resource bindings. Inspect `.wrangler/deploy/config.json` and its referenced merged config after building. Start at an experimental hostname. [Cloudflare deployment guide](https://docs.emdashcms.com/deployment/cloudflare/).

Add `.dev.vars` and `.dev.vars.*` to the experiment's `.gitignore` before storing local Worker secrets: those files are currently unignored. Preserve the encryption key separately from database backups. Schema seeds bootstrap a new database; editing a seed after setup does not automatically evolve the persisted model.

The repository already sets `global_fetch_strictly_public`. Upstream [issue #1273](https://github.com/emdash-cms/emdash/issues/1273) reports hangs when that flag is combined with D1 `session: "auto"`. Current source adds a hang guard/fallback; the issue is closed. The starter still uses `session: "auto"`, whereas the database default and deployment guide use disabled D1 sessions. For the experiment explicitly use `d1({ binding: "DB", session: "disabled" })`. This is a relevant configuration risk, not evidence of what caused the previous attempt.

Sandboxed marketplace/registry plugins require a Workers Paid plan, `LOADER`, and the plugin bridge. The starter comments out the loader so a basic CMS can be tested without sandboxed plugins. Omit the sandbox runner during the first proof. [Plugin sandbox guide](https://docs.emdashcms.com/deployment/plugin-sandbox/).

The initial `pnpm exec wrangler whoami` reported **not authenticated**. Account access, existing resources, plan eligibility, and a successful remote deployment remain unverified. Authenticate with `pnpm exec wrangler login`, then repeat the account check before provisioning experimental resources. Use a dedicated CMS media bucket; keep the existing font bucket separate. Configure the stable admin origin before passkey registration. Verify recovery/email separately if magic-link sign-in is desired.

**Recommended sequence and acceptance criteria.**

1. Create an isolated worktree from the current site. Pin EmDash 1.1.0 and keep pnpm 11.21.0. Add the CMS and a temporary smoke route; use `/emdash-test/{slug}/` as its temporary collection URL pattern so admin View links open CMS pages. Verify local migrations, admin sessions, editing, and media upload.
2. Import representative cases: a plain post, link-format post, code post, image-heavy Fuji review, nested quote/list post, an old dated post, and the draft. Render through the existing design. Compare dates, markup, images, social metadata, and feed GUIDs.
3. Authenticate and deploy a separate Worker/database/bucket/session namespace. Verify public render, admin sign-in, upload/retrieval, edit/publish without rebuilding, restart persistence, and scheduled publishing in remote logs. A working local schedule does not verify the deployed Cron wiring.
4. Run the full import with a manifest. Verify all 387 source records, five topics, every media reference, draft exclusion, stable URLs, preserved date ordering, and a no-op repeat import. Exercise backup/site transfer and restoration before cutover.
5. Switch public content routes and publishing scripts, then test preview behavior and cache invalidation. Retain the earlier DNS/legacy URL audit as a separate cutover requirement. Update stale project documentation when the target architecture is implemented.

Initial baseline validation on the existing site passed: `pnpm check` (zero errors, five existing hints), `pnpm build` (Cloudflare output), and `node scripts/check-content-dates.mjs` (500 content dates plus DST/offset fixtures in each of four host time zones). These baseline checks validated the starting point; the experiment update above records the subsequent integration and deployment proof.
