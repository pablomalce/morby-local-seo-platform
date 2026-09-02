// @vitest-environment jsdom
/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Dos cosas, y las dos son cableado.
 *
 * La primera: que los campos del formulario existan y no llamen a la acción de
 * servidor. El privilegio entero de la `0017` depende de que el mapeo se
 * escriba desde el servidor; un `createSupabaseBrowserClient()` acá adentro
 * sería la escalada que el bloque 38 mide, escrita por nosotros.
 *
 * La segunda: que las dos razones que comparten estado se muestren DISTINTAS.
 * `screen.test.ts` prueba que la razón se calcula; lo que no puede probar es que
 * la pantalla la diga. Una pantalla que calcula bien la razón y muestra el mismo
 * texto para las dos manda a un operador a configurar un cliente que ya está
 * bien, que es el defecto que arregló el #46 y la razón por la que esta pantalla
 * existe.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mapProperty = vi.fn(async () => ({ ok: true }) as { ok: boolean; message?: string });
const unmapProperty = vi.fn(async () => ({ ok: true }) as { ok: boolean; message?: string });
vi.mock("@/lib/integrations/property-actions", () => ({ mapProperty, unmapProperty }));

const ORG = "22222222-2222-4222-8222-222222222222";

async function componente() {
  return import("@/app/app/integrations/client");
}

/** Una vista de superficie, con lo que cada test necesita cambiar. */
function vista(over: Partial<Record<string, unknown>> = {}) {
  return {
    surface: "ga4",
    state: "not-connected",
    reason: "client-not-mapped",
    propertyRef: null,
    ...over,
  } as never;
}

beforeEach(() => {
  mapProperty.mockClear();
  unmapProperty.mockClear();
  mapProperty.mockResolvedValue({ ok: true });
  unmapProperty.mockResolvedValue({ ok: true });
});

// El proyecto no carga `@testing-library/jest-dom` ni corre con `globals`, así
// que la limpieza automática no existe: sin esto, el segundo `render` de un
// mismo `describe` deja dos árboles en el documento y `getByText` se rompe por
// duplicado en vez de por lo que el test mide.
afterEach(cleanup);

describe("el formulario escribe por la acción de servidor", () => {
  it("CONNECT manda la organización, la superficie y lo que se escribió", async () => {
    const { OrganizationIntegrations } = await componente();
    render(
      <OrganizationIntegrations
        organizationId={ORG}
        organizationName="Cliente A"
        organizationSlug="cliente-a"
        surfaces={[vista()]}
      />
    );

    fireEvent.change(screen.getByLabelText("Google Analytics 4 property"), {
      target: { value: "properties/123456789" },
    });
    fireEvent.click(screen.getByRole("button", { name: "CONNECT" }));

    await waitFor(() => expect(mapProperty).toHaveBeenCalledTimes(1));
    expect(mapProperty).toHaveBeenCalledWith({
      organizationId: ORG,
      surface: "ga4",
      propertyRef: "properties/123456789",
    });
  });

  it("DISCONNECT manda la organización y la superficie", async () => {
    const { OrganizationIntegrations } = await componente();
    render(
      <OrganizationIntegrations
        organizationId={ORG}
        organizationName="Cliente A"
        organizationSlug="cliente-a"
        surfaces={[vista({ state: "connected", reason: null, propertyRef: "properties/1" })]}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "DISCONNECT" }));

    await waitFor(() => expect(unmapProperty).toHaveBeenCalledTimes(1));
    expect(unmapProperty).toHaveBeenCalledWith({ organizationId: ORG, surface: "ga4" });
  });

  it("no se puede desconectar lo que no está mapeado", async () => {
    const { OrganizationIntegrations } = await componente();
    render(
      <OrganizationIntegrations
        organizationId={ORG}
        organizationName="Cliente A"
        organizationSlug="cliente-a"
        surfaces={[vista()]}
      />
    );
    const boton = screen.getByRole("button", { name: "DISCONNECT" }) as HTMLButtonElement;
    expect(boton.disabled).toBe(true);
  });

  it("el campo arranca con el mapeo que ya tiene el cliente", async () => {
    // Un campo vacío al lado de «conectado» le hace creer al operador que se
    // perdió el mapeo, y el primer reflejo es volver a escribirlo.
    const { OrganizationIntegrations } = await componente();
    render(
      <OrganizationIntegrations
        organizationId={ORG}
        organizationName="Cliente A"
        organizationSlug="cliente-a"
        surfaces={[vista({ state: "connected", reason: null, propertyRef: "properties/999" })]}
      />
    );
    const campo = screen.getByLabelText("Google Analytics 4 property") as HTMLInputElement;
    expect(campo.value).toBe("properties/999");
  });

  it("el rechazo de la acción se muestra, no se traga", async () => {
    mapProperty.mockResolvedValue({
      ok: false,
      message: "Esa property ya está mapeada a otra organización. Desmapeala allá primero.",
    });
    const { OrganizationIntegrations } = await componente();
    render(
      <OrganizationIntegrations
        organizationId={ORG}
        organizationName="Cliente A"
        organizationSlug="cliente-a"
        surfaces={[vista()]}
      />
    );

    fireEvent.change(screen.getByLabelText("Google Analytics 4 property"), {
      target: { value: "properties/1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "CONNECT" }));

    await waitFor(() =>
      expect(screen.getByText(/ya está mapeada a otra organización/)).toBeTruthy()
    );
  });
});

describe("las dos razones que comparten estado se leen distinto", () => {
  it("la de plataforma manda a Google Cloud y dice que no es por cliente", async () => {
    const { OrganizationIntegrations } = await componente();
    render(
      <OrganizationIntegrations
        organizationId={ORG}
        organizationName="Cliente A"
        organizationSlug="cliente-a"
        surfaces={[vista({ reason: "platform-not-connected" })]}
      />
    );
    const texto = screen.getByText(/Google Cloud/);
    expect(texto.textContent).toMatch(/not per client/);
  });

  it("la de cliente manda a esta pantalla, para este cliente", async () => {
    const { OrganizationIntegrations } = await componente();
    render(
      <OrganizationIntegrations
        organizationId={ORG}
        organizationName="Cliente A"
        organizationSlug="cliente-a"
        surfaces={[vista({ reason: "client-not-mapped" })]}
      />
    );
    const texto = screen.getByText(/no property assigned/);
    expect(texto.textContent).toMatch(/Fixed here/);
  });

  it("las dos comparten estado y NO comparten texto", async () => {
    // Ésta es la afirmación entera de esta pantalla. Si los dos textos se
    // igualan, todo lo demás sigue en verde y la pantalla vuelve a ser la que
    // manda a arreglar lo que ya está bien.
    const { OrganizationIntegrations } = await componente();
    const textoDe = (reason: string) => {
      const { container, unmount } = render(
        <OrganizationIntegrations
          organizationId={ORG}
          organizationName="Cliente A"
          organizationSlug="cliente-a"
          surfaces={[vista({ reason })]}
        />
      );
      const t = container.textContent ?? "";
      unmount();
      return t;
    };
    expect(textoDe("platform-not-connected")).not.toBe(textoDe("client-not-mapped"));
  });

  it("«conectado» no arrastra ninguna razón al lado", async () => {
    const { OrganizationIntegrations } = await componente();
    const { container } = render(
      <OrganizationIntegrations
        organizationId={ORG}
        organizationName="Cliente A"
        organizationSlug="cliente-a"
        surfaces={[vista({ state: "connected", reason: null, propertyRef: "properties/1" })]}
      />
    );
    expect(container.textContent).toContain("CONNECTED");
    expect(container.textContent).not.toMatch(/Fixed/);
  });
});

describe("las tres formas canónicas se le dicen al operador", () => {
  it("cada superficie muestra la suya", async () => {
    const { OrganizationIntegrations } = await componente();
    const { container } = render(
      <OrganizationIntegrations
        organizationId={ORG}
        organizationName="Cliente A"
        organizationSlug="cliente-a"
        surfaces={[
          vista({ surface: "search_console" }),
          vista({ surface: "ga4" }),
          vista({ surface: "google_business_profile" }),
        ]}
      />
    );
    const texto = container.textContent ?? "";
    expect(texto).toContain("properties/N");
    expect(texto).toContain("locations/N");
    expect(texto).toContain("sc-domain:host");
  });
});

describe("el estado de la plataforma", () => {
  it("dice cuál es el estado del token de la agencia", async () => {
    const { PlatformNotice } = await componente();
    const { container } = render(<PlatformNotice connected={false} tokenState="absent" />);
    expect(container.textContent).toContain("ABSENT");
    expect(container.textContent).toContain("NOT CONFIGURED");
  });

  it("sólo `active` se muestra como bueno; los otros seis no", async () => {
    // La insignia verde es una afirmación sobre el token. `unset` y
    // `unreadable` no saben nada de él, y pintarlos de verde diría «conectado»
    // sobre algo que nadie miró.
    const { PlatformNotice } = await componente();
    for (const estado of [
      "expired",
      "revoked",
      "absent",
      "unset",
      "malformed",
      "unreadable",
    ] as const) {
      const { container } = render(<PlatformNotice connected tokenState={estado} />);
      expect(container.textContent, `con ${estado}`).toContain(estado.toUpperCase());
    }
  });

  /**
   * El enlace al consentimiento. Es la única manera de empezar el OAuth desde la
   * aplicación, y a la vez el único control de esta pantalla que puede dejar a la
   * PLATAFORMA sin token: `store_integration_token` revoca el vivo antes de
   * escribir el nuevo, así que un consentimiento abandonado a la mitad no deja
   * las cosas como estaban.
   */
  it("ofrece conectar exactamente en los tres estados que se arreglan conectando", async () => {
    const { PlatformNotice } = await componente();

    for (const estado of ["absent", "revoked", "expired"] as const) {
      const { container } = render(<PlatformNotice connected tokenState={estado} />);
      expect(
        container.querySelector('a[href="/api/auth/google/start"]'),
        `con ${estado} tendría que ofrecerlo`
      ).not.toBeNull();
      cleanup();
    }
  });

  it("no ofrece conectar sin credenciales de plataforma: el consentimiento no puede empezar", async () => {
    const { PlatformNotice } = await componente();
    const { container } = render(<PlatformNotice connected={false} tokenState="absent" />);
    expect(container.querySelector('a[href="/api/auth/google/start"]')).toBeNull();
  });

  it("no lo ofrece con el token vivo ni cuando no se sabe nada de él", async () => {
    const { PlatformNotice } = await componente();

    for (const estado of ["active", "unset", "malformed", "unreadable"] as const) {
      const { container } = render(<PlatformNotice connected tokenState={estado} />);
      expect(
        container.querySelector('a[href="/api/auth/google/start"]'),
        `con ${estado} NO tendría que ofrecerlo`
      ).toBeNull();
      cleanup();
    }
  });
});

/**
 * QUÉ IMPIDE ESTE BLOQUE
 *
 * Que el motivo se calcule bien y la pantalla no lo muestre.
 *
 * `probeView.test.ts` prueba las frases. Lo que no puede probar es el CABLEADO:
 * que la sonda llegue a la fila correcta y se pinte. Es el mismo defecto que este
 * repositorio ya se comió dos veces — un módulo probado que nadie invoca.
 */
describe("el motivo del último fallo, en la fila", () => {
  const SONDA = {
    surface: "ga4" as const,
    outcome: "http",
    httpStatus: 403,
    propertyRef: "properties/456666287",
    checkedAt: new Date().toISOString(),
  };

  it("muestra qué pasó y contra qué property", async () => {
    const { OrganizationIntegrations } = await componente();
    const { container } = render(
      <OrganizationIntegrations
        organizationId={ORG}
        organizationName="Vulkan Studios"
        organizationSlug="vulkan-studios"
        surfaces={[vista({ surface: "ga4", state: "error", reason: null })]}
        probes={[SONDA]}
      />
    );

    const texto = container.textContent ?? "";
    expect(texto).toContain("permiso");
    expect(texto).toContain("properties/456666287");
    expect(texto).toContain("medido");
  });

  it("no muestra nada cuando la última consulta salió bien", async () => {
    const { OrganizationIntegrations } = await componente();
    const { container } = render(
      <OrganizationIntegrations
        organizationId={ORG}
        organizationName="Vulkan Studios"
        organizationSlug="vulkan-studios"
        surfaces={[vista({ surface: "ga4", state: "connected", reason: null })]}
        probes={[{ ...SONDA, outcome: "ok", httpStatus: null }]}
      />
    );
    expect(container.querySelector('[data-testid="sonda-ga4"]')).toBeNull();
  });

  it("no le pone a una superficie la sonda de otra", async () => {
    // El mapeo es la frontera entre clientes; el motivo también tiene que
    // respetarla. Un 403 de GA4 mostrado bajo Search Console manda a arreglar la
    // integración equivocada.
    const { OrganizationIntegrations } = await componente();
    const { container } = render(
      <OrganizationIntegrations
        organizationId={ORG}
        organizationName="Vulkan Studios"
        organizationSlug="vulkan-studios"
        surfaces={[vista({ surface: "search_console", state: "error", reason: null })]}
        probes={[SONDA]}
      />
    );
    expect(container.querySelector('[data-testid="sonda-search_console"]')).toBeNull();
  });
});
