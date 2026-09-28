import { slugToTerm } from "@/lib/site";
import { jobsDisplayTerm } from "@/lib/jobs-seo";
import { jobsOgImage, OG_CONTENT_TYPE, OG_SIZE } from "../_seo/og";

export const alt = "Hacker News 'Who is hiring?' demand trend";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image({ params }: { params: Promise<{ term: string }> }) {
  const { term } = await params;
  return jobsOgImage(
    `${jobsDisplayTerm(slugToTerm(term))} jobs`,
    "Monthly demand in Hacker News 'Who is hiring?' posts",
  );
}
