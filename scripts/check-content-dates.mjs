import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { CONTENT_TIME_ZONE, parseContentDate, toKeystaticDatetime } from '../src/lib/dates.mjs';

// Run independently of Astro so the same dates can be checked under build-host
// timezones without changing the content store or starting an import.
if (!process.argv.includes('--worker')) {
  let expected;
  for (const timeZone of ['UTC', 'America/New_York', 'America/Los_Angeles', 'Asia/Tokyo']) {
    const result = JSON.parse(execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--worker'], {
      env: { ...process.env, TZ: timeZone },
      encoding: 'utf8',
    }));
    expected ??= result;
    assert.deepEqual(result, expected, `Content timestamps changed under TZ=${timeZone}`);
    console.log(`${timeZone}: ${result.dates} content dates and DST/offset fixtures passed`);
  }
} else {
  const fixtures = [
    ['2026-01-01T00:05', '2026-01-01T05:05:00.000Z'],
    ['2026-07-01T00:05', '2026-07-01T04:05:00.000Z'],
    ['2026-03-08T01:59', '2026-03-08T06:59:00.000Z'],
    ['2026-03-08T03:00', '2026-03-08T07:00:00.000Z'],
    ['2026-11-01T01:30', '2026-11-01T05:30:00.000Z'],
    ['2026-11-01T01:30-05:00', '2026-11-01T06:30:00.000Z'],
    ['2026-11-01T02:00', '2026-11-01T07:00:00.000Z'],
    ['2026-01-01T00:05+09:00', '2025-12-31T15:05:00.000Z'],
    ['2024-02-29T12:00', '2024-02-29T17:00:00.000Z'],
    ['2026-07-01T12:34:56.789', '2026-07-01T16:34:56.789Z'],
    [new Date('2026-07-01T16:34:56Z'), '2026-07-01T16:34:56.000Z'],
  ];
  for (const [value, expected] of fixtures) {
    assert.equal(parseContentDate(value).toISOString(), expected);
  }
  for (const value of ['2026-03-08T02:30', '2026-02-29T12:00', '2026-01-01T25:00', '', new Date(NaN)]) {
    assert.throws(() => parseContentDate(value), RangeError);
  }
  assert.equal(toKeystaticDatetime('2026-07-01T04:05:45Z'), '2026-07-01T00:05');
  assert.equal(toKeystaticDatetime('2026-01-01T05:05:45Z'), '2026-01-01T00:05');
  assert.equal(toKeystaticDatetime('2026-11-01T05:30:00Z'), '2026-11-01T01:30');
  assert.throws(() => toKeystaticDatetime('2026-11-01T06:30:00Z'), /second occurrence/);

  const directory = new URL('../src/content/posts/', import.meta.url);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: CONTENT_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const hash = createHash('sha256');
  let dates = 0;
  for (const file of (await readdir(directory)).filter((file) => /\.md(?:oc)?$/.test(file)).sort()) {
    const text = await readFile(new URL(file, directory), 'utf8');
    const frontmatter = text.split(/^---\s*$/m)[1];
    for (const [, field, quoted] of frontmatter.matchAll(/^(publishedAt|updatedAt):\s*(.+)$/gm)) {
      const value = quoted.trim().replace(/^["']|["']$/g, '');
      const date = parseContentDate(value);
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
        assert.equal(formatter.format(date), value.slice(0, 10), `${file} ${field} changed day`);
        assert.equal(toKeystaticDatetime(date), value, `${file} ${field} changed time`);
      }
      hash.update(`${file}:${field}:${date.toISOString()}\n`);
      dates++;
    }
  }
  console.log(JSON.stringify({ dates, hash: hash.digest('hex') }));
}
