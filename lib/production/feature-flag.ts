// Interruptor del módulo de producción (templates de banners, /produccion,
// /api/production, secciones "Producción" en clientes y en el chat).
//
// Se habilita con NEXT_PUBLIC_PRODUCTION_ENABLED=1. Es NEXT_PUBLIC porque
// también decide qué se renderiza en el cliente. Al ser una variable pública
// de Next se inyecta en tiempo de BUILD: en Coolify hay que definirla antes
// de construir y rehacer el deploy para que cambie.
//
// Sin la variable (producción hoy) el módulo queda oculto y sus rutas
// responden como si no existieran; con ella (local) se ve completo.

export const PRODUCTION_ENABLED = process.env.NEXT_PUBLIC_PRODUCTION_ENABLED === "1";
