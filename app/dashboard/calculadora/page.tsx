"use client";

import { useEffect, useState } from "react";
import { Calculator, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface VideoConfig {
  basePlano: number;
  lipSync: number;
  training: number;
  complejo: number;
  adaptacion: number;
  reduccion: number;
}

interface FotoConfig {
  baseImagen: number;
  training: number;
  capas: number;
  upscale: number;
  retouch: { b: number; m: number; c: number };
}

// Percent input: displays and edits as %, suffix %
function PctInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [raw, setRaw] = useState(value ? String(value) : "");
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setRaw(value ? String(value) : "");
  }, [value, focused]);

  return (
    <div className="relative">
      <Input
        type="text" inputMode="decimal" className="pr-8"
        value={raw}
        onFocus={() => { setFocused(true); setRaw(value ? String(value) : ""); }}
        onChange={e => {
          setRaw(e.target.value);
          const n = Number(e.target.value);
          if (!isNaN(n)) onChange(n);
        }}
        onBlur={() => {
          setFocused(false);
          const n = Number(raw);
          if (raw === "" || isNaN(n)) { onChange(0); setRaw(""); }
          else { onChange(n); setRaw(String(n)); }
        }}
      />
      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">%</span>
    </div>
  );
}

// Input with CLP formatting
function CLPInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [raw, setRaw] = useState(value ? value.toLocaleString("es-CL") : "");
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setRaw(value ? value.toLocaleString("es-CL") : "");
  }, [value, focused]);

  const parse = (v: string) => Number(v.replace(/\./g, "").replace(/,/g, "."));

  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
      <Input
        type="text" inputMode="numeric" className="pl-7"
        value={raw}
        onFocus={() => { setFocused(true); setRaw(value ? String(value) : ""); }}
        onChange={e => {
          setRaw(e.target.value);
          const n = parse(e.target.value);
          if (!isNaN(n)) onChange(n);
        }}
        onBlur={() => {
          setFocused(false);
          const n = parse(raw);
          if (raw === "" || isNaN(n)) { onChange(0); setRaw(""); }
          else { onChange(n); setRaw(n.toLocaleString("es-CL")); }
        }}
      />
    </div>
  );
}

export default function DashboardCalculadoraPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // State stores % values as human-readable (e.g. 20 = 20%), converted to/from decimal on load/save
  const [techFee, setTechFee] = useState(5);
  const [video, setVideo] = useState<VideoConfig>({
    basePlano: 300000, lipSync: 20, training: 15,
    complejo: 10, adaptacion: 10, reduccion: 10,
  });
  const [foto, setFoto] = useState<FotoConfig>({
    baseImagen: 100000, training: 100, capas: 50,
    upscale: 100000, retouch: { b: 50000, m: 100000, c: 200000 },
  });

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/api/calculadora/config");
        if (res.ok) {
          const data = await res.json();
          if (data.tech_fee !== undefined) setTechFee(data.tech_fee * 100);
          if (data.video) setVideo({
            basePlano: data.video.basePlano,
            lipSync: data.video.lipSync * 100,
            training: data.video.training * 100,
            complejo: data.video.complejo * 100,
            adaptacion: data.video.adaptacion * 100,
            reduccion: data.video.reduccion * 100,
          });
          if (data.foto) setFoto({
            baseImagen: data.foto.baseImagen,
            training: data.foto.training * 100,
            capas: data.foto.capas * 100,
            upscale: data.foto.upscale,
            retouch: data.foto.retouch,
          });
        }
      } catch (err) {
        console.error("Error loading config:", err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/calculadora/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tech_fee: techFee / 100,
          video: {
            basePlano: video.basePlano,
            lipSync: video.lipSync / 100,
            training: video.training / 100,
            complejo: video.complejo / 100,
            adaptacion: video.adaptacion / 100,
            reduccion: video.reduccion / 100,
          },
          foto: {
            baseImagen: foto.baseImagen,
            training: foto.training / 100,
            capas: foto.capas / 100,
            upscale: foto.upscale,
            retouch: foto.retouch,
          },
        }),
      });
      if (res.ok) {
        alert("Configuración guardada");
      } else {
        alert("Error al guardar");
      }
    } catch {
      alert("Error de conexión");
    } finally {
      setSaving(false);
    }
  };

  const handleRestore = async () => {
    if (!confirm("¿Restaurar todos los valores de fábrica?")) return;
    setSaving(true);
    try {
      const res = await fetch("/api/calculadora/config", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setTechFee(data.tech_fee * 100);
        setVideo({
          basePlano: data.video.basePlano,
          lipSync: data.video.lipSync * 100,
          training: data.video.training * 100,
          complejo: data.video.complejo * 100,
          adaptacion: data.video.adaptacion * 100,
          reduccion: data.video.reduccion * 100,
        });
        setFoto({
          baseImagen: data.foto.baseImagen,
          training: data.foto.training * 100,
          capas: data.foto.capas * 100,
          upscale: data.foto.upscale,
          retouch: data.foto.retouch,
        });
        alert("Valores restaurados");
      }
    } catch {
      alert("Error de conexión");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Calculator className="h-8 w-8 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Calculadora IA - Configuración</h1>
          <p className="text-muted-foreground text-sm">Valores predeterminados para presupuestos</p>
        </div>
      </div>

      <div className="max-w-2xl space-y-6">
        {/* Video Config */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Video</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Costo Base por Plano</Label>
              <CLPInput value={video.basePlano} onChange={v => setVideo({ ...video, basePlano: v })} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Lip-Sync</Label>
                <PctInput value={video.lipSync} onChange={v => setVideo({ ...video, lipSync: v })} />
              </div>
              <div>
                <Label>Training</Label>
                <PctInput value={video.training} onChange={v => setVideo({ ...video, training: v })} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label>Recargo Complejo</Label>
                <PctInput value={video.complejo} onChange={v => setVideo({ ...video, complejo: v })} />
              </div>
              <div>
                <Label>Adaptación</Label>
                <PctInput value={video.adaptacion} onChange={v => setVideo({ ...video, adaptacion: v })} />
              </div>
              <div>
                <Label>Reducción</Label>
                <PctInput value={video.reduccion} onChange={v => setVideo({ ...video, reduccion: v })} />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Foto Config */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Foto</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Costo Base por Imagen</Label>
              <CLPInput value={foto.baseImagen} onChange={v => setFoto({ ...foto, baseImagen: v })} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Training</Label>
                <PctInput value={foto.training} onChange={v => setFoto({ ...foto, training: v })} />
              </div>
              <div>
                <Label>Capas</Label>
                <PctInput value={foto.capas} onChange={v => setFoto({ ...foto, capas: v })} />
              </div>
            </div>
            <div>
              <Label>Costo Escalado</Label>
              <CLPInput value={foto.upscale} onChange={v => setFoto({ ...foto, upscale: v })} />
            </div>
            <div>
              <Label className="text-primary text-sm">Retoque Manual</Label>
              <div className="grid grid-cols-3 gap-4 mt-2">
                <div>
                  <Label>Básico</Label>
                  <CLPInput value={foto.retouch.b} onChange={v => setFoto({ ...foto, retouch: { ...foto.retouch, b: v } })} />
                </div>
                <div>
                  <Label>Medio</Label>
                  <CLPInput value={foto.retouch.m} onChange={v => setFoto({ ...foto, retouch: { ...foto.retouch, m: v } })} />
                </div>
                <div>
                  <Label>Complejo</Label>
                  <CLPInput value={foto.retouch.c} onChange={v => setFoto({ ...foto, retouch: { ...foto.retouch, c: v } })} />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Tech Fee */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">General</CardTitle>
          </CardHeader>
          <CardContent>
            <div>
              <Label>Tech Fee</Label>
              <PctInput value={techFee} onChange={setTechFee} />
            </div>
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="flex gap-3">
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Guardar Cambios
          </Button>
          <Button variant="outline" onClick={handleRestore} disabled={saving}>
            <RotateCcw className="h-4 w-4 mr-2" />
            Restaurar Fábrica
          </Button>
        </div>
      </div>
    </div>
  );
}
