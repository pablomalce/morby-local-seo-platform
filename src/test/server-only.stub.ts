/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que un cliente HTTP quede sin test porque no se puede importar.
 *
 * `server-only` no es una dependencia instalada: es un paquete que Next resuelve
 * durante SU build, y que existe para reventar la compilación si un módulo de
 * servidor termina en un bundle de cliente. Vitest no tiene ese paso, así que
 * `import "server-only"` no resuelve y el archivo entero es intesteable —que es
 * la razón por la que `pagespeed.ts` y `places.ts` llegaron hasta hoy sin uno.
 *
 * Este stub lo reemplaza SÓLO bajo el runner, por alias en `vitest.config.ts`.
 * La garantía real no se pierde: la sigue dando el build de Next, que es donde
 * se puede dar. Lo que se recupera es poder medir el código.
 */
export {};
