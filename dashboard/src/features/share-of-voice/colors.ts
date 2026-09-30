function hashToHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) % 360;
  }
  return h;
}

interface ColorRow {
  brand: string;
}

export function buildColorMap(
  rows: ColorRow[],
  groupByBrand: boolean,
): string[] {
  if (groupByBrand) {
    return rows.map((r) => `hsl(${hashToHue(r.brand)}, 65%, 45%)`);
  }

  const groups = new Map<string, number[]>();
  rows.forEach((r, i) => {
    const list = groups.get(r.brand) ?? [];
    list.push(i);
    groups.set(r.brand, list);
  });

  const colors = new Array<string>(rows.length);
  groups.forEach((indices, brand) => {
    const baseHue = hashToHue(brand);
    const total = indices.length;
    indices.forEach((rowIdx, pos) => {
      const t = total === 1 ? 0.5 : pos / (total - 1);
      const lightness = 35 + t * 30;
      const saturation = 75 - t * 25;
      colors[rowIdx] = `hsl(${baseHue}, ${saturation}%, ${lightness}%)`;
    });
  });

  return colors;
}
