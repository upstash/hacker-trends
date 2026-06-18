/**
 * Server-rendered sample of REAL "Who is hiring?" job postings, for the SEO
 * landing routes.
 *
 * The crawlable, indexable heart of the reframed pages: the actual posting text
 * a job-seeker came to read, in the initial HTML (NOT the client-only drill-down
 * panel). Each row shows the poster's HN handle, the hiring month, the matched
 * term highlighted in the same peach mark the search uses, an outbound link to
 * the posting on HN, and a link to the in-app `/archived/<thread>` view of the
 * month's thread.
 *
 * Pure server component - the postings are fetched in `jobs-landing-data.ts` and
 * passed in; this file only renders them. No "use client".
 */

import Link from "next/link";
import type { JSX } from "react";
import type { JobPosting } from "@/lib/jobs-landing-data";

/** Same peach highlight the main search + drill-down use. */
const MARK = { background: "#ffe1cc", color: "#000", padding: 0 } as const;

/** Regex-escaped, whitespace-split query tokens (drops `|` OR-group joins). */
function tokens(q: string): string[] {
  return q
    .replace(/\|/g, " ")
    .trim()
    .split(/\s+/)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .filter(Boolean);
}

/** Wrap each matched token in the peach mark (server-rendered, so the match is
 *  visible in the crawlable HTML too). */
function highlight(text: string, q: string): (JSX.Element | string)[] | string {
  const t = tokens(q);
  if (t.length === 0 || !text) return text;
  const re = new RegExp(`(${t.join("|")})`, "gi");
  return text.split(re).map((p, i) =>
    re.test(p) ? (
      <mark key={i} style={MARK}>
        {p}
      </mark>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

/** "2021-04" -> "Apr 2021" for the byline. */
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
function monthLabel(month: string | null): string | null {
  if (!month) return null;
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return null;
  return `${MONTHS[m - 1]} ${y}`;
}

export function JobsPostingSample({
  postings,
  term,
  heading,
}: {
  postings: JobPosting[];
  /** the matched term (for highlighting); an OR-group is split on `|`. */
  term: string;
  heading: string;
}) {
  if (postings.length === 0) return null;
  return (
    <div className="px-3 pt-6">
      <h2 className="text-[14px] font-bold">{heading}</h2>
      <ol className="mt-2 flex flex-col gap-3">
        {postings.map((p) => {
          const hnUrl = `https://news.ycombinator.com/item?id=${p.id}`;
          const when = monthLabel(p.month);
          return (
            <li key={p.id} className="text-[12.5px] leading-[1.5]">
              <div className="text-[11px] text-[color:var(--hn-subtle)] mb-0.5">
                <a
                  href={hnUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="font-semibold"
                >
                  {p.by}
                </a>
                {when && <span> · hiring in {when}</span>}
                {p.parent != null && (
                  <>
                    {" · "}
                    <Link href={`/archived/${p.parent}`} className="subtle">
                      read the thread
                    </Link>
                  </>
                )}
                {" · "}
                <a href={hnUrl} target="_blank" rel="noreferrer noopener" className="subtle">
                  view on HN
                </a>
              </div>
              <p>{highlight(p.snippet, term)}</p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
