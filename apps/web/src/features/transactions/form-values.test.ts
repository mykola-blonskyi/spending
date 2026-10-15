import { describe, expect, it } from 'vitest';
import { minorToDecimalString } from '@shared/format';
import { parseAmount } from './form-values';

describe('parseAmount', () => {
  it.each([
    ['12', 2, 1200],
    ['12.5', 2, 1250],
    ['12,50', 2, 1250],
    [' 1 234.05 ', 2, 123405],
    ['0.01', 2, 1],
    ['500', 0, 500],
    ['1.234', 3, 1234],
    ['12.', 2, 1200],
  ])('reads %j with exponent %i as %i', (text, exponent, minor) => {
    expect(parseAmount(text, exponent)).toBe(minor);
  });

  it.each([[''], ['0'], ['0.00'], ['-5'], ['1.234'], ['abc'], ['1e3']])('refuses %j', (text) => {
    expect(parseAmount(text, 2)).toBeNull();
  });

  it('round-trips through the editable text', () => {
    expect(parseAmount(minorToDecimalString(1250, 2), 2)).toBe(1250);
    expect(minorToDecimalString(5, 2)).toBe('0.05');
  });
});
