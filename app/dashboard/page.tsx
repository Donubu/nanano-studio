"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, MessageSquare, FolderKanban, ImageIcon, Video, Loader2, Zap, DollarSign, Sparkles } from "lucide-react";

interface DashboardStats {
  totalUsers: number;
  totalProjects: number;
  totalConversations: number;
  totalImages: number;
  totalVideos: number;
  totalTokensInput: number;
  totalTokensOutput: number;
  totalEstimatedCost: number;
  topazImageCredits: number;
  topazVideoCredits: number;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch("/api/dashboard/stats");
        if (res.ok) {
          const data = await res.json();
          setStats(data);
        }
      } catch (err) {
        console.error("Error fetching stats:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, []);

  const formatNumber = (num: number) => {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + "M";
    }
    if (num >= 1000) {
      return (num / 1000).toFixed(1) + "K";
    }
    return num.toString();
  };

  const formatCost = (cost: number) => {
    const numCost = Number(cost) || 0;
    if (numCost === 0) return "$0.00";
    if (numCost < 0.01) return `$${numCost.toFixed(4)}`;
    if (numCost < 1) return `$${numCost.toFixed(3)}`;
    return `$${numCost.toFixed(2)}`;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">
          Bienvenido a Duaria Studio
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <Card className="bg-card border-border/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Usuarios
            </CardTitle>
            <Users className="h-4 w-4 text-blue-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {loading ? (
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              ) : (
                formatNumber(stats?.totalUsers || 0)
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Usuarios registrados
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Proyectos
            </CardTitle>
            <FolderKanban className="h-4 w-4 text-yellow-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {loading ? (
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              ) : (
                formatNumber(stats?.totalProjects || 0)
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Proyectos activos
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Conversaciones
            </CardTitle>
            <MessageSquare className="h-4 w-4 text-green-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {loading ? (
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              ) : (
                formatNumber(stats?.totalConversations || 0)
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Chats totales
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Imágenes
            </CardTitle>
            <ImageIcon className="h-4 w-4 text-purple-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {loading ? (
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              ) : (
                formatNumber(stats?.totalImages || 0)
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Generadas
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Videos
            </CardTitle>
            <Video className="h-4 w-4 text-orange-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {loading ? (
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              ) : (
                formatNumber(stats?.totalVideos || 0)
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Generados
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Cost & Topaz Section */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 max-w-4xl">
        <Card className="bg-card border-border/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Costo Total
            </CardTitle>
            <DollarSign className="h-4 w-4 text-green-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-400">
              {loading ? (
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              ) : (
                formatCost(stats?.totalEstimatedCost || 0)
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              USD estimado
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Topaz Imagen
            </CardTitle>
            <Sparkles className="h-4 w-4 text-purple-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-400">
              {loading ? (
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              ) : (
                formatNumber(Number(stats?.topazImageCredits || 0))
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Créditos usados
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Topaz Video
            </CardTitle>
            <Sparkles className="h-4 w-4 text-orange-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-400">
              {loading ? (
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              ) : (
                formatNumber(Number(stats?.topazVideoCredits || 0))
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Créditos usados
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Topaz Total
            </CardTitle>
            <Sparkles className="h-4 w-4 text-cyan-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-cyan-400">
              {loading ? (
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              ) : (
                formatNumber(Number(stats?.topazImageCredits || 0) + Number(stats?.topazVideoCredits || 0))
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Créditos totales
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Token Usage Section */}
      <div>
        <h2 className="text-lg font-semibold mb-3">Uso de Tokens</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="bg-card border-border/50">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Tokens Input
              </CardTitle>
              <Zap className="h-4 w-4 text-cyan-400" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {loading ? (
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                ) : (
                  formatNumber(stats?.totalTokensInput || 0)
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Tokens de entrada
              </p>
            </CardContent>
          </Card>

          <Card className="bg-card border-border/50">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Tokens Output
              </CardTitle>
              <Zap className="h-4 w-4 text-pink-400" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {loading ? (
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                ) : (
                  formatNumber(stats?.totalTokensOutput || 0)
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Tokens de salida
              </p>
            </CardContent>
          </Card>

          <Card className="bg-card border-border/50">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total Tokens
              </CardTitle>
              <Zap className="h-4 w-4 text-amber-400" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {loading ? (
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                ) : (
                  formatNumber(Number(stats?.totalTokensInput || 0) + Number(stats?.totalTokensOutput || 0))
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Input + Output
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
