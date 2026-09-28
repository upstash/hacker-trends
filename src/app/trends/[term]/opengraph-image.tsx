import { ImageResponse } from "next/og";
import { slugToTerm } from "@/lib/site";
import { getTermSeries } from "@/lib/landing-data";
import { SLOTS, slotOf } from "@/lib/trend-time";

export const alt = "Hacker News mention trend";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
// ISR like the page: rendered on first request (never at build), then cached.
// Any term works, not just catalog ones: the homepage's `?q=` share previews
// point here.
export const dynamic = "force-static";
export const revalidate = 21600;

export function generateStaticParams() {
  return [];
}

const BARS = 96;

/** Densify buckets to slots, then downsample the COMPLETE slots (the
 *  in-progress `endSlot` is left out, so the last bar isn't a partial-count
 *  cliff) to BARS columns. Each column is the mean of its 2-3 slots (a sum
 *  would sawtooth), as a 0–100 percentage of the tallest column. */
function toBars(buckets: { key: number; docCount: number }[], endSlot: number): number[] {
  const n = Math.max(1, Math.min(SLOTS, endSlot));
  const dense = new Float64Array(n);
  for (const b of buckets) {
    const slot = slotOf(b.key);
    if (slot >= 0 && slot < n) dense[slot] += b.docCount;
  }
  const sum = new Array(BARS).fill(0);
  const cnt = new Array(BARS).fill(0);
  for (let i = 0; i < n; i++) {
    const col = Math.min(BARS - 1, Math.floor((i / n) * BARS));
    sum[col] += dense[i];
    cnt[col]++;
  }
  const out = sum.map((v, i) => (cnt[i] ? v / cnt[i] : 0));
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
  const { buckets, endSlot, stats } = await getTermSeries(term);
  const bars = toBars(buckets, endSlot);

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
