/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que el login termine en un 404.
 *
 * El destino de después de iniciar sesión estaba escrito CUATRO veces —el
 * middleware, el callback del magic link, la pantalla de login y la acción de
 * servidor— y las cuatro decían `/app/dashboard`, que no existe: bajo
 * `src/app/app/` sólo hay `account` e `integrations`, y el dashboard vive en
 * `/dashboard`. El resultado es que el magic link dejaba al usuario en «This
 * page could not be found» con la sesión ya creada, y que un usuario con sesión
 * que volviera a `/login` terminaba en el mismo lugar.
 *
 * Estuvo roto desde que existe el gate y nadie lo vio, y eso tiene explicación:
 * hasta el 2026-09-01 la producción apuntaba a un proyecto Supabase borrado, así
 * que **ningún login llegó nunca hasta acá**. El primero que funcionó encontró el
 * defecto en el primer intento.
 *
 * POR QUÉ UNA CONSTANTE Y NO CUATRO CADENAS ARREGLADAS
 *
 * Porque arreglar las cuatro deja el mismo defecto listo para volver: quien
 * agregue un quinto lugar escribe la ruta de nuevo, y una ruta escrita a mano no
 * la comprueba nadie. Con una constante, el test de al lado le pregunta al ÁRBOL
 * DE ARCHIVOS si el destino existe — así que el día que alguien mueva o borre esa
 * página, la suite se pone en rojo antes de que un usuario se coma el 404.
 */

/**
 * A dónde va quien acaba de iniciar sesión, y a dónde rebota `/login` cuando ya
 * hay sesión.
 *
 * Se escribe SIN barra final y empezando con `/`: `rutas.test.ts` lo traduce a
 * `src/app<destino>/page.tsx` para comprobar que la página existe, y una barra de
 * más rompería esa traducción sin romper la navegación — o sea que dejaría de
 * medirse en silencio.
 */
export const DESTINO_POST_LOGIN = "/dashboard";
