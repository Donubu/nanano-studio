"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Calculator, ArrowLeft, Plus, Loader2, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateLocal } from "@/lib/utils";

interface Budget {
  id: number;
  client_id: number | null;
  client_name: string | null;
  project_name: string;
  created_by: number;
  creator_name: string | null;
  creator_email: string;
  status: "draft" | "accepted" | "rejected";
  status_note: string | null;
  status_date: string | null;
  discount_amount: number;
  tech_fee_percent: number;
  subtotal: number;
  total: number;
  item_count: number;
  created_at: string;
  updated_at: string;
}

const STATUS_CONFIG = {
  draft: { label: "Borrador", className: "bg-muted text-muted-foreground" },
  accepted: { label: "Aceptado", className: "bg-green-500/15 text-green-600 dark:text-green-400" },
  rejected: { label: "Rechazado", className: "bg-red-500/15 text-red-600 dark:text-red-400" },
};

function formatCurrency(amount: number): string {
  return "$" + Math.round(amount).toLocaleString("es-CL");
}

export function CalculadoraView() {
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);

  const fetchBudgets = useCallback(async () => {
    try {
      setLoading(true);
      const params = statusFilter ? `?status=${statusFilter}` : "";
      const res = await fetch(`/api/calculadora${params}`);
      if (res.ok) {
        const data = await res.json();
        setBudgets(data);
      }
    } catch (err) {
      console.error("Error fetching budgets:", err);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchBudgets();
  }, [fetchBudgets]);

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Link href="/">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div className="flex items-center gap-3">
              <Calculator className="h-7 w-7 text-primary" />
              <div>
                <h1 className="text-2xl font-bold">Calculadora IA</h1>
                <p className="text-sm text-muted-foreground">Presupuestos y cotizaciones</p>
              </div>
            </div>
          </div>
          <Link href="/calculadora/nuevo">
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Nuevo Presupuesto
            </Button>
          </Link>
        </div>

        {/* Status Filter */}
        <div className="flex gap-2 mb-6">
          {[
            { value: null, label: "Todos" },
            { value: "draft", label: "Borradores" },
            { value: "accepted", label: "Aceptados" },
            { value: "rejected", label: "Rechazados" },
          ].map((filter) => (
            <Button
              key={filter.value ?? "all"}
              variant={statusFilter === filter.value ? "default" : "outline"}
              size="sm"
              onClick={() => setStatusFilter(filter.value)}
            >
              {filter.label}
            </Button>
          ))}
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : budgets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Calculator className="h-16 w-16 text-muted-foreground/30 mb-4" />
            <h3 className="text-lg font-medium mb-2">Sin presupuestos</h3>
            <p className="text-muted-foreground mb-6">
              {statusFilter ? "No hay presupuestos con este filtro" : "Crea tu primer presupuesto para comenzar"}
            </p>
            {!statusFilter && (
              <Link href="/calculadora/nuevo">
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Nuevo Presupuesto
                </Button>
              </Link>
            )}
          </div>
        ) : (
          <div className="border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[100px]">Fecha</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Proyecto</TableHead>
                  <TableHead>Creador</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="w-[60px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {budgets.map((budget) => {
                  const statusInfo = STATUS_CONFIG[budget.status];
                  return (
                    <TableRow key={budget.id}>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {formatDateLocal(budget.created_at)}
                      </TableCell>
                      <TableCell className="font-medium">
                        {budget.client_name || "—"}
                      </TableCell>
                      <TableCell>{budget.project_name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {budget.creator_name || budget.creator_email}
                      </TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusInfo.className}`}>
                          {statusInfo.label}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-mono font-medium">
                        {formatCurrency(budget.total)}
                      </TableCell>
                      <TableCell>
                        <Link href={`/calculadora/${budget.id}`}>
                          <Button variant="ghost" size="icon" title="Ver detalle">
                            <FileText className="h-4 w-4" />
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
