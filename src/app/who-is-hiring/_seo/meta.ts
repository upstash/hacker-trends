import type { Metadata } from "next";
import { SITE_NAME, abs } from "@/lib/site";

/**
 * Page metadata for the "Who is hiring?" routes. The page-level `openGraph` and
 * `twitter` blocks REPLACE the layout's (no deep merge), so restate everything
 * here: without it these pages inherited the homepage tagline on X and lost the
 * og:image. The image itself is each route's `opengraph-image.tsx`; X falls
 * back to it (and to the og title/description) for `summary_large_image`.
 */
export function jobsMetadata(opts: {
  title: string;
  description: string;
  path: string;
  type?: "website" | "article";
  noindex?: boolean;
}): Metadata {
  const { title, description, path, type = "article", noindex } = opts;
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: abs(path) },
    ...(noindex ? { robots: { index: false, follow: true } } : {}),
    openGraph: { type, siteName: SITE_NAME, title, description, url: abs(path) },
    twitter: { card: "summary_large_image", title, description },
  };
}
