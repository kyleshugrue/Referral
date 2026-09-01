import { describe, it, expect } from 'vitest';
import { validateDirectMessageInput } from '../message-validation';

describe('validateDirectMessageInput (messaging operation)', () => {
  it('accepts a valid receiver id and trims content', () => {
    expect(validateDirectMessageInput(42, '  hello there  ')).toEqual({
      ok: true,
      content: 'hello there',
    });
  });

  it('rejects a missing or NaN receiver id', () => {
    expect(validateDirectMessageInput(0, 'hi')).toEqual({
      ok: false,
      message: 'Invalid receiver ID',
    });
    expect(validateDirectMessageInput(NaN, 'hi')).toEqual({
      ok: false,
      message: 'Invalid receiver ID',
    });
  });

  it('rejects missing, non-string, or blank content', () => {
    expect(validateDirectMessageInput(1, undefined)).toEqual({
      ok: false,
      message: 'Message content is required',
    });
    expect(validateDirectMessageInput(1, '   ')).toEqual({
      ok: false,
      message: 'Message content is required',
    });
    expect(validateDirectMessageInput(1, 12345 as unknown as string)).toEqual({
      ok: false,
      message: 'Message content is required',
    });
  });

  it('rejects content above the direct-message limit', () => {
    expect(validateDirectMessageInput(1, 'x'.repeat(4_001))).toEqual({
      ok: false,
      message: 'Message content is too long',
    });
  });
});
