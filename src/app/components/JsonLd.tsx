/**
 * Renders a JSON-LD <script> for structured data (schema.org). Server component;
 * the object is serialized once at render. Used for WebSite/WebApplication on
 * the root, FAQPage on /how-it-works, and Dataset/Article-ish blocks on the
 * landing pages so search engines can show rich results.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      // JSON.stringify output is safe to inline; no user-controlled HTML here.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
