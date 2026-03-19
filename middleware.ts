import NextAuth from "next-auth";
import { authConfig } from "./auth.config";
import { NextResponse } from "next/server";

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const token = req.auth;
  const isLoggedIn = !!token;
  const isLoginPage = req.nextUrl.pathname === "/login";
  const isAuthRoute = req.nextUrl.pathname.startsWith("/api/auth");
  const isHealthRoute = req.nextUrl.pathname.startsWith("/api/health");

  // Permitir rutas de autenticación y health check
  if (isAuthRoute || isHealthRoute) {
    return NextResponse.next();
  }

  // JWT exists but missing critical fields (DB failed during login) — force re-login
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hasIncompleteSession = isLoggedIn && (!token.user || !(token.user as any).id);

  // Redirigir a home si ya está logueado e intenta acceder a login
  if (isLoginPage && isLoggedIn && !hasIncompleteSession) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  // Redirigir a login si no está logueado o sesión incompleta
  if (!isLoginPage && (!isLoggedIn || hasIncompleteSession)) {
    // Clear the broken session cookie and redirect to login
    if (hasIncompleteSession) {
      const response = NextResponse.redirect(new URL("/login", req.url));
      response.cookies.delete("authjs.session-token");
      response.cookies.delete("__Secure-authjs.session-token");
      return response;
    }
    return NextResponse.redirect(new URL("/login", req.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
