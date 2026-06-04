"use client";

/**
 * An `<a>` that logs an `outbound_click` to GA before letting the navigation
 * proceed. Exists so the static/server-rendered landing pages (how-it-works,
 * /trends, /compare, the shared footer) — which can't attach an onClick handler
 * themselves — can still track clicks through to Upstash / the repo, the
 * conversion this whole demo is pitching for. Client components in the app
 * (HackerTrends pitch, CodePanel) instead call trackOutbound() inline.
 */

import type { ReactNode } from "react";
import { trackOutbound } from "@/lib/analytics";

export function OutboundLink({
  destination,
  location,
  href,
  className,
  children,
}: {
  destination: "upstash" | "github";
  location: string;
  href: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={className}
      onClick={() => trackOutbound(destination, location)}
    >
      {children}
    </a>
  );
}
