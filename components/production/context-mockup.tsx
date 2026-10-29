"use client";

// Previsualización en contexto: la pieza dentro del feed, la story o una
// página web, que es como el cliente la aprueba. Marcos dibujados con CSS
// (sin imágenes): teléfono con la interfaz de Instagram/TikTok encima
// (lo que tapan las zonas seguras) y una página de noticias con el banner en
// su posición típica (leaderboard arriba, rectángulo en la columna, half
// page al lado).

import { useState } from "react";
import { Bookmark, Heart, MessageCircle, Monitor, MoreHorizontal, Send, Smartphone, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { TemplateDefinition } from "@/lib/production/types";
import type { BrandKitContent } from "@/lib/production/brand-kit";
import { serializeOverrides } from "@/lib/production/overrides";
import { AdaptationRenderer } from "@/components/production/render/adaptation-renderer";

export type MockupKind = "feed" | "story" | "web";

export function mockupKindFor(a: { width: number; height: number; preset_channel?: string | null }): MockupKind {
  const social = /^(instagram|meta|facebook|tiktok|linkedin|youtube|x)$/.test(a.preset_channel ?? "");
  const r = a.height / a.width;
  if (social && r >= 1.6) return "story";
  if (social) return "feed";
  return "web";
}

function Piece({ tree, brandKit, width }: { tree: TemplateDefinition; brandKit: BrandKitContent; width: number }) {
  const s = width / tree.size.w;
  return (
    <div style={{ width, height: tree.size.h * s, overflow: "hidden", position: "relative" }}>
      <div style={{ width: tree.size.w, height: tree.size.h, transform: `scale(${s})`, transformOrigin: "0 0" }}>
        <AdaptationRenderer
          adaptation={{
            width: Math.round(tree.size.w),
            height: Math.round(tree.size.h),
            fit_mode: "responsive",
            overrides_json: serializeOverrides({ manual_layout: tree }),
          }}
          master={tree}
          brandKit={brandKit}
        />
      </div>
    </div>
  );
}

const Avatar = ({ name, size = 28 }: { name: string; size?: number }) => (
  <span
    className="rounded-full bg-gradient-to-br from-fuchsia-500 to-amber-400 text-white font-semibold flex items-center justify-center shrink-0"
    style={{ width: size, height: size, fontSize: size * 0.42 }}
  >
    {name.slice(0, 1).toUpperCase()}
  </span>
);

const PHONE_W = 360;

function PhoneFrame({ children, dark }: { children: React.ReactNode; dark?: boolean }) {
  return (
    <div className="rounded-[36px] border-[10px] border-neutral-900 bg-neutral-900 shadow-2xl" style={{ width: PHONE_W + 20 }}>
      <div className={cn("rounded-[26px] overflow-hidden relative", dark ? "bg-black text-white" : "bg-white text-black")} style={{ width: PHONE_W, height: PHONE_H }}>
        <div className="absolute top-2 left-1/2 -translate-x-1/2 w-24 h-5 rounded-full bg-neutral-900 z-20" />
        {children}
      </div>
    </div>
  );
}

function FeedMockup({ tree, brandKit, brand }: { tree: TemplateDefinition; brandKit: BrandKitContent; brand: string }) {
  return (
    <PhoneFrame>
      <div className="pt-10 px-3 pb-2 flex items-center justify-between text-sm font-semibold">
        <span className="italic text-lg">Instagram</span>
        <Send className="h-5 w-5" />
      </div>
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2">
          <Avatar name={brand} />
          <div className="leading-tight">
            <p className="text-[12px] font-semibold">{brand}</p>
            <p className="text-[10px] text-neutral-500">Publicidad</p>
          </div>
        </div>
        <MoreHorizontal className="h-4 w-4" />
      </div>
      <Piece tree={tree} brandKit={brandKit} width={PHONE_W} />
      <div className="px-3 py-2 bg-neutral-100 text-[12px] font-medium flex items-center justify-between border-b border-neutral-200">
        Más información <span className="text-neutral-400">›</span>
      </div>
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-4">
          <Heart className="h-5 w-5" />
          <MessageCircle className="h-5 w-5" />
          <Send className="h-5 w-5" />
        </div>
        <Bookmark className="h-5 w-5" />
      </div>
      <div className="px-3 space-y-1 text-[12px]">
        <p className="font-semibold">1.284 Me gusta</p>
        <p>
          <span className="font-semibold">{brand}</span> <span className="text-neutral-600">Texto de la publicación…</span>
        </p>
      </div>
    </PhoneFrame>
  );
}

const PHONE_H = 760;

function StoryMockup({ tree, brandKit, brand, tiktok }: { tree: TemplateDefinition; brandKit: BrandKitContent; brand: string; tiktok: boolean }) {
  // Como en el teléfono: la story llena la pantalla (cover) y lo que sobra
  // a los lados se recorta; arriba y abajo la interfaz tapa la pieza.
  const s = Math.max(PHONE_W / tree.size.w, PHONE_H / tree.size.h);
  const w = tree.size.w * s;
  const h = tree.size.h * s;
  return (
    <PhoneFrame dark>
      <div className="absolute inset-0 overflow-hidden">
        <div style={{ position: "absolute", left: (PHONE_W - w) / 2, top: (PHONE_H - h) / 2 }}>
          <Piece tree={tree} brandKit={brandKit} width={w} />
        </div>
      </div>
      {tiktok ? (
        <>
          <div className="absolute top-10 inset-x-0 flex justify-center gap-4 text-[13px] font-semibold drop-shadow">
            <span className="opacity-70">Siguiendo</span>
            <span className="border-b-2 border-white pb-0.5">Para ti</span>
          </div>
          <div className="absolute right-3 bottom-28 flex flex-col items-center gap-5 drop-shadow">
            <Avatar name={brand} size={40} />
            {[Heart, MessageCircle, Bookmark, Send].map((I, i) => (
              <span key={i} className="flex flex-col items-center gap-0.5 text-[10px]">
                <I className="h-7 w-7" />
                {["12,4 K", "318", "1.023", "Compartir"][i]}
              </span>
            ))}
          </div>
          <div className="absolute left-3 right-20 bottom-8 text-[12px] drop-shadow space-y-1">
            <p className="font-semibold">{brand} · Patrocinado</p>
            <p className="opacity-90">Descripción del video #marca #campaña</p>
            <p className="bg-white/90 text-black text-center rounded py-1.5 font-medium">Más información</p>
          </div>
        </>
      ) : (
        <>
          <div className="absolute top-9 inset-x-3 h-0.5 bg-white/40 rounded">
            <div className="h-full w-1/3 bg-white rounded" />
          </div>
          <div className="absolute top-12 inset-x-3 flex items-center justify-between drop-shadow">
            <div className="flex items-center gap-2">
              <Avatar name={brand} size={30} />
              <div className="leading-tight text-[12px]">
                <p className="font-semibold">{brand}</p>
                <p className="opacity-80 text-[10px]">Publicidad</p>
              </div>
            </div>
            <X className="h-5 w-5" />
          </div>
          <div className="absolute bottom-6 inset-x-3 flex items-center gap-3 drop-shadow">
            <div className="flex-1 border border-white/70 rounded-full px-3 py-2 text-[12px] opacity-90">Enviar mensaje</div>
            <Heart className="h-6 w-6" />
            <Send className="h-6 w-6" />
          </div>
          <div className="absolute bottom-20 inset-x-0 flex justify-center">
            <span className="bg-white text-black text-[12px] font-medium rounded-full px-4 py-1.5">Más información ↑</span>
          </div>
        </>
      )}
    </PhoneFrame>
  );
}

const Line = ({ w = "100%" }: { w?: string }) => <div className="h-2.5 rounded bg-neutral-200" style={{ width: w }} />;
const Para = () => (
  <div className="space-y-2">
    <Line />
    <Line w="96%" />
    <Line w="88%" />
    <Line w="60%" />
  </div>
);

function WebMockup({ tree, brandKit }: { tree: TemplateDefinition; brandKit: BrandKitContent }) {
  const r = tree.size.h / tree.size.w;
  const slot: "top" | "side" | "inline" = r <= 0.5 ? "top" : r >= 1.4 ? "side" : "inline";
  const pageW = 820;
  const ad = (w: number) => (
    <div className="relative inline-block border border-dashed border-neutral-300">
      <Piece tree={tree} brandKit={brandKit} width={w} />
      <span className="absolute -top-3 right-0 text-[9px] text-neutral-400 bg-white px-1">Anuncio</span>
    </div>
  );
  const adW = Math.min(tree.size.w, slot === "top" ? pageW - 40 : slot === "side" ? 300 : 300);
  return (
    <div className="rounded-lg border border-neutral-300 bg-white text-black shadow-2xl overflow-hidden" style={{ width: pageW }}>
      <div className="h-8 bg-neutral-100 border-b border-neutral-200 flex items-center gap-2 px-3">
        <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
        <div className="ml-3 h-4 flex-1 rounded bg-white border border-neutral-200 text-[10px] text-neutral-400 px-2 flex items-center">
          www.sitio-de-noticias.cl/articulo
        </div>
      </div>
      <div className="px-5 py-4 space-y-4">
        <div className="flex items-center justify-between">
          <span className="font-serif text-xl font-bold">Diario</span>
          <div className="flex gap-4 text-[11px] text-neutral-500">
            <span>Portada</span>
            <span>País</span>
            <span>Economía</span>
            <span>Deportes</span>
          </div>
        </div>
        {slot === "top" && <div className="flex justify-center">{ad(adW)}</div>}
        <div className="flex gap-6">
          <div className="flex-1 space-y-4">
            <div className="h-5 w-3/4 rounded bg-neutral-300" />
            <div className="h-3 w-1/3 rounded bg-neutral-200" />
            <div className="h-40 rounded bg-neutral-200" />
            <Para />
            {slot === "inline" && <div className="flex justify-center py-2">{ad(adW)}</div>}
            <Para />
            <Para />
          </div>
          <div className="w-[300px] shrink-0 space-y-4">
            {slot === "side" ? ad(adW) : <div className="h-64 rounded bg-neutral-100" />}
            <Para />
          </div>
        </div>
      </div>
    </div>
  );
}

export function ContextMockup({
  tree,
  brandKit,
  brand,
  channel,
  label,
  onClose,
}: {
  tree: TemplateDefinition;
  brandKit: BrandKitContent;
  brand: string;
  channel: string | null;
  label: string;
  onClose: () => void;
}) {
  const auto = mockupKindFor({ width: tree.size.w, height: tree.size.h, preset_channel: channel });
  const [kind, setKind] = useState<MockupKind>(auto);
  const tiktok = channel === "tiktok";
  return (
    <div
      className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-background border border-border/50 rounded-xl shadow-2xl max-w-[95vw] max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between gap-4 px-4 py-2.5 border-b border-border/50">
          <div className="text-xs">
            <span className="font-medium">En contexto · {label}</span>
            <span className="text-muted-foreground">
              {" "}· {tree.size.w}×{tree.size.h} · así la ve el público
            </span>
          </div>
          <div className="flex items-center gap-1">
            {(
              [
                ["feed", "Feed", Smartphone],
                ["story", "Story", Smartphone],
                ["web", "Sitio web", Monitor],
              ] as const
            ).map(([k, name, Icon]) => (
              <Button key={k} size="sm" variant={kind === k ? "default" : "ghost"} onClick={() => setKind(k)} className="h-7 gap-1 text-xs">
                <Icon className="h-3.5 w-3.5" />
                {name}
              </Button>
            ))}
            <Button size="sm" variant="ghost" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="p-6 overflow-auto bg-[#1b1d22] flex items-start justify-center">
          {kind === "feed" && <FeedMockup tree={tree} brandKit={brandKit} brand={brand} />}
          {kind === "story" && <StoryMockup tree={tree} brandKit={brandKit} brand={brand} tiktok={tiktok} />}
          {kind === "web" && <WebMockup tree={tree} brandKit={brandKit} />}
        </div>
      </div>
    </div>
  );
}
