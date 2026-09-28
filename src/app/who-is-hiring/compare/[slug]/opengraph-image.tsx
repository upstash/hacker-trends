import { notFound } from "next/navigation";
import { jobsDisplayTerm } from "@/lib/jobs-seo";
import { jobsOgImage, OG_CONTENT_TYPE, OG_SIZE } from "../../_seo/og";
import { termsForSlug } from "./slug";

export const alt = "Hacker News 'Who is hiring?' demand comparison";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // Lead each side with its first OR-group part so the title stays short.
  const terms = termsForSlug(slug);
  if (!terms) notFound();
  const labels = terms.map((t) => jobsDisplayTerm(t.split("|")[0].trim()));
  return jobsOgImage(
    labels.join(" vs "),
    "Demand in Hacker News 'Who is hiring?' posts",
  );
}
