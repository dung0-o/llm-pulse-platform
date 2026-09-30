import { describe, expect, it } from 'vitest';
import { buildColorMap } from './colors';

describe('buildColorMap', () => {
  it('returns one color per row', () => {
    const rows = [{ brand: 'Qwen' }, { brand: 'Gemma' }, { brand: 'Llama' }];
    expect(buildColorMap(rows, true)).toHaveLength(3);
  });

  it('is deterministic across calls', () => {
    const rows = [{ brand: 'Qwen' }, { brand: 'Gemma' }];
    expect(buildColorMap(rows, true)).toEqual(buildColorMap(rows, true));
  });

  it('gives every brand the same hue regardless of position', () => {
    const a = buildColorMap([{ brand: 'Qwen' }], true)[0];
    const b = buildColorMap([{ brand: 'Gemma' }, { brand: 'Qwen' }], true)[1];
    expect(a).toBe(b);
  });

  it('shares hue but varies lightness within a brand when ungrouped', () => {
    const rows = [
      { brand: 'Qwen' },
      { brand: 'Qwen' },
      { brand: 'Qwen' },
    ];
    const [c1, c2, c3] = buildColorMap(rows, false);

    const hue = (c: string) => c.match(/hsl\((\d+)/)?.[1];
    const light = (c: string) => c.match(/(\d+)%\)$/)?.[1];

    expect(hue(c1)).toBe(hue(c2));
    expect(hue(c2)).toBe(hue(c3));
    // Lightness must strictly increase across positions
    expect(Number(light(c1))).toBeLessThan(Number(light(c2)));
    expect(Number(light(c2))).toBeLessThan(Number(light(c3)));
  });

  it('gives different hues to different families', () => {
    const rows = [{ brand: 'Qwen' }, { brand: 'Gemma' }];
    const [qwen, gemma] = buildColorMap(rows, true);
    const hue = (c: string) => c.match(/hsl\((\d+)/)?.[1];
    expect(hue(qwen)).not.toBe(hue(gemma));
  });
});
