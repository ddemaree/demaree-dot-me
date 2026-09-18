# DNS cutover audit — September 18, 2026

**Follow-up decision:** A basic `/about/` page has been added using the live page's text and links, with sitemap inclusion. The site owner accepts retiring unsupported legacy archive URLs, alternate feed URLs, and ID-based shortlinks; those findings are no longer cutover blockers. Existing working RSS routes remain in place. The initial audit and companion CSV below are retained as the pre-change snapshot.

**Media clarification:** Imported post images are stored in this repository and served as assets by the new site. The media warning below concerns incoming links to old WordPress upload paths and attachment pages, not a WordPress dependency for displaying the rebuilt posts.

The initial audit found a sound SEO foundation, with URL compatibility gaps affecting `/about/`, WordPress query shortlinks, JSON Feed, and legacy archive routes.

This audit compares the current working tree, including existing uncommitted edits, with the public WordPress site at https://demaree.me. A fresh production build was tested through the Cloudflare adapter's local production preview. Hosting-account redirects, DNS configuration, Search Console, analytics, and access logs were outside this audit's scope; external edge rules could supplement the repository's behavior.

## Verified coverage

The [live sitemap index](https://demaree.me/wp-sitemap.xml) contains 427 unique page URLs. The build serves 420 of them at the same paths; seven return 404.

| Live URL family | Live sitemap URLs | Build returns 200 | Missing |
| --- | ---: | ---: | ---: |
| Posts | 359 | 358 | 1 |
| Pages, including home and blog | 5 | 2 | 3 |
| Tags | 59 | 59 | 0 |
| Topics | 1 | 1 | 0 |
| Post formats | 2 | 0 | 2 |
| Author archive | 1 | 0 | 1 |
| **Total** | **427** | **420** | **7** |

The new sitemap has 464 URLs: 386 posts, 69 tags, five topics, and four index pages. Every URL returned 200, a nonempty title and description, and the expected `https://demaree.me/…/` canonical. None inadvertently emitted `noindex`.

All 388 indexable static HTML pages have one H1, unique descriptions, Open Graph title/description/URL, and Twitter card metadata. All 38 OG image files exist. Every post has a publication timestamp; 112 also have modification timestamps. Missing pages and unknown topic/tag routes return actual 404 responses with `noindex` and no canonical. Keystatic and its API return 404 in production.

`/feed/`, `/feed/atom/`, `/feed/rss2/`, `/rss/`, and `/atom/` return 301 redirects to the valid `/feed.xml`. Its ten latest item links and GUIDs match the live RSS feed. Robots.txt advertises the new sitemap. All rendered same-host image paths resolve to built files; rendered posts no longer depend on WordPress uploads or Cloudinary.

## Resolve before cutover

### 1. Restore the About page

The live [About page](https://demaree.me/about/) returns 200, but `/about/` returns 404 in the build. Both desktop and mobile navigation link there from every page (`src/components/SiteHeader.astro:14`). Rebuild this page at the existing path before launch.

### 2. Implement WordPress query redirects on the actual deployment platform

The following live compatibility URLs return the home page with status 200 in the production preview:

| Legacy URL | Live behavior | Required behavior |
| --- | --- | --- |
| `/?p=6828` | 301 to `/p/hey-siri-call-google/` | Map WordPress post IDs to their existing post URLs |
| `/?page_id=167` | 301 to `/about/` | Map retained page IDs to the matching pages |
| `/?cat=3` | 301 to `/topics/notebook/` | Map retained category IDs |
| `/?tag=apple` | 301 to `/labels/apple/` | Map retained tag slugs |
| `/?feed=rss2` | RSS feed redirect | Redirect to `/feed.xml` |
| `/?feed=atom` | Atom feed redirect | Preserve a working feed response |
| `/?feed=json` | JSON Feed | Preserve JSON Feed |

WordPress advertises its `?p=` shortlinks in page HTML, so this is an incoming-link compatibility problem, even though the canonical post URLs survive.

The live `/?s=apple` search also becomes a home-page 200. Decide whether to preserve search or provide an explicit useful replacement; search results are a functionality gap rather than a canonical-post coverage issue.

`vercel.json:3` contains query-feed redirects, but `astro.config.mjs:25` now selects the Cloudflare adapter. The Cloudflare production preview confirms those Vercel rules do not apply. Port compatibility rules to the actual edge/Worker configuration and verify that they execute before static assets satisfy `/`. Existing `wordpressId` fields supply the post-ID mapping. Update the stale Vercel deployment instructions in AGENTS.md/README.md once the deployment target is settled.

### 3. Preserve feed subscriptions

The live site advertises [JSON Feed](https://demaree.me/feed/json/) in its HTML head. `/feed/json/` returns 404 in the build. Serve JSON Feed at that URL; redirecting JSON-only clients to RSS is not assured compatibility.

Live topic/tag feeds, including `/topics/notebook/feed/` and `/labels/apple/feed/`, also return 404 in the build. Preserve filtered feeds where subscribers may use them, or make an explicit retirement decision using traffic/subscription evidence. Query-based feed handling is covered above.

### 4. Map archive URLs and decide which test pages to retire

These are the seven missing sitemap URLs:

| URL | Suggested disposition |
| --- | --- |
| `/about/` | Restore the page |
| `/posts/` | Permanent redirect to `/blog/`, if that replaces the old archive |
| `/p/author/ddemaree/` | Permanent redirect to `/blog/`, the single-author archive |
| `/p/type/link/` | Preserve the filtered archive or deliberately map it to an appropriate replacement |
| `/p/type/aside/` | Preserve the filtered archive or deliberately map it to an appropriate replacement |
| `/typography-test/` | Retire intentionally with 404/410, unless still wanted |
| `/p/test-content/` | Already `draft: true` locally; confirm intentional retirement |

Pagination and date archives are outside the sitemap inventory. Live `/blog/page/2/`, `/blog/page/36/`, `/topics/notebook/page/2/`, `/page/2/`, `/p/2026/`, and `/p/2026/06/` work, while corresponding build routes return 404. Handle old archive pagination consistently; redirect to the relevant complete archive where that page genuinely replaces the old content. Audit label pagination under the same policy. Do not blanket-redirect missing pages to the home page.

The live sitemap discovery URL `/wp-sitemap.xml` also returns 404 locally. A permanent redirect to `/sitemap.xml` is inexpensive compatibility; update any Search Console sitemap submission too. Old child-sitemap URLs may be retired or mapped deliberately.

Google's [migration guidance](https://developers.google.com/search/docs/crawling-indexing/site-move-with-url-changes) recommends an old-to-new URL map, permanent redirects for moved content, and genuine errors for intentionally removed content.

### 5. Preserve valuable media URLs before retiring the old origin

Local article images are healthy, but that does not preserve incoming links to original WordPress assets. For example, `/wp-content/uploads/2023/03/Screenshot-2023-03-30-at-9.08.22-PM.png` serves a real image live and returns 404 in the build. There is no WordPress uploads route or preservation mapping in the repository.

The public media API returned 155 records (its total header reported 158, so this is not a guaranteed exhaustive media inventory): three source URLs on demaree.me and 152 on Cloudinary. All three same-host source files returned 200 live. Every record also had an attachment-page URL; three sampled attachment pages returned 200. For example, `/p/hey-siri-call-google/ji_g7bu1mom/` returns 200 live and 404 in the production preview.

Inventory remaining old media URLs using WordPress, access logs, and Search Console. Keep the original paths or redirect them to stable replacement assets, prioritizing externally linked files. Redirect attachment pages to their relevant article or asset where appropriate. Cloudinary URLs use a different host and their continuity depends on retaining that service.

## Metadata cleanup

These are worthwhile before launch, but they do not prevent crawling or indexing:

- **Normalize descriptions to plain text.** `src/lib/post-description.ts:14–15` returns editorial descriptions verbatim. Imported Markdown appears in metadata for `fear-of-a-chrome-planet`, `on-on-mast-brothers`, `on-making-things-worth-loving`, and `4-empty-living-places`. Escaped reference-link syntax also survives the fallback for `apple-lets-out-a-few-more-ipad-details`. Clean the fields or normalize both supplied and generated descriptions.
- **Restore `max-image-preview:large`.** Live home and sampled post HTML emit this robots directive; the rebuild only emits robots metadata for `noindex` pages (`src/layouts/BaseLayout.astro:49`). Restore it on indexable pages to preserve permission for large search image previews. See [Google's directive documentation](https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag#max-image-preview).
- **Add a default social image if desired.** Home, blog, and 348 of 386 posts lack an OG image. Fill the 23 blank featured-image alt descriptions. Live home and post samples have no OG/Twitter metadata, so the existing implementation is already an improvement.
- **Review syndicated canonical ownership.** Twenty-eight imported Medium/Substack posts currently self-canonicalize to demaree.me; `sourceUrl` is retained but not used for canonical selection. This may be the intended publishing policy, but it should be deliberate.
- **Structured data is optional follow-up.** Neither sampled live page nor the rebuild emits Article/Person JSON-LD. Adding it is an enhancement, not a cutover regression.

## Existing content debt

These issues already occur on the old content or its dependencies and are separate from route migration:

- `back-to-basic-at-basecamp.mdoc:49` links to missing `/labels/37-signals/`.
- `2020-in-review.mdoc:107,119` contains three dead `dev.demaree.me` links; local replacements exist for `on-authority`, `people-over-work-product`, and `no-more-masters`.
- Eleven `log.demaree.me/post/…` self-links returned 403 during the audit; this could involve bot protection. Prefer verified local post URLs where equivalent content exists.
- The external `cl.ly` screenshot in `filtering-github-email-notifications.mdoc:30` returns 404.
- `claude-opus-is-a-bore.mdoc:17` links to `#commentary`, which has no rendered target ID.

## Final acceptance checks

After the compatibility work, exercise the actual deployed hostname with the complete URL inventory and representative query/feed/media routes. Verify HTTPS and www-to-apex redirects, trailing-slash normalization, sitemap delivery, absence of preview `noindex` headers, and custom 404 responses at the hosting edge. The local preview uses a temporary 307 for slash normalization; prefer permanent normalization where the path policy is permanent.

Check Search Console verification continuity and use its indexed-URL/backlink data plus access logs to find URLs that the public sitemap cannot reveal. No DNS or hosting-account changes were made during this audit.

Validation passed: `pnpm check` (zero errors/warnings, three unused-import hints), `pnpm build`, and `node scripts/check-content-dates.mjs` (500 dates plus DST/offset fixtures in four host time zones). Application code and content were left unchanged.

The companion CSV inventories every live sitemap URL and its observed local production status: [dns-cutover-url-coverage-2026-09-18.csv](dns-cutover-url-coverage-2026-09-18.csv).
