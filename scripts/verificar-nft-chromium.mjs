#!/usr/bin/env node
/**
 * QUÉ IMPIDE ESTE ARCHIVO (RV-B)
 *
 * Que la función de Vercel de la auditoría AEO salga SIN el binario de
 * Chromium, y que otra función salga CON él.
 *
 * `@sparticuz/chromium` abre sus `bin/*.br` por ruta, no por `require`, y el
 * trazador de Next no los ve: los mete `outputFileTracingIncludes` en
 * `next.config.mjs`. Nada medía esa línea donde puede fallar, que es el
 * `.nft.json` que deja el build. MEDIDO por la revisión: sin el bloque, `next
 * build` terminó en 0, el nft de la ruta quedó con 418 archivos y ningún
 * `bin/*.br`, y la copia de la función en AL2023 con `VERCEL=1` dio
 * `sin-navegador` en control, sana y SSR —«no medido» en producción, con el
 * build y el CI en verde—. Y al revés: si el include se ensancha, los ~70 MB
 * vuelven a viajar en rutas que no los usan (RV-3).
 *
 * Esto lee los `.nft.json` del build y exige:
 *
 *   1. que el de la ruta de la auditoría exista y lleve CADA `.br` que trae el
 *      paquete instalado —la lista sale de `node_modules`, no de una copia
 *      escrita a mano que se desactualice con la versión—;
 *   2. que ningún otro `.nft.json` lleve uno solo.
 *
 * Corre en el job `verify` del CI, después de `npm run build`. A mano:
 *
 *   npm run build && node scripts/verificar-nft-chromium.mjs
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** El nft de la única ruta que lleva Chromium, relativo a `.next/`. */
export const NFT_DE_LA_AUDITORIA = path.join("server", "app", "api", "aeo", "audit", "route.js.nft.json");

/** Todos los `.nft.json` debajo de `dir`, sin entrar a la caché del build. */
function nfts(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entrada) => {
    const completo = path.join(dir, entrada.name);
    if (entrada.isDirectory()) return entrada.name === "cache" ? [] : nfts(completo);
    return entrada.name.endsWith(".nft.json") ? [completo] : [];
  });
}

/**
 * Los problemas, en castellano, o la lista vacía.
 *
 * @param {{ next: string; binarios: string }} rutas `next`: la carpeta `.next`
 *   del build; `binarios`: `node_modules/@sparticuz/chromium/bin`.
 * @returns {{ problemas: string[]; esperados: string[]; revisados: number }}
 */
export function verificarNftChromium({ next, binarios }) {
  const problemas = [];
  const dirBinarios = path.resolve(binarios);
  const esperados = existsSync(dirBinarios)
    ? readdirSync(dirBinarios)
        .filter((n) => n.endsWith(".br"))
        .sort()
    : [];
  // Anti-vacuidad: sin binarios que buscar, «no falta ninguno» no dice nada.
  if (esperados.length === 0) problemas.push(`no hay ningún .br en ${binarios}: no hay contra qué comparar`);

  const todos = nfts(next);
  const propio = path.resolve(next, NFT_DE_LA_AUDITORIA);
  if (!todos.some((n) => path.resolve(n) === propio)) {
    problemas.push(`falta ${NFT_DE_LA_AUDITORIA}: el build no trazó la ruta de la auditoría`);
  }

  for (const nft of todos) {
    const { files = [] } = JSON.parse(readFileSync(nft, "utf8"));
    // Las rutas de un nft son relativas a la carpeta del propio nft.
    const deChromium = files
      .map((f) => path.resolve(path.dirname(nft), f))
      .filter((f) => f.startsWith(dirBinarios + path.sep))
      .map((f) => path.basename(f));
    if (path.resolve(nft) === propio) {
      const faltan = esperados.filter((n) => !deChromium.includes(n));
      if (faltan.length > 0) {
        problemas.push(
          `la función de la auditoría no lleva ${faltan.join(", ")}: en producción cada render sería «sin-navegador» (¿se borró outputFileTracingIncludes?)`
        );
      }
    } else if (deChromium.length > 0) {
      problemas.push(
        `${path.relative(next, nft)} lleva ${deChromium.join(", ")}: ~70 MB de Chromium en una función que no lo usa`
      );
    }
  }
  return { problemas, esperados, revisados: todos.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { problemas, esperados, revisados } = verificarNftChromium({
    next: ".next",
    binarios: path.join("node_modules", "@sparticuz", "chromium", "bin"),
  });
  if (problemas.length > 0) {
    for (const p of problemas) console.error(`✗ ${p}`);
    process.exit(1);
  }
  console.log(`✓ la auditoría lleva ${esperados.join(", ")}; ninguno de los otros ${revisados - 1} nft lleva Chromium`);
}
