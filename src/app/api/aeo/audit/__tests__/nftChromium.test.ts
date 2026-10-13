/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que el verificador del nft de Chromium (`scripts/verificar-nft-chromium.mjs`,
 * RV-B) dé verde sin mirar. El verificador corre en el CI sobre el build de
 * verdad —es donde la garantía puede fallar—; acá se prueba él mismo, con
 * builds de mentira armados a mano, para que un verificador roto no pase por
 * vigilante.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NFT_DE_LA_AUDITORIA, verificarNftChromium } from "../../../../../../scripts/verificar-nft-chromium.mjs";

const BINARIOS = ["al2023.tar.br", "chromium.br", "fonts.tar.br", "swiftshader.tar.br"];
let raiz = "";

/** Un repo de mentira: `node_modules/@sparticuz/chromium/bin` y un `.next` con los nft que se pidan. */
function armar(nftsPorRuta: Record<string, string[]>, binarios = BINARIOS) {
  raiz = mkdtempSync(path.join(os.tmpdir(), "nft-chromium-"));
  const bin = path.join(raiz, "node_modules", "@sparticuz", "chromium", "bin");
  mkdirSync(bin, { recursive: true });
  for (const b of binarios) writeFileSync(path.join(bin, b), "");
  const next = path.join(raiz, ".next");
  for (const [relativo, archivos] of Object.entries(nftsPorRuta)) {
    const nft = path.join(next, relativo);
    mkdirSync(path.dirname(nft), { recursive: true });
    // Como los escribe Next: relativos a la carpeta del nft.
    const files = archivos.map((a) => path.relative(path.dirname(nft), path.join(raiz, a)));
    writeFileSync(nft, JSON.stringify({ version: 1, files }));
  }
  return { next, binarios: bin };
}

const conBinarios = BINARIOS.map((b) => `node_modules/@sparticuz/chromium/bin/${b}`);
const OTRA = path.join("server", "app", "api", "geo", "grid", "route.js.nft.json");

afterEach(() => {
  if (raiz) rmSync(raiz, { recursive: true, force: true });
  raiz = "";
});

describe("RV-B: el verificador del nft de Chromium", () => {
  it("un build sano —la auditoría con los cuatro, las demás sin ninguno— no tiene problemas", () => {
    const r = verificarNftChromium(
      armar({
        [NFT_DE_LA_AUDITORIA]: ["node_modules/@sparticuz/chromium/build/index.js", ...conBinarios],
        [OTRA]: ["node_modules/zod/index.js"],
      })
    );
    expect(r.problemas).toEqual([]);
    expect(r.esperados).toEqual(BINARIOS);
    expect(r.revisados).toBe(2);
  });

  it("lo que dejó el build sin `outputFileTracingIncludes` —el JS del paquete y ningún .br— es un problema, con los que faltan", () => {
    const r = verificarNftChromium(armar({ [NFT_DE_LA_AUDITORIA]: ["node_modules/@sparticuz/chromium/build/index.js"] }));
    expect(r.problemas).toEqual([expect.stringMatching(/no lleva al2023\.tar\.br, chromium\.br, fonts\.tar\.br, swiftshader\.tar\.br/)]);
  });

  it("uno solo que falte ya es un problema", () => {
    const r = verificarNftChromium(armar({ [NFT_DE_LA_AUDITORIA]: conBinarios.slice(1) }));
    expect(r.problemas).toEqual([expect.stringMatching(/no lleva al2023\.tar\.br:/)]);
  });

  it("otra función que lleva Chromium es un problema, con su nombre", () => {
    const r = verificarNftChromium(armar({ [NFT_DE_LA_AUDITORIA]: conBinarios, [OTRA]: [conBinarios[1]] }));
    expect(r.problemas).toEqual([expect.stringMatching(/geo.grid.route\.js\.nft\.json lleva chromium\.br/)]);
  });

  it("sin el nft de la auditoría, o sin binarios con qué comparar, no hay verde", () => {
    expect(verificarNftChromium(armar({ [OTRA]: [] })).problemas).toEqual([expect.stringMatching(/falta .*route\.js\.nft\.json/)]);
    expect(verificarNftChromium(armar({ [NFT_DE_LA_AUDITORIA]: conBinarios }, [])).problemas).toEqual([
      expect.stringMatching(/no hay ningún \.br/),
    ]);
  });

  it("la caché del build no cuenta: lo que hay ahí no se despliega", () => {
    const r = verificarNftChromium(
      armar({ [NFT_DE_LA_AUDITORIA]: conBinarios, [path.join("cache", "vieja", "x.nft.json")]: conBinarios })
    );
    expect(r.problemas).toEqual([]);
  });
});
