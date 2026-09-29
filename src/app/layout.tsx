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
  DEFAULT_OG_IMAGE,
  OG_BASE,
  TWITTER_BASE,
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
  // Explicit default card so every page has one: the file-based image only
  // attaches to "/", and a child's own `openGraph` object drops the layout's.
  openGraph: {
    ...OG_BASE,
    url: SITE_URL,
    title: `${SITE_NAME}: ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
    images: [DEFAULT_OG_IMAGE],
  },
  twitter: {
    ...TWITTER_BASE,
    title: `${SITE_NAME}: ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
    images: [DEFAULT_OG_IMAGE.url],
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

const PROD_HOST = new URL(SITE_URL).hostname;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        {/* og:logo needs a `property` attribute, which Next's metadata API
            can't emit (its `other` map always renders `name=`). Render it
            directly - the App Router hoists it into <head>. */}
        <meta property="og:logo" content={`${SITE_URL}/icon.svg`} />
      </head>
      <body>
        {/* Google Analytics (gtag.js) + Ahrefs Web Analytics, loaded only on the
            production host so localhost and *.vercel.app previews don't pollute
            the numbers. Off-prod `window.gtag` stays undefined, so track() is a
            no-op there. */}
        <Script id="analytics" strategy="afterInteractive">
          {`
            if (location.hostname === ${JSON.stringify(PROD_HOST)}) {
              window.dataLayer = window.dataLayer || [];
              window.gtag = function(){dataLayer.push(arguments);};
              gtag('js', new Date());
              gtag('config', 'G-RNWSKXGPQD');
              var ga = document.createElement('script');
              ga.async = true;
              ga.src = 'https://www.googletagmanager.com/gtag/js?id=G-RNWSKXGPQD';
              document.head.appendChild(ga);
              var ah = document.createElement('script');
              ah.async = true;
              ah.src = 'https://analytics.ahrefs.com/analytics.js';
              ah.setAttribute('data-key', 'FXA+NiNrkB9sI55LE+lvGw');
              document.head.appendChild(ah);
            }
          `}
        </Script>
        <WebVitals />
        <JsonLd data={siteJsonLd} />
        {children}
      </body>
    </html>
  );
}
