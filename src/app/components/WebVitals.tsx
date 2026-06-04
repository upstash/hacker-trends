"use client";

/**
 * Pipes Next's Core Web Vitals (LCP / INP / CLS / FCP / TTFB) into GA on real
 * traffic, so the perf work (deferred gallery data, memo'd sparklines, reserved
 * heights for CLS) can be watched in the field instead of just in the lab.
 * Renders nothing — it's only here for the hook. Mounted once in the root layout.
 */

import { useReportWebVitals } from "next/web-vitals";
import { trackWebVital } from "@/lib/analytics";

export function WebVitals() {
  useReportWebVitals(trackWebVital);
  return null;
}
