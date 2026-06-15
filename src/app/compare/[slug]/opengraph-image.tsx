import { ImageResponse } from "next/og";
import { comparisonBySlug, slugToTerm } from "@/lib/site";
import { getComparisonLanding } from "@/lib/landing-data";
import { buildOgChart, ogChartSvg } from "@/lib/og-chart";

export const alt = "Hacker News trend comparison";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const COMPARE_COLORS = ["#1f6feb", "#ff6600", "#1a7f37", "#cf222e", "#8250df"];

// SVG viewBox for the line chart (matches the on-page TrendChart proportions).
const CHART = { w: 1056, h: 300, padT: 26, padB: 6 };

function termsForSlug(slug: string): string[] {
  const curated = comparisonBySlug(slug);
  if (curated) return curated.terms;
  return slug.split("-vs-").map((p) => slugToTerm(p)).filter(Boolean);
}

export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const terms = termsForSlug(slug).slice(0, 5);
  const { series } = await getComparisonLanding(terms);
  const rows = series.map((s, i) => ({
    term: s.term,
    color: COMPARE_COLORS[i % COMPARE_COLORS.length],
  }));
  const { lines } = buildOgChart(
    series.map((s, i) => ({
      color: COMPARE_COLORS[i % COMPARE_COLORS.length],
      buckets: s.buckets,
    })),
    CHART,
  );
  const chartSvg = ogChartSvg(lines, CHART);
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
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={chartUri} width={CHART.w} height={CHART.h} alt="" />
          {lines.map((l, i) => {
            if (l.peakValue <= 0) return null;
            const left = Math.max(64, Math.min(CHART.w - 64, l.peakX));
            const top = l.peakY - 34 < 0 ? l.peakY + 12 : l.peakY - 34;
            return (
              <div
                key={i}
                style={{
                  position: "absolute",
                  left,
                  top,
                  transform: "translateX(-50%)",
                  fontSize: 26,
                  fontWeight: 700,
                  color: l.color,
                  display: "flex",
                  whiteSpace: "nowrap",
                }}
              >
                {`${l.peakValue.toLocaleString()} posts`}
              </div>
            );
          })}
        </div>

        <div style={{ marginTop: 20, fontSize: 24, color: "#828282" }}>
          2007 - 2026 · Powered by Upstash Redis Search
        </div>
      </div>
    ),
    { ...size },
  );
}
