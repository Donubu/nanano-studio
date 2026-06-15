"use client";

import { useCallback, useEffect, useState } from "react";
import { Image as ImageIcon, Video as VideoIcon, Infinity as InfinityIcon, AlertTriangle } from "lucide-react";

interface CreditStatus {
  type: "image" | "video";
  effective_limit: number | null;
  used: number;
  remaining: number | null;
  blocked: boolean;
}

interface CreditMeResponse {
  client_id: number;
  is_admin: boolean;
  exempt: boolean;
  // null para admins/exentos: el backend corta-circuita sin correr getCreditStatus
  period: { year: number; month: number } | null;
  image: CreditStatus | null;
  video: CreditStatus | null;
}

interface Props {
  clientId: number | null;
  // Cambia para forzar refetch (ej. tras una generación)
  refreshKey?: number;
}

function fmt(status: CreditStatus, Icon: typeof ImageIcon, label: string) {
  if (status.effective_limit === null) {
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground" title={`${label}: ilimitado`}>
        <Icon className="h-3.5 w-3.5" />
        <InfinityIcon className="h-3 w-3" />
      </span>
    );
  }
  const remaining = Math.max(0, (status.effective_limit ?? 0) - status.used);
  const isLow = remaining > 0 && remaining <= Math.max(1, Math.round((status.effective_limit ?? 0) * 0.1));
  const color = status.blocked
    ? "text-red-400"
    : isLow
    ? "text-amber-400"
    : "text-muted-foreground";
  return (
    <span className={`inline-flex items-center gap-1 ${color}`} title={`${label}: ${status.used}/${status.effective_limit}`}>
      <Icon className="h-3.5 w-3.5" />
      <span className="font-mono text-[11px]">
        {status.used}/{status.effective_limit}
      </span>
      {status.blocked && <AlertTriangle className="h-3 w-3" />}
    </span>
  );
}

export function CreditBadge({ clientId, refreshKey }: Props) {
  const [data, setData] = useState<CreditMeResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async () => {
    if (!clientId) {
      setData(null);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/credits/me`);
      if (res.ok) {
        const json: CreditMeResponse = await res.json();
        setData(json);
      } else {
        setData(null);
      }
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    fetchData();
  }, [fetchData, refreshKey]);

  // Refrescar al recuperar foco y cada 2 min mientras está activa. Los créditos
  // cambian lento; el refetch inmediato tras generar va por `refreshKey`.
  useEffect(() => {
    if (!clientId) return;
    const onFocus = () => fetchData();
    window.addEventListener("focus", onFocus);
    const interval = window.setInterval(fetchData, 120000);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.clearInterval(interval);
    };
  }, [clientId, fetchData]);

  if (!clientId || !data) return null;
  // Admins y exentos no necesitan el badge (backend devuelve image/video null)
  if (data.is_admin || data.exempt || !data.image || !data.video) return null;
  // Sin política configurada en ningún tipo → nada que mostrar
  if (data.image.effective_limit === null && data.video.effective_limit === null) return null;

  return (
    <div className={`flex items-center gap-3 text-xs ${loading ? "opacity-50" : ""}`}>
      {fmt(data.image, ImageIcon, "Imágenes")}
      {fmt(data.video, VideoIcon, "Videos")}
    </div>
  );
}
