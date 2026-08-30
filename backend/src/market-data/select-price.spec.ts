import { selectPrice, sessionLabel } from './select-price.js';

describe('selectPrice', () => {
  it('uses the regular price during the regular session', () => {
    expect(
      selectPrice({
        marketState: 'REGULAR',
        regularMarketPrice: 217.55,
        postMarketPrice: 999,
      }),
    ).toEqual({ price: 217.55, session: 'REGULAR', extended: false });
  });

  it('uses the after-hours price in the POST session', () => {
    expect(
      selectPrice({
        marketState: 'POST',
        regularMarketPrice: 217.55,
        postMarketPrice: 217.73,
      }),
    ).toEqual({ price: 217.73, session: 'POST', extended: true });
  });

  it('uses the pre-market price in the PRE session', () => {
    expect(
      selectPrice({
        marketState: 'PRE',
        regularMarketPrice: 217.55,
        preMarketPrice: 219.1,
      }),
    ).toEqual({ price: 219.1, session: 'PRE', extended: true });
  });

  it('treats POSTPOST as an after-hours session', () => {
    expect(
      selectPrice({
        marketState: 'POSTPOST',
        regularMarketPrice: 100,
        postMarketPrice: 101,
      })?.session,
    ).toBe('POST');
  });

  it('treats PREPRE as a pre-market session', () => {
    expect(
      selectPrice({
        marketState: 'PREPRE',
        regularMarketPrice: 100,
        preMarketPrice: 99,
      })?.session,
    ).toBe('PRE');
  });

  it('falls back to the close when there is no after-hours print yet', () => {
    expect(
      selectPrice({ marketState: 'POST', regularMarketPrice: 217.55 }),
    ).toEqual({ price: 217.55, session: 'POST', extended: false });
  });

  it('falls back to the close when the extended print is zero', () => {
    // A thinly traded name can report 0 rather than omitting the field.
    expect(
      selectPrice({
        marketState: 'POST',
        regularMarketPrice: 217.55,
        postMarketPrice: 0,
      }),
    ).toEqual({ price: 217.55, session: 'POST', extended: false });
  });

  it('uses the last after-hours trade when the market is fully closed', () => {
    // Brokers show the last trade, not the official close, and the portfolio
    // has to reconcile against the broker.
    expect(
      selectPrice({
        marketState: 'CLOSED',
        regularMarketPrice: 317.76,
        postMarketPrice: 318.4,
      }),
    ).toEqual({ price: 318.4, session: 'CLOSED', extended: true });
  });

  it('falls back to the close when a closed market has no after-hours print', () => {
    expect(
      selectPrice({ marketState: 'CLOSED', regularMarketPrice: 217.55 }),
    ).toEqual({ price: 217.55, session: 'CLOSED', extended: false });
  });

  it('treats an unknown or missing market state as CLOSED', () => {
    expect(selectPrice({ regularMarketPrice: 10 })?.session).toBe('CLOSED');
    expect(
      selectPrice({ marketState: 'SOMETHING_NEW', regularMarketPrice: 10 })
        ?.session,
    ).toBe('CLOSED');
  });

  it('accepts a lowercase market state', () => {
    expect(
      selectPrice({
        marketState: 'post',
        regularMarketPrice: 100,
        postMarketPrice: 101,
      }),
    ).toEqual({ price: 101, session: 'POST', extended: true });
  });

  it('returns null when there is no usable price at all', () => {
    expect(selectPrice({ marketState: 'REGULAR' })).toBeNull();
    expect(
      selectPrice({ marketState: 'REGULAR', regularMarketPrice: 0 }),
    ).toBeNull();
  });

  it('does not use a pre-market print during the post session', () => {
    expect(
      selectPrice({
        marketState: 'POST',
        regularMarketPrice: 100,
        preMarketPrice: 95,
      }),
    ).toEqual({ price: 100, session: 'POST', extended: false });
  });
});

describe('sessionLabel', () => {
  it('has no badge during regular hours', () => {
    expect(sessionLabel('REGULAR')).toBeNull();
  });
  it('labels the extended and closed sessions', () => {
    expect(sessionLabel('PRE')).toBe('PRE-MARKET');
    expect(sessionLabel('POST')).toBe('AFTER HOURS');
    expect(sessionLabel('CLOSED')).toBe('MARKET CLOSED');
  });
});
