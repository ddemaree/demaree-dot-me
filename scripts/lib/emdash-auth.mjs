import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';

export const IMPORT_SCOPES = [
  'content:read', 'content:write', 'media:read', 'media:write', 'schema:read', 'taxonomies:manage',
];

export const validBearerToken = (value) => typeof value === 'string' && value.length >= 16
  && /^[A-Za-z0-9._~+/-]+=*$/.test(value);

export function emdashOrigin(value) {
  const url = new URL(value);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!['http:', 'https:'].includes(url.protocol) || (!local && url.protocol !== 'https:')
    || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) {
    throw new Error('EmDash URL must be an HTTPS origin (HTTP is allowed for localhost), without a path or credentials.');
  }
  return url.origin;
}

/** Canonical /oauth/token is raw OAuth JSON; legacy endpoints wrap successes. */
export function oauthPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('EmDash returned an invalid OAuth response.');
  }
  return payload.success === true && payload.data && typeof payload.data === 'object'
    ? payload.data : payload;
}

export function validateOAuthTokens(payload, { requireRefresh = true } = {}) {
  const token = oauthPayload(payload);
  if (!validBearerToken(token.access_token) || (requireRefresh && !validBearerToken(token.refresh_token))
    || (token.refresh_token !== undefined && !validBearerToken(token.refresh_token))
    || typeof token.token_type !== 'string' || token.token_type.toLowerCase() !== 'bearer'
    || !Number.isSafeInteger(token.expires_in) || token.expires_in <= 0
    || typeof token.scope !== 'string') {
    throw new Error('EmDash OAuth response is missing valid token fields; credentials were not printed.');
  }
  return token;
}

export function oauthErrorCode(payload) {
  const error = payload?.error;
  const code = typeof error === 'string' ? error : error?.code;
  return typeof code === 'string' && /^[a-z_]{1,64}$/i.test(code) && !/ec_(?:pat|oat|ort)_/.test(code)
    ? code.toLowerCase() : 'oauth_request_failed';
}

export async function oauthRequest(origin, endpoint, body, customHeaders = {}, { timeoutMs = 30_000 } = {}) {
  const safeOrigin = emdashOrigin(origin);
  if (!endpoint.startsWith('/_emdash/api/oauth/')) throw new Error('Unexpected OAuth endpoint.');
  let headers;
  try { headers = new Headers(customHeaders); }
  catch { throw new Error('Stored EmDash request headers are invalid; their contents were not printed.'); }
  headers.set('Content-Type', 'application/json');
  headers.set('X-EmDash-Request', '1');
  headers.set('Origin', safeOrigin);
  const response = await fetch(`${safeOrigin}${endpoint}`, {
    method: 'POST', headers, body: JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(timeoutMs),
  });
  if (!(response.headers.get('content-type') ?? '').includes('json')) {
    throw new Error(`EmDash OAuth endpoint returned HTTP ${response.status} without JSON.`);
  }
  let payload;
  try { payload = await response.json(); }
  catch { throw new Error('EmDash OAuth endpoint returned invalid JSON; its contents were not printed.'); }
  return { ok: response.ok, status: response.status, payload, retryAfter: response.headers.get('retry-after') };
}

export async function refreshOAuthCredential(origin, credential) {
  if (!credential?.refreshToken) throw new Error('EmDash credential expired; log in again.');
  const response = await oauthRequest(origin, '/_emdash/api/oauth/token', {
    grant_type: 'refresh_token', refresh_token: credential.refreshToken,
  }, credential.customHeaders);
  if (!response.ok) throw new Error(`EmDash OAuth refresh failed: ${oauthErrorCode(response.payload)}.`);
  const token = validateOAuthTokens(response.payload);
  return { ...credential, accessToken: token.access_token, refreshToken: token.refresh_token,
    expiresAt: new Date(Date.now() + token.expires_in * 1000).toISOString() };
}

export function credentialPath() {
  const configRoot = process.env.XDG_CONFIG_HOME || path.join(homedir(), '.config');
  return path.join(configRoot, 'emdash/auth.json');
}

async function readCredentialStore(filename) {
  let store = {};
  try { store = JSON.parse(await readFile(filename, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('Cannot read existing EmDash credentials; no credentials were replaced.'); }
  if (!store || typeof store !== 'object' || Array.isArray(store)) throw new Error('Existing EmDash credentials are invalid.');
  return store;
}

export async function loadOAuthCredential(origin, filename = credentialPath()) {
  const credential = (await readCredentialStore(filename))[emdashOrigin(origin)];
  if (credential === undefined) return null;
  if (!credential || typeof credential !== 'object' || Array.isArray(credential)
    || !validBearerToken(credential.accessToken)) {
    throw new Error('Stored EmDash credentials are invalid; log in again.');
  }
  return credential;
}

/** Check persistence before requesting a one-use device authorization. */
export async function preflightCredentialStore(filename = credentialPath()) {
  await readCredentialStore(filename);
  const directory = path.dirname(filename);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const probe = path.join(directory, `.auth-probe-${randomUUID()}.tmp`);
  await writeFile(probe, '', { mode: 0o600, flag: 'wx' });
  await unlink(probe);
}

/** Atomic replacement preserves other origins; a failed save retains a private recovery file. */
export async function saveOAuthCredential(origin, credential, filename = credentialPath()) {
  const safeOrigin = emdashOrigin(origin);
  const directory = path.dirname(filename);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const recovery = path.join(directory, `.auth-recovery-${randomUUID()}.json`);
  // The device grant has already been consumed. Save that result privately
  // before reading/merging the full store so later failures remain recoverable.
  await writeFile(recovery, `${JSON.stringify({ [safeOrigin]: credential }, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  const temporary = path.join(directory, `.auth-${randomUUID()}.json.tmp`);
  try {
    const store = await readCredentialStore(filename);
    await writeFile(temporary, `${JSON.stringify({ ...store, [safeOrigin]: {
      ...store[safeOrigin], ...credential,
    } }, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    await chmod(temporary, 0o600);
    await rename(temporary, filename);
  } catch {
    throw new Error(`Credential storage failed; the authenticated credential remains in the private recovery file ${recovery}.`);
  }
  await unlink(recovery).catch(() => {});
  return filename;
}
