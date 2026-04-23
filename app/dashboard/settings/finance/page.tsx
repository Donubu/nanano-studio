"use client";

import { useEffect, useState } from "react";
import { Loader2, Save, Wallet, DollarSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface FinanceSettings {
  available_balance_usd: number | null;
  usd_clp_rate: number | null;
  updated_at: string | null;
}

export default function FinanceSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [balanceUsd, setBalanceUsd] = useState<string>("");
  const [rate, setRate] = useState<string>("");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  useEffect(() => {
    void fetchSettings();
  }, []);

  async function fetchSettings() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/finance");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: FinanceSettings = await res.json();
      setBalanceUsd(data.available_balance_usd != null ? String(data.available_balance_usd) : "");
      setRate(data.usd_clp_rate != null ? String(data.usd_clp_rate) : "");
      setUpdatedAt(data.updated_at);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error cargando settings");
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const body: Record<string, number> = {};
      const b = Number(balanceUsd);
      const r = Number(rate);
      if (balanceUsd !== "" && Number.isFinite(b)) body.available_balance_usd = b;
      if (rate !== "" && Number.isFinite(r)) body.usd_clp_rate = r;

      const res = await fetch("/api/settings/finance", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error || `HTTP ${res.status}`);
      }
      setSuccessMsg("Guardado correctamente");
      await fetchSettings();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error guardando");
    } finally {
      setSaving(false);
    }
  }

  const balancePreviewClp =
    balanceUsd && rate && Number(balanceUsd) > 0 && Number(rate) > 0
      ? Math.round(Number(balanceUsd) * Number(rate))
      : null;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Wallet className="h-7 w-7 text-primary" />
          Ajustes Financieros
        </h1>
        <p className="text-muted-foreground mt-1">
          Saldo disponible y tipo de cambio USD → CLP. Se usa en el reporte semanal por cliente.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Configuración</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="balance">Saldo disponible (USD)</Label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="balance"
                  type="number"
                  step="0.01"
                  min="0"
                  value={balanceUsd}
                  onChange={(e) => setBalanceUsd(e.target.value)}
                  placeholder="Ej: 10000"
                  className="pl-9"
                />
              </div>
              {balancePreviewClp != null && (
                <p className="text-xs text-muted-foreground">
                  Equivalente: ${balancePreviewClp.toLocaleString("es-CL")} CLP
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="rate">Tasa de cambio USD → CLP</Label>
              <Input
                id="rate"
                type="number"
                step="0.01"
                min="0"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                placeholder="Ej: 920"
              />
              <p className="text-xs text-muted-foreground">
                El saldo siempre se almacena en USD. Esta tasa se usa para mostrar los totales en CLP en el reporte.
              </p>
            </div>

            {error && (
              <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md p-3">
                {error}
              </div>
            )}

            {successMsg && (
              <div className="text-sm text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-900 rounded-md p-3">
                {successMsg}
              </div>
            )}

            <div className="flex items-center justify-between pt-2">
              <span className="text-xs text-muted-foreground">
                {updatedAt ? `Última actualización: ${new Date(updatedAt).toLocaleString("es-CL")}` : "Sin guardar aún"}
              </span>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Guardando…
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4 mr-2" />
                    Guardar
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
