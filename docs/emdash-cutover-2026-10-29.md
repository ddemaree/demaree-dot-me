# EmDash production preparation — October 29, 2026

Cutover update: both PRs are merged. The owner authorized and completed the
preparatory sign-in, and all three Custom Domains now point to the EmDash
Worker. The committed runtime origin is `https://demaree.me`. The owner still
needs to complete the checked Site URL change and register a production passkey.

Both `emdash` and `@emdash-cms/cloudflare` are pinned to 1.2.0. The existing
1.1.0 deployment did not provide the Change domain and Continue on controls
referenced by the earlier cutover report. The 1.2.0 release supplies them and
adds no numbered core database migrations. See the [release notes](https://emdashcms.com/blog/emdash-1-2).

## Deployment target

Cloudflare Builds now connects this repository to `demaree-emdash-poc`:

- `main`: `pnpm build`, then `pnpm exec wrangler deploy`.
- Other branches: `pnpm build`, then `pnpm exec wrangler versions upload`.

The two Git build triggers on `demaree-dot-me` were removed with owner approval.
That Worker's deployed version, domains, and data were retained. The existing
EmDash D1 database, R2 bucket, session namespace, and encryption secret stay on
the EmDash Worker. No content reimport is needed.

At preparation time, `demaree.me`, `www.demaree.me`, and `log.demaree.me` are
Custom Domains on `demaree-dot-me`. The EmDash runtime origin remains
`https://demaree-emdash-poc.bitsandletters.workers.dev` until the owner is ready.

## Domain and passkey transfer

1. In Chrome, sign into the old workers.dev EmDash admin and keep that tab open.
   Do this before changing `EMDASH_SITE_URL`: that setting also controls the
   passkey relying-party domain, so a fresh old-host sign-in may stop working
   after the setting changes.
2. Reassign the `demaree.me` Cloudflare Custom Domain to `demaree-emdash-poc`.
   Verify `https://demaree.me/_emdash/admin` reaches the EmDash sign-in page.
   Keep the old workers.dev address enabled during the transfer. Handle `www`
   and `log` explicitly as aliases or redirects; do not leave their behavior
   implicit in the apex-domain change.
3. Change `EMDASH_SITE_URL` in `wrangler.jsonc` to `https://demaree.me` and deploy.
   Persist this change in Git so a future automatic deployment does not restore
   the old origin.
4. In the existing signed-in old-host tab, open Settings > General > Change
   domain, enter `https://demaree.me`, and use Check and switch.
5. Select Continue on demaree.me. On the new page, select Continue, then Register
   Passkey in Security settings. The owner completes the device's passkey prompt.
   Generate this one-use link only when ready; it expires after five minutes.
6. Confirm a fresh sign-in on the new hostname, then run the acceptance checker
   against `https://demaree.me` with credentials for that origin. Verify edit,
   save, publish, media, scheduling, redirects, canonicals, sitemap, and robots.

A browser session is required for handover; the endpoint refuses CLI bearer
tokens. Keep the former deployment available for rollback until the new domain
and sign-in work. [Official domain move guide](https://docs.emdashcms.com/guides/change-domain/).
