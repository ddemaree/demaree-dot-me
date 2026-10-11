#!/usr/bin/env node
/**
 * Explicit OAuth device login for the EmDash import experiment.
 * Usage: pnpm login:emdash --url https://the-experiment.workers.dev
 * Shows the browser verification URL/code without opening a browser or logging secrets.
 */
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import {
  IMPORT_SCOPES, emdashOrigin, oauthErrorCode, oauthPayload, oauthRequest,
  preflightCredentialStore, saveOAuthCredential, validateOAuthTokens,
} from './lib/emdash-auth.mjs';

async function login() {
  const { values } = parseArgs({ options: {
    url: { type: 'string' }, help: { type: 'boolean', default: false },
  } });
  if (values.help) {
    console.log('Usage: pnpm login:emdash --url=https://the-experiment.workers.dev\n'
      + 'Creates a scoped OAuth device grant. Finish admin setup first; approve the displayed code in a browser.\n'
      + 'Stores credentials privately in the standard EmDash CLI credential file. Tokens are never printed.');
    return;
  }
  if (!values.url) throw new Error('Explicit --url is required. Use --help for usage.');
  const origin = emdashOrigin(values.url);
  await preflightCredentialStore();
  const response = await oauthRequest(origin, '/_emdash/api/oauth/device/code', {
    client_id: 'emdash-cli', scope: IMPORT_SCOPES.join(' '),
  });
  if (!response.ok) throw new Error(`EmDash device authorization failed: ${oauthErrorCode(response.payload)}.`);
  const device = oauthPayload(response.payload);
  if (typeof device.device_code !== 'string' || !device.device_code
    || typeof device.user_code !== 'string' || !/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(device.user_code)
    || !Number.isSafeInteger(device.expires_in) || device.expires_in <= 0
    || (device.interval !== undefined && (!Number.isSafeInteger(device.interval) || device.interval <= 0))) {
    throw new Error('EmDash returned an invalid device authorization response.');
  }
  const verification = new URL(device.verification_uri);
  if (verification.origin !== origin || verification.username || verification.password
    || verification.search || verification.hash) throw new Error('EmDash verification URL did not match the requested origin.');
  const deadline = Date.now() + Math.min(device.expires_in, 15 * 60) * 1000;
  let interval = Math.min(60, Math.max(5, device.interval ?? 5));
  console.log(`Verification URL: ${verification.href}`);
  console.log(`User code: ${device.user_code}`);
  while (Date.now() < deadline) {
    await delay(Math.min(interval * 1000, Math.max(0, deadline - Date.now())));
    if (Date.now() >= deadline) break;
    const exchanged = await oauthRequest(origin, '/_emdash/api/oauth/token', {
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: device.device_code,
    }, {}, { timeoutMs: Math.max(1, Math.min(30_000, deadline - Date.now())) });
    if (exchanged.ok) {
      // Validate the raw or wrapped response immediately; never assume `.data`.
      // After this one-use exchange, persist it before making further requests.
      const token = validateOAuthTokens(exchanged.payload);
      const credential = { accessToken: token.access_token, refreshToken: token.refresh_token,
        expiresAt: new Date(Date.now() + token.expires_in * 1000).toISOString() };
      await saveOAuthCredential(origin, credential);
      const granted = token.scope.split(' ').filter(Boolean);
      if (IMPORT_SCOPES.some((scope) => !granted.includes(scope))) {
        throw new Error('Login was saved, but the granted scope cannot perform the sample import. Check the administrator role.');
      }
      console.log(`Authenticated for ${origin}. Import credentials saved.`);
      return;
    }
    const code = oauthErrorCode(exchanged.payload);
    if (code === 'authorization_pending') continue;
    if (code === 'slow_down' || exchanged.status === 429) {
      const retry = Number(exchanged.retryAfter);
      const serverInterval = Number(exchanged.payload?.interval);
      interval = Math.min(60, Math.max(interval + 5, Number.isFinite(retry) ? retry : 0,
        Number.isFinite(serverInterval) ? serverInterval : 0));
      continue;
    }
    if (code === 'access_denied') throw new Error('EmDash device authorization was denied.');
    if (code === 'expired_token') throw new Error('EmDash device authorization expired; run the login command again.');
    throw new Error(`EmDash device token exchange failed: ${code}.`);
  }
  throw new Error('EmDash device authorization expired after at most 15 minutes; run the login command again.');
}

try { await login(); }
catch (error) {
  // Fetch/type errors may carry request details in causes; only the controlled
  // top-level message is shown, never a payload, stack, or credential object.
  console.error(error instanceof Error ? error.message : 'EmDash login failed.');
  process.exitCode = 1;
}
