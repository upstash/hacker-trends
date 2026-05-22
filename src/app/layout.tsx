import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hacker Trends: search 18 years of Hacker News",
  description:
    "Google-Trends-style explorer for Hacker News. Overlay any topics, tools, or people and see how their traction rose and fell over 18 years. Powered by Upstash Redis Search.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
