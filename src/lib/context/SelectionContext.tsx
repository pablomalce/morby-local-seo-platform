"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { organizations } from "@/lib/mock/universal";
import {
  createBusiness as storeCreateBusiness,
  createLocation as storeCreateLocation,
  createService as storeCreateService,
  deleteBusiness as storeDeleteBusiness,
  isUserCreated,
  listAllBusinesses,
  listAllLocations,
  listAllServices,
  type NewBusinessInput,
  type NewLocationInput,
  type NewServiceInput,
} from "@/lib/store/tenantStore";
import type { Business, BusinessLocation, BusinessService, Organization } from "@/lib/types/core";

const STORAGE_KEY = "lg.selection";

interface SelectionState {
  organizationId: string;
  businessId: string;
  serviceId: string | null;
  locationId: string | null;
}

interface SelectionContextValue extends SelectionState {
  organization: Organization;
  business: Business;
  service: BusinessService | null;
  location: BusinessLocation | null;
  businessesForOrg: Business[];
  servicesForBusiness: BusinessService[];
  locationsForBusiness: BusinessLocation[];
  isUserCreatedBusiness: boolean;
  setBusinessId: (id: string) => void;
  setServiceId: (id: string | null) => void;
  setLocationId: (id: string | null) => void;
  /** Create a business, optionally with a first location and service in one shot. */
  createTenant: (input: {
    business: Omit<NewBusinessInput, "organizationId">;
    firstLocation?: Omit<NewLocationInput, "businessId">;
    firstService?: Omit<NewServiceInput, "businessId">;
  }) => Business;
  addLocation: (input: Omit<NewLocationInput, "businessId">) => BusinessLocation;
  addService: (input: Omit<NewServiceInput, "businessId">) => BusinessService;
  removeBusiness: (id: string) => void;
}

const SelectionContext = createContext<SelectionContextValue | null>(null);

function defaultState(allBusinesses: Business[]): SelectionState {
  const org = organizations[0];
  const biz = allBusinesses.find((b) => b.organizationId === org.id) ?? allBusinesses[0];
  return {
    organizationId: org.id,
    businessId: biz.id,
    serviceId: null,
    locationId: null,
  };
}

export function SelectionProvider({ children }: { children: React.ReactNode }) {
  // Bump this counter whenever the underlying tenant store changes so memoised lists recompute.
  const [storeVersion, setStoreVersion] = useState(0);
  const bumpStore = useCallback(() => setStoreVersion((v) => v + 1), []);

  const allBusinesses = useMemo(() => listAllBusinesses(), [storeVersion]);
  const allLocations = useMemo(() => listAllLocations(), [storeVersion]);
  const allServices = useMemo(() => listAllServices(), [storeVersion]);

  const [state, setState] = useState<SelectionState>(() => defaultState(allBusinesses));

  // Hydrate selection from localStorage and force a fresh read of the tenant store on mount.
  useEffect(() => {
    if (typeof window === "undefined") return;
    bumpStore();
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<SelectionState>;
      const businesses = listAllBusinesses();
      const orgOk = parsed.organizationId && organizations.some((o) => o.id === parsed.organizationId);
      const bizOk = parsed.businessId && businesses.some((b) => b.id === parsed.businessId);
      if (orgOk && bizOk) {
        setState({
          organizationId: parsed.organizationId!,
          businessId: parsed.businessId!,
          serviceId: parsed.serviceId ?? null,
          locationId: parsed.locationId ?? null,
        });
      }
    } catch {
      /* ignore corrupted storage */
    }
  }, [bumpStore]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const setBusinessId = useCallback((id: string) => {
    setState((prev) => ({ ...prev, businessId: id, serviceId: null, locationId: null }));
  }, []);

  const setServiceId = useCallback((id: string | null) => {
    setState((prev) => ({ ...prev, serviceId: id }));
  }, []);

  const setLocationId = useCallback((id: string | null) => {
    setState((prev) => ({ ...prev, locationId: id }));
  }, []);

  const createTenant: SelectionContextValue["createTenant"] = useCallback(
    (input) => {
      const business = storeCreateBusiness({ ...input.business, organizationId: organizations[0].id });
      if (input.firstLocation) {
        storeCreateLocation({ ...input.firstLocation, businessId: business.id, isPrimary: true });
      }
      if (input.firstService) {
        storeCreateService({ ...input.firstService, businessId: business.id, isFeatured: true });
      }
      bumpStore();
      setState({
        organizationId: business.organizationId,
        businessId: business.id,
        serviceId: null,
        locationId: null,
      });
      return business;
    },
    [bumpStore],
  );

  const addLocation: SelectionContextValue["addLocation"] = useCallback(
    (input) => {
      const loc = storeCreateLocation({ ...input, businessId: state.businessId });
      bumpStore();
      return loc;
    },
    [bumpStore, state.businessId],
  );

  const addService: SelectionContextValue["addService"] = useCallback(
    (input) => {
      const svc = storeCreateService({ ...input, businessId: state.businessId });
      bumpStore();
      return svc;
    },
    [bumpStore, state.businessId],
  );

  const removeBusiness: SelectionContextValue["removeBusiness"] = useCallback(
    (id) => {
      storeDeleteBusiness(id);
      bumpStore();
      // If we just deleted the active tenant, fall back to the first available business.
      setState((prev) => {
        if (prev.businessId !== id) return prev;
        const remaining = listAllBusinesses();
        const next = remaining[0];
        return next
          ? { organizationId: next.organizationId, businessId: next.id, serviceId: null, locationId: null }
          : prev;
      });
    },
    [bumpStore],
  );

  const value = useMemo<SelectionContextValue>(() => {
    const organization = organizations.find((o) => o.id === state.organizationId) ?? organizations[0];
    const business = allBusinesses.find((b) => b.id === state.businessId) ?? allBusinesses[0];
    const businessesForOrg = allBusinesses.filter((b) => b.organizationId === organization.id);
    const servicesForBusiness = allServices.filter((s) => s.businessId === business.id);
    const locationsForBusiness = allLocations.filter((l) => l.businessId === business.id);
    return {
      ...state,
      organization,
      business,
      service: servicesForBusiness.find((s) => s.id === state.serviceId) ?? null,
      location: locationsForBusiness.find((l) => l.id === state.locationId) ?? null,
      businessesForOrg,
      servicesForBusiness,
      locationsForBusiness,
      isUserCreatedBusiness: isUserCreated(business.id),
      setBusinessId,
      setServiceId,
      setLocationId,
      createTenant,
      addLocation,
      addService,
      removeBusiness,
    };
  }, [
    state,
    allBusinesses,
    allLocations,
    allServices,
    setBusinessId,
    setServiceId,
    setLocationId,
    createTenant,
    addLocation,
    addService,
    removeBusiness,
  ]);

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

export function useSelection(): SelectionContextValue {
  const ctx = useContext(SelectionContext);
  if (!ctx) throw new Error("useSelection must be used inside <SelectionProvider>");
  return ctx;
}
