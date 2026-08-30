import { platformStatus } from "@/lib/integrations/platformStatus";
import { SettingsView } from "./client";

/**
 * QUÉ IMPIDE ESTA PANTALLA
 *
 * Que la lista de integraciones diga «sin conectar» porque está escrita así.
 *
 * Hasta el #59 esto era un arreglo de catorce nombres con una insignia fija al
 * lado. La respuesta correcta hoy y por el motivo equivocado — el día que se
 * conecte algo, el arreglo sigue ahí y la pantalla sigue diciendo lo mismo. Es el
 * mismo defecto que el #55 sacó del orquestador y el #56 de la pantalla de
 * integraciones; éste era el tercer lugar.
 *
 * POR QUÉ ES UN COMPONENTE DE SERVIDOR
 *
 * Porque lo que hay que mirar son variables de entorno del SERVIDOR, y un
 * componente de cliente no las ve — sólo vería las `NEXT_PUBLIC_*`, que son
 * justamente las que no importan acá. Medirlo en el cliente daría «sin
 * configurar» para todo, para siempre: la respuesta correcta por el motivo
 * equivocado otra vez, y con un mecanismo entero dándola.
 *
 * `platformStatus()` devuelve CUÁNTAS de las que hacen falta están puestas y
 * nunca sus valores. Un secreto que llega a una pantalla de ajustes es un secreto
 * en el historial del navegador de quien la abrió.
 */
export const dynamic = "force-dynamic";

export default function SettingsPage() {
  return <SettingsView status={platformStatus()} />;
}
