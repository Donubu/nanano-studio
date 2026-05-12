"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Image as ImageIcon, Video as VideoIcon, Infinity as InfinityIcon, X, Plus, Trash2 } from "lucide-react";
import { formatDateLocal } from "@/lib/utils";

type GenType = "image" | "video";

interface CreditStatus {
  type: GenType;
  effective_limit: number | null;
  used: number;
  remaining: number | null;
  blocked: boolean;
}

interface CreditsSummary {
  client_id: number;
  policy: {
    monthly_image_limit: number | null;
    monthly_video_limit: number | null;
  };
  period: { year: number; month: number };
  usage: { image: CreditStatus; video: CreditStatus };
  adjustments_total: { image: number; video: number };
}

interface AdjustmentRow {
  id: number;
  client_id: number;
  period_year: number;
  period_month: number;
  generation_type: GenType;
  delta: number;
  reason: string | null;
  created_by_name: string | null;
  created_by_email: string | null;
  created_at: string;
}

interface ExceptionRow {
  id: number;
  user_id: number;
  reason: string | null;
  created_at: string;
  user_email: string;
  user_name: string | null;
  user_image: string | null;
}

interface UserOption {
  id: number;
  name: string | null;
  email: string;
}

interface Props {
  clientId: number;
}

function fmtLimit(value: number | null): string {
  if (value === null) return "Ilimitado";
  if (value === 0) return "Bloqueado";
  return String(value);
}

export default function ClientCreditsSection({ clientId }: Props) {
  const [summary, setSummary] = useState<CreditsSummary | null>(null);
  const [adjustments, setAdjustments] = useState<AdjustmentRow[]>([]);
  const [exceptions, setExceptions] = useState<ExceptionRow[]>([]);
  const [allUsers, setAllUsers] = useState<UserOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingPolicy, setSavingPolicy] = useState(false);

  // Policy editor state
  const [imageLimitInput, setImageLimitInput] = useState("");
  const [imageUnlimited, setImageUnlimited] = useState(false);
  const [videoLimitInput, setVideoLimitInput] = useState("");
  const [videoUnlimited, setVideoUnlimited] = useState(false);

  // Adjustment form state
  const [adjType, setAdjType] = useState<GenType>("image");
  const [adjDelta, setAdjDelta] = useState("");
  const [adjReason, setAdjReason] = useState("");
  const [creatingAdj, setCreatingAdj] = useState(false);

  // Exception form state
  const [excUserId, setExcUserId] = useState("");
  const [excReason, setExcReason] = useState("");
  const [creatingExc, setCreatingExc] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [sRes, aRes, eRes, uRes] = await Promise.all([
        fetch(`/api/clients/${clientId}/credits`),
        fetch(`/api/clients/${clientId}/credits/adjustments`),
        fetch(`/api/clients/${clientId}/exceptions`),
        fetch(`/api/users`),
      ]);
      if (sRes.ok) {
        const data: CreditsSummary = await sRes.json();
        setSummary(data);
        setImageUnlimited(data.policy.monthly_image_limit === null);
        setImageLimitInput(
          data.policy.monthly_image_limit === null ? "" : String(data.policy.monthly_image_limit)
        );
        setVideoUnlimited(data.policy.monthly_video_limit === null);
        setVideoLimitInput(
          data.policy.monthly_video_limit === null ? "" : String(data.policy.monthly_video_limit)
        );
      }
      if (aRes.ok) setAdjustments(await aRes.json());
      if (eRes.ok) setExceptions(await eRes.json());
      if (uRes.ok) setAllUsers(await uRes.json());
    } catch (err) {
      console.error("Error cargando créditos:", err);
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const savePolicy = async () => {
    setSavingPolicy(true);
    try {
      const body = {
        monthly_image_limit: imageUnlimited ? null : Math.max(0, Number(imageLimitInput) || 0),
        monthly_video_limit: videoUnlimited ? null : Math.max(0, Number(videoLimitInput) || 0),
      };
      const res = await fetch(`/api/clients/${clientId}/credits`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        await fetchAll();
      }
    } catch (err) {
      console.error("Error guardando policy:", err);
    } finally {
      setSavingPolicy(false);
    }
  };

  const createAdjustment = async () => {
    const delta = Number(adjDelta);
    if (!Number.isFinite(delta) || delta === 0) return;
    if (!summary) return;
    setCreatingAdj(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/credits/adjustments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          period_year: summary.period.year,
          period_month: summary.period.month,
          generation_type: adjType,
          delta,
          reason: adjReason || null,
        }),
      });
      if (res.ok) {
        setAdjDelta("");
        setAdjReason("");
        await fetchAll();
      }
    } catch (err) {
      console.error("Error creando ajuste:", err);
    } finally {
      setCreatingAdj(false);
    }
  };

  const deleteAdjustment = async (adjId: number) => {
    try {
      const res = await fetch(`/api/clients/${clientId}/credits/adjustments/${adjId}`, {
        method: "DELETE",
      });
      if (res.ok) await fetchAll();
    } catch (err) {
      console.error("Error eliminando ajuste:", err);
    }
  };

  const createException = async () => {
    if (!excUserId) return;
    setCreatingExc(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/exceptions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: Number(excUserId),
          reason: excReason || null,
        }),
      });
      if (res.ok) {
        setExcUserId("");
        setExcReason("");
        await fetchAll();
      }
    } catch (err) {
      console.error("Error creando exención:", err);
    } finally {
      setCreatingExc(false);
    }
  };

  const deleteException = async (userId: number) => {
    try {
      const res = await fetch(`/api/clients/${clientId}/exceptions/${userId}`, {
        method: "DELETE",
      });
      if (res.ok) await fetchAll();
    } catch (err) {
      console.error("Error eliminando exención:", err);
    }
  };

  if (loading || !summary) {
    return (
      <div className="bg-card rounded-xl border border-border/50 p-6">
        <h3 className="text-sm font-medium mb-4">Créditos mensuales</h3>
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  const availableForException = allUsers.filter(
    (u) => !exceptions.some((e) => e.user_id === u.id)
  );

  return (
    <div className="space-y-6">
      {/* Policy + uso del mes */}
      <div className="bg-card rounded-xl border border-border/50 p-6">
        <div className="flex items-baseline justify-between mb-4">
          <h3 className="text-sm font-medium">Créditos mensuales</h3>
          <span className="text-xs text-muted-foreground">
            Mes {String(summary.period.month).padStart(2, "0")}/{summary.period.year}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          {/* Imágenes */}
          <div className="bg-muted/40 rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <ImageIcon className="h-4 w-4" /> Imágenes
            </div>
            <div className="text-xs text-muted-foreground">
              Usado este mes:{" "}
              <span className="text-foreground font-medium">
                {summary.usage.image.used}
              </span>{" "}
              /{" "}
              <span className="text-foreground font-medium">
                {fmtLimit(summary.usage.image.effective_limit)}
              </span>
              {summary.adjustments_total.image !== 0 && (
                <span className="ml-1">
                  (base {fmtLimit(summary.policy.monthly_image_limit)} + ajustes{" "}
                  {summary.adjustments_total.image >= 0 ? "+" : ""}
                  {summary.adjustments_total.image})
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1 text-xs text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={imageUnlimited}
                  onChange={(e) => setImageUnlimited(e.target.checked)}
                />
                <InfinityIcon className="h-3 w-3" /> Ilimitado
              </label>
              <Input
                type="number"
                min={0}
                placeholder="Límite mensual"
                value={imageLimitInput}
                disabled={imageUnlimited}
                onChange={(e) => setImageLimitInput(e.target.value)}
                className="bg-background"
              />
            </div>
          </div>

          {/* Videos */}
          <div className="bg-muted/40 rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <VideoIcon className="h-4 w-4" /> Videos
            </div>
            <div className="text-xs text-muted-foreground">
              Usado este mes:{" "}
              <span className="text-foreground font-medium">
                {summary.usage.video.used}
              </span>{" "}
              /{" "}
              <span className="text-foreground font-medium">
                {fmtLimit(summary.usage.video.effective_limit)}
              </span>
              {summary.adjustments_total.video !== 0 && (
                <span className="ml-1">
                  (base {fmtLimit(summary.policy.monthly_video_limit)} + ajustes{" "}
                  {summary.adjustments_total.video >= 0 ? "+" : ""}
                  {summary.adjustments_total.video})
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1 text-xs text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={videoUnlimited}
                  onChange={(e) => setVideoUnlimited(e.target.checked)}
                />
                <InfinityIcon className="h-3 w-3" /> Ilimitado
              </label>
              <Input
                type="number"
                min={0}
                placeholder="Límite mensual"
                value={videoLimitInput}
                disabled={videoUnlimited}
                onChange={(e) => setVideoLimitInput(e.target.value)}
                className="bg-background"
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <Button size="sm" onClick={savePolicy} disabled={savingPolicy}>
            {savingPolicy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Guardar política"}
          </Button>
        </div>

        <p className="text-xs text-muted-foreground mt-3">
          Texto, audio y música no se cuentan. La cuota se cuenta por generación completada
          (sin importar calidad ni modelo).
        </p>
      </div>

      {/* Ajustes mensuales */}
      <div className="bg-card rounded-xl border border-border/50 p-6">
        <h3 className="text-sm font-medium mb-4">Créditos adicionales del mes</h3>

        {adjustments.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">
            No hay ajustes registrados.
          </p>
        ) : (
          <div className="space-y-1 mb-4">
            {adjustments.map((a) => (
              <div
                key={a.id}
                className="flex items-center justify-between bg-muted/40 rounded-lg px-3 py-2 text-sm"
              >
                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono text-muted-foreground">
                    {String(a.period_month).padStart(2, "0")}/{a.period_year}
                  </span>
                  <span
                    className={
                      a.delta >= 0 ? "text-green-400 font-medium" : "text-red-400 font-medium"
                    }
                  >
                    {a.delta >= 0 ? "+" : ""}
                    {a.delta}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {a.generation_type === "image" ? "imágenes" : "videos"}
                  </span>
                  {a.reason && (
                    <span className="text-xs text-muted-foreground">— {a.reason}</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {a.created_by_name || a.created_by_email || "—"} ·{" "}
                    {formatDateLocal(a.created_at)}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 hover:bg-red-500/10"
                    onClick={() => deleteAdjustment(a.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-red-400" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="border-t border-border/40 pt-4 mt-4">
          <p className="text-xs text-muted-foreground mb-2">
            Agregar créditos para {String(summary.period.month).padStart(2, "0")}/
            {summary.period.year}
          </p>
          <div className="flex flex-col md:flex-row md:items-center gap-2">
            <Select value={adjType} onValueChange={(v) => setAdjType(v as GenType)}>
              <SelectTrigger className="md:w-40 bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="image">Imágenes</SelectItem>
                <SelectItem value="video">Videos</SelectItem>
              </SelectContent>
            </Select>
            <Input
              type="number"
              placeholder="+N créditos (o -N)"
              value={adjDelta}
              onChange={(e) => setAdjDelta(e.target.value)}
              className="md:w-40 bg-background"
            />
            <Input
              placeholder="Razón (opcional)"
              value={adjReason}
              onChange={(e) => setAdjReason(e.target.value)}
              className="flex-1 bg-background"
            />
            <Button size="sm" onClick={createAdjustment} disabled={creatingAdj || !adjDelta} className="gap-1">
              {creatingAdj ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Agregar
            </Button>
          </div>
        </div>
      </div>

      {/* Usuarios exentos */}
      <div className="bg-card rounded-xl border border-border/50 p-6">
        <h3 className="text-sm font-medium mb-1">Usuarios exentos</h3>
        <p className="text-xs text-muted-foreground mb-4">
          Estos usuarios se saltan los límites del cliente. Su consumo tampoco descuenta del
          pool. No son administradores: solo no aplican cuota.
        </p>

        {exceptions.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">
            No hay usuarios exentos.
          </p>
        ) : (
          <div className="space-y-2 mb-4">
            {exceptions.map((e) => (
              <div
                key={e.id}
                className="flex items-center justify-between bg-muted/40 rounded-lg px-3 py-2"
              >
                <div className="flex items-center gap-3">
                  {e.user_image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={e.user_image}
                      alt={e.user_name || e.user_email}
                      width={28}
                      height={28}
                      className="rounded-full"
                    />
                  ) : (
                    <div className="w-7 h-7 rounded-full bg-accent flex items-center justify-center text-xs font-medium">
                      {(e.user_name || e.user_email).charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div>
                    <p className="text-sm font-medium leading-none">
                      {e.user_name || e.user_email}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {e.user_email}
                      {e.reason ? ` · ${e.reason}` : ""}
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 hover:bg-red-500/10"
                  onClick={() => deleteException(e.user_id)}
                >
                  <X className="h-3.5 w-3.5 text-red-400" />
                </Button>
              </div>
            ))}
          </div>
        )}

        <div className="border-t border-border/40 pt-4 mt-4 flex flex-col md:flex-row md:items-center gap-2">
          <Select
            value={excUserId}
            onValueChange={setExcUserId}
            disabled={availableForException.length === 0}
          >
            <SelectTrigger className="md:flex-1 bg-background">
              <SelectValue
                placeholder={
                  availableForException.length === 0
                    ? "No hay usuarios disponibles"
                    : "Seleccionar usuario..."
                }
              />
            </SelectTrigger>
            <SelectContent>
              {availableForException.map((u) => (
                <SelectItem key={u.id} value={String(u.id)}>
                  {u.name || u.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            placeholder="Razón (opcional)"
            value={excReason}
            onChange={(e) => setExcReason(e.target.value)}
            className="flex-1 bg-background"
          />
          <Button size="sm" onClick={createException} disabled={!excUserId || creatingExc}>
            {creatingExc ? <Loader2 className="h-4 w-4 animate-spin" /> : "Eximir"}
          </Button>
        </div>
      </div>
    </div>
  );
}
