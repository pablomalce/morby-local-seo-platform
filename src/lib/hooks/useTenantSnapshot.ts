"use client";

import { useMemo } from "react";
import { useSelection } from "@/lib/context/SelectionContext";
import { buildBusinessSnapshot, type BusinessSnapshot } from "@/lib/mock/universal";

/**
 * Returns the merged snapshot for the currently-selected tenant. Works for both seed demo
 * businesses (full data) and user-created businesses (empty arrays so the UI can render
 * helpful empty states instead of crashing).
 */
export function useTenantSnapshot(): BusinessSnapshot {
  const { business, locationsForBusiness, servicesForBusiness } = useSelection();
  return useMemo(
    () => buildBusinessSnapshot(business, locationsForBusiness, servicesForBusiness),
    [business, locationsForBusiness, servicesForBusiness],
  );
}
