import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";
import { JsonLd } from "./components/JsonLd";
import { WebVitals } from "./components/WebVitals";
import {
  SITE_URL,
  SITE_NAME,
  SITE_TAGLINE,
  SITE_DESCRIPTION,
} from "@/lib/site";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  // The browser tab stays the short brand name; child routes append their own
  // descriptive title via the template. The keyword-rich phrasing lives in the
  // description + og:title + the landing-page titles, not the homepage tab.
  title: {
    default: SITE_NAME,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: [
    "Hacker News trends",
    "Hacker News search",
    "Hacker News history",
    "HN trends",
    "tech trends over time",
    "Google Trends for Hacker News",
    "Upstash Redis Search",
  ],
  authors: [{ name: "Upstash", url: "https://upstash.com" }],
  creator: "Upstash",
  publisher: "Upstash",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    url: SITE_URL,
    title: `${SITE_NAME}: ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME}: ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  category: "technology",
};

/** Site-wide structured data: a searchable WebSite (enables the search-box rich
 *  result) and the tool itself as a free WebApplication. */
const siteJsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      url: SITE_URL,
      name: SITE_NAME,
      description: SITE_DESCRIPTION,
      potentialAction: {
        "@type": "SearchAction",
        target: {
          "@type": "EntryPoint",
          urlTemplate: `${SITE_URL}/?q={search_term_string}`,
        },
        "query-input": "required name=search_term_string",
      },
    },
    {
      "@type": "WebApplication",
      "@id": `${SITE_URL}/#app`,
      name: SITE_NAME,
      url: SITE_URL,
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web",
      description: SITE_DESCRIPTION,
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      creator: { "@type": "Organization", name: "Upstash", url: "https://upstash.com" },
    },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        {/* og:logo needs a `property` attribute, which Next's metadata API
            can't emit (its `other` map always renders `name=`). Render it
            directly — the App Router hoists it into <head>. */}
        <meta property="og:logo" content={`${SITE_URL}/icon.svg`} />
      </head>
      <body>
        {/* Google Analytics (gtag.js) */}
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-RNWSKXGPQD"
          strategy="afterInteractive"
        />
        <Script id="ga-gtag" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', 'G-RNWSKXGPQD');
          `}
        </Script>
        {/* Ahrefs Web Analytics */}
        <Script
          src="https://analytics.ahrefs.com/analytics.js"
          data-key="FXA+NiNrkB9sI55LE+lvGw"
          strategy="afterInteractive"
        />
        <WebVitals />
        <JsonLd data={siteJsonLd} />
        {children}
      </body>
    </html>
  );
}
