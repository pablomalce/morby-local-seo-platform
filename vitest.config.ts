import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // Un test que tarda para siempre no falla: cuelga la corrida y alguien
    // cancela el job. Preferimos un rojo explícito.
    testTimeout: 10_000,
    // `node` sigue siendo el valor por defecto, y es deliberado: los 28 tests
    // que existían antes de esto se escribieron y se verificaron por mutación
    // contra ese entorno, y ampliar el alcance no debe cambiarles en silencio
    // contra qué corren. El único que necesita un DOM lo pide él mismo, con un
    // `@vitest-environment jsdom` en su primera línea.
  },
  // tsconfig.json fija `jsx: "preserve"` porque Next hace su propia
  // transformación en tiempo de build. Vitest no tiene ese paso posterior, así
  // que sin esto le entregaría JSX sin transformar al runtime. Va acá, donde
  // vive el runner, en vez de cambiar el contrato que tsconfig.json tiene con
  // Next.
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
