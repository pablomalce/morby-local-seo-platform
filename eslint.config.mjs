// Config de ESLint que faltaba en el repo.
//
// Sin este archivo `next lint` abre un prompt interactivo ("How would you like
// to configure ESLint?"): el script existía en package.json pero no era
// ejecutable de forma desatendida, y en CI se habría colgado hasta el timeout
// del job. Verificado corriéndolo con stdin cerrado sobre un worktree limpio.
//
// Flat config porque el repo trae ESLint 9. `FlatCompat` traduce los presets de
// `eslint-config-next`, que todavía se publican en el formato viejo.
//
// EFECTO QUE NO ES OBVIO: al existir esta config, `next build` empieza a
// lintear. Antes no lo hacía, y por eso el build pasaba con la deuda de abajo
// intacta. Desde ahora un ERROR de ESLint rompe el build —y con él el deploy de
// Vercel—, no sólo el CI. Es una barrera más y es deseable, pero conviene
// saberlo: es un cambio de comportamiento en producción.
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({
  baseDirectory: dirname(fileURLToPath(import.meta.url)),
});

export default [
  {
    ignores: [".next/**", "node_modules/**", "next-env.d.ts", "coverage/**"],
  },

  ...compat.extends("next/core-web-vitals", "next/typescript"),

  // ─── DEUDA DE LINT HEREDADA — medida, acotada y no perdonada ───────────────
  //
  // El preset estricto encuentra 69 errores que YA ESTABAN en main antes de que
  // existiera CI, repartidos en 22 archivos. Arreglarlos no es el piso: son
  // cambios en código de producción —escapar entidades, agregar keys de React,
  // tipar `any`— y cada uno merece su propio PR y su propia verificación. Dos de
  // ellos viven en engine.ts, que no se refactoriza.
  //
  // Por eso la deuda se declara regla por regla y archivo por archivo, en vez de
  // apagar la regla globalmente. La diferencia importa: en cualquier OTRO
  // archivo —y en todo archivo nuevo— estas reglas siguen siendo error y ponen
  // el CI en rojo. Esta lista sólo se puede achicar.
  //
  // Los conteos salieron de `next lint --format json`, que es exactamente el
  // comando que corre CI. Medirlo con `npx eslint .` da un número más chico y
  // equivocado: no cubre el mismo conjunto de archivos.
  //
  // No todo esto es cosmético: react/jsx-key y no-html-link-for-pages son bugs
  // de verdad. Están acá para que el piso pueda entrar hoy, no para quedarse.

  // react/no-unescaped-entities — 25 error(es) en 3 archivo(s):
  //   12  src/app/legal/terms/page.tsx
  //    7  src/app/legal/privacy/page.tsx
  //    6  src/app/legal/cookies/page.tsx
  {
    files: [
      "src/app/legal/cookies/page.tsx",
      "src/app/legal/privacy/page.tsx",
      "src/app/legal/terms/page.tsx",
    ],
    rules: { "react/no-unescaped-entities": "warn" },
  },
  // @typescript-eslint/no-explicit-any — 13 error(es) en 3 archivo(s):
  //    6  src/lib/reports/orchestrator.ts
  //    6  src/lib/store/supabaseTenantStore.ts
  //    1  src/app/api/reports/generate/route.ts
  {
    files: [
      "src/app/api/reports/generate/route.ts",
      "src/lib/reports/orchestrator.ts",
      "src/lib/store/supabaseTenantStore.ts",
    ],
    rules: { "@typescript-eslint/no-explicit-any": "warn" },
  },
  // react/jsx-no-comment-textnodes — 11 error(es) en 10 archivo(s):
  //    2  src/components/ui.tsx
  //    1  src/app/legal/layout.tsx
  //    1  src/app/reports/page.tsx
  //    1  src/app/studio/images/page.tsx
  //    1  src/components/CookieConsent.tsx
  //    1  src/components/Footer.tsx
  //    1  src/components/layout.tsx
  //    1  src/components/legal.tsx
  //    1  src/components/selectors/BusinessSelector.tsx
  //    1  src/components/selectors/ServiceSelector.tsx
  {
    files: [
      "src/app/legal/layout.tsx",
      "src/app/reports/page.tsx",
      "src/app/studio/images/page.tsx",
      "src/components/CookieConsent.tsx",
      "src/components/Footer.tsx",
      "src/components/layout.tsx",
      "src/components/legal.tsx",
      "src/components/selectors/BusinessSelector.tsx",
      "src/components/selectors/ServiceSelector.tsx",
      "src/components/ui.tsx",
    ],
    rules: { "react/jsx-no-comment-textnodes": "warn" },
  },
  // @typescript-eslint/no-unused-vars — 9 error(es) en 4 archivo(s):
  //    6  src/app/app/account/page.tsx
  //    1  src/app/planner/page.tsx
  //    1  src/lib/generators/tenantData.ts
  //    1  src/lib/reports/engine.ts
  {
    files: [
      "src/app/app/account/page.tsx",
      "src/app/planner/page.tsx",
      "src/lib/generators/tenantData.ts",
      "src/lib/reports/engine.ts",
    ],
    rules: { "@typescript-eslint/no-unused-vars": "warn" },
  },
  // react/jsx-key — 9 error(es) en 1 archivo(s):
  //    9  src/app/legal/privacy/page.tsx
  {
    files: [
      "src/app/legal/privacy/page.tsx",
    ],
    rules: { "react/jsx-key": "warn" },
  },
  // @next/next/no-html-link-for-pages — 1 error(es) en 1 archivo(s):
  //    1  src/app/login/page.tsx
  {
    files: [
      "src/app/login/page.tsx",
    ],
    rules: { "@next/next/no-html-link-for-pages": "warn" },
  },
  // @typescript-eslint/no-empty-object-type — 1 error(es) en 1 archivo(s):
  //    1  src/lib/integrations/imageProvider.ts
  {
    files: [
      "src/lib/integrations/imageProvider.ts",
    ],
    rules: { "@typescript-eslint/no-empty-object-type": "warn" },
  },
];
