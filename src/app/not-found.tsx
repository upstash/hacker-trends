/**
 * 404, in character. The whole site cosplays as Hacker News, so the not-found
 * page is a dead story sitting at the bottom of /new with zero upvotes and a
 * pile of the exact comments every HN thread eventually gets. Server component
 * (no interactivity needed) so it stays static.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { LandingHeader, LandingFooter } from "./components/LandingChrome";

export const metadata: Metadata = {
  title: { absolute: "404 · page not found" },
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <div className="max-w-[760px] mx-auto">
      <LandingHeader crumb="404" />

      <main className="px-3 py-12 text-center">
        {/* Make it unmistakable: giant 404 first, explanation second. */}
        <div className="text-[color:var(--hn-orange)] font-bold leading-none text-[96px] sm:text-[140px]">
          404
        </div>
        <h1 className="mt-2 text-[16pt] font-bold">Page not found</h1>
        <p className="mt-3 text-[10pt] leading-relaxed max-w-[480px] mx-auto">
          This URL never got enough upvotes to make the front page. It slid off{" "}
          <span className="font-mono">/new</span> and now it lives here - in the
          great <span className="italic">[dead]</span> beyond.
        </p>

        <div className="mt-6 flex flex-wrap justify-center gap-3 text-[10pt]">
          <Link href="/" className="font-semibold text-[color:var(--hn-orange)]">
            ▲ back to the front page →
          </Link>
          <span className="text-[color:var(--hn-subtle)]">or</span>
          <Link href="/how-it-works" className="underline">
            read how this thing works
          </Link>
        </div>

        {/* The one comment that survived. */}
        <div className="mt-12 max-w-[560px] mx-auto text-left border-t border-[color:var(--hn-subtle)]/30 pt-4">
          <div className="story-sub text-[8pt]">
            <span className="select-none mr-1">▲</span>
            <span className="underline">rewrite_it_in_rust</span> 2 points 7
            years ago | parent | next | on: 404
          </div>
          <p className="text-[10pt] leading-snug mt-[2px]">
            If this 404 were written in Rust it would have been a compile-time
            error and you&rsquo;d never be here. Just saying.
          </p>
        </div>
      </main>

      <LandingFooter />
    </div>
  );
}
