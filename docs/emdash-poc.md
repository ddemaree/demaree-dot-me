# EmDash proof of concept

This experiment lives in the `codex/emdash-poc` worktree. It integrates EmDash
1.1.0 into the existing Astro design. The public routes on this branch now use
EmDash; the production domain has not been moved.
Use pnpm 11.21.0 and Node.js 22.16 or newer. Node.js 24.20.0 was used for
the full-corpus import and background server verification.

## What runs here

Home, blog, `/p/[slug]/`, topic and tag archives, navigation, feeds, and the
sitemap read published EmDash content at request time. Public requests never
include drafts or pending edits. Single-post pages support EmDash's validated
preview/edit context; private previews are excluded from indexing. Markdoc is
retained as the migration source and historical archive, with Keystatic still
development-only. The external B&L server island keeps its original feed.

`/emdash-test/` redirects to `/blog/`; its post routes redirect to `/p/`.
All pages on the workers.dev and local hosts are `noindex`. The production
hostname enables canonicals and search indexing. CMS responses use `no-store`
so publication and removal are visible without rebuilding. Native topic
references and tag assignments supply the archives and navigation.

EmDash's admin is at `/_emdash/admin`. The `_emdash` live loader coexists with
the B&L loader in `src/live.config.ts`. `seed/emdash-poc.json` supplies schema
and structure, while the importer supplies historical content and media.
Changing a seed after setup does not automatically migrate an existing schema.

The adapter is Cloudflare in this worktree. Astro sessions use its generated
KV binding; EmDash uses the named `DB` D1 and `MEDIA` R2 bindings. D1 read-replica
sessions are explicitly disabled to avoid their interaction with
`global_fetch_strictly_public`; this does not disable administrator sessions.
`src/worker.ts` provides both Astro's fetch handler and EmDash's scheduled
handler, with a matching every-minute Cron Trigger.

## Local setup and import

Run commands from this worktree's repository root:

```sh
pnpm install --frozen-lockfile
pnpm astro dev status
pnpm dev --background
pnpm import:emdash --all
pnpm import:emdash --all --apply
```

Check server status before starting it. The site uses `http://localhost:4321`.
Manage it with `pnpm astro dev logs` and `pnpm astro dev stop`; the verification
server has been stopped.

Local `.dev.vars` contains `EMDASH_SITE_URL=http://localhost:4321` and a local
`EMDASH_ENCRYPTION_KEY`. Generate a new key with `pnpm exec emdash secrets
generate` when setting up another environment. `.dev.vars`, `.dev.vars.*`,
`.emdash/`, generated types, and `.wrangler/` are ignored. Keep keys out of
Git and retain each environment's encryption key separately from its database.

The default import is a read-only dry-run of eight representative posts.
`--all` selects every remaining source post. Neither dry-run makes CMS requests. `--apply` uploads media, creates topics/tags and entries,
sets relationships, and publishes only originally published records with their
historical dates. Local apply uses EmDash's development-only setup/token route;
that route rejects production requests.

Useful flags:

| Flag | Behavior |
| --- | --- |
| `--dry-run` | Explicitly plan without CMS requests or file writes |
| `--apply` | Apply the planned import to the selected target |
| `--slugs=one,two` | Select specific existing local slugs |
| `--all` | Select the full corpus; cannot be combined with `--slugs` |
| `--concurrency=4` | Parallel post work; defaults to four, accepts one through eight |
| `--target=https://…` | Explicit remote HTTPS origin; defaults to localhost |
| `--update` | Allow replacement of changed imported entries after review |

The importer refuses untracked slug collisions. Per-target manifests in
`.emdash/imports/` record source hashes, content hashes, and media mappings.
Unchanged runs verify and skip existing entries; detected CMS body edits are
preserved unless `--update` is supplied. Do not treat `--update` as a merge.
The importer checks status, dates, metadata, content, topic, and tag assignments
after writing. For this migration the repository is authoritative, and the PoC
data can be rebuilt. No additional conflict protection or recovery workflow is
required for this initial load; no database reset has been performed.

The image-upload path accepts local post-image aliases. The one post with an
external `cl.ly` image, “Filtering GitHub email notifications”, has been retired
from this branch and remains recoverable in Git. The remaining corpus has 386
posts: 385 published and one draft. Cleaner tag slugs such as `iphone`, `ipad`,
and `ios` are intentional; the existing archive helper now uses them too.

Offset-free source dates are parsed through `src/lib/dates.mjs` as New York
wall time, then sent as explicit UTC instants. Original metadata and update
dates remain separate from CMS editorial timestamps. Public modification
metadata now follows EmDash’s `updatedAt`, including import-time writes, so
later CMS edits advance it; publication dates retain their historical instants.

Local D1, R2, and KV state is isolated under `.wrangler/state/`. The adapter uses
`remoteBindings: false`. Deploying code does **not** transfer this local data;
remote content must be imported or transferred separately.

## Experimental Cloudflare target

Deployed successfully to [the experimental Worker](https://demaree-emdash-poc.bitsandletters.workers.dev/emdash-test/)
on October 2, 2026. Its first administrator was created with a passkey. Sign-in
and the authenticated dashboard work in Chrome; the Codex in-app browser stalled
while waiting for the passkey authenticator. The remaining corpus has been imported into both local and remote data stores:
385 published posts, one draft, 199 deduplicated media objects from 201 image
aliases, five topics, and 68 tags.

| Resource | Configuration |
| --- | --- |
| Cloudflare account | Bits and Letters |
| Worker | `demaree-emdash-poc` |
| D1 database | `demaree-emdash-poc` |
| D1 ID | `573cf7d8-e8b7-4621-b802-3b37317e9440` |
| R2 bucket | `demaree-emdash-poc-media` |
| Session KV | `demaree-emdash-poc-session` (`e11083a3ed6e4fcca5937af316917fd2`) |
| Runtime site origin | `EMDASH_SITE_URL` in `wrangler.jsonc` |
| Runtime encryption | `EMDASH_ENCRYPTION_KEY` as a Worker secret |

Build and deploy with `pnpm build` and `pnpm exec wrangler deploy`. Deploy the
Astro-generated Wrangler configuration: it includes the adapter's session and
image bindings in addition to the source configuration. Keep the stable admin
origin configured before registering production passkeys.

For a new environment, complete administrator setup, then authenticate the
importer. The scoped helper prints a verification URL and code; approve that
code in Chrome while the command waits:

```sh
pnpm login:emdash --url=https://demaree-emdash-poc.bitsandletters.workers.dev
pnpm import:emdash --all --target=https://demaree-emdash-poc.bitsandletters.workers.dev
pnpm import:emdash --all --target=https://demaree-emdash-poc.bitsandletters.workers.dev --apply
```

The helper requests the content, media, schema-read, and taxonomy scopes used
by the importer. It handles raw OAuth and legacy wrapped responses, waits up to
15 minutes, and stores credentials atomically with private file permissions.
If a code expires, run the helper again. The standard EmDash CLI login command
also uses the same credential store.

Remote apply reads the existing EmDash CLI credential for that origin from
`~/.config/emdash/auth.json` (or `XDG_CONFIG_HOME`). `EMDASH_API_TOKEN` or
`EMDASH_TOKEN` can supply a personal access token instead. Import manifests
never include credentials. Production setup and authentication
must use a real administrator; the local bypass is unavailable there.

See the official [Cloudflare deployment guide](https://docs.emdashcms.com/deployment/cloudflare/)
and [site-transfer guide](https://docs.emdashcms.com/guides/site-transfer/).

## Historical proof-of-concept evidence (October 2)

Both local and remote full imports passed post-write verification. Repeats
against both databases verified and skipped all 386 entries without duplicating
posts or media (zero imported, 386 unchanged).
The remote import resumed after transient request timeouts and a switch to
four workers, using existing checkpoints; no database reset was needed.
Per-post verification checked the body, metadata, status, dates, topics, and tags. Local authenticated API editing and publishing
changed the rendered page without rebuilding; the test changes were restored.

In the deployed Chrome admin, the Fuji review and Ageism post each passed a body
edit, save-as-draft, publish, remove-edit, and publish-again cycle. Draft edits
remained absent from the public page; publication changed it without a rebuild.
API comparisons confirmed all other Portable Text blocks, image references,
marks, HTML blocks, custom fields, and historical publication dates were exact.
After restoration, both bodies matched their pre-test data exactly. The Fuji
review retained 46 blocks; Ageism retained 10, including its quotation/list HTML.
The initial seven published remote sample pages returned 200; the original
draft and a missing slug returned 404. After the full local import, all 385
published CMS pages returned 200 with noindex; the draft and retired post
returned 404, as did invalid pagination. The index showed 39 pages with five
posts on the last page. The preferred iphone/ipad/ios label archives returned
200, and all 201 source image aliases resolved through 199 media objects. All 15 distinct image URLs in the Fuji review returned
nonempty WebP images through the deployed image pipeline.

After the full remote import and final deployment, the deployed preview showed
“All posts,” 385 published entries, noindex, and 39 pages with five entries on
the last page. Invalid pagination, the original draft, and the retired post
returned 404; the retired post was also absent from the source-backed `/p/`
route. The preferred iphone/ipad/ios archives and two additional imported posts
returned 200. Deployed Worker version: `1801c183-8c50-4137-8963-2bf2d622c7c1`.

`pnpm check:emdash` audited all 386 remaining source posts: 3,495 Portable Text blocks,
186 body images, and 25 HTML fallbacks. It verifies text, image metadata, link
destinations, deterministic keys, sanitizer behavior, and exact round trips
through the installed EmDash admin's conversion functions. Complex quotes,
complex lists, and inline images use editable HTML blocks to preserve their
structure. These sections remain editable as HTML rather than as individual
native rich-text nodes. The whole-corpus check exercises ProseMirror JSON
conversion; the representative browser acceptance tests above additionally
exercise actual save and publication behavior.

`node scripts/check-content-dates.mjs` passed 499 stored dates and DST/offset
fixtures in four host time zones. `pnpm check` passed with zero errors and five
existing hints; `pnpm build` passed and generated the deployed Cloudflare Worker.
Remote startup, stable-origin OAuth discovery, and administrator sign-in passed.
The production development bypass returns 403 and Keystatic returns 404.
A remote Cron event at 2026-10-02 16:10:53 UTC ran successfully with outcome
`ok`, zero exceptions, and no error logs. Initial delivery took about 13 minutes
after the trigger was created. This confirms the handler executes remotely;
scheduled-content behavior also passed a separate fixture. A temporary post
was scheduled for `2026-10-02T16:55:23.238Z` and observed published at
`16:56:03.953Z`, with its scheduled timestamp retained as `publishedAt`, its
schedule cleared, and its body visible at a public 200 response. It was then
soft-deleted into recoverable trash; the route returned 404 and the sample
returned to seven published posts. An earlier short observation window ended
before the next delivery and was inconclusive.

Public routes, feeds, sitemap, and the publishing script have since been
converted. Current deployment checks and remaining production cutover steps
are recorded in [the October 11 report](emdash-cutover-2026-10-11.md). Backup/site-transfer testing can be revisited if
needed; the agreed PoC workflow treats the repository as the import source and
the experimental database as disposable.


## Existing schema URL migration

Changing the seed does not update an installed collection. This branch includes
an idempotent URL-pattern migration, applied to both local and remote D1:

```sh
pnpm exec wrangler d1 execute demaree-emdash-poc --local --file scripts/migrate-emdash-public-routes.sql
pnpm exec wrangler d1 execute demaree-emdash-poc --remote --file scripts/migrate-emdash-public-routes.sql
```

It changes only the posts collection’s URL pattern from `/emdash-test/{slug}/`
to `/p/{slug}/`, so admin View and Preview links reach the public template.
