"use client";

import { useEffect, useMemo, useState } from "react";
import { useSelection } from "@/lib/context/SelectionContext";
import { buildBusinessSnapshot, type BusinessSnapshot } from "@/lib/mock/universal";
import { generateTenantData } from "@/lib/generators/tenantData";
import {
  isUserCreated,
  listStoredCompetitors,
  listStoredContent,
  listStoredReviews,
} from "@/lib/store/tenantStore";

const STORAGE_KEY = "lg.tenants.v2";

/**
 * Returns the merged snapshot for the currently-selected tenant:
 *   - Seed businesses keep curated data (Mörby, Luma Dental, Casa Verde) + any agent-added items.
 *   - User-created businesses receive deterministic generated data (metrics, competitors,
 *     reviews, content, ranking trend, GBP checklist) + any agent-added items.
 *
 * Re-renders whenever the tenant store changes (storage event + a window-scoped custom event
 * fired by the agent runner — see `runAgent` callers).
 */
export function useTenantSnapshot(): BusinessSnapshot {
  const { business, locationsForBusiness, servicesForBusiness } = useSelection();

  // Bump when tenant store changes — across tabs (storage) and within-tab (custom event).
  const [storeVersion, setStoreVersion] = useState(0);
  useEffect(() => {
    if (typeof window === "undefined") return;
    function bump() {
      setStoreVersion((v) => v + 1);
    }
    function onStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY) bump();
    }
    window.addEventListener("storage", onStorage);
    window.addEventListener("lg:store-changed", bump as EventListener);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("lg:store-changed", bump as EventListener);
    };
  }, []);

  return useMemo<BusinessSnapshot>(() => {
    const base = buildBusinessSnapshot(business, locationsForBusiness, servicesForBusiness);

    // For user-created tenants, generate a full plausible snapshot from their inputs.
    if (isUserCreated(business.id)) {
      const generated = generateTenantData(business, locationsForBusiness, servicesForBusiness);
      base.metrics = generated.metrics;
      base.rankingTrend = generated.rankingTrend;
      base.reviewsGrowth = generated.reviewsGrowth;
      base.gbpChecklist = generated.gbpChecklist;
      base.competitors = generated.competitors;
      base.reviews = generated.reviews;
      base.content = generated.content;
    }

    // Always layer agent-produced data from the store on top — this gives users live feedback
    // when they hit Run on any agent.
    const storedContent = listStoredContent(business.id);
    const storedCompetitors = listStoredCompetitors(business.id);
    const storedReviews = listStoredReviews(business.id);
    if (storedContent.length) base.content = [...storedContent, ...base.content];
    if (storedCompetitors.length) base.competitors = [...storedCompetitors, ...base.competitors];
    if (storedReviews.length) base.reviews = [...storedReviews, ...base.reviews];

    return base;
  }, [business, locationsForBusiness, servicesForBusiness, storeVersion]);
}

/** Fire from any agent runner to make snapshot consumers refresh in-tab. */
export function notifyStoreChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event("lg:store-changed"));
}
