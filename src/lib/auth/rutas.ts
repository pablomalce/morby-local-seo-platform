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
export const DESTINO_POST_LOGIN = "/app/dashboard";
//
// CAMBIÓ, Y LA REGLA DE `rutas.test.ts` SE INVIRTIÓ CON ÉL
//
// Era `/dashboard`, que es la demo pública: el login depositaba al usuario
// DENTRO de la demostración, con los servicios sembrados de Mörby a la vista.
// El #75 puso una marca para que se supiera cuál se estaba mirando y dejó dicho
// que no cerraba la decisión de fondo. Ésta la cierra: el producto tiene lugar
// propio bajo `/app`, que es la mitad que el middleware gatea.
//
// La regla vieja decía «NO debajo de /app», y era correcta en su momento por un
// motivo que ya no existe: entonces `/app/dashboard` no existía y el destino era
// un 404 —el defecto que arregló la #65—. Lo que hay que sostener no es dónde NO
// está, sino que la página exista Y que esté gateada: un destino post-login
// público es, por definición, un lugar al que se puede llegar sin haber entrado.
