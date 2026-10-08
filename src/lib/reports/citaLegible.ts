/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que el reporte que se abre en pantalla y el que se descarga digan cosas
 * distintas de la ficha que citan.
 *
 * La puerta H1.3 dice que cambiar el ICP una vez cambia el texto del reporte.
 * Hasta el 2026-10-07 eso valía sólo para el Markdown: `ReportView` —lo que se
 * ve al apretar OPEN REPORT— no leía `profileCitation`, así que quien
 * regeneraba el reporte y lo abría no veía ni la versión citada ni su ICP; el
 * nonce sólo aparecía en el `.md` descargado. Lo encontró la revisión.
 *
 * Por eso lo que se dice de la cita sale de UNA función, y las dos salidas
 * —`reportToMarkdown` y `ReportView`— sólo le ponen formato. Un campo del ICP
 * que se agregue o se saque acá aparece o desaparece en las dos.
 *
 * Los estados son los de `citationLine` en `markdown.ts`, con las mismas
 * frases: un reporte viejo (sin `profileCitation`, del historial de
 * `localStorage`) dice que es viejo; `none`, `demo` y `error` no se parecen
 * entre sí; una cita sin `icp` (guardada entre H1.2 y H1.3) dice que es de
 * antes; `icp: null` dice que la versión no tiene.
 */
import type { ProfileCitation } from "./types";

/** Un campo del ICP con su etiqueta, en el orden en que se muestra. */
export interface CampoDelIcp {
  etiqueta: string;
  valor: string;
}

export type IcpLegible =
  | { tipo: "icp"; definicion: string; campos: CampoDelIcp[] }
  | { tipo: "aviso"; texto: string };

export type CitaLegible =
  | {
      tipo: "cita";
      version: number;
      /** ISO, como viene de la base; cada salida lo formatea. */
      publicadaEl: string;
      versionId: string;
      icp: IcpLegible;
    }
  | { tipo: "aviso"; texto: string };

/** La etiqueta que va delante de la definición, en las dos salidas. */
export const ETIQUETA_DEL_ICP = "Ideal customer profile (ICP)";

function icpLegible(
  icp: Extract<ProfileCitation, { status: "cited" }>["icp"] | undefined
): IcpLegible {
  if (icp === undefined) {
    return {
      tipo: "aviso",
      texto:
        "This report was generated before reports showed the ideal customer profile (ICP) of the version they cite.",
    };
  }
  if (icp === null) {
    return { tipo: "aviso", texto: "This version of the strategic profile has no ideal customer profile (ICP)." };
  }
  const campos: CampoDelIcp[] = [];
  if (icp.disqualifiers) campos.push({ etiqueta: "Disqualifiers", valor: icp.disqualifiers });
  if (icp.buyingTrigger) campos.push({ etiqueta: "Buying trigger", valor: icp.buyingTrigger });
  if (icp.budgetBand) campos.push({ etiqueta: "Budget band", valor: icp.budgetBand });
  return { tipo: "icp", definicion: icp.definition, campos };
}

/** Lo que el reporte dice de la ficha que cita, sin formato. */
export function citaLegible(c: ProfileCitation | undefined): CitaLegible {
  if (!c) {
    return {
      tipo: "aviso",
      texto: "This report was generated before reports cited a strategic profile, so it cites none.",
    };
  }
  switch (c.status) {
    case "cited":
      return {
        tipo: "cita",
        version: c.version,
        publicadaEl: c.publishedAt,
        versionId: c.versionId,
        icp: icpLegible(c.icp),
      };
    case "none":
      return {
        tipo: "aviso",
        texto: "No strategic profile has been published for this business yet, so this report cites none.",
      };
    case "demo":
      return {
        tipo: "aviso",
        texto: "Demo report: there is no organisation behind it, so there is no strategic profile to cite.",
      };
    case "error":
      return {
        tipo: "aviso",
        texto: `The strategic profile could not be read (${c.reason}), so this report cites none. This is a failure on our side, not a missing profile.`,
      };
  }
}
