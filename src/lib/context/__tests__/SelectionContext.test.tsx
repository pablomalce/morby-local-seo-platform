// @vitest-environment jsdom
//
// El entorno se declara por archivo y no en vitest.config.ts a propósito.
// `environmentMatchGlobs` está obsoleto en Vitest 3, y un glob de configuración
// decide en silencio contra qué corre un archivo: acá el requisito queda escrito
// en el archivo que lo tiene.

import { JSDOM } from "jsdom";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The selection context, rendered.
 *
 * What this covers, and why a static scan could not. The property at stake is
 * an ORDERING between two `useEffect`s — the one that reads the saved selection
 * and the one that writes it. Nothing about that is visible in the text of the
 * file; it only exists while React is running them. A test that read the source
 * would report on the order they are *declared* in, which is not the same
 * claim.
 *
 * It also regresses silently. Nobody sees a wrong colour or a crash: the user
 * reloads, their tenant is gone, and they blame the browser.
 *
 * WHAT THE MUTATIONS SAID, because it is not what writing this predicted. Two
 * independent mechanisms hold the property up, and EITHER ONE ALONE IS ENOUGH:
 *
 *   1. the restore effect is declared before the persist effect, so the read
 *      happens before the first write;
 *   2. the persist effect refuses to write until `restoredRef` is set, so it
 *      writes nothing on the commit where the restore has not run yet.
 *
 * Reversing the declaration order leaves all four tests green — the flag saves
 * it. Deleting the flag leaves all four green — the order saves it. Only
 * removing BOTH loses the saved selection, and then two of these fail.
 *
 * That is worth knowing before someone deletes one of them as redundant: it is
 * redundant, right up until the other one moves. A single-mutation check would
 * have reported this file as covering nothing, and a reviewer reasoning from
 * the code alone (this author did) concludes the flag is decorative. It is not.
 *
 * The provider reaches for Supabase and for the auth session, neither of which
 * exists in a test process. Both are mocked to the shape they take in demo mode
 * — signed out, no database — because that is the path the selection logic runs
 * on, and mocking more than that would test the mocks.
 */

vi.mock("@/lib/auth/AuthProvider", () => ({
  useAuth: () => ({ loading: false, user: null, session: null }),
}));

vi.mock("@/lib/store/supabaseTenantStore", () => ({
  fetchMyBusinesses: vi.fn(async () => ({
    organizationId: null,
    businesses: [],
    locations: [],
    services: [],
  })),
  createTenantInDb: vi.fn(),
  deleteBusinessFromDb: vi.fn(),
}));

import { SelectionProvider, useSelection } from "@/lib/context/SelectionContext";

/**
 * The same key the provider uses. Hard-coded on purpose: a test that imported
 * the constant would keep passing if the key were renamed, and renaming it
 * loses every existing user's saved selection.
 */
const STORAGE_KEY = "lg.selection";

/**
 * Seed tenants from `@/lib/mock/universal`. `biz-morby` is the first of them,
 * which is the one the old `defaultState()` preselected — the flash this whole
 * change came from.
 */
const FIRST_SEED = "biz-morby";
const OTHER_SEED = "biz-luma-dental";
const ORG = "org-northgrowth";

function Probe() {
  const { business } = useSelection();
  return <span data-testid="selected">{business.id === "" ? "(none)" : business.id}</span>;
}

function save(businessId: string) {
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ organizationId: ORG, businessId, serviceId: null, locationId: null })
  );
}

function savedBusinessId(): string | null {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return raw ? (JSON.parse(raw).businessId ?? null) : null;
}

async function mount() {
  render(
    <SelectionProvider>
      <Probe />
    </SelectionProvider>
  );
  // The provider settles across more than one commit — the restore effect sets
  // state, which re-renders. Waiting for a particular value here would encode
  // the answer into the wait; waiting for the element to exist does not.
  await waitFor(() => expect(screen.getByTestId("selected")).toBeTruthy());
}

function selected(): string {
  return screen.getByTestId("selected").textContent ?? "";
}

/**
 * Vitest's jsdom environment leaves `window.localStorage` undefined on this
 * runtime — measured, not guessed: under `@vitest-environment jsdom` the page
 * has `window` and `document` and a real `http://localhost:3000` origin, yet
 * `typeof window.localStorage` is `"undefined"` and the window prototype
 * carries no `Storage` at all. jsdom itself is not the problem; constructing a
 * `JSDOM` directly in the same process yields a working `localStorage`.
 *
 * So the real one is borrowed rather than reimplemented. A hand-written stub
 * would be a second implementation of the thing under test, and it would agree
 * with itself about semantics the browser decides — what a missing key returns,
 * what happens to a non-string value.
 */
beforeAll(() => {
  if (typeof window.localStorage === "undefined") {
    const donor = new JSDOM("", { url: "http://localhost:3000" });
    Object.defineProperty(window, "localStorage", {
      value: donor.window.localStorage,
      configurable: true,
    });
  }
});

describe("SelectionProvider", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  // Testing Library registers its own `afterEach` cleanup only when Vitest runs
  // with `globals: true`. This project does not, so without unmounting by hand
  // every render stacks up in the same document and the second test onwards
  // finds two probes instead of one. Found by running it, not by reading a doc.
  afterEach(cleanup);

  it("selects nothing when there is no saved selection", async () => {
    await mount();

    // The old behaviour preselected the first seed tenant, which is what made
    // every navigation flash a business the user had not chosen.
    expect(
      selected(),
      "a fresh visitor must not arrive already inside somebody's tenant"
    ).toBe("(none)");
  });

  it("restores a saved selection instead of losing it on mount", async () => {
    save(OTHER_SEED);

    await mount();

    await waitFor(() => expect(selected()).toBe(OTHER_SEED));
  });

  it("leaves the saved selection in storage rather than overwriting it", async () => {
    save(OTHER_SEED);

    await mount();
    await waitFor(() => expect(selected()).toBe(OTHER_SEED));

    // What this asserts is the state storage is left in once everything has
    // settled: a reload has to find the tenant, not the empty default.
    expect(
      savedBusinessId(),
      "the persisted selection must survive a mount, or the next reload starts empty"
    ).toBe(OTHER_SEED);
  });

  it("clears a selection whose business no longer exists, rather than picking another", async () => {
    save("biz-that-was-deleted");

    await mount();

    // Reassigning is the dangerous behaviour: the user is placed inside a
    // tenant they did not choose, and nothing on screen says a substitution
    // happened.
    await waitFor(() =>
      expect(
        selected(),
        "a stale selection must clear, never silently become another tenant"
      ).toBe("(none)")
    );
    expect(selected()).not.toBe(FIRST_SEED);
  });
});
