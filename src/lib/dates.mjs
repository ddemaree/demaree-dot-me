import { Temporal } from '@js-temporal/polyfill';

export const CONTENT_TIME_ZONE = 'America/New_York';

const localDatetime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?$/;

/**
 * Keystatic stores wall-clock times without offsets. Interpret those in the
 * site's timezone, independently of the machine building or serving the site.
 * Explicit ISO offsets and existing Date objects already identify an instant.
 * @param {string | Date} value
 * @returns {Date}
 */
export function parseContentDate(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.valueOf())) throw new RangeError('Invalid content date');
    return new Date(value.valueOf());
  }

  if (localDatetime.test(value)) {
    const local = Temporal.PlainDateTime.from(value, { overflow: 'reject' });
    // Repeated autumn times use the first occurrence, matching Date's behavior.
    const zoned = local.toZonedDateTime(CONTENT_TIME_ZONE, { disambiguation: 'earlier' });
    // Unlike Date, do not silently move a nonexistent spring time to another hour.
    if (!zoned.toPlainDateTime().equals(local)) {
      throw new RangeError(`${value} does not exist in ${CONTENT_TIME_ZONE} because the clocks move forward`);
    }
    return new Date(zoned.epochMilliseconds);
  }

  return new Date(Temporal.Instant.from(value).epochMilliseconds);
}

/**
 * Format an imported instant for the datetime-local editor, at minute precision.
 * Reject a later repeated hour: a naive editor value cannot preserve that instant.
 * @param {string | Date} value
 * @returns {string}
 */
export function toKeystaticDatetime(value) {
  const date = parseContentDate(value);
  const instant = Temporal.Instant.fromEpochMilliseconds(date.valueOf());
  const local = instant.toZonedDateTimeISO(CONTENT_TIME_ZONE).toPlainDateTime();
  const result = local.toString({ smallestUnit: 'minute', roundingMode: 'trunc' });
  const minute = Math.floor(date.valueOf() / 60_000) * 60_000;
  if (parseContentDate(result).valueOf() !== minute) {
    throw new RangeError(`${value} falls in the second occurrence of a repeated hour in ${CONTENT_TIME_ZONE}; preserve its explicit offset instead of importing it as a local datetime`);
  }
  return result;
}
