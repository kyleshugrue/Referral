import { describe, it, expect } from 'vitest';
import { validateDirectMessageInput, groupMessageSchema } from '../message-validation';

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
});

describe('groupMessageSchema', () => {
  it('accepts valid group message input', () => {
    const result = groupMessageSchema.safeParse({ content: 'hi all', memberIds: [1, 2, 3] });
    expect(result.success).toBe(true);
  });

  it('rejects empty content', () => {
    const result = groupMessageSchema.safeParse({ content: '', memberIds: [1] });
    expect(result.success).toBe(false);
  });

  it('rejects an empty member list', () => {
    const result = groupMessageSchema.safeParse({ content: 'hi', memberIds: [] });
    expect(result.success).toBe(false);
  });

  it('rejects non-numeric member ids', () => {
    const result = groupMessageSchema.safeParse({ content: 'hi', memberIds: ['a'] });
    expect(result.success).toBe(false);
  });
});
