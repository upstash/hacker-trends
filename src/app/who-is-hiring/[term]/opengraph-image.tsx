import { notFound } from "next/navigation";
import { jobsDisplayTerm } from "@/lib/jobs-seo";
import { termFor } from "./term";
import { jobsOgImage, OG_CONTENT_TYPE, OG_SIZE } from "../_seo/og";

export const alt = "Hacker News 'Who is hiring?' demand trend";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image({ params }: { params: Promise<{ term: string }> }) {
  const term = termFor((await params).term);
  if (!term) notFound();
  return jobsOgImage(
    `${jobsDisplayTerm(term)} jobs`,
    "Monthly demand in Hacker News 'Who is hiring?' posts",
  );
}
