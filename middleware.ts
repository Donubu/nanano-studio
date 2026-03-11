import NextAuth from "next-auth";
import { authConfig } from "./auth.config";
import { NextResponse } from "next/server";

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const isLoginPage = req.nextUrl.pathname === "/login";
  const isAuthRoute = req.nextUrl.pathname.startsWith("/api/auth");
  const isHealthRoute = req.nextUrl.pathname.startsWith("/api/health");

  // Permitir rutas de autenticación y health check
  if (isAuthRoute || isHealthRoute) {
    return NextResponse.next();
  }

  // Redirigir a home si ya está logueado e intenta acceder a login
  if (isLoginPage && isLoggedIn) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  // Redirigir a login si no está logueado
  if (!isLoginPage && !isLoggedIn) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
