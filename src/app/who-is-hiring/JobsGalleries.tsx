"use client";

/**
 * The two gallery sections under the big chart:
 *   - "Top categories": themed "Top N <category>" cards (>=4 terms each).
 *   - "Popular comparisons": head-to-head stories (<=3 terms / OR-group bars).
 *
 * Source is the curated set in `jobs-gallery.ts` (CATEGORY_CARDS + COMPARISONS),
 * produced by the discovery script. We re-enforce the PRD rule here defensively:
 * any "category" card with <=3 terms is DEMOTED into Popular comparisons, so a
 * "Top N" list is always a real list.
 *
 * Every card is a `JobsMiniCard` (lazy live data with a CDN-cached dataset
 * fast-path). All cards share ONE dataset fetch via `useJobsGallery`, so the
 * gallery doesn't fan out an aggregate per term on load. Clicking a card calls
 * `onPick`, which the page wires to swap the big chart's comparison.
 */

import { useMemo } from "react";
import { CATEGORY_CARDS, COMPARISONS, type GalleryCard } from "@/lib/jobs-gallery";
import { JobsMiniCard } from "./JobsMiniCard";
import { useJobsGallery } from "./useJobsGallery";

/** Min terms for a card to stay in "Top categories"; smaller -> comparisons. */
const MIN_CATEGORY_TERMS = 4;

export function JobsGalleries({ onPick }: { onPick: (terms: string[]) => void }) {
  // One shared dataset fetch for every card in both galleries.
  const dataset = useJobsGallery();

  // Re-partition defensively so the "Top N is a real list" rule always holds,
  // regardless of how the discovery script split things.
  const { categories, comparisons } = useMemo(() => {
    const cats: GalleryCard[] = [];
    const cmps: GalleryCard[] = [...COMPARISONS];
    for (const card of CATEGORY_CARDS) {
      if (card.terms.length >= MIN_CATEGORY_TERMS) cats.push(card);
      else cmps.push(card);
    }
    return { categories: cats, comparisons: cmps };
  }, []);

  return (
    <>
      <GallerySection
        title="Top categories"
        hint="click any chart to load it above"
        cards={categories}
        dataset={dataset}
        onPick={onPick}
      />
      <GallerySection
        title="Popular comparisons"
        hint="head to head - click to load above"
        cards={comparisons}
        dataset={dataset}
        onPick={onPick}
        last
      />
    </>
  );
}

function GallerySection({
  title,
  hint,
  cards,
  dataset,
  onPick,
  last,
}: {
  title: string;
  hint: string;
  cards: GalleryCard[];
  dataset: ReturnType<typeof useJobsGallery>;
  onPick: (terms: string[]) => void;
  last?: boolean;
}) {
  return (
    <section className={`px-3 pt-8${last ? " pb-14" : ""}`}>
      <div className="flex items-baseline gap-2 border-b border-[color:var(--hn-subtle)] pb-1 mb-3">
        <h2 className="text-[13px] font-bold">{title}</h2>
        <span className="text-[10px] text-[color:var(--hn-subtle)]">{hint}</span>
      </div>
      <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <JobsMiniCard
            key={card.title}
            card={card}
            dataset={dataset}
            onPick={onPick}
          />
        ))}
      </div>
    </section>
  );
}
