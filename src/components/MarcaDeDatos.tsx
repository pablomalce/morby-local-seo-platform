"use client";

/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que una pantalla dibuje datos sembrados sin decir que lo son.
 *
 * Vive en la cáscara (`AppShell`) y no en cada página a propósito: el root
 * layout monta `AppShell` alrededor de TODO, así que una pantalla nueva nace con
 * la marca puesta en vez de nacer sin ella. `marcaEnLaCascara.test.ts` es la
 * pared que sostiene esa afirmación.
 *
 * La marca la pone el DATO —`marcaDeDatos(business.id)`— y nunca la sesión. El
 * porqué está en `src/lib/demo/marcaDeDatos.ts`.
 */
import { Badge, StatusDot } from "@/components/ui";
import { useSelection } from "@/lib/context/SelectionContext";
import { marcaDeDatos, type MarcaDeDatos as Marca } from "@/lib/demo/marcaDeDatos";

/**
 * El texto es el mismo vocabulario en mayúsculas del resto de la franja de
 * estado (`SYSTEM ONLINE`, `ACTIVE TENANT`), que no pasa por el diccionario.
 */
const TEXTO: Record<Marca, string> = {
  sembrado: "DEMO DATA",
  real: "LIVE DATA",
  "sin-negocio": "NO BUSINESS",
};

const TONO: Record<Marca, "warning" | "online" | "muted"> = {
  sembrado: "warning",
  real: "online",
  "sin-negocio": "muted",
};

export function MarcaDeDatos({ className }: { className?: string }) {
  const { business } = useSelection();
  const marca = marcaDeDatos(business.id);

  return (
    <Badge variant="hud" className={className}>
      <span className="flex items-center gap-1.5" data-testid="marca-de-datos" data-marca={marca}>
        <StatusDot tone={TONO[marca]} />
        {TEXTO[marca]}
      </span>
    </Badge>
  );
}
