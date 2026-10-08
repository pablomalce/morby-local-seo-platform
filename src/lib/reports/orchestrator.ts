/**
 * Report orchestrator — server-side.
 *
 * Pipeline:
 *   1. Load the tenant snapshot (Supabase if authenticated, otherwise the universal seed
 *      dataset for demo mode).
 *   2. Hydrate with real data from connected integrations (Places API today; SC / GBP / GA4
 *      pending OAuth setup).
 *   3. Run the heuristic engine to produce the structured Report.
 *   4. Persist to Supabase `reports` table (when authenticated).
 *   5. Return the Report.
 *
 * This is the function the Reporting Agent calls, and what the API route uses.
 */

import "server-only";
import { buildBusinessSnapshot, businesses, locations, services } from "@/lib/mock/universal";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { lookupPlace } from "@/lib/integrations/google/places";
import { lookupPageSpeed } from "@/lib/integrations/google/pagespeed";
import { guardarSonda, sondaDeOutcome } from "@/lib/integrations/google/probe";
import type { GoogleSurface, PropertyMapping } from "@/lib/integrations/google/sources";
import { describirFallo, hydrateGoogle } from "@/lib/integrations/google/hydrate";
import { type AccessTokenResult, agencyAccessToken } from "@/lib/integrations/google/tokenStore";
import { fetchSearchConsoleTotals } from "@/lib/integrations/google/searchConsole";
import { fetchGa4Totals } from "@/lib/integrations/google/ga4";
import { type LecturaDeFicha, leerFichaPublicada } from "@/lib/profile/fichaPublicada";
import { buildReport } from "./engine";
import type { BusinessSnapshot } from "@/lib/mock/universal";
import type {
  Business,
  BusinessLocation,
  BusinessService,
  Competitor,
  ContentAsset,
  Review,
} from "@/lib/types/core";
import type { DataSourceHealth, ProfileCitation, Report } from "./types";

/**
 * Client-side snapshot passed from the browser when the tenant lives only in localStorage
 * (i.e. created via the onboarding wizard while not signed in). This lets demo users get
 * real reports without persisting to the DB.
 */
export interface ClientSnapshotInput {
  business: Business;
  locations: BusinessLocation[];
  services: BusinessService[];
  content?: ContentAsset[];
  competitors?: Competitor[];
  reviews?: Review[];
}

interface GenerateReportInput {
  /** Business ID (uuid for authenticated tenants, or one of the seed IDs in demo mode). */
  businessId: string;
  /** Optional snapshot from the client — used when the tenant isn't in DB nor seed. */
  clientSnapshot?: ClientSnapshotInput;
  /** Optional UI locale override — when set, the engine renders in this language regardless of business.primaryLocale. */
  locale?: "en" | "es" | "sv";
}

interface SnapshotResult {
  snapshot: BusinessSnapshot;
  /** True when the snapshot came from authenticated Supabase data. */
  authenticated: boolean;
  /** Contra qué versión de la ficha se va a escribir el reporte. */
  profileCitation: ProfileCitation;
}

/**
 * La versión publicada de la ficha de ESTA empresa, o por qué no hay cita.
 *
 * La lectura es `leerFichaPublicada` (src/lib/profile/fichaPublicada.ts), la
 * MISMA que sirve la ficha al Lead Engine por `GET /api/profile/published`:
 * desde H1.3 el reporte y el prompt del Lead Engine leen el ICP por un solo
 * camino, así que no pueden citar ICP distintos. Acá sólo se traduce a la cita.
 *
 * Un error de lectura es `error` y NO `none`: «no tiene ficha publicada» es un
 * hecho sobre el cliente y «no se pudo leer» es un fallo nuestro. Hoy, además,
 * es el caso normal en hosted —la `0026` no está aplicada y `company_profiles`
 * no existe, medido el 2026-09-30—, así que esta rama no es teórica: es la que
 * corre hasta que alguien aplique las tres migraciones de la ficha.
 *
 * `reason` es el código de PostgREST o de Postgres y nunca el mensaje, que
 * puede nombrar tablas y constraints; la lección del ensayo de publicación
 * (#104). Cero filas es `none`; dos filas publicadas son un error (PGRST116),
 * porque elegir una sería citar al azar. Ver el encabezado de la lectura.
 *
 * El ICP viaja DENTRO de la cita, de la misma variable: el texto del reporte
 * muestra el ICP de la versión que cita, no uno leído aparte.
 */
function citationFrom(lectura: LecturaDeFicha): ProfileCitation {
  switch (lectura.estado) {
    case "fallo":
      return { status: "error", reason: lectura.codigo };
    case "sin-version":
      return { status: "none" };
    case "publicada":
      return {
        status: "cited",
        versionId: lectura.ficha.versionId,
        version: lectura.ficha.version,
        publishedAt: lectura.ficha.publishedAt,
        icp: lectura.ficha.icp,
      };
  }
}

async function loadSnapshot({ businessId, clientSnapshot }: GenerateReportInput): Promise<SnapshotResult | null> {
  // Try authenticated path first.
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (user) {
    const { data: biz } = await supabase
      .from("businesses")
      .select("*")
      .eq("id", businessId)
      .single();
    if (biz) {
      const [locsResp, svcsResp, cmpResp, revResp, contentResp, plansResp, profileResp] = await Promise.all([
        supabase.from("business_locations").select("*").eq("business_id", businessId),
        supabase.from("business_services").select("*").eq("business_id", businessId),
        supabase.from("competitors").select("*").eq("business_id", businessId),
        supabase.from("reviews").select("*").eq("business_id", businessId),
        supabase.from("content_assets").select("*").eq("business_id", businessId),
        supabase.from("platform_tasks").select("*").eq("business_id", businessId),
        // H1.2 y H1.3: la versión PUBLICADA de la ficha de esta empresa, con su
        // ICP, por la lectura compartida con el Lead Engine. Ver `citationFrom`.
        leerFichaPublicada(supabase, biz.organization_id, businessId),
      ]);

      const business = {
        id: biz.id,
        organizationId: biz.organization_id,
        name: biz.name,
        website: biz.website,
        industry: biz.industry,
        brandTone: biz.brand_tone,
        primaryLocale: biz.primary_locale as "en" | "es" | "sv",
        valueProposition: biz.value_proposition,
        logoColor: biz.logo_color,
        createdAt: biz.created_at,
      };

      const snap = buildBusinessSnapshot(
        business,
        (locsResp.data ?? []).map(mapLocation),
        (svcsResp.data ?? []).map(mapService),
      );

      // Override the seed-derived collections with real DB data.
      snap.competitors = (cmpResp.data ?? []).map(mapCompetitor);
      snap.reviews = (revResp.data ?? []).map(mapReview);
      snap.content = (contentResp.data ?? []).map(mapContent);
      if ((plansResp.data ?? []).length > 0) {
        snap.plan = (plansResp.data ?? []).map(mapPlan);
      }

      return { snapshot: snap, authenticated: true, profileCitation: citationFrom(profileResp) };
    }
  }

  // Fall back to seed business (demo mode).
  const seed = businesses.find((b) => b.id === businessId);
  if (seed) {
    const locs = locations.filter((l) => l.businessId === seed.id);
    const svcs = services.filter((s) => s.businessId === seed.id);
    return {
      snapshot: buildBusinessSnapshot(seed, locs, svcs),
      authenticated: false,
      profileCitation: { status: "demo" },
    };
  }

  // Final fallback: tenant lives only in the client's localStorage (created via onboarding
  // wizard while not signed in). Build the snapshot from the data the browser sent.
  if (clientSnapshot && clientSnapshot.business?.id === businessId) {
    const snap = buildBusinessSnapshot(
      clientSnapshot.business,
      clientSnapshot.locations ?? [],
      clientSnapshot.services ?? [],
    );
    if (clientSnapshot.content?.length) snap.content = clientSnapshot.content;
    if (clientSnapshot.competitors?.length) snap.competitors = clientSnapshot.competitors;
    if (clientSnapshot.reviews?.length) snap.reviews = clientSnapshot.reviews;
    return { snapshot: snap, authenticated: false, profileCitation: { status: "demo" } };
  }

  return null;
}

/**
 * Hydrate the snapshot with real Google Places data when possible.
 * Returns the updated DataSourceHealth so the report shows provenance.
 */
async function hydrateWithPlaces(snap: BusinessSnapshot): Promise<DataSourceHealth["places"]> {
  if (!process.env.GOOGLE_PLACES_API_KEY) return "missing";

  const location = snap.locations.find((l) => l.isPrimary) ?? snap.locations[0];
  if (!location) return "missing";

  const query = `${snap.business.name} ${location.city ?? ""}`.trim();
  const lookup = await lookupPlace({ name: snap.business.name, query });

  if (lookup.status === "live") {
    // Mutate: overwrite review count + add a Google-rated competitor benchmark if helpful.
    // We do NOT touch the review array (that's the user's local CRM data) — just augment
    // the `reviewsGrowth` projection so KPIs reflect real Google numbers.
    if (typeof lookup.userRatingCount === "number" && lookup.userRatingCount > 0) {
      // Tag the current month's data point with the real count.
      if (snap.reviewsGrowth.length > 0) {
        const last = snap.reviewsGrowth[snap.reviewsGrowth.length - 1];
        last.reviews = lookup.userRatingCount;
      }
    }
    return "live";
  }
  if (lookup.status === "no-match") return "missing";
  return lookup.status === "missing-key" ? "missing" : "error";
}

/** How long a cached PageSpeed result stays fresh. */
const PAGESPEED_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Cuánto puede estar en el FUTURO un `fetched_at` y seguir sirviéndose.
 *
 * El `fetched_at` lo pone `lookupPageSpeed` con el reloj de ESTE servidor en el
 * momento en que Google contestó, así que uno futuro sólo puede venir de dos
 * lados: el reloj de otra instancia adelantado unos milisegundos, o una fila
 * que no escribió este código. La segunda existió: hasta la `0030`, cualquier
 * cuenta escribía la fila con el `fetched_at` que quisiera, y con uno en el año
 * 2999 la cuenta `ahora - fetched_at < TTL` da negativo, o sea «fresca», PARA
 * SIEMPRE: nunca se volvía a preguntar a Google ni se pisaba la fila. Medido en
 * la réplica y con este archivo el 2026-10-07.
 *
 * Cinco minutos cubren de sobra el primer caso y le ponen techo al segundo: lo
 * más que una fila con fecha futura puede durar es el TTL más este margen.
 */
const PAGESPEED_RELOJ_MS = 5 * 60 * 1000;

type WebVitals = NonNullable<BusinessSnapshot["webVitals"]>;

/**
 * LA CACHÉ DE PAGESPEED ES DE CADA ORGANIZACIÓN, Y LA TOCA SÓLO EL SERVIDOR (0030)
 *
 * Con `service_role` —`createSupabaseAdminClient`— y NUNCA con la sesión. Medido
 * en producción el 2026-10-06: con la sesión de por medio, la tabla tenía que
 * estar abierta a quien la sesión representa, y eso era `anon` para leer —la
 * lista de URLs de los clientes, con la clave del bundle— y `authenticated` para
 * escribir, con el alta de cuentas abierta: cualquiera con un correo
 * upserteaba un resultado inventado para la URL de un cliente y este archivo lo
 * servía 24 h en su reporte. La `0030` le saca la tabla a los dos; con la sesión,
 * estas dos funciones sólo verían 42501.
 *
 * Y POR ORGANIZACIÓN, porque el servidor solo no alcanzaba. `service_role`
 * saltea la RLS, y con la clave por URL sola el servidor hacía de diputado
 * confundido: medido el 2026-10-07, una cuenta recién registrada pedía un
 * reporte con la URL de un cliente ajeno —por `clientSnapshot`, o creando en su
 * propia organización un negocio con esa web, que el alta le deja hacer— y el
 * servidor le contestaba desde la caché del cliente: sin llamar a Google, en
 * milisegundos y con el `fetchedAt` del último reporte del cliente. Era un
 * oráculo de «¿esta URL es cliente de alguien acá, y cuándo fue su último
 * reporte?», sobre el mismo activo que la `0030` vino a cerrar. Con la clave
 * `(organization_id, url, strategy)` cada organización sólo se encuentra a sí
 * misma, y el `organization_id` sale del negocio que la sesión LEYÓ de la base
 * bajo su RLS, nunca del pedido.
 *
 * Sin organización —el reporte de demostración y el de `clientSnapshot`— no hay
 * caché: ni se lee ni se escribe, igual que la sonda de más abajo. Esos
 * reportes van siempre a Google.
 *
 * SIGUE SIENDO BEST-EFFORT, PERO NO EN SILENCIO
 *
 * Un fallo de caché no tumba el reporte: una lectura que falla es «no hay
 * caché» y la consulta va a Google; una escritura que falla deja el reporte
 * como estaba. Lo que cambia es que ya no se traga: hasta la `0030`, el error de
 * PostgREST se descartaba sin mirarlo, y un permiso denegado —el estado en que
 * deja la `0030` al código viejo— se veía igual que una caché vacía, con cada
 * reporte gastando cuota de Google sin que nada lo dijera. Ahora queda en el log
 * con el CÓDIGO y no con el mensaje, que puede nombrar tablas (la lección de
 * #104, la misma que sigue el INSERT de `reports` más abajo). Ni la URL ni la
 * organización van al log: la URL es justamente lo que esto protege.
 *
 * Y el cliente de servicio TIRA si le faltan sus variables —
 * `SUPABASE_SERVICE_ROLE_KEY` sin cargar en un deploy—, por eso el `try`: es lo
 * mismo que hace `guardarSonda`, y por el mismo motivo.
 */
function avisarCache(paso: "lectura" | "escritura", motivo: string): void {
  console.warn(`[pagespeed-cache] ${paso}: ${motivo}`);
}

/**
 * Las tres columnas de la clave primaria de la `0030`, en su orden. El upsert
 * las nombra en vez de confiar en el default de PostgREST, y el test lo afirma:
 * un `ignoreDuplicates` o un `onConflict` que no sea la clave cambia qué hace el
 * upsert sin que nada se rompa a la vista.
 */
const CLAVE_DE_LA_CACHE = "organization_id,url,strategy";

async function leerPageSpeedCacheado(
  organizationId: string,
  url: string,
  strategy: string
): Promise<{ result: WebVitals; fetched_at: string } | null> {
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("pagespeed_cache")
      .select("result, fetched_at")
      .eq("organization_id", organizationId)
      .eq("url", url)
      .eq("strategy", strategy)
      .maybeSingle();
    if (error) {
      avisarCache("lectura", error.code || "sin código");
      return null;
    }
    return (data as { result: WebVitals; fetched_at: string } | null) ?? null;
  } catch {
    avisarCache("lectura", "el cliente de servicio no se pudo crear o tiró");
    return null;
  }
}

async function guardarPageSpeedEnCache(
  organizationId: string,
  url: string,
  strategy: string,
  webVitals: WebVitals
): Promise<void> {
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin
      .from("pagespeed_cache")
      .upsert(
        { organization_id: organizationId, url, strategy, result: webVitals, fetched_at: webVitals.fetchedAt },
        { onConflict: CLAVE_DE_LA_CACHE }
      );
    if (error) avisarCache("escritura", error.code || "sin código");
  } catch {
    avisarCache("escritura", "el cliente de servicio no se pudo crear o tiró");
  }
}

/**
 * Si una fila de la caché se puede servir. `invalida` es un `fetched_at` que no
 * se puede leer o que está más allá de `PAGESPEED_RELOJ_MS` en el futuro: no la
 * escribió una consulta de este servidor, y se trata como si no estuviera.
 */
function frescura(fetchedAt: string, ahora: number): "fresca" | "vencida" | "invalida" {
  const medida = Date.parse(fetchedAt);
  if (!Number.isFinite(medida) || medida - ahora > PAGESPEED_RELOJ_MS) return "invalida";
  return ahora - medida < PAGESPEED_TTL_MS ? "fresca" : "vencida";
}

/**
 * Hydrate the snapshot with real Core Web Vitals from Google PageSpeed Insights.
 * Returns the resulting DataSourceHealth status so the report shows provenance.
 *
 * Caching strategy: PageSpeed is slow (15–40s) and flaky on slow sites, so we cache only
 * SUCCESSFUL results in the `pagespeed_cache` table (keyed by organization+url+strategy, 24h
 * TTL). A fresh hit is served instantly and survives redeploys; failures are never cached. All
 * cache access is best-effort, server-only and per organization — see `leerPageSpeedCacheado`
 * above for why, and why its failures are logged instead of swallowed.
 *
 * POR QUÉ ADEMÁS ANOTA UNA SONDA
 *
 * Porque `error` sin motivo fue exactamente el estado en que PageSpeed quedó los
 * dos primeros reportes reales, y `missing-key` es un estado aparte: la clave
 * está y la llamada falló, sin decir si fue permiso, cuota o tiempo. La 0023
 * abre la tabla de la 0022 para que ese motivo sobreviva al log — ver su
 * encabezado.
 *
 * `organizationId` llega en null cuando el reporte es de demostración, y ahí no
 * se anota nada: la tabla tiene `organization_id NOT NULL`, y una demo no tiene
 * organización. Sólo se anota cuando de verdad hubo una llamada — un cache hit no
 * consultó a Google, así que declarar `ok` sería afirmar sobre una consulta que
 * no ocurrió. La caché sigue la misma regla, por el motivo de su encabezado.
 */
async function hydrateWithPageSpeed(
  snap: BusinessSnapshot,
  organizationId: string | null
): Promise<DataSourceHealth["pagespeed"]> {
  if (!process.env.GOOGLE_PAGESPEED_API_KEY) return "missing";
  const website = snap.business.website;
  if (!website) return "missing";
  const strategy = "mobile";

  // 1. Serve a fresh cached good result if this organization has one.
  if (organizationId) {
    const cached = await leerPageSpeedCacheado(organizationId, website, strategy);
    if (cached) {
      const estado = frescura(cached.fetched_at, Date.now());
      if (estado === "fresca") {
        snap.webVitals = cached.result;
        return "live";
      }
      // La fila se ignora y el upsert de abajo la pisa con lo que conteste Google.
      if (estado === "invalida") avisarCache("lectura", "fetched_at futuro o ilegible, se ignora la fila");
    }
  }

  // 2. Cache miss / stale / no organization → fresh lookup.
  const result = await lookupPageSpeed({ url: website, strategy });

  // La sonda va antes de mirar el resultado, y se guarda también cuando salió
  // bien: «anduvo hace un rato» es la mitad del diagnóstico. Sus fallos no
  // cambian nada — ver el encabezado de `probe.ts`.
  if (organizationId) {
    const motivo = describirFallo(result.outcome, website);
    if (motivo) console.warn(`[google] pagespeed: ${motivo}`);
    // `guardarSonda` no tira: traga su propio error a propósito, porque un
    // reporte que se cae por no poder anotar por qué falló otra cosa convierte
    // una molestia en una caída.
    await guardarSonda(sondaDeOutcome(organizationId, "pagespeed", result.outcome, website));
  }

  if (result.status === "live" && result.lighthouseScore !== undefined) {
    const webVitals = {
      lcp: result.lcp ?? 0,
      inp: result.inp ?? 0,
      cls: result.cls ?? 0,
      lighthouseScore: result.lighthouseScore,
      fetchedAt: result.fetchedAt ?? new Date().toISOString(),
    };
    snap.webVitals = webVitals;
    // 3. Cache the good result (best-effort — never block the report on a cache write).
    // `webVitals` sale de `result`, o sea de la respuesta de Google a este
    // servidor; del pedido no llega nada a esta fila, y la URL y la organización
    // salen del negocio que la sesión leyó de la base.
    if (organizationId) await guardarPageSpeedEnCache(organizationId, website, strategy, webVitals);
    return "live";
  }
  if (result.status === "missing-key") return "missing";
  return "error";
}

/**
 * Los mapeos VIVOS de una organización, de `integration_properties`.
 *
 * Una consulta para las tres superficies: la 0017 garantiza un mapeo vivo por
 * organización y proveedor, así que son tres filas como mucho y pedirlas de a
 * una sería triplicar el costo de cada reporte por nada.
 *
 * `organization_id` va escrito aunque la RLS ya lo imponga, por lo mismo que el
 * INSERT en `reports` lo escribe: la policy es la garantía y el filtro es lo que
 * hace legible qué se está pidiendo. Y `unmapped_at IS NULL` también, aunque el
 * índice único sólo alcance a los vivos — el índice impide que haya DOS vivos,
 * no que se lea uno muerto.
 *
 * Un fallo de lectura devuelve la lista vacía y NO rompe el reporte. La
 * consecuencia es que las tres fuentes salen `client-not-mapped`, que es lo
 * mismo que dirían si no hubiera mapeo — y eso es una pérdida de precisión
 * aceptada a cambio de que una integración no tumbe un reporte que las otras
 * cuatro fuentes pueden llenar igual.
 */
async function readPropertyMappings(organizationId: string): Promise<PropertyMapping[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("integration_properties")
    .select("provider, property_ref")
    .eq("organization_id", organizationId)
    .is("unmapped_at", null);

  if (error || !data) return [];
  return data.map((row) => ({
    provider: row.provider as GoogleSurface,
    propertyRef: row.property_ref as string,
  }));
}

/**
 * El token de la agencia para ESTE reporte, o por qué no lo hay.
 *
 * Un reporte de demostración no tiene sesión ni organización, así que tampoco
 * tiene mapeos: las tres fuentes salen `missing` por el mapeo y el token nunca se
 * llega a usar. Se escribe igual, y con un motivo honesto, para que haya UN solo
 * camino — una rama que saltee la hidratación entera sería una segunda manera de
 * decidir estados, y dos maneras se separan con el tiempo.
 */
async function tokenParaElReporte(authenticated: boolean): Promise<AccessTokenResult> {
  if (!authenticated) {
    return { ok: false, reason: "absent", detail: "reporte de demostración, sin sesión" };
  }
  return agencyAccessToken();
}

export async function generateReport(input: GenerateReportInput): Promise<Report | null> {
  const result = await loadSnapshot(input);
  if (!result) {
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.warn("[reports] No snapshot for", input.businessId, "clientSnapshot?", !!input.clientSnapshot);
    }
    return null;
  }

  // Both hydrations mutate the same snapshot but write disjoint fields, so they're safe in parallel.
  const [placesStatus, pagespeedStatus] = await Promise.all([
    hydrateWithPlaces(result.snapshot),
    hydrateWithPageSpeed(
      result.snapshot,
      result.authenticated ? result.snapshot.business.organizationId : null
    ),
  ]);

  // Sin sesión no hay mapeo que leer: la tabla es por organización y un reporte
  // de demostración no tiene ninguna. Las tres salen `missing`, que es lo que
  // corresponde — y por eso la lista vacía, no por una palabra escrita.
  const mappings = result.authenticated
    ? await readPropertyMappings(result.snapshot.business.organizationId)
    : [];

  // El token se pide UNA vez para las tres superficies, y las dos consultas que
  // hoy existen salen en paralelo. Ver `hydrate.ts`.
  const ahora = new Date();
  const google = await hydrateGoogle({
    mappings,
    token: await tokenParaElReporte(result.authenticated),
    fetchSearchConsole: (accessToken, propertyRef) =>
      fetchSearchConsoleTotals({ accessToken, propertyRef, ahora, fetcher: fetch }),
    fetchGa4: (accessToken, propertyRef) =>
      fetchGa4Totals({ accessToken, propertyRef, ahora, fetcher: fetch }),
    // Sólo con sesión: `integration_probe` tiene `organization_id NOT NULL`, y un
    // reporte de demostración no tiene tenant que anotar. Sin esto, la sonda del
    // demo escribiría contra la organización sembrada, que no existe en la base.
    organizationId: result.authenticated ? result.snapshot.business.organizationId : null,
    recordProbe: guardarSonda,
  });

  // Los números entran al snapshot, como los de PageSpeed: el motor los muestra
  // si están y no los inventa si no. Un total ausente y un total en cero son
  // cosas distintas, y ésta es la línea donde se mantienen distintas.
  if (google.searchConsoleTotals) result.snapshot.searchConsole = google.searchConsoleTotals;
  if (google.ga4Totals) result.snapshot.ga4 = google.ga4Totals;

  const report = buildReport(result.snapshot, ahora.toISOString(), {
    dataSources: {
      places: placesStatus,
      pagespeed: pagespeedStatus,
      searchConsole: google.searchConsole,
      gbp: google.gbp,
      ga4: google.ga4,
    },
    localeOverride: input.locale,
    profileCitation: result.profileCitation,
  });

  // Persist to DB if authenticated.
  if (result.authenticated) {
    const supabase = await createSupabaseServerClient();
    const { error: persistError } = await supabase.from("reports").insert({
      // Explicit. The snapshot already carries the tenant — it was read from
      // the same `businesses` row this report is about — so the trigger that
      // used to supply it was supplying a value that had been in scope all
      // along. That trigger is gone as of 0012; without this line the insert is
      // refused by NOT NULL. See tenantOf() in lib/store/supabaseTenantStore.ts.
      organization_id: result.snapshot.business.organizationId,
      business_id: report.businessId,
      title: `${report.businessName} · ${new Date(report.generatedAt).toLocaleDateString()}`,
      kind: "weekly",
      locale: report.locale,
      summary: report.summary,
      content: JSON.stringify(report),
      // La cita, para la base: FK compuesta a la versión (la `0028`). Sale de la
      // MISMA variable que la cita del JSON de arriba, así que las dos no pueden
      // decir cosas distintas.
      //
      // Y la clave va SÓLO cuando hay algo que citar, no como `null`. Es a
      // propósito y es por el orden de despliegue: en una base sin la `0028` la
      // columna no existe, y un `profile_version_id: null` rompería con 42703
      // TODOS los reportes; así sólo rompe el de una empresa con versión
      // publicada, que sin la `0026` no puede existir. Ver la `0028`, «QUÉ NO
      // HACE».
      ...(report.profileCitation.status === "cited"
        ? { profile_version_id: report.profileCitation.versionId }
        : {}),
    });

    // Antes este error se tragaba: el reporte volvía a la pantalla y nadie se
    // enteraba de que no se había guardado. Desde H1.2 eso es peor que antes,
    // porque la puerta dice que el reporte generado CITA una versión que
    // resuelve — y un reporte que no se guardó no cita nada, en silencio. Así
    // que se levanta, con el código y no con el mensaje (que puede nombrar
    // tablas), y la ruta lo convierte en su respuesta genérica.
    //
    // No rompe nada que ande: medido en hosted el 2026-09-30, `reports` tiene
    // 5 filas, la última del 2026-09-05. El INSERT funciona hoy.
    if (persistError) {
      throw new Error(`reports: el reporte no se guardó (${persistError.code ?? "sin código"})`);
    }
  }

  return report;
}

// ---------------------------------------------------------------------------
// Row → app type mappers
// ---------------------------------------------------------------------------

function mapLocation(row: any) {
  return {
    id: row.id,
    businessId: row.business_id,
    label: row.label,
    addressLine: row.address_line,
    city: row.city,
    region: row.region,
    country: row.country,
    primaryGeoQuery: row.primary_geo_query,
    latitude: row.latitude ?? undefined,
    longitude: row.longitude ?? undefined,
    isPrimary: row.is_primary,
  };
}

function mapService(row: any) {
  return {
    id: row.id,
    businessId: row.business_id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    primaryKeyword: row.primary_keyword,
    supportingKeywords: row.supporting_keywords ?? [],
    isFeatured: row.is_featured,
  };
}

function mapCompetitor(row: any) {
  return {
    id: row.id,
    businessId: row.business_id,
    locationId: row.location_id ?? undefined,
    name: row.name,
    website: row.website ?? undefined,
    rating: row.rating ?? undefined,
    reviewCount: row.review_count ?? undefined,
    strengthScore: row.strength_score,
    relevanceScore: row.relevance_score,
    strengths: row.strengths ?? [],
    weaknesses: row.weaknesses ?? [],
    opportunities: row.opportunities ?? [],
  };
}

function mapReview(row: any) {
  return {
    id: row.id,
    businessId: row.business_id,
    locationId: row.location_id ?? undefined,
    author: row.author,
    rating: row.rating,
    text: row.text,
    serviceMentioned: row.service_mentioned ?? undefined,
    suggestedReply: row.suggested_reply ?? undefined,
    status: row.status,
    receivedAt: row.received_at,
  };
}

function mapContent(row: any) {
  return {
    id: row.id,
    businessId: row.business_id,
    serviceId: row.service_id ?? undefined,
    locale: row.locale,
    kind: row.kind,
    title: row.title ?? undefined,
    body: row.body,
    targetKeyword: row.target_keyword ?? undefined,
    status: row.status,
    createdAt: row.created_at,
  };
}

function mapPlan(row: any) {
  return {
    id: row.id,
    businessId: row.business_id,
    title: row.title,
    description: row.description ?? undefined,
    category: row.category,
    priority: row.priority,
    impact: row.impact,
    difficulty: row.difficulty,
    week: row.week,
    status: row.status,
  };
}
