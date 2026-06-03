"use client";

/**
 * Last line of defense: this only fires when the ROOT LAYOUT itself throws, so
 * there's no chrome, no globals.css, nothing to lean on — it must ship its own
 * <html>/<body> and inline every style. Kept deliberately tiny and self-
 * contained. Same HN gallows humor as error.tsx, minus the dependencies.
 */

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          background: "#f6f6ef",
          color: "#000",
          fontFamily: "Verdana, Geneva, sans-serif",
          fontSize: "10pt",
        }}
      >
        <div style={{ background: "#ff6600", padding: "2px 8px" }}>
          <span
            style={{
              display: "inline-block",
              width: 18,
              height: 18,
              background: "#fff",
              color: "#ff6600",
              textAlign: "center",
              fontWeight: 700,
              lineHeight: "18px",
              fontSize: 14,
              marginRight: 6,
              verticalAlign: "middle",
            }}
          >
            T
          </span>
          <span style={{ fontWeight: 700, fontSize: 12 }}>Hacker Trends</span>
        </div>

        <div style={{ maxWidth: 600, margin: "0 auto", padding: "40px 16px" }}>
          <h1 style={{ fontSize: "14pt", fontWeight: 400, margin: 0 }}>
            kernel panic: even the layout gave up
          </h1>
          <p style={{ lineHeight: 1.6, marginTop: 16 }}>
            This is the error page&rsquo;s error page. We went one layer too
            deep and hit the part of the stack where the jokes run out. The good
            news: it can only get better from here.
          </p>
          <button
            onClick={() => reset()}
            style={{
              marginTop: 12,
              background: "transparent",
              border: 0,
              padding: 0,
              color: "#ff6600",
              fontWeight: 700,
              fontFamily: "Verdana, Geneva, sans-serif",
              fontSize: "10pt",
              cursor: "pointer",
            }}
          >
            ▲ have you tried turning it off and on again? →
          </button>
        </div>
      </body>
    </html>
  );
}
