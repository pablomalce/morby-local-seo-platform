"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
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
import {
  createTenantInDb,
  deleteBusinessFromDb,
  fetchMyBusinesses,
} from "@/lib/store/supabaseTenantStore";
import { useAuth } from "@/lib/auth/AuthProvider";
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
  /** True when we have an authenticated user and tenants come from Supabase. */
  isAuthenticated: boolean;
  setBusinessId: (id: string) => void;
  setServiceId: (id: string | null) => void;
  setLocationId: (id: string | null) => void;
  createTenant: (input: {
    business: Omit<NewBusinessInput, "organizationId">;
    firstLocation?: Omit<NewLocationInput, "businessId">;
    firstService?: Omit<NewServiceInput, "businessId">;
  }) => Promise<Business>;
  addLocation: (input: Omit<NewLocationInput, "businessId">) => Promise<BusinessLocation>;
  addService: (input: Omit<NewServiceInput, "businessId">) => Promise<BusinessService>;
  removeBusiness: (id: string) => Promise<void>;
}

const SelectionContext = createContext<SelectionContextValue | null>(null);

/**
 * Empty selection — no business picked. The header selector renders a "Select a business"
 * placeholder; pages that need a business render a friendly empty state. The previous default
 * of "first seed tenant" caused the Mörby flash on every navigation.
 */
function emptySelection(): SelectionState {
  return {
    organizationId: organizations[0]?.id ?? "",
    businessId: "",
    serviceId: null,
    locationId: null,
  };
}

export function SelectionProvider({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const isAuthenticated = !!user;

  // Bump this counter whenever the underlying tenant store changes so memoised lists recompute.
  const [storeVersion, setStoreVersion] = useState(0);
  const bumpStore = useCallback(() => setStoreVersion((v) => v + 1), []);

  // DB-backed tenant data (only populated when authenticated).
  const [dbState, setDbState] = useState<{
    organizationId: string | null;
    businesses: Business[];
    locations: BusinessLocation[];
    services: BusinessService[];
  } | null>(null);

  // Hydrate DB tenants when the user signs in or signs out.
  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      setDbState(null);
      return;
    }
    let cancelled = false;
    fetchMyBusinesses()
      .then((data) => {
        if (cancelled) return;
        setDbState(data);
      })
      .catch(() => {
        if (cancelled) return;
        setDbState({ organizationId: null, businesses: [], locations: [], services: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, authLoading, storeVersion]);

  // localStorage seed (always-on for demo mode and as fallback while DB loads).
  const localBusinesses = useMemo(() => listAllBusinesses(), [storeVersion]);
  const localLocations = useMemo(() => listAllLocations(), [storeVersion]);
  const localServices = useMemo(() => listAllServices(), [storeVersion]);

  // Pick which dataset is live: DB (authenticated) vs local (demo).
  const allBusinesses = isAuthenticated && dbState ? dbState.businesses : localBusinesses;
  const allLocations = isAuthenticated && dbState ? dbState.locations : localLocations;
  const allServices = isAuthenticated && dbState ? dbState.services : localServices;

  const [state, setState] = useState<SelectionState>(emptySelection);

  // Track whether we've read the localStorage selection yet. We must NOT persist the empty
  // default state before this happens — otherwise the persist effect clobbers the saved
  // selection on first render, defeating the whole point of localStorage.
  const restoredRef = useRef(false);

  // Restore previously selected business on mount (runs before persistence kicks in).
  useEffect(() => {
    if (typeof window === "undefined") {
      restoredRef.current = true;
      return;
    }
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<SelectionState>;
        if (parsed.businessId) {
          setState((prev) => ({ ...prev, ...parsed } as SelectionState));
        }
      }
    } catch {
      /* ignore */
    }
    restoredRef.current = true;
  }, []);

  // Sync selection when datasets change (e.g. user signs in and DB tenants arrive).
  // If the previously selected business no longer exists, clear the selection (don't auto-pick
  // another tenant) so the user explicitly picks a new one.
  useEffect(() => {
    // QUÉ IMPIDE ESTA GUARDA
    //
    // Que la selección de un negocio REAL se borre sola al cambiar de página.
    //
    // Con sesión y antes de que llegue `dbState`, `allBusinesses` son los
    // SEMBRADOS. El uuid restaurado de `localStorage` no está entre ellos, así
    // que este efecto lo leía como «el negocio ya no existe» y limpiaba — y el
    // efecto de persistencia escribía el vacío encima. Medido en producción el
    // 2026-09-05: `businessId` pasó de `7d703707-…` a `""` con sólo navegar de
    // `/reports` a `/dashboard`.
    //
    // Y no alcanza con que el efecto de restauración corra primero: los dos
    // `setState` caen en el mismo lote, y el actualizador de acá recibe el
    // estado YA restaurado. O sea que el orden de los efectos no protege nada.
    //
    // `dbState === null` es «todavía no contestó», y es distinto de haber
    // contestado sin negocios: en ese caso `dbState` es un objeto con la lista
    // vacía y limpiar es correcto, porque el negocio de verdad no está.
    if (isAuthenticated && dbState === null) return;

    setState((prev) => {
      if (!prev.businessId) return prev; // No selection yet — leave it.
      const stillExists = allBusinesses.some((b) => b.id === prev.businessId);
      if (stillExists) return prev;
      return { ...emptySelection(), organizationId: prev.organizationId };
    });
  }, [allBusinesses, isAuthenticated, dbState]);

  // Persist selection to localStorage so reloads keep context. Guarded so it never writes
  // the empty default state before restore has had a chance to run.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!restoredRef.current) return;
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
    async (input) => {
      if (isAuthenticated && dbState?.organizationId) {
        // Persist to Supabase.
        await createTenantInDb({
          organizationId: dbState.organizationId,
          business: { ...input.business },
          firstLocation: input.firstLocation
            ? { ...input.firstLocation }
            : undefined,
          firstService: input.firstService
            ? { ...input.firstService }
            : undefined,
        });
        const refreshed = await fetchMyBusinesses();
        setDbState(refreshed);
        const newest = refreshed.businesses[refreshed.businesses.length - 1];
        if (newest) {
          setState({
            organizationId: newest.organizationId,
            businessId: newest.id,
            serviceId: null,
            locationId: null,
          });
        }
        return newest!;
      }

      // Demo path — localStorage.
      const business = storeCreateBusiness({
        ...input.business,
        organizationId: organizations[0].id,
      });
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
    [isAuthenticated, dbState, bumpStore],
  );

  const addLocation: SelectionContextValue["addLocation"] = useCallback(
    async (input) => {
      // Demo only for now — DB version is a Phase 3 follow-up.
      const loc = storeCreateLocation({ ...input, businessId: state.businessId });
      bumpStore();
      return loc;
    },
    [bumpStore, state.businessId],
  );

  const addService: SelectionContextValue["addService"] = useCallback(
    async (input) => {
      const svc = storeCreateService({ ...input, businessId: state.businessId });
      bumpStore();
      return svc;
    },
    [bumpStore, state.businessId],
  );

  const removeBusiness: SelectionContextValue["removeBusiness"] = useCallback(
    async (id) => {
      if (isAuthenticated) {
        await deleteBusinessFromDb(id);
        const refreshed = await fetchMyBusinesses();
        setDbState(refreshed);
      } else {
        storeDeleteBusiness(id);
        bumpStore();
      }
      setState((prev) => {
        if (prev.businessId !== id) return prev;
        const remaining = isAuthenticated && dbState ? dbState.businesses : listAllBusinesses();
        const next = remaining[0];
        return next
          ? { organizationId: next.organizationId, businessId: next.id, serviceId: null, locationId: null }
          : prev;
      });
    },
    [bumpStore, isAuthenticated, dbState],
  );

  const value = useMemo<SelectionContextValue>(() => {
    const organization =
      organizations.find((o) => o.id === state.organizationId) ?? organizations[0];
    // Placeholder business for the "no selection yet" state. Pages that need a business
    // detect it via `business.id === ""` and render an empty state.
    const placeholderBusiness: Business = {
      id: "",
      organizationId: organization.id,
      name: "__SELECT_BUSINESS__", // sentinel — the selector renders a localised label.
      website: "",
      industry: "other",
      brandTone: "",
      primaryLocale: "en",
      valueProposition: "",
      logoColor: "#3a3a3a",
      createdAt: new Date().toISOString(),
    };
    const business = state.businessId
      ? allBusinesses.find((b) => b.id === state.businessId) ?? placeholderBusiness
      : placeholderBusiness;

    // QUÉ IMPIDE ESTA LÍNEA
    //
    // Que los negocios REALES se filtren contra el id de una organización de
    // MENTIRA, y desaparezcan del selector después de haber llegado.
    //
    // `organizations` viene de `@/lib/mock/universal`, que es lo correcto en
    // modo demo y era todo lo que había cuando esto se escribió. Con sesión, los
    // negocios llegan de la base con el `organization_id` de su tenant, que
    // nunca coincide con el de una organización sembrada — así que el filtro de
    // abajo los descartaba TODOS.
    //
    // El síntoma engaña: la petición sale, contesta 200 y trae el negocio, y el
    // desplegable queda vacío igual. Medido el 2026-09-01 con
    // `/rest/v1/businesses?organization_id=eq.df6743a9…` en 200 y el selector sin
    // una sola opción.
    const organizationIdActiva =
      isAuthenticated && dbState?.organizationId ? dbState.organizationId : organization.id;

    const businessesForOrg = allBusinesses.filter(
      (b) => b.organizationId === organizationIdActiva
    );
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
      // QUÉ IMPIDE ESTA LÍNEA
      //
      // Que la SESIÓN conteste una pregunta sobre el DATO.
      //
      // Decía `isAuthenticated ? true : isUserCreated(business.id)`. En el caso
      // ya cargado da lo mismo —los negocios de la base traen uuid y ninguno
      // está en la lista de sembrados—, así que el cambio no mueve nada ahí. Lo
      // que arregla es la ventana intermedia: entre que hay sesión y que llegan
      // los tenants de la base, `allBusinesses` son los SEMBRADOS, y una
      // selección restaurada de `localStorage` puede apuntar a Mörby. Con la
      // versión vieja, esa pantalla llena de datos de demostración se anunciaba
      // como propia del usuario.
      //
      // `SelectionContext.marcaAntesDeLaBase.test.tsx` sostiene exactamente esa
      // ventana, con el `fetch` colgado a propósito.
      isUserCreatedBusiness: isUserCreated(business.id),
      isAuthenticated,
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
    isAuthenticated,
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
