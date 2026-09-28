import { ImageResponse } from "next/og";
import { notFound } from "next/navigation";
import { comparisonBySlug, slugToTerm } from "@/lib/site";
import { MAX_TERMS } from "@/lib/share-url";
import { getComparisonLanding } from "@/lib/landing-data";
import { buildOgChart, ogChartSvg, type OgChartLine } from "@/lib/og-chart";

export const alt = "Hacker News trend comparison";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
// ISR like the page: rendered on first request (never at build), then cached.
// Any <= MAX_TERMS slug works, not just curated ones: the homepage's `?q=` share
// previews point here.
export const dynamic = "force-static";
export const revalidate = 21600;

export function generateStaticParams() {
  return [];
}

const COMPARE_COLORS = ["#1f6feb", "#ff6600", "#1a7f37", "#cf222e", "#8250df"];

// SVG viewBox for the line chart (matches the on-page TrendChart proportions).
const CHART = { w: 1056, h: 300, padT: 26, padB: 6 };

function termsForSlug(slug: string): string[] {
  const curated = comparisonBySlug(slug);
  if (curated) return curated.terms;
  return slug.split("-vs-").map((p) => slugToTerm(p)).filter(Boolean);
}

/** Peak labels ("5,674 posts") above their dots, tallest first; a label that
 *  would overlap one already placed (two terms peaking close together) tries
 *  below its dot, then further out. */
function placePeakLabels(lines: OgChartLine[]) {
  const LABEL_H = 30;
  const placed: { left: number; top: number; w: number; text: string; color: string }[] = [];
  for (const l of [...lines].filter((l) => l.peakValue > 0).sort((a, b) => a.peakY - b.peakY)) {
    const text = `${l.peakValue.toLocaleString()} posts`;
    const w = text.length * 15 + 8;
    const left = Math.max(w / 2, Math.min(CHART.w - w / 2, l.peakX));
    const clear = (top: number) =>
      top >= 0 &&
      top <= CHART.h - LABEL_H &&
      placed.every(
        (p) => Math.abs(p.left - left) >= (p.w + w) / 2 || Math.abs(p.top - top) >= LABEL_H,
      );
    const tries = [l.peakY - 34, l.peakY + 12, l.peakY - 68, l.peakY + 46];
    const top = tries.find(clear) ?? (l.peakY - 34 < 0 ? l.peakY + 12 : l.peakY - 34);
    placed.push({ left, top, w, text, color: l.color });
  }
  return placed;
}

export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const terms = termsForSlug(slug);
  if (terms.length === 0 || terms.length > MAX_TERMS) notFound();
  // Series only: the image never shows stories, so don't search for them.
  const { series } = await getComparisonLanding(terms, 0);
  const rows = series.map((s, i) => ({
    term: s.term,
    color: COMPARE_COLORS[i % COMPARE_COLORS.length],
  }));
  const { lines } = buildOgChart(
    series.map((s, i) => ({
      color: COMPARE_COLORS[i % COMPARE_COLORS.length],
      buckets: s.buckets,
      endSlot: s.endSlot,
    })),
    CHART,
  );
  const chartSvg = ogChartSvg(lines, CHART);
  const labels = placePeakLabels(lines);
  const chartUri = `data:image/svg+xml;base64,${Buffer.from(chartSvg).toString("base64")}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "#f6f6ef",
          padding: "56px 72px",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ fontSize: 26, color: "#828282", display: "flex" }}>
          Hacker Trends · compared on Hacker News
        </div>

        <div
          style={{
            marginTop: 14,
            fontSize: 60,
            fontWeight: 800,
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          {rows.map((r, i) => (
            <div key={r.term} style={{ display: "flex", alignItems: "center" }}>
              {i > 0 && (
                <span style={{ color: "#9a9a9a", fontWeight: 400, padding: "0 16px" }}>
                  vs
                </span>
              )}
              <span style={{ color: r.color }}>{r.term}</span>
            </div>
          ))}
        </div>

        <div
          style={{
            marginTop: "auto",
            display: "flex",
            position: "relative",
            width: CHART.w,
            height: CHART.h,
          }}
        >
          <img src={chartUri} width={CHART.w} height={CHART.h} alt="" />
          {labels.map((l, i) => (
            <div
              key={i}
              style={{
                position: "absolute",
                left: l.left,
                top: l.top,
                transform: "translateX(-50%)",
                fontSize: 26,
                fontWeight: 700,
                color: l.color,
                // page-colored backing so a label never reads through a line
                background: "rgba(246,246,239,0.9)",
                padding: "0 4px",
                display: "flex",
                whiteSpace: "nowrap",
              }}
            >
              {l.text}
            </div>
          ))}
        </div>

        <div style={{ marginTop: 20, fontSize: 24, color: "#828282" }}>
          2007 - 2026 · Powered by Upstash Redis Search
        </div>
      </div>
    ),
    { ...size },
  );
}
