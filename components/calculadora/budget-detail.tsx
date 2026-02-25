"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Calculator, Loader2, Pencil, Copy, Trash2,
  CheckCircle, XCircle, Printer, Video, ImageIcon,
  CalendarDays, Clock, User,
  ChevronDown, Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { formatDateLocal } from "@/lib/utils";

interface HourEntry { user_id: number; user_name: string | null; user_email: string; user_cargo: string; hours: number; }
interface ExternalCost { id: number; name: string; amount: number; }

interface BudgetItem {
  id: number; type: "video" | "photo"; sort_order: number;
  mode: "dias_habiles" | "horas_hombre"; dias_habiles: number | null;
  item_data: Record<string, unknown>; subtotal: number;
  cost_breakdown: Record<string, number> | null;
  hours: HourEntry[]; externals: ExternalCost[];
}

interface Budget {
  id: number; client_id: number | null; client_name: string | null;
  project_name: string; detail: string | null; ai_summary: string | null; created_by: number;
  creator_name: string | null; creator_email: string;
  status: "draft" | "accepted" | "rejected";
  status_note: string | null; status_date: string | null;
  discount_amount: number; discount_type: string; discount_reason: string | null;
  tech_fee_percent: number; subtotal: number; total: number;
  created_at: string; updated_at: string;
  is_owner: boolean;
  items: BudgetItem[]; externals: ExternalCost[];
}

const STATUS_CONFIG = {
  draft: { label: "Borrador", className: "bg-muted text-muted-foreground", icon: Pencil },
  accepted: { label: "Aceptado", className: "bg-green-500/15 text-green-600 dark:text-green-400", icon: CheckCircle },
  rejected: { label: "Rechazado", className: "bg-red-500/15 text-red-600 dark:text-red-400", icon: XCircle },
};

function fmt(n: number): string { return "$" + Math.round(n).toLocaleString("es-CL"); }

// --- Generate a textual summary of what the budget contains ---
function buildSummary(budget: Budget): string {
  const parts: string[] = [];
  const videoItems = budget.items.filter(i => i.type === "video");
  const photoItems = budget.items.filter(i => i.type === "photo");

  if (videoItems.length > 0) {
    const totalPlanos = videoItems.reduce((s, i) => s + (Number((i.item_data as Record<string, number>).planos) || 0), 0);
    const pieces: string[] = [];
    videoItems.forEach(item => {
      const d = item.item_data as Record<string, unknown>;
      const ratio = d.ratio === "Otro" ? (d.ratioCustom as string || "personalizado") : d.ratio;
      pieces.push(`${d.durMaster}s en ${ratio}`);
    });
    parts.push(`${videoItems.length} pieza${videoItems.length > 1 ? "s" : ""} de video (${totalPlanos} planos total${pieces.length > 0 ? ": " + pieces.join(", ") : ""})`);
  }

  if (photoItems.length > 0) {
    const totalImgs = photoItems.reduce((s, i) => s + (Number((i.item_data as Record<string, number>).imagenes) || 0), 0);
    parts.push(`${photoItems.length} pieza${photoItems.length > 1 ? "s" : ""} de foto (${totalImgs} imágenes total)`);
  }

  const totalDias = budget.items.map(i => i.dias_habiles || 0).filter(d => d > 0);
  if (totalDias.length > 0) {
    const maxDias = Math.max(...totalDias);
    parts.push(`entrega estimada en ${maxDias} días hábiles`);
  }

  const totalHours = budget.items.flatMap(i => i.hours).reduce((s, h) => s + h.hours, 0);
  if (totalHours > 0) {
    parts.push(`${totalHours} HH asignadas`);
  }

  return parts.length > 0 ? parts.join(" · ") : "Sin ítems";
}

export function BudgetDetail({ budgetId }: { budgetId: string }) {
  const router = useRouter();
  const [budget, setBudget] = useState<Budget | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [statusDialog, setStatusDialog] = useState<"accepted" | "rejected" | null>(null);
  const [statusNote, setStatusNote] = useState("");
  const [deleteDialog, setDeleteDialog] = useState(false);
  const [itemsExpanded, setItemsExpanded] = useState(false);
  const [aiSummary, setAiSummary] = useState("");
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    const fetchBudget = async () => {
      try {
        const res = await fetch(`/api/calculadora/${budgetId}`);
        if (res.ok) {
          const data = await res.json();
          setBudget(data);
          if (data.ai_summary) setAiSummary(data.ai_summary);
        } else router.push("/calculadora");
      } catch { router.push("/calculadora"); }
      finally { setLoading(false); }
    };
    fetchBudget();
  }, [budgetId, router]);

  const handleStatusChange = async () => {
    if (!statusDialog) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/calculadora/${budgetId}/status`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: statusDialog, note: statusNote }),
      });
      if (res.ok) {
        setBudget(prev => prev ? { ...prev, status: statusDialog, status_note: statusNote || null, status_date: new Date().toISOString() } : null);
        setStatusDialog(null); setStatusNote("");
      }
    } catch { alert("Error al actualizar estado"); }
    finally { setActionLoading(false); }
  };

  const handleDuplicate = async () => {
    setActionLoading(true);
    try {
      const res = await fetch(`/api/calculadora/${budgetId}/duplicate`, { method: "POST" });
      if (res.ok) { const data = await res.json(); router.push(`/calculadora/${data.id}`); }
    } catch { alert("Error al duplicar"); }
    finally { setActionLoading(false); }
  };

  const generateAiSummary = async () => {
    setAiLoading(true);
    try {
      const res = await fetch(`/api/calculadora/${budgetId}/ai-summary`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setAiSummary(data.summary);
      } else {
        const err = await res.json();
        alert(err.error || "Error al generar resumen");
      }
    } catch { alert("Error de conexión"); }
    finally { setAiLoading(false); }
  };

  const handleDelete = async () => {
    setActionLoading(true);
    try {
      const res = await fetch(`/api/calculadora/${budgetId}`, { method: "DELETE" });
      if (res.ok) router.push("/calculadora");
    } catch { alert("Error al eliminar"); }
    finally { setActionLoading(false); setDeleteDialog(false); }
  };

  if (loading || !budget) {
    return <div className="flex items-center justify-center min-h-screen"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  }

  const statusInfo = STATUS_CONFIG[budget.status];
  const isDraft = budget.status === "draft";
  const canEdit = budget.is_owner;
  const itemsSubtotal = budget.items.reduce((sum, item) => sum + Number(item.subtotal), 0);
  const globalExtTotal = budget.externals.reduce((sum, e) => sum + Number(e.amount), 0);
  const accum = itemsSubtotal + globalExtTotal;
  const techFee = accum * Number(budget.tech_fee_percent);
  const preDiscount = accum + techFee;
  const discountValue = budget.discount_type === "percent"
    ? preDiscount * (Number(budget.discount_amount) / 100)
    : Number(budget.discount_amount);

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto p-6 print:p-2 print:max-w-none">
        {/* Header */}
        <div className="flex items-center justify-between mb-6 print:hidden">
          <div className="flex items-center gap-4">
            <Link href="/calculadora"><Button variant="ghost" size="icon"><ArrowLeft className="h-5 w-5" /></Button></Link>
            <div className="flex items-center gap-3">
              <Calculator className="h-7 w-7 text-primary" />
              <h1 className="text-2xl font-bold">Presupuesto #{budget.id}</h1>
            </div>
          </div>
        </div>

        {/* Actions bar */}
        <div className="flex flex-wrap items-center gap-2 mb-6 print:hidden">
          {canEdit && isDraft && (
            <Link href={`/calculadora/${budget.id}/editar`}>
              <Button variant="outline" size="sm"><Pencil className="h-4 w-4 mr-1" /> Editar</Button>
            </Link>
          )}
          <Button variant="outline" size="sm" onClick={handleDuplicate} disabled={actionLoading}>
            <Copy className="h-4 w-4 mr-1" /> Duplicar
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="h-4 w-4 mr-1" /> Imprimir
          </Button>
          {canEdit && (
            <Button variant="outline" size="sm" className="text-destructive hover:bg-destructive/10" onClick={() => setDeleteDialog(true)}>
              <Trash2 className="h-4 w-4 mr-1" /> Borrar
            </Button>
          )}
          {canEdit && isDraft && (
            <>
              <div className="w-px h-6 bg-border mx-1" />
              <Button variant="outline" size="sm" className="text-green-600 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-950" onClick={() => setStatusDialog("accepted")}>
                <CheckCircle className="h-4 w-4 mr-1" /> Aceptado
              </Button>
              <Button variant="outline" size="sm" className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950" onClick={() => setStatusDialog("rejected")}>
                <XCircle className="h-4 w-4 mr-1" /> Rechazado
              </Button>
            </>
          )}
        </div>

        {/* Two-column layout: content (2/3) + totals (1/3) */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 print:grid-cols-1 print:gap-3 print:text-xs">
          {/* Left column: info + detail + items */}
          <div className="lg:col-span-2 space-y-6 print:space-y-2">
            {/* Info + detail combined */}
            <Card className="print:shadow-none">
              <CardContent className="pt-6 space-y-4 print:pt-3 print:pb-3 print:space-y-2">
                <div className="grid grid-cols-2 gap-4 print:gap-2">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase">Cliente</p>
                    <p className="font-medium">{budget.client_name || "Sin cliente"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase">Proyecto</p>
                    <p className="font-medium">{budget.project_name}</p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase">Creado por</p>
                    <p className="font-medium text-sm">{budget.creator_name || budget.creator_email}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase">Fecha</p>
                    <p className="font-medium text-sm">{formatDateLocal(budget.created_at)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase">Estado</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${statusInfo.className}`}>
                        <statusInfo.icon className="h-3 w-3" />
                        {statusInfo.label}
                      </span>
                    </div>
                  </div>
                </div>
                {budget.status_note && (
                  <p className="text-sm text-muted-foreground italic border-t pt-3">
                    "{budget.status_note}"
                    {budget.status_date && budget.status !== "draft" && (
                      <span className="text-xs ml-1">— {formatDateLocal(budget.status_date)}</span>
                    )}
                  </p>
                )}
                {(budget.detail || buildSummary(budget)) && (
                  <div className={`border-t pt-4 space-y-2 ${aiSummary ? "print:hidden" : ""}`}>
                    {budget.detail && (
                      <div>
                        <p className="text-xs text-muted-foreground uppercase font-medium mb-1">Detalle</p>
                        <p className="text-sm whitespace-pre-wrap">{budget.detail}</p>
                      </div>
                    )}
                    <p className="text-sm text-muted-foreground">{buildSummary(budget)}</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* AI Summary */}
            <Card className={!aiSummary ? "print:hidden" : ""}>
              <CardContent className="pt-6">
                {aiSummary ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-muted-foreground uppercase font-medium flex items-center gap-1.5">
                        <Sparkles className="h-3.5 w-3.5 print:hidden" />
                        <span className="print:hidden">Resumen IA</span>
                        <span className="hidden print:inline">Detalle</span>
                      </p>
                      <Button
                        variant="ghost" size="sm" className="text-xs h-7 print:hidden"
                        disabled={aiLoading}
                        onClick={generateAiSummary}
                      >
                        {aiLoading ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : null}
                        Regenerar
                      </Button>
                    </div>
                    <p className="text-sm whitespace-pre-wrap">{aiSummary}</p>
                  </div>
                ) : (
                  <div className="flex items-center justify-center py-2">
                    <Button
                      variant="outline" size="sm"
                      disabled={aiLoading}
                      onClick={generateAiSummary}
                    >
                      {aiLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
                      Generar resumen con IA
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Items as table — force to new page in print */}
            <div className="print:break-before-page">
              <h2 className="text-lg font-semibold mb-3 print:text-sm print:mb-1">Ítems ({budget.items.length})</h2>
              <div className="border rounded-lg overflow-hidden print:rounded-none">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/50 border-b">
                      <th className="text-left px-4 py-2 font-medium print:px-2 print:py-1">Ítem</th>
                      <th className="text-left px-4 py-2 font-medium print:px-2 print:py-1">Detalle</th>
                      <th className="text-left px-4 py-2 font-medium print:px-2 print:py-1">Plazo</th>
                      <th className="text-right px-4 py-2 font-medium print:px-2 print:py-1">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {budget.items.map((item, idx) => (
                      <ItemRow key={item.id} item={item} index={idx} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Global externals as table */}
            {budget.externals.length > 0 && (
              <div>
                <h2 className="text-lg font-semibold mb-3 print:text-sm print:mb-1">Costos Externos Globales</h2>
                <div className="border rounded-lg overflow-hidden print:rounded-none">
                  <table className="w-full text-sm">
                    <tbody>
                      {budget.externals.map((ext) => (
                        <tr key={ext.id} className="border-b last:border-0">
                          <td className="px-4 py-2 print:px-2 print:py-1">{ext.name}</td>
                          <td className="px-4 py-2 text-right font-mono print:px-2 print:py-1">{fmt(ext.amount)}</td>
                        </tr>
                      ))}
                      <tr className="bg-muted/50 font-medium">
                        <td className="px-4 py-2 print:px-2 print:py-1">Total externos</td>
                        <td className="px-4 py-2 text-right font-mono print:px-2 print:py-1">{fmt(globalExtTotal)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* Right column: totals (sticky) */}
          <div className="lg:col-span-1">
            <div className="lg:sticky lg:top-6">
              <div className="border rounded-lg overflow-hidden border-primary/50 print:shadow-none print:break-inside-avoid print:rounded-none">
                <table className="w-full text-sm print:text-xs">
                  <tbody>
                    {/* Subtotal with accordion */}
                    <tr className="border-b cursor-pointer hover:bg-muted/30 transition-colors" onClick={() => setItemsExpanded(!itemsExpanded)}>
                      <td className="px-4 py-2 text-muted-foreground print:px-2 print:py-1">
                        <span className="flex items-center gap-1">
                          <ChevronDown className={`h-3 w-3 transition-transform print:hidden ${itemsExpanded ? "rotate-180" : ""}`} />
                          Subtotal ítems
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right font-mono print:px-2 print:py-1">{fmt(itemsSubtotal)}</td>
                    </tr>
                    {itemsExpanded && budget.items.map((item, idx) => (
                      <tr key={item.id} className="border-b bg-muted/20">
                        <td colSpan={2} className="px-4 py-1.5 print:px-2 print:py-1">
                          <ItemBreakdown item={item} index={idx} />
                        </td>
                      </tr>
                    ))}
                    {globalExtTotal > 0 && (
                      <>
                        <tr className="border-b">
                          <td className="px-4 py-2 text-muted-foreground print:px-2 print:py-1">Externos globales</td>
                          <td className="px-4 py-2 text-right font-mono print:px-2 print:py-1">{fmt(globalExtTotal)}</td>
                        </tr>
                        {budget.externals.map(e => (
                          <tr key={e.id} className="border-b bg-muted/20">
                            <td className="px-4 py-1 pl-8 text-muted-foreground text-xs print:px-2 print:pl-6">{e.name}</td>
                            <td className="px-4 py-1 text-right font-mono text-xs text-muted-foreground print:px-2">{fmt(e.amount)}</td>
                          </tr>
                        ))}
                      </>
                    )}
                    <tr className="border-b">
                      <td className="px-4 py-2 text-muted-foreground print:px-2 print:py-1">Acumulado</td>
                      <td className="px-4 py-2 text-right font-mono print:px-2 print:py-1">{fmt(accum)}</td>
                    </tr>
                    {Number(budget.tech_fee_percent) > 0 && (
                      <tr className="border-b">
                        <td className="px-4 py-2 text-muted-foreground print:px-2 print:py-1">Tech Fee ({(Number(budget.tech_fee_percent) * 100).toFixed(0)}%)</td>
                        <td className="px-4 py-2 text-right font-mono print:px-2 print:py-1">{fmt(techFee)}</td>
                      </tr>
                    )}
                    {discountValue > 0 && (
                      <tr className="border-b text-red-500">
                        <td className="px-4 py-2 print:px-2 print:py-1">
                          Descuento
                          {budget.discount_type === "percent" && ` (${budget.discount_amount}%)`}
                          {budget.discount_reason && <span className="text-xs ml-1 italic">({budget.discount_reason})</span>}
                        </td>
                        <td className="px-4 py-2 text-right font-mono print:px-2 print:py-1">-{fmt(discountValue)}</td>
                      </tr>
                    )}
                    <tr className="bg-muted/50 font-bold text-base print:text-sm">
                      <td className="px-4 py-3 print:px-2 print:py-1">Total Final</td>
                      <td className="px-4 py-3 text-right font-mono text-primary print:px-2 print:py-1">{fmt(budget.total)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Status change dialog */}
      <Dialog open={statusDialog !== null} onOpenChange={() => { setStatusDialog(null); setStatusNote(""); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{statusDialog === "accepted" ? "Marcar como Aceptado" : "Marcar como Rechazado"}</DialogTitle>
            <DialogDescription>
              {statusDialog === "accepted" ? "Una vez aceptado, el presupuesto no podrá editarse." : "Una vez rechazado, el presupuesto no podrá editarse."}
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label>Nota (opcional)</Label>
            <Textarea value={statusNote} onChange={e => setStatusNote(e.target.value)} placeholder="Agregar una nota..." rows={3} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setStatusDialog(null); setStatusNote(""); }}>Cancelar</Button>
            <Button onClick={handleStatusChange} disabled={actionLoading}
              className={statusDialog === "accepted" ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700"}>
              {actionLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {statusDialog === "accepted" ? "Confirmar Aceptado" : "Confirmar Rechazado"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete dialog */}
      <Dialog open={deleteDialog} onOpenChange={setDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Eliminar Presupuesto</DialogTitle>
            <DialogDescription>¿Estás seguro de que deseas eliminar este presupuesto?</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialog(false)}>Cancelar</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={actionLoading}>
              {actionLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---- Item Detail ----

// Table row for each budget item
function ItemRow({ item, index }: { item: BudgetItem; index: number }) {
  const isVideo = item.type === "video";
  const d = item.item_data as Record<string, unknown>;

  // Build detail text
  const details: string[] = [];
  if (isVideo) {
    const ratio = d.ratio === "Otro" ? (d.ratioCustom as string || "personalizado") : String(d.ratio || "");
    details.push(`${d.planos} planos, máster ${d.durMaster}s ${ratio}`);
    if (d.lipSync) details.push("Lip-sync");
    if (d.training) details.push("Entrenamiento IA");
    if (Number(d.complejos) > 0) details.push(`${d.complejos} complejos`);
    const ads: string[] = [];
    if (Number(d.ad169) > 0) ads.push(`${d.ad169}x 16:9`);
    if (Number(d.ad916) > 0) ads.push(`${d.ad916}x 9:16`);
    if (Number(d.ad11) > 0) ads.push(`${d.ad11}x 1:1`);
    if (Number(d.ad45) > 0) ads.push(`${d.ad45}x 4:5`);
    if (ads.length) details.push(`Adapt: ${ads.join(", ")}`);
    // Reductions — support both new array format and legacy flat fields
    const reductionsArr = Array.isArray(d.reductions) ? d.reductions as Record<string, unknown>[] : [];
    if (reductionsArr.length > 0) {
      for (const r of reductionsArr) {
        const reds: string[] = [];
        if (Number(r.red169) > 0) reds.push(`${r.red169}x 16:9`);
        if (Number(r.red916) > 0) reds.push(`${r.red916}x 9:16`);
        if (Number(r.red11) > 0) reds.push(`${r.red11}x 1:1`);
        if (Number(r.red45) > 0) reds.push(`${r.red45}x 4:5`);
        if (Number(r.redOtro) > 0 && r.redOtroLabel) reds.push(`${r.redOtro}x ${r.redOtroLabel}`);
        if (reds.length) details.push(`Red ${r.durRed}s: ${reds.join(", ")}`);
      }
    } else {
      // Legacy flat format
      const reds: string[] = [];
      if (Number(d.red169) > 0) reds.push(`${d.red169}x 16:9`);
      if (Number(d.red916) > 0) reds.push(`${d.red916}x 9:16`);
      if (Number(d.red11) > 0) reds.push(`${d.red11}x 1:1`);
      if (Number(d.red45) > 0) reds.push(`${d.red45}x 4:5`);
      if (reds.length) details.push(`Red ${d.durRed}s: ${reds.join(", ")}`);
    }
  } else {
    details.push(`${d.imagenes} imágenes`);
    if (d.training) details.push("Entrenamiento IA");
    if (d.upscale) details.push("Escalado HiRes");
    if (d.capas) details.push("Capas PSD");
    const retQty = Number(d.retQty) || 0;
    if (retQty > 0) {
      const retLabels: Record<string, string> = { b: "Básico", m: "Medio", c: "Complejo" };
      details.push(`Retoque ${retLabels[(d.retLevel as string) || "b"]} ×${retQty}`);
    }
  }

  // Hours summary
  if (item.hours.length > 0) {
    const totalH = item.hours.reduce((s, h) => s + h.hours, 0);
    details.push(`${totalH} HH`);
  }

  // Externals
  if (item.externals.length > 0) {
    item.externals.forEach(e => details.push(`Ext: ${e.name}`));
  }

  return (
    <tr className="border-b last:border-0 print:break-inside-avoid">
      <td className="px-4 py-3 print:px-2 print:py-1.5 align-top whitespace-nowrap">
        <div className="flex items-center gap-2">
          <div className={`p-1.5 rounded-md print:p-1 ${isVideo ? "bg-blue-500/10" : "bg-purple-500/10"}`}>
            {isVideo
              ? <Video className={`h-3.5 w-3.5 print:h-3 print:w-3 text-blue-500`} />
              : <ImageIcon className={`h-3.5 w-3.5 print:h-3 print:w-3 text-purple-500`} />
            }
          </div>
          <span className="font-medium">{isVideo ? "Video" : "Foto"}</span>
        </div>
      </td>
      <td className="px-4 py-3 print:px-2 print:py-1.5 align-top">
        <span className="text-muted-foreground">{details.join(" · ")}</span>
      </td>
      <td className="px-4 py-3 print:px-2 print:py-1.5 align-top whitespace-nowrap text-muted-foreground">
        {item.dias_habiles ? `${item.dias_habiles} días` : "—"}
      </td>
      <td className="px-4 py-3 print:px-2 print:py-1.5 align-top text-right font-mono font-medium whitespace-nowrap">
        {fmt(item.subtotal)}
      </td>
    </tr>
  );
}

// --- Accordion item breakdown for the summary totals ---
function ItemBreakdown({ item, index }: { item: BudgetItem; index: number }) {
  const isVideo = item.type === "video";
  const d = item.item_data as Record<string, unknown>;
  const cb = item.cost_breakdown || {};

  // Build cost lines: [label, value] pairs — only non-zero shown
  const lines: [string, number][] = [];

  if (isVideo) {
    const ratio = d.ratio === "Otro" ? (d.ratioCustom as string || "personalizado") : String(d.ratio);
    if (cb.base) lines.push([`Base (${d.planos} planos)`, cb.base]);
    if (cb.lipSync) lines.push(["Lip-sync", cb.lipSync]);
    if (cb.training) lines.push(["Entrenamiento IA", cb.training]);
    if (cb.complejos) lines.push([`Planos complejos (${d.complejos})`, cb.complejos]);
    // Show each adaptation ratio as a separate line
    if (cb.adaptaciones) {
      const adTotal = (Number(d.ad169) || 0) + (Number(d.ad916) || 0) + (Number(d.ad11) || 0) + (Number(d.ad45) || 0);
      const costPerAd = adTotal > 0 ? cb.adaptaciones / adTotal : 0;
      if (Number(d.ad169) > 0) lines.push([`Adaptación 16:9 (×${d.ad169})`, costPerAd * Number(d.ad169)]);
      if (Number(d.ad916) > 0) lines.push([`Adaptación 9:16 (×${d.ad916})`, costPerAd * Number(d.ad916)]);
      if (Number(d.ad11) > 0) lines.push([`Adaptación 1:1 (×${d.ad11})`, costPerAd * Number(d.ad11)]);
      if (Number(d.ad45) > 0) lines.push([`Adaptación 4:5 (×${d.ad45})`, costPerAd * Number(d.ad45)]);
    }
    // Show each reduction ratio as a separate line — support both formats
    if (cb.reducciones) {
      const reductionsArr = Array.isArray(d.reductions) ? d.reductions as Record<string, unknown>[] : [];
      if (reductionsArr.length > 0) {
        // New array format: distribute cost proportionally across all reduction units
        const totalUnits = reductionsArr.reduce((sum: number, r: Record<string, unknown>) =>
          sum + (Number(r.red169) || 0) + (Number(r.red916) || 0) + (Number(r.red11) || 0) + (Number(r.red45) || 0) + (Number(r.redOtro) || 0), 0);
        const costPerUnit = totalUnits > 0 ? cb.reducciones / totalUnits : 0;
        for (const r of reductionsArr) {
          if (Number(r.red169) > 0) lines.push([`Reducción 16:9 ${r.durRed}s (×${r.red169})`, costPerUnit * Number(r.red169)]);
          if (Number(r.red916) > 0) lines.push([`Reducción 9:16 ${r.durRed}s (×${r.red916})`, costPerUnit * Number(r.red916)]);
          if (Number(r.red11) > 0) lines.push([`Reducción 1:1 ${r.durRed}s (×${r.red11})`, costPerUnit * Number(r.red11)]);
          if (Number(r.red45) > 0) lines.push([`Reducción 4:5 ${r.durRed}s (×${r.red45})`, costPerUnit * Number(r.red45)]);
          if (Number(r.redOtro) > 0 && r.redOtroLabel) lines.push([`Reducción ${r.redOtroLabel} ${r.durRed}s (×${r.redOtro})`, costPerUnit * Number(r.redOtro)]);
        }
      } else {
        // Legacy flat format
        const reTotal = (Number(d.red169) || 0) + (Number(d.red916) || 0) + (Number(d.red11) || 0) + (Number(d.red45) || 0);
        const costPerRe = reTotal > 0 ? cb.reducciones / reTotal : 0;
        if (Number(d.red169) > 0) lines.push([`Reducción 16:9 ${d.durRed}s (×${d.red169})`, costPerRe * Number(d.red169)]);
        if (Number(d.red916) > 0) lines.push([`Reducción 9:16 ${d.durRed}s (×${d.red916})`, costPerRe * Number(d.red916)]);
        if (Number(d.red11) > 0) lines.push([`Reducción 1:1 ${d.durRed}s (×${d.red11})`, costPerRe * Number(d.red11)]);
        if (Number(d.red45) > 0) lines.push([`Reducción 4:5 ${d.durRed}s (×${d.red45})`, costPerRe * Number(d.red45)]);
      }
    }

    return (
      <div className="space-y-0.5">
        <div className="flex justify-between font-medium">
          <span>
            <span className="inline-block w-2 h-2 rounded-full mr-1.5 bg-blue-500" />
            Ítem {index + 1}: Video — máster {String(d.durMaster)}s {ratio}
          </span>
          <span className="font-mono shrink-0 ml-2">{fmt(item.subtotal)}</span>
        </div>
        {lines.map(([label, val]) => (
          <div key={label} className="flex justify-between ml-5 text-muted-foreground">
            <span>{label}</span>
            <span className="font-mono shrink-0 ml-2">{fmt(val)}</span>
          </div>
        ))}
        {item.externals.map(e => (
          <div key={e.id} className="flex justify-between ml-5 text-muted-foreground">
            <span>Externo: {e.name}</span>
            <span className="font-mono shrink-0 ml-2">{fmt(e.amount)}</span>
          </div>
        ))}
      </div>
    );
  }

  // Photo
  const retLevelLabels: Record<string, string> = { b: "Básico", m: "Medio", c: "Complejo" };
  if (cb.base) lines.push([`Base (${d.imagenes} imágenes)`, cb.base]);
  if (cb.training) lines.push(["Entrenamiento IA", cb.training]);
  if (cb.retoque) {
    const retQty = Number(d.retQty) || 0;
    const retLabel = retLevelLabels[(d.retLevel as string) || "b"];
    lines.push([`Retoque ${retLabel} (×${retQty})`, cb.retoque]);
  }
  if (cb.upscale) lines.push(["Escalado HiRes", cb.upscale]);
  if (cb.capas) lines.push(["Capas PSD", cb.capas]);

  return (
    <div className="space-y-0.5">
      <div className="flex justify-between font-medium">
        <span>
          <span className="inline-block w-2 h-2 rounded-full mr-1.5 bg-purple-500" />
          Ítem {index + 1}: Foto
        </span>
        <span className="font-mono shrink-0 ml-2">{fmt(item.subtotal)}</span>
      </div>
      {lines.map(([label, val]) => (
        <div key={label} className="flex justify-between ml-5 text-muted-foreground">
          <span>{label}</span>
          <span className="font-mono shrink-0 ml-2">{fmt(val)}</span>
        </div>
      ))}
      {item.externals.map(e => (
        <div key={e.id} className="flex justify-between ml-5 text-muted-foreground">
          <span>Externo: {e.name}</span>
          <span className="font-mono shrink-0 ml-2">{fmt(e.amount)}</span>
        </div>
      ))}
    </div>
  );
}
