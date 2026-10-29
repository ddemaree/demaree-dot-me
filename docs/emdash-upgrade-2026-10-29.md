# EmDash 1.4.0 upgrade — October 29, 2026

Status: source compatibility review, local validation, and the production
migration precheck passed. Deployment and production acceptance are pending.
Tracked in [DEM-28](https://linear.app/bitsandletters/issue/DEM-28/demaree-dot-me-upgrade-emdash-to-140).

The live npm `latest` tags were checked on October 29: both `emdash` and
`@emdash-cms/cloudflare` resolve to **1.4.0**, upgrading this site from 1.2.0.
Keep the two direct dependencies on the same exact version; the Cloudflare
package depends on its matching core release.

To fulfill the explicit request for the latest release, the existing pnpm
`minimumReleaseAgeExclude` entries were expanded to permit exactly 1.4.0 for
`emdash`, `@emdash-cms/admin`, `@emdash-cms/auth`, `@emdash-cms/blocks`,
`@emdash-cms/cloudflare`, and `@emdash-cms/gutenberg-to-portable-text`.
Existing exceptions remain; no broad package or release-age policy was relaxed.

## Verified compatibility

- Comparing the official `emdash@1.2.0` and `emdash@1.4.0` source tags found no
  added, removed, or changed numbered core migration files, through
  `091_redirect_artifacts`. Their Git blob hashes are identical. Migration
  policy and runner code changed; the new `content-sized.ts` helper guards the
  existing `079_datetime_normalization` migration. An unfinished upgrade now
  returns 503 instead of serving an empty page with status 200. The generated
  manifest confirms the same 90 ordered migration names, and production has
  all 90 applied with no pending or unknown names and no held lock.
- The native `cloudflareEmail()` plugin's executable code and configuration
  shape are unchanged. Its comments now correctly describe automatic activation
  and selection. Keep the existing `EMAIL` binding, sender restriction, and
  `EmDash <noreply@demaree.me>` sender. No email setup change is required.
- Magic-link send and verify route files are identical between these releases.
  The release notes require no passkey reset or domain handover. Auth fixes
  include cleanup of expired OAuth records and standard `invalid_grant` errors;
  they do not require changing this site's origin or authentication settings.
- EmDash no longer supplies automatic `cacheHint.lastModified` values. This
  site's public query helpers discard those hints and public content uses
  `no-store`, so no cache adaptation is needed. The sitemap already uses
  `post.data.updatedAt` or `publishedAt`. The B&L RSS loader supplies its own
  independent hint and is unaffected.
- Public query fixes improve D1 reads without changing this site's scalar
  pagination, publication filtering, or native topic-relation lookup. The
  related numbered migrations are unchanged.
- Node remains **22.16 or newer**. Relevant Astro, React, and Cloudflare adapter
  peer minimums are unchanged. Wrangler becomes optional for consumers that do
  not use the plugin sandbox; this project still needs it for deployment.

Sources: [core changelog](https://github.com/emdash-cms/emdash/blob/emdash%401.4.0/packages/core/CHANGELOG.md),
[Cloudflare changelog](https://github.com/emdash-cms/emdash/blob/emdash%401.4.0/packages/cloudflare/CHANGELOG.md),
[auth changelog](https://github.com/emdash-cms/emdash/blob/emdash%401.4.0/packages/auth/CHANGELOG.md),
[migration sources](https://github.com/emdash-cms/emdash/tree/emdash%401.4.0/packages/core/src/database/migrations),
and [official upgrade guide](https://docs.emdashcms.com/deployment/updating/).

## Validation and deployment

- Passed using pnpm 11.21.0: dependency installation, `pnpm check`, `pnpm build`,
  and `pnpm check:emdash`. Astro checked 65 files with zero errors, zero warnings,
  and five existing hints. Content checks covered 386 posts, 3,495 blocks,
  186 body images, 25 HTML fallbacks, and 386 successful round trips.
- Passed: the generated migration manifest has the same 90 ordered names as
  the 1.2.0 baseline, with none added or removed. Its fingerprint changes
  because EmDash hashes `JSON.stringify({ emdashVersion, names })`, not migration
  source or compiled bundles. Changing only the version with the same names
  reproduces both fingerprints: `6d2ee569f432f98c22f03cba75f8868d229d5ec9a8663104dfef45811e581f1a`
  for 1.2.0 and `d72e86d4d9dd878eabd4a1e1f106e333f8d7734c9911ef226018a61831b9e01f`
  for 1.4.0. See [migration identity source](https://github.com/emdash-cms/emdash/blob/emdash%401.4.0/packages/core/src/migrations/identity.ts).
- Passed: read-only D1 queries through the connected Cloudflare account
  found all 90 expected `_emdash_migrations` names, no pending or unknown
  migrations, and `_emdash_migrations_lock.is_locked = 0`; zero rows written.
  This reproduces the status/lock reads used by `emdash migrate --check`. The
  CLI itself required `CLOUDFLARE_API_TOKEN`, which this OAuth-connected setup
  does not have. No migration or lock mutation was performed.
- Pending: verify the Cloudflare build and deployment use the approved commit,
  preserve the production origin and bindings, and pass public acceptance.
- Pending: inspect admin availability and the active email provider. Source
  compatibility alone does not establish a successful production sign-in or
  email delivery; record any browser or delivery checks separately.

Rollback to a retained 1.2.0 Worker version is an option only after verifying
that the upgrade has not changed production migration state. Identical source
migration files alone do not establish that condition: a database with older
pending migrations could still advance on startup. If migration state changes,
assess database compatibility and recovery before reverting application code.
