import { categoryCardBySlug } from "@/lib/jobs-seo";
import { jobsOgImage, OG_CONTENT_TYPE, OG_SIZE } from "../../_seo/og";

export const alt = "Hacker News 'Who is hiring?' category demand";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const card = categoryCardBySlug(slug);
  return jobsOgImage(
    card?.title ?? "Who is hiring?",
    "Ranked by demand in Hacker News job postings",
  );
}
