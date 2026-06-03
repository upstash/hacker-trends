"use client";

/**
 * 500, in character. Next.js requires this to be a client component with a
 * `reset()` prop, so we lean in: it's a "Show HN: I broke the site" submission
 * with a joke stack trace and a re-run-it button dressed up as a CI retry.
 *
 * Note: this renders INSIDE the root layout, so we re-use the same HN chrome.
 * For a layout-level blowup there's `global-error.tsx`, which can't.
 */

import { useEffect } from "react";
import Link from "next/link";
import { LandingHeader, LandingFooter } from "./components/LandingChrome";

const FAKE_STACK = [
  "Error: undefined is not a function (and neither am I before coffee)",
  "    at HackerTrends (/var/task/works-on-my-machine.tsx:42:0)",
  "    at Upstash.query (it.was.dns/probably:53:1)",
  "    at async confidence (.../shipped-on-a-friday.ts:1:1)",
  "    at process.exit(1) // git blame says it was you",
];

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The site's whole gimmick is reading Hacker News, so let it read the crash too.
    console.error("[hacker-trends] front page is on fire:", error);
  }, [error]);

  return (
    <div className="max-w-[760px] mx-auto">
      <LandingHeader crumb="500" />

      <main className="px-3 py-5">
        <table className="w-full border-collapse">
          <tbody>
            <tr className="align-top">
              <td className="story-rank">1.</td>
              <td className="pl-1">
                <div className="leading-snug">
                  <span className="text-[12pt] mr-1 select-none text-[color:var(--hn-orange)]">
                    ▲
                  </span>
                  <span className="text-[12pt] font-normal">
                    Show HN: I broke the site (500)
                  </span>{" "}
                  <span className="story-domain">(internal.server/error)</span>
                </div>
                <div className="story-sub text-[8pt] mt-[1px]">
                  500 points by <span className="underline">an exception</span>{" "}
                  just now | flag | hide |{" "}
                  <span className="underline">500 comments</span>
                </div>
              </td>
            </tr>
          </tbody>
        </table>

        <p className="mt-5 text-[10pt] leading-relaxed">
          Something threw on the server. It worked on our machine, which is the
          highest praise software can receive. Top comment is just{" "}
          <span className="italic">&ldquo;have you tried turning Redis off
          and on again?&rdquo;</span> — and honestly, that&rsquo;s what the
          button below does.
        </p>

        {/* The joke stack trace, in the one monospace block on the whole site. */}
        <pre className="mt-4 overflow-x-auto bg-white border border-[color:var(--hn-subtle)]/40 p-3 text-[9pt] leading-relaxed font-mono text-[#444]">
          {FAKE_STACK.join("\n")}
          {error?.digest && (
            <>
              {"\n"}
              {`    digest: ${error.digest} (paste this into a thread, get told it's a dupe)`}
            </>
          )}
        </pre>

        <div className="mt-5 flex flex-wrap items-center gap-3 text-[10pt]">
          <button
            onClick={() => reset()}
            className="font-semibold text-[color:var(--hn-orange)] hover:underline cursor-pointer"
          >
            ▲ re-run the build (try again) →
          </button>
          <span className="text-[color:var(--hn-subtle)]">or</span>
          <Link href="/" className="underline">
            git revert to the homepage
          </Link>
        </div>

        <p className="mt-6 text-[8pt] text-[color:var(--hn-subtle)] italic">
          No exceptions were harmed in the rendering of this page. They were,
          however, thoroughly logged.
        </p>
      </main>

      <LandingFooter />
    </div>
  );
}
