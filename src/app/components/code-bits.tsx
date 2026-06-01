/**
 * Shared bits for the "show the code" surface: the tiny syntax highlighter and
 * the Upstash brand glyphs. Lives in its own module (no "use client") so the
 * CodePanel and the pitch's Upstash credit can share this logic without
 * duplicating it.
 */

import type React from "react";

/* ---- tiny, controlled-input syntax highlighter ---------------------- */
/*
 * Single-pass tokenizer: comments and strings are matched first so the
 * `$operator` / keyword passes never reach inside them. Good enough because the
 * input is our own generated TS, not arbitrary code.
 */
const TOKEN =
  /(\/\/[^\n]*)|("(?:[^"\\]|\\.)*")|\b(await|const|new|import|from)\b|(\$[A-Za-z]\w*)/g;

export function highlight(code: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(code)) !== null) {
    if (m.index > last) out.push(code.slice(last, m.index));
    const [full, comment, str, keyword, op] = m;
    const cls = comment
      ? "tok-comment"
      : str
        ? "tok-string"
        : keyword
          ? "tok-keyword"
          : op
            ? "tok-op"
            : "";
    out.push(
      <span key={i++} className={cls}>
        {full}
      </span>,
    );
    last = m.index + full.length;
  }
  if (last < code.length) out.push(code.slice(last));
  return out;
}

/** Upstash logo mark (the emerald swoosh), lifted from upstash.com. Colors are
 *  hard-coded so it renders without Tailwind's emerald palette classes. */
export function UpstashMark() {
  return (
    <svg
      viewBox="-8 -20 370 519"
      height="13"
      width="9"
      aria-hidden="true"
      className="shrink-0"
    >
      <path
        d="M0.421875 412.975C78.5269 491.079 205.16 491.079 283.265 412.975C361.369 334.87 361.369 208.237 283.265 130.132L247.909 165.487C306.488 224.066 306.488 319.041 247.909 377.619C189.331 436.198 94.3559 436.198 35.7769 377.619L0.421875 412.975Z"
        fill="#10b981"
      />
      <path
        d="M71.1328 342.264C110.185 381.316 173.501 381.316 212.554 342.264C251.606 303.212 251.606 239.895 212.554 200.843L177.199 236.198C196.725 255.724 196.725 287.382 177.199 306.909C157.672 326.435 126.014 326.435 106.488 306.909L71.1328 342.264Z"
        fill="#10b981"
      />
      <path
        d="M353.974 59.421C275.869 -18.6835 149.236 -18.6835 71.1315 59.421C-6.97352 137.526 -6.97352 264.159 71.1315 342.264L106.486 306.909C47.9085 248.33 47.9085 153.355 106.486 94.777C165.065 36.198 260.04 36.198 318.618 94.777L353.974 59.421Z"
        fill="#34d399"
      />
      <path
        d="M283.264 130.132C244.212 91.08 180.894 91.08 141.842 130.132C102.789 169.185 102.789 232.501 141.842 271.553L177.197 236.198C157.671 216.672 157.671 185.014 177.197 165.487C196.723 145.961 228.381 145.961 247.908 165.487L283.264 130.132Z"
        fill="#34d399"
      />
    </svg>
  );
}

/** Small "opens in a new tab" arrow pointing to the top-right. */
export function ArrowUpRight() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="10"
      height="10"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      <path d="M7 17 17 7M8 7h9v9" />
    </svg>
  );
}

/** The github + "Powered by Upstash Redis Search" links shared by both code
 *  surfaces. Pinned to the right of whatever header row holds it. Pass
 *  `hideGithubOnMobile` (search page) to drop the github link on small screens
 *  so "see the code" + the Upstash credit fit on one line. */
export function CodeLinks({
  hideGithubOnMobile = false,
}: {
  hideGithubOnMobile?: boolean;
} = {}) {
  return (
    <>
      <a
        className={hideGithubOnMobile ? "code-github hidden sm:inline" : "code-github"}
        href="https://github.com/upstash/hacker-trends"
        target="_blank"
        rel="noreferrer"
      >
        github
      </a>
      <a
        className="code-poweredby"
        href="https://upstash.com/docs/redis/search"
        target="_blank"
        rel="noreferrer"
      >
        <span>Powered by</span>
        <UpstashMark />
        <span>Upstash Redis Search</span>
        <ArrowUpRight />
      </a>
    </>
  );
}
