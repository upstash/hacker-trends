import { permanentRedirect } from "next/navigation";

// The gallery moved to the landing page ("/"); 308-redirect old /examples links
// so their ranking signal consolidates onto the root.
export default function ExamplesRedirect() {
  permanentRedirect("/");
}
