/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que la demo y el producto sigan siendo la misma pantalla sin que nada diga
 * cuál estás mirando.
 *
 * EL DEFECTO QUE LO MOTIVA
 *
 * `DESTINO_POST_LOGIN` es `/dashboard`, y `/dashboard` es la demo pública: el
 * login deposita al usuario EN la demostración, con los servicios sembrados del
 * negocio de Mörby a la vista. La pantalla se dibuja entera y con datos, así que
 * no hay nada roto que mirar. Se destapó midiendo, el 2026-09-04: Pablo dijo
 * «estoy logueado» y pasó `/dashboard`; no lo estaba.
 *
 * POR QUÉ MIRA EL DATO Y NO LA SESIÓN
 *
 * Un aviso que dependa de si hay cookie diría «conectado» sobre una pantalla
 * llena de datos de Mörby, que es precisamente el caso que hay que marcar. Y ese
 * caso no es hipotético: con sesión, el proveedor arranca con los datos
 * sembrados y los de la base llegan en un commit posterior —está escrito en
 * `SelectionContext.tenantReal.test.tsx`—, o sea que existe una ventana real en
 * la que hay sesión y lo que se ve es la demostración.
 *
 * La pregunta correcta ya estaba contestada y probada: `isUserCreated()`.
 */
import { isUserCreated } from "@/lib/store/tenantStore";

/**
 * Qué clase de dato está mirando el usuario.
 *
 * `sin-negocio` es su propio estado y no un `sembrado` disfrazado: sin selección
 * el negocio es el marcador de posición con `id === ""`, que no está en la lista
 * de sembrados y por lo tanto `isUserCreated("")` contesta `true`. Sin este
 * caso, la pantalla vacía se anunciaría como datos reales.
 */
export type MarcaDeDatos = "sembrado" | "real" | "sin-negocio";

export function marcaDeDatos(businessId: string): MarcaDeDatos {
  if (!businessId) return "sin-negocio";
  return isUserCreated(businessId) ? "real" : "sembrado";
}
