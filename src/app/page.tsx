import { parseShareState } from "@/lib/share-url";
import { HackerTrends } from "./HackerTrends";

// Reading searchParams here makes the route dynamic (fine — every view is a
// live, uncached query anyway) and lets us seed the client from a shared link's
// `?…` on the server, so a shared URL renders the right view with no flash.
export default async function Home({
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
  return <HackerTrends initial={parseShareState(sp)} />;
}
