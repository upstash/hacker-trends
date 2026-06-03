import { ImageResponse } from "next/og";
import { comparisonBySlug, slugToTerm } from "@/lib/site";
import { getComparisonLanding } from "@/lib/landing-data";
import { SLOTS, slotOf } from "@/lib/trend-time";

export const alt = "Hacker News trend comparison";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const COMPARE_COLORS = ["#1f6feb", "#ff6600", "#1a7f37", "#cf222e", "#8250df"];
const BARS = 44;

function termsForSlug(slug: string): string[] {
  const curated = comparisonBySlug(slug);
  if (curated) return curated.terms;
  return slug.split("-vs-").map((p) => slugToTerm(p)).filter(Boolean);
}

function toBars(buckets: { key: number; docCount: number }[]): number[] {
  const dense = new Float64Array(SLOTS);
  for (const b of buckets) {
    const slot = slotOf(b.key);
    if (slot >= 0 && slot < SLOTS) dense[slot] += b.docCount;
  }
  const out = new Array(BARS).fill(0);
  for (let i = 0; i < SLOTS; i++) {
    const col = Math.min(BARS - 1, Math.floor((i / SLOTS) * BARS));
    out[col] += dense[i];
  }
  const max = Math.max(1, ...out);
  return out.map((v) => Math.round((v / max) * 100));
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
    bars: toBars(s.buckets),
  }));

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

        <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 18 }}>
          {rows.map((r) => (
            <div key={r.term} style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 90 }}>
              {r.bars.map((h, i) => (
                <div
                  key={i}
                  style={{ flex: 1, height: `${Math.max(2, h)}%`, background: r.color, borderRadius: 2 }}
                />
              ))}
            </div>
          ))}
        </div>

        <div style={{ marginTop: 20, fontSize: 24, color: "#828282" }}>
          2007 — 2026 · Powered by Upstash Redis Search
        </div>
      </div>
    ),
    { ...size },
  );
}
