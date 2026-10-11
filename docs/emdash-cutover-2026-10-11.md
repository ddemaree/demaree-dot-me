# EmDash cutover readiness — October 11, 2026

The public blog on `codex/emdash-poc` now uses EmDash 1.1.0. The migration
integrates into the existing Astro design and targets `standard-site`, which
already has PR #4 to `main`. The production domain has not moved.

The current preview is [the experimental Worker](https://demaree-emdash-poc.bitsandletters.workers.dev/).
Worker version: `f3915d61-b02e-48c0-8813-4fcbecfcacd1`.
It uses the existing D1 database, R2 media bucket, KV session namespace,
image binding, encryption secret, and every-minute scheduled handler.
No corpus reimport, database reset, or production DNS change was performed.

## Implemented behavior

Home, blog, post pages, topic/tag archives, navigation, RSS, and sitemap read
published CMS snapshots at request time. Native topic references and tag
assignments determine archives and links. Publication dates keep their
historical instants; modification metadata follows the CMS editorial timestamp.
Editorial descriptions take precedence over plain-text body excerpts.

The shared Portable Text renderer preserves featured/body images, alt text,
link titles, code, quotes, lists, and editable HTML fallbacks. The existing
sidebar, typography, mobile navigation, standard.site metadata, and external
B&L server island remain in place. Markdoc and development-only Keystatic are
retained as legacy import sources; editing those files does not publish a CMS
change.

Public archives, feeds, sitemap, and ordinary post requests exclude drafts and
pending revisions. EmDash's validated single-post preview/edit context can
render drafts with private/no-store caching and noindex. Missing and draft
public pages use the styled 404; actual CMS query failures return 503.
Public CMS responses use no-store so publishing is visible without rebuilding.

Old `/emdash-test/` paths redirect to the public blog/post templates. The seed
and existing local/remote collections now use `/p/{slug}/`; the small
idempotent D1 migration is in `scripts/migrate-emdash-public-routes.sql`.
WordPress query feed URLs and feed path aliases continue to redirect.

## Verification

| Check | Result |
| --- | --- |
| `pnpm check` | 65 files, zero errors/warnings; five existing hints |
| `pnpm build` | Cloudflare production bundle generated successfully |
| Worker deployment/startup | Successful deployment; Cloudflare startup 20 ms on the initial public-route preview |
| `pnpm check:emdash` | All 386 source posts, 3,495 blocks, 186 body images, 25 HTML fallbacks; editor round trips passed |
| Source date checks | 499 dates plus DST/offset fixtures in four host time zones |
| Deployed acceptance sweep | 465 pages, including all 385 published posts and 73 taxonomy archives; zero failures |
| Rendered CMS media | All 195 distinct rendered image URLs returned nonempty image responses |
| Feed and sitemap | Ten full-content RSS items with stable WordPress GUIDs; 463 canonical sitemap URLs, exact published post set |
| Redirects and visibility | Nine legacy/preview redirects passed; draft and retired post returned 404; preview hosts noindex and disallow crawling |
| Deployed draft preview | Existing scoped OAuth generated an item-scoped two-minute preview; anonymous signed URL returned 200, private/no-store, noindex; unsigned draft remained 404 |
| Local authenticated editing | Existing dev-admin session rendered inline edit markers; archives/feed still excluded the draft; invalid preview token and unauthenticated edit cookie returned 404 |
| Production-host metadata | Local requests using the owned production hostname returned the correct HTTPS canonical/OG URL, indexable metadata, and production robots rules |
| Browser rendering | Desktop and 390px mobile post layout, loaded images, mobile menu, home latest posts, and the B&L server island passed |
| Production-only auth boundary | Deployed development setup bypass returned 403; Keystatic returned 404; OAuth discovery uses the Worker origin |
| AT Protocol publisher | Read-only dry-run read six eligible CMS posts; no Bluesky login, record writes, or verification-file writes |

The deployed acceptance checker is repeatable:

```sh
EMDASH_SITE_URL=https://demaree-emdash-poc.bitsandletters.workers.dev pnpm check:emdash-site
```

It reads the CMS with an existing credential, then checks pages/media
anonymously with concurrency four. It verifies body text as well as titles,
dates, published membership, headers, native taxonomy URLs, RSS GUIDs,
redirects, and image bytes. It does not modify CMS content.

The publisher also repairs inherited AT Protocol defects: unsupported agent
construction, slash-containing record keys, and outdated document fields.
Page verification links and writes share valid `posts-<slug>` identities.
A read-only audit found no existing Standard.site records for the documented
Bluesky identity. Publishing those records remains a separate explicit action.

## Production cutover still pending

The code and preview have passed the migration checks. Production hostname
routing, TLS, and administrator authentication must be verified on the real
hostname at cutover; local Host-header checks cannot prove those external steps.

1. Review/merge this change with the `standard-site` work and promote the
   existing experimental Worker/data to the production hostname using a
   Cloudflare Custom Domain. No new database or media import is required.
2. Update `EMDASH_SITE_URL` to `https://demaree.me`, deploy, and update EmDash's
   Site URL through its checked Change domain flow. Keep the old Worker
   hostname available during sign-in transfer.
3. While signed in at the old hostname in Chrome, use EmDash's Continue on
   the new hostname flow. The owner registers the new domain-bound passkey.
   Start this when the owner is present: the one-time continuation expires
   after five minutes. No new credential was created during these checks.
4. Run the acceptance checker against `https://demaree.me` after authenticating
   its CMS origin, then check admin edit/save/publish, media, and the scheduled
   handler on that hostname. Preserve the current deployment for routing back
   if a domain-specific issue appears.

See EmDash's [domain move guide](https://docs.emdashcms.com/guides/change-domain/)
for the checked domain change and passkey transfer. The site's own sitemap and
robots routes use `astro.config.mjs`'s canonical production URL and hostname
policy. Legacy `i-phone`/`i-pad`/`i-os` label redirects remain intentionally
omitted; the broken-image post stays retired as agreed.
