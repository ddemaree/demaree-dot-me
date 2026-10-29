# EmDash email recovery

Implementation and rollout are tracked in [DEM-23](https://linear.app/bitsandletters/issue/DEM-23/demaree-dot-me-enable-cloudflare-email-and-verify-magic-link-recovery).

## Provider and configuration

Use the native `cloudflareEmail()` plugin included in
`@emdash-cms/cloudflare/plugins` 1.2.0. It sends through the `EMAIL` Worker binding,
with sender `EmDash <noreply@demaree.me>`. The binding restricts outgoing sender
addresses to `noreply@demaree.me`. No additional package or API key is needed.

The plugin activates automatically when the deployed application initializes,
and EmDash selects it when it is the sole active email provider. The login page
then offers **Sign in with email link**. Passkey authentication stays available.
Keep `EMDASH_SITE_URL=https://demaree.me` so recovery links use the production
origin. Local development keeps `remoteBindings: false` and sends no real mail.

## Rollout order

1. Confirm Cloudflare Email Sending entitlement. Sending to arbitrary recipients
   requires Workers Paid; verified destination addresses can receive free sends.
   As of October 29, 2026, Cloudflare documents 3,000 outbound emails per month
   included on Workers Paid, then $0.35 per 1,000. Do not change the subscription
   without the owner's approval.
2. In Cloudflare, open **Compute → Email Service → Email Sending → Onboard
   Domain**, and select `demaree.me`. Review the DNS changes before applying.
   Email Sending uses `cf-bounce` records plus DKIM and domain DMARC. Preserve
   existing incoming-mail MX records and existing valid SPF/DMARC policies;
   this does not require moving incoming mail to Cloudflare Email Routing.
3. Confirm sender-domain DNS verification succeeds, then merge/deploy the plugin
   and Worker binding configuration. Do not deploy a provider that advertises
   recovery before the sender can deliver mail.
4. Open [Settings → Email](https://demaree.me/_emdash/admin/settings/email) and
   confirm Cloudflare Email is active. Confirm the existing admin account's
   email address is accurate. With owner authorization, send a test to that
   address and check the inbox (including spam).
5. In a separate private Chrome window, request **Sign in with email link** for
   the existing admin address. Open the received link and select **Continue**.
   Confirm the dashboard opens at `https://demaree.me`. Links are single-use and
   expire after 15 minutes. Keep the passkey-authenticated session available
   until this succeeds; confirm passkey login still works afterward.

The magic-link request intentionally returns a generic success even for unknown
users, sending failures, or rate limits. That response is not proof of delivery.
A received test email and successful fresh magic-link login are the acceptance
checks. Never record credentials, tokens, or complete sign-in links in logs,
issues, or source files.

## Rollout status — October 29, 2026

The owner approved sender onboarding, deployment, and one test email to the
existing admin address. Cloudflare Email Sending is enabled for `demaree.me`,
with sender-domain DNS status `ready` and no reported conflicts. The account
reports a quota of 1,000 emails per day; no subscription change was required.
Incoming mail still uses the existing `smtp.google.com` MX record. The bounce
records and DKIM selector use `cf-bounce`; existing domain DMARC was preserved.

PR #6 is merged and production deployment succeeded for commit `cd67b9c`
(Worker version `97096c37-4604-4528-bd83-37cbd1ea8eff`). Settings → Email
shows `cloudflare-email` active. The one authorized test sent through EmDash
arrived in the admin's inbox, with SPF, DKIM, and DMARC all passing.

Owner-confirmed fresh magic-link sign-in is the remaining acceptance check.
See DEM-23 for current status.

## References

- [EmDash email setup](https://docs.emdashcms.com/guides/email/)
- [EmDash Cloudflare configuration](https://docs.emdashcms.com/deployment/cloudflare/#email)
- [Cloudflare sender onboarding](https://developers.cloudflare.com/email-service/get-started/send-emails/)
- [Cloudflare send binding restrictions](https://developers.cloudflare.com/email-service/configuration/send-bindings/)
- [Cloudflare email pricing](https://developers.cloudflare.com/email-service/platform/pricing/)
