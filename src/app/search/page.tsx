/**
 * Legacy `/search` route. The search tool now lives at the root (`/`), so this
 * just forwards any old shared `/search?q=…` link to `/?q=…`, preserving the
 * full query string so the shared view still reproduces exactly.
 */

import { permanentRedirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function SearchRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(raw)) {
    if (Array.isArray(v)) v.forEach((x) => sp.append(k, x));
    else if (v !== undefined) sp.append(k, v);
  }
  const qs = sp.toString();
  // 308 permanent: the search tool moved to "/" for good, so consolidate any
  // ranking signal from old /search?q=… links onto the root.
  permanentRedirect(qs ? `/?${qs}` : "/");
}
