import { describe, expect, it } from 'vitest';
import { csvCell, csvRow } from './csv';

describe('csvCell', () => {
  it.each([
    ['plain', 'plain'],
    ['', ''],
    ['a,b', '"a,b"'],
    ['say "hi"', '"say ""hi"""'],
    ['line\nbreak', '"line\nbreak"'],
    ['cr\rhere', '"cr\rhere"'],
    ['=1+1', "'=1+1"],
    ['+1', "'+1"],
    ['-1', "'-1"],
    ['@SUM(A1)', "'@SUM(A1)"],
    ['\tx', "'\tx"],
    ['\rx', `"'\rx"`],
    ['=HYPERLINK("x")', `"'=HYPERLINK(""x"")"`],
    ['1.50', '1.50'],
    ['a=b', 'a=b'],
  ])('renders %j as %j', (value, expected) => {
    expect(csvCell(value)).toBe(expected);
  });
});

describe('csvRow', () => {
  it('joins escaped cells and ends with CRLF', () => {
    expect(csvRow(['a', 'b,c', '=d'])).toBe(`a,"b,c",'=d\r\n`);
  });
});
