/**
 * Shared social card for the "Who is hiring?" routes (hub + landing pages).
 *
 * Text-only on purpose: the title/subtitle come from the route params and the
 * static catalog, and the bars are a fixed decorative pattern, so rendering a
 * card never touches the search index (a share storm can't become DB load).
 */

import { ImageResponse } from "next/og";
import { PALETTE } from "@/lib/jobs-trends";

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = "image/png";

// A stylized stacked-share pattern: per column, the three bands' heights (%).
const COLS = [
  [50, 30, 20], [48, 31, 21], [46, 33, 21], [44, 34, 22], [41, 36, 23],
  [40, 36, 24], [38, 37, 25], [36, 38, 26], [35, 38, 27], [33, 39, 28],
  [31, 40, 29], [30, 40, 30], [28, 41, 31], [27, 41, 32], [25, 42, 33],
  [24, 42, 34], [23, 42, 35], [22, 42, 36],
];

export function jobsOgImage(title: string, subtitle: string): ImageResponse {
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
            W
          </div>
          <div style={{ fontSize: 28, color: "#828282" }}>
            Who Is Hiring? · Hacker News job trends
          </div>
        </div>
        <div
          style={{
            marginTop: 28,
            fontSize: title.length > 40 ? 56 : 72,
            fontWeight: 800,
            color: "#111",
            lineHeight: 1.1,
            display: "flex",
          }}
        >
          {title}
        </div>
        <div style={{ marginTop: 12, fontSize: 30, color: "#ff6600" }}>{subtitle}</div>
        <div
          style={{
            marginTop: "auto",
            display: "flex",
            alignItems: "flex-end",
            gap: 4,
            height: 170,
          }}
        >
          {COLS.map((col, i) => (
            <div
              key={i}
              style={{ flex: 1, height: "100%", display: "flex", flexDirection: "column-reverse" }}
            >
              {col.map((h, j) => (
                <div key={j} style={{ height: `${h}%`, background: PALETTE[j] }} />
              ))}
            </div>
          ))}
        </div>
        <div style={{ marginTop: 18, fontSize: 24, color: "#828282" }}>
          Every Hacker News hiring thread since 2011 · Powered by Upstash Redis Search
        </div>
      </div>
    ),
    { ...OG_SIZE },
  );
}
