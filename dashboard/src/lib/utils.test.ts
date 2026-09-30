import { describe, expect, it } from 'vitest';
import {
  formatNumber,
  formatRelativeDate,
  scoreColor,
  scoreToLabel,
} from './utils';

describe('formatNumber', () => {
  it('uses thousand separators', () => {
    expect(formatNumber(1234)).toBe('1,234');
    expect(formatNumber(1234567)).toBe('1,234,567');
  });
});

describe('scoreToLabel', () => {
  it('maps sign to a label', () => {
    expect(scoreToLabel(0.5)).toBe('Positive');
    expect(scoreToLabel(-0.5)).toBe('Negative');
    expect(scoreToLabel(0)).toBe('Neutral');
  });

  it('treats near-zero as neutral', () => {
    expect(scoreToLabel(0.1)).toBe('Neutral');
    expect(scoreToLabel(-0.1)).toBe('Neutral');
  });
});

describe('scoreColor', () => {
  it('returns a text class, never a raw hex', () => {
    expect(scoreColor(0.5)).toMatch(/^text-/);
    expect(scoreColor(-0.5)).toMatch(/^text-/);
    expect(scoreColor(0)).toMatch(/^text-/);
  });
});

describe('formatRelativeDate', () => {
  it('says "just now" for the current instant', () => {
    expect(formatRelativeDate(new Date().toISOString())).toBe('just now');
  });

  it('reports hours for recent dates', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000).toISOString();
    expect(formatRelativeDate(twoHoursAgo)).toBe('2h ago');
  });
});
