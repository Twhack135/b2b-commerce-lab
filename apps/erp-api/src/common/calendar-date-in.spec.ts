import { calendarDateIn } from './dates';

const at = (iso: string) => new Date(iso);

describe('calendarDateIn (order date in the time zone of a sales organization)', () => {
  it.each([
    // Germany in winter (CET, UTC+1): the day changes at 23:00 UTC
    ['Europe/Berlin', '2026-10-30T22:59:59.999Z', '2026-10-30'],
    ['Europe/Berlin', '2026-10-30T23:00:00.000Z', '2026-10-31'],
    // Germany in summer (CEST, UTC+2): the day changes at 22:00 UTC
    ['Europe/Berlin', '2026-07-14T21:59:59.999Z', '2026-07-14'],
    ['Europe/Berlin', '2026-07-14T22:00:00.000Z', '2026-07-15'],
    // Poland has the same offsets as Germany
    ['Europe/Warsaw', '2026-10-30T22:59:59.999Z', '2026-10-30'],
    ['Europe/Warsaw', '2026-10-30T23:00:00.000Z', '2026-10-31'],
    // Japan (JST, UTC+9, no daylight saving): the day changes at 15:00 UTC
    ['Asia/Tokyo', '2026-10-30T14:59:59.999Z', '2026-10-30'],
    ['Asia/Tokyo', '2026-10-30T15:00:00.000Z', '2026-10-31'],
    ['Asia/Tokyo', '2026-07-14T15:00:00.000Z', '2026-07-15'],
  ])('%s at %s is %s', (timeZone, instant, expected) => {
    expect(calendarDateIn(timeZone, at(instant))).toBe(expected);
  });

  it('gives different dates for the same instant in different markets', () => {
    const instant = at('2026-10-30T16:00:00Z');
    expect(calendarDateIn('Europe/Berlin', instant)).toBe('2026-10-30');
    expect(calendarDateIn('Asia/Tokyo', instant)).toBe('2026-10-31');
  });

  it('handles the days of the clock changes', () => {
    // 2026-03-29: Germany switches to summer time at 01:00 UTC
    expect(calendarDateIn('Europe/Berlin', at('2026-03-28T22:59:59Z'))).toBe(
      '2026-03-28',
    );
    expect(calendarDateIn('Europe/Berlin', at('2026-03-28T23:00:00Z'))).toBe(
      '2026-03-29',
    );
    expect(calendarDateIn('Europe/Berlin', at('2026-03-29T21:59:59Z'))).toBe(
      '2026-03-29',
    );
    expect(calendarDateIn('Europe/Berlin', at('2026-03-29T22:00:00Z'))).toBe(
      '2026-03-30',
    );
    // 2026-10-25: back to winter time at 01:00 UTC
    expect(calendarDateIn('Europe/Berlin', at('2026-10-24T21:59:59Z'))).toBe(
      '2026-10-24',
    );
    expect(calendarDateIn('Europe/Berlin', at('2026-10-24T22:00:00Z'))).toBe(
      '2026-10-25',
    );
    expect(calendarDateIn('Europe/Berlin', at('2026-10-25T22:59:59Z'))).toBe(
      '2026-10-25',
    );
    expect(calendarDateIn('Europe/Berlin', at('2026-10-25T23:00:00Z'))).toBe(
      '2026-10-26',
    );
  });

  it('handles the change of the year and leap days', () => {
    expect(calendarDateIn('Europe/Berlin', at('2026-12-31T22:59:59Z'))).toBe(
      '2026-12-31',
    );
    expect(calendarDateIn('Europe/Berlin', at('2026-12-31T23:00:00Z'))).toBe(
      '2027-01-01',
    );
    expect(calendarDateIn('Asia/Tokyo', at('2027-12-31T15:00:00Z'))).toBe(
      '2028-01-01',
    );
    expect(calendarDateIn('Asia/Tokyo', at('2028-02-28T15:00:00Z'))).toBe(
      '2028-02-29',
    );
  });

  it('rejects an unknown time zone instead of guessing', () => {
    expect(() =>
      calendarDateIn('Europe/Atlantis', at('2026-10-30T12:00:00Z')),
    ).toThrow(RangeError);
  });
});
