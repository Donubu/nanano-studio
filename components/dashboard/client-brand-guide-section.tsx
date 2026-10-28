"use client";

// Guía de marca del cliente traída de practicante (por slug). Muestra el
// snapshot guardado y permite re-sincronizar. La IA de producción lo usa como
// contexto al crear desde texto/referencia; nunca consulta practicante en vivo.

import { useCallback, useEffect, useState } from "react";
import { BookOpen, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDateLocal } from "@/lib/utils";
import type { BrandGuide } from "@/lib/production/brand-guide";

interface GuideState {
  slug: string | null;
  guide: BrandGuide | null;
  synced_at: string | null;
}

function Chips({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((t, i) => (
        <span key={i} className="text-[11px] px-2 py-0.5 rounded-full bg-muted border border-border/50">
          {t}
        </span>
      ))}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

export default function ClientBrandGuideSection({ clientId }: { clientId: number }) {
  const [state, setState] = useState<GuideState | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/clients/${clientId}/brand-guide`);
    if (res.ok) setState(await res.json());
  }, [clientId]);

  useEffect(() => {
    load();
  }, [load]);

  const sync = async () => {
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/brand-guide`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error || `Error ${res.status}`);
        return;
      }
      setState(body);
    } catch (e) {
      setError(`Error de red: ${(e as Error).message}`);
    } finally {
      setSyncing(false);
    }
  };

  const g = state?.guide;
  return (
    <div className="bg-card rounded-xl border border-border/50 p-6 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <BookOpen className="h-4 w-4" /> Guía de marca
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Se trae del brandbook en Practicante
            {state?.slug ? (
              <>
                {" "}con el slug <span className="font-mono">{state.slug}</span>
              </>
            ) : null}
            . La IA de producción la usa para escribir en la voz de la marca.
            {state?.synced_at ? ` Última sincronización: ${formatDateLocal(state.synced_at)}.` : ""}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={sync}
          disabled={syncing || !state?.slug}
          className="gap-1 shrink-0"
          title={state?.slug ? undefined : "Agrega el slug del cliente (Clientes → Editar) para sincronizar"}
        >
          {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {g ? "Re-sincronizar" : "Sincronizar desde Practicante"}
        </Button>
      </div>

      {!state?.slug && (
        <p className="text-sm text-muted-foreground">
          Este cliente no tiene slug. Agrégalo en Clientes → Editar, con el mismo identificador que usa en Practicante.
        </p>
      )}
      {syncing && (
        <p className="text-xs text-muted-foreground">
          Practicante está revisando el brandbook; puede tardar un par de minutos.
        </p>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}

      {g && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          {g.voz.tono && (
            <Row label="Tono">
              <p>{g.voz.tono}</p>
              <Chips items={g.voz.personalidad} />
            </Row>
          )}
          {g.voz.tratamiento && (
            <Row label="Tratamiento">
              <p>{g.voz.tratamiento}</p>
            </Row>
          )}
          {g.voz.palabras_usar.length > 0 && (
            <Row label="Palabras a usar">
              <Chips items={g.voz.palabras_usar} />
            </Row>
          )}
          {g.voz.palabras_evitar.length > 0 && (
            <Row label="Palabras a evitar">
              <Chips items={g.voz.palabras_evitar} />
            </Row>
          )}
          {g.voz.ejemplos_titulares.length > 0 && (
            <Row label="Ejemplos de titulares">
              <ul className="list-disc pl-4 text-xs space-y-0.5">
                {g.voz.ejemplos_titulares.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </Row>
          )}
          {g.voz.ejemplos_cta.length > 0 && (
            <Row label="Ejemplos de CTA">
              <Chips items={g.voz.ejemplos_cta} />
            </Row>
          )}
          {g.visual.colores.length > 0 && (
            <Row label="Colores">
              <div className="flex flex-wrap gap-2">
                {g.visual.colores.map((c, i) => (
                  <span key={i} className="flex items-center gap-1.5 text-xs" title={c.uso}>
                    <span className="h-4 w-4 rounded border border-border/50" style={{ background: c.hex }} />
                    {c.nombre || c.hex}
                  </span>
                ))}
              </div>
            </Row>
          )}
          {g.visual.tipografias.length > 0 && (
            <Row label="Tipografías">
              <p className="text-xs">{g.visual.tipografias.map((t) => `${t.nombre}${t.uso ? ` (${t.uso})` : ""}`).join(" · ")}</p>
            </Row>
          )}
          {(g.visual.logo.ancho_min_px || g.visual.logo.area_seguridad || g.visual.logo.usos_prohibidos.length > 0) && (
            <Row label="Logo">
              <p className="text-xs">
                {g.visual.logo.ancho_min_px ? `Ancho mínimo ${g.visual.logo.ancho_min_px}px. ` : ""}
                {g.visual.logo.area_seguridad}
              </p>
              {g.visual.logo.usos_prohibidos.length > 0 && (
                <ul className="list-disc pl-4 text-xs text-muted-foreground">
                  {g.visual.logo.usos_prohibidos.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              )}
            </Row>
          )}
          {g.visual.estilo_fotografico && (
            <Row label="Estilo fotográfico">
              <p className="text-xs">{g.visual.estilo_fotografico}</p>
            </Row>
          )}
          {g.reglas.length > 0 && (
            <div className="md:col-span-2">
              <Row label="Reglas">
                <ul className="list-disc pl-4 text-xs space-y-0.5">
                  {g.reglas.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              </Row>
            </div>
          )}
          {g.fuentes.length > 0 && (
            <p className="md:col-span-2 text-[10px] text-muted-foreground">Fuentes: {g.fuentes.join(" · ")}</p>
          )}
        </div>
      )}
    </div>
  );
}
