// ARCHIVO DESCARTABLE — existe sólo para probar que el CI se pone rojo.
// Esta rama no se mergea nunca.

// Rompe `typecheck` (y por lo tanto `build`).
export const noEsUnNumero: number = "esto es un string";

// Rompe `lint`. La deuda de eslint.config.mjs acota `no-explicit-any` a los
// archivos que YA la tenían; este archivo es nuevo, así que no está protegido.
// Eso es justamente lo que hay que demostrar.
export function conAny(x: any) {
  return x;
}
