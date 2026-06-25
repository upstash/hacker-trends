/**
 * One-off: compute the jobs gallery wire from the live index and write it to
 * `src/app/who-is-hiring/examples.json/snapshot.json`, so the route can serve it
 * verbatim while querying is disabled (the CDN copy got wiped to empty when the
 * index went down). Run with the local .env present:  bun run scripts/dump-jobs-gallery.ts
 */
import { writeFileSync } from "node:fs";
import { getJobsGalleryData } from "@/lib/jobs-gallery-data";
import { encodeJobsGalleryWire } from "@/lib/jobs-gallery-wire";

const data = await getJobsGalleryData({ fresh: true });
const wire = encodeJobsGalleryWire(data);

const parts = Object.keys(wire.terms);
const nonEmpty = parts.filter((p) => wire.terms[p].length > 0);
console.error(
  `version=${wire.version} parts=${parts.length} nonEmpty=${nonEmpty.length}`,
);
if (nonEmpty.length < parts.length) {
  console.error(
    `WARNING empty parts: ${parts.filter((p) => wire.terms[p].length === 0).join(", ")}`,
  );
}

const out = "src/app/who-is-hiring/examples.json/snapshot.json";
writeFileSync(out, JSON.stringify(wire));
console.error(`wrote ${out}`);
