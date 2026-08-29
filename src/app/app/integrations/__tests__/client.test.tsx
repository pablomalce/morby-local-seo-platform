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
    const { container } = render(<PlatformNotice connected={false} tokenState="undecided" />);
    expect(container.textContent).toContain("UNDECIDED");
    expect(container.textContent).toContain("NOT CONFIGURED");
  });
});
