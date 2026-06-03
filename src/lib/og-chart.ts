import { SLOTS, slotOf } from "./trend-time";

/**
 * Build SVG line/area paths for an OG card that mirrors the on-page TrendChart:
 * each term's sparse buckets are densified to the full 2007→2026 slot grid,
 * scaled to a shared peak, and emitted as a smooth-ish polyline + filled area.
 * Returns plain path strings + the peak point so the .tsx can render it inside
 * Satori (which supports basic <svg> primitives but no React hooks).
 */
export type OgChartView = { w: number; h: number; padT: number; padB: number };

export type OgChartLine = {
  color: string;
  line: string;
  area: string;
  peakX: number;
  peakY: number;
  peakValue: number;
};

export function buildOgChart(
  series: { color: string; buckets: { key: number; docCount: number }[] }[],
  view: OgChartView,
): { lines: OgChartLine[]; w: number; h: number } {
  const { w, h, padT, padB } = view;

  const dense = series.map((s) => {
    const values = new Float64Array(SLOTS);
    for (const b of s.buckets) {
      const slot = slotOf(b.key);
      if (slot >= 0 && slot < SLOTS) values[slot] += b.docCount;
    }
    return { color: s.color, values };
  });

  let max = 0;
  for (const d of dense)
    for (let i = 0; i < SLOTS; i++) if (d.values[i] > max) max = d.values[i];
  max = max || 1;

  const xOf = (i: number) => ((i + 0.5) / SLOTS) * w;
  const yOf = (v: number) => h - padB - (v / max) * (h - padT - padB);
  const base = h - padB;

  const lines = dense.map((d) => {
    const pts: string[] = [];
    let peakI = 0;
    let peakV = 0;
    for (let i = 0; i < SLOTS; i++) {
      pts.push(`${xOf(i).toFixed(1)},${yOf(d.values[i]).toFixed(1)}`);
      if (d.values[i] > peakV) {
        peakV = d.values[i];
        peakI = i;
      }
    }
    return {
      color: d.color,
      line: `M${pts.join("L")}`,
      area: `M${xOf(0).toFixed(1)},${base}L${pts.join("L")}L${xOf(SLOTS - 1).toFixed(1)},${base}Z`,
      peakX: xOf(peakI),
      peakY: yOf(peakV),
      peakValue: peakV,
    };
  });

  return { lines, w, h };
}

/**
 * Render the chart (gridlines + area fills + lines + peak dots) as a standalone
 * SVG string, ready to embed as a data-URI <img> in Satori. Shapes only — peak
 * number labels are drawn as Satori <div>s on top, since text in a rasterized
 * SVG would need an embedded font.
 */
export function ogChartSvg(
  lines: OgChartLine[],
  view: OgChartView,
): string {
  const { w, h, padT, padB } = view;
  const grids = [0, 0.5, 1]
    .map((f) => {
      const y = h - padB - f * (h - padT - padB);
      return `<line x1="0" x2="${w}" y1="${y}" y2="${y}" stroke="#e3e3da" stroke-width="1"/>`;
    })
    .join("");
  const areas = lines
    .map((l) => `<path d="${l.area}" fill="${l.color}" fill-opacity="0.12"/>`)
    .join("");
  const strokes = lines
    .map(
      (l) =>
        `<path d="${l.line}" fill="none" stroke="${l.color}" stroke-width="3" stroke-linejoin="round"/>`,
    )
    .join("");
  const dots = lines
    .filter((l) => l.peakValue > 0)
    .map((l) => `<circle cx="${l.peakX}" cy="${l.peakY}" r="5" fill="${l.color}"/>`)
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${grids}${areas}${strokes}${dots}</svg>`;
}
