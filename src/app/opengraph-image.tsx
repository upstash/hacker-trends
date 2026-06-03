import { ImageResponse } from "next/og";
import { SITE_NAME, SITE_TAGLINE } from "@/lib/site";

export const alt = `${SITE_NAME}: ${SITE_TAGLINE}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// A stylized two-line "rise and fall" pattern (heights in %), drawn with plain
// divs so the card renders without any SVG/font dependency in Satori.
const LINE_A = [8, 10, 14, 22, 18, 30, 44, 38, 56, 70, 62, 84, 96, 78, 60];
const LINE_B = [6, 9, 7, 12, 20, 16, 28, 40, 34, 52, 46, 60, 72, 88, 70];

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "#f6f6ef",
          padding: "64px 72px",
          fontFamily: "sans-serif",
        }}
      >
        {/* brand row */}
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div
            style={{
              width: 76,
              height: 76,
              background: "#ff6600",
              border: "5px solid #ffffff",
              boxShadow: "0 0 0 2px #ff6600",
              color: "#fff",
              fontSize: 52,
              fontWeight: 800,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            T
          </div>
          <div style={{ fontSize: 60, fontWeight: 800, color: "#111" }}>
            {SITE_NAME}
          </div>
        </div>

        <div
          style={{
            marginTop: 28,
            fontSize: 40,
            color: "#3a3a3a",
            maxWidth: 980,
            lineHeight: 1.25,
          }}
        >
          See how any topic, tool, or person trended across 18 years of Hacker
          News.
        </div>

        {/* decorative overlaid trend lines */}
        <div
          style={{
            marginTop: "auto",
            display: "flex",
            alignItems: "flex-end",
            gap: 10,
            height: 240,
          }}
        >
          {LINE_A.map((h, i) => (
            <div
              key={i}
              style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end", flex: 1, height: "100%" }}
            >
              <div style={{ height: `${LINE_B[i]}%`, background: "#1f6feb", opacity: 0.85, borderRadius: 3 }} />
              <div style={{ height: 6 }} />
              <div style={{ height: `${h}%`, background: "#ff6600", borderRadius: 3 }} />
            </div>
          ))}
        </div>

        <div style={{ marginTop: 24, fontSize: 26, color: "#828282" }}>
          Live over 45M posts and comments · Powered by Upstash Redis Search
        </div>
      </div>
    ),
    { ...size },
  );
}
