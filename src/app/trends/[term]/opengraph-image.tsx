import { ImageResponse } from "next/og";
import { slugToTerm } from "@/lib/site";
import { getTermSeries } from "@/lib/landing-data";
import { SLOTS, slotOf } from "@/lib/trend-time";

export const alt = "Hacker News mention trend";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const BARS = 96;

/** Densify buckets to monthly slots, then downsample to BARS columns (summing),
 *  returning heights as 0–100 percentages of the series max. */
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
  params: Promise<{ term: string }>;
}) {
  const { term: slug } = await params;
  const term = slugToTerm(slug);
  const { buckets, stats } = await getTermSeries(term);
  const bars = toBars(buckets);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "#f6f6ef",
          padding: "60px 72px",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              width: 48,
              height: 48,
              background: "#ff6600",
              border: "3px solid #fff",
              color: "#fff",
              fontSize: 32,
              fontWeight: 800,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            T
          </div>
          <div style={{ fontSize: 28, color: "#828282" }}>
            Hacker Trends · Hacker News mentions
          </div>
        </div>

        <div
          style={{
            marginTop: 24,
            fontSize: 72,
            fontWeight: 800,
            color: "#111",
            display: "flex",
          }}
        >
          “{term}”
        </div>
        {stats.peakLabel && (
          // Single string child: Satori requires display:flex on any div with
          // more than one child, so keep this to one text node.
          <div style={{ marginTop: 8, fontSize: 30, color: "#ff6600" }}>
            {`${stats.total.toLocaleString()} mentions · peaked ${stats.peakLabel}`}
          </div>
        )}

        <div
          style={{
            marginTop: "auto",
            display: "flex",
            alignItems: "flex-end",
            gap: 3,
            height: 230,
          }}
        >
          {bars.map((h, i) => (
            <div
              key={i}
              style={{
                flex: 1,
                height: `${Math.max(2, h)}%`,
                background: "#ff6600",
                borderRadius: 2,
              }}
            />
          ))}
        </div>
        <div style={{ marginTop: 18, fontSize: 24, color: "#828282" }}>
          2007 - 2026 · Powered by Upstash Redis Search
        </div>
      </div>
    ),
    { ...size },
  );
}
