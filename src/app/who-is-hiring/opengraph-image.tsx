import { jobsOgImage, OG_CONTENT_TYPE, OG_SIZE } from "./_seo/og";

export const alt = "Who Is Hiring? - Hacker News job trends since 2011";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return jobsOgImage("Who is hiring?", "How skills trend in Hacker News job postings");
}
