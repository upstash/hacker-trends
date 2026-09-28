/**
 * Renders a JSON-LD <script> for structured data (schema.org). Server component;
 * the object is serialized once at render. Used for WebSite/WebApplication on
 * the root, FAQPage on /how-it-works, and Dataset/Article-ish blocks on the
 * landing pages so search engines can show rich results.
 */
// Built from a string: a regex literal with \u2028 trips some transpilers.
const UNSAFE = new RegExp("[<>&\\u2028\\u2029]", "g");

export function JsonLd({ data }: { data: Record<string, unknown> }) {
  // Landing pages put URL-derived terms in here, so JSON.stringify alone is not
  // safe to inline: a term containing `</script>` would close the tag. Escaping
  // `<`, `>`, `&` and the JS line separators as \u sequences keeps it valid JSON
  // that can never break out of the <script>.
  const json = JSON.stringify(data).replace(
    UNSAFE,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}
