"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui";

/**
 * QUÉ IMPIDE ESTE COMPONENTE
 *
 * Que tener varios clientes sea invisible.
 *
 * Con un cliente por organización —que es lo que el esquema exige, ver
 * `eleccion.ts`— el desempate por uuid te deja siempre en el mismo y sin salida.
 * Esto es la salida.
 */
export function SelectorDeOrganizacion({
  actual,
  disponibles,
}: {
  actual: string;
  disponibles: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Con una sola no se dibuja nada: un selector de un elemento es ruido que
  // sugiere una elección que no existe.
  if (disponibles.length < 2) return null;

  async function cambiar(id: string) {
    if (id === actual) return;
    setError(null);
    const res = await fetch("/api/organizations/active", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ organizationId: id }),
    });
    if (!res.ok) {
      // Un fallo silencioso acá deja a alguien apretando un selector que no
      // cambia nada, que es exactamente el estado del que venimos.
      setError(`No se pudo cambiar de organización (${res.status}).`);
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <div className="mt-4" data-testid="selector-organizacion">
      <div className="flex flex-wrap items-center gap-2">
        {disponibles.map((o) => {
          const activa = o.id === actual;
          return (
            <button
              key={o.id}
              type="button"
              data-testid="opcion-organizacion"
              data-activa={activa ? "si" : "no"}
              disabled={pendiente}
              onClick={() => cambiar(o.id)}
              className={
                activa
                  ? "rounded-vulkan border border-vulkan-orange bg-vulkan-orange/10 px-3 py-1.5 font-display text-[11px] uppercase tracking-hud text-vulkan-orange"
                  : "rounded-vulkan border border-metal-700 px-3 py-1.5 font-display text-[11px] uppercase tracking-hud text-metal-300 hover:border-vulkan-orange/50 disabled:opacity-50"
              }
            >
              {o.name}
            </button>
          );
        })}
      </div>
      {error && (
        <p className="mt-2 text-[12px] text-red-300" data-testid="error-cambio">
          {error}
        </p>
      )}
      <p className="mt-2 font-mono text-[10px] uppercase tracking-hud text-metal-500">
        <Badge variant="hud">AGENCY VIEW</Badge> un cliente por organización
      </p>
    </div>
  );
}
