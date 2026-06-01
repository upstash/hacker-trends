import { redirect } from "next/navigation";

// The gallery moved to the landing page ("/"); keep old /examples links working.
export default function ExamplesRedirect() {
  redirect("/");
}
