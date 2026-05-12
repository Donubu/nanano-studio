import NextAuth from "next-auth";
import pool from "@/lib/db";
import { RowDataPacket } from "mysql2";
import { authConfig } from "./auth.config";

interface UserRow extends RowDataPacket {
  id: number;
  email: string;
  name: string | null;
  image: string | null;
  role: string;
  can_create_projects: number;
  has_personal_space: number;
  blocked_at: string | null;
  deleted_at: string | null;
}

// Cada cuánto re-consultar la BD en el jwt callback para detectar bloqueos
// o eliminaciones de usuarios con sesión activa.
const REVALIDATE_INTERVAL_MS = 5 * 60 * 1000;

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user, account }) {
      if (account?.provider === "google") {
        try {
          const [rows] = await pool.execute<UserRow[]>(
            "SELECT id, email, name, image, role, blocked_at, deleted_at FROM users WHERE email = ?",
            [user.email]
          );

          if (rows.length === 0) {
            // Usuario no registrado - denegar acceso
            return false;
          }

          const dbUser = rows[0];

          // Rechazar si está bloqueado o eliminado
          if (dbUser.deleted_at || dbUser.blocked_at) {
            return false;
          }

          // Actualizar nombre e imagen si cambiaron
          if (dbUser.name !== user.name || dbUser.image !== user.image) {
            await pool.execute(
              "UPDATE users SET name = ?, image = ? WHERE id = ?",
              [user.name, user.image, dbUser.id]
            );
          }

          return true;
        } catch (error) {
          console.error("Error verificando usuario:", error);
          return false;
        }
      }
      return false;
    },
    async jwt({ token, user, account }) {
      // Login inicial: el callback recibe `account` y `user` desde el provider.
      if (account && user) {
        try {
          const [rows] = await pool.execute<UserRow[]>(
            "SELECT id, role, can_create_projects, has_personal_space, blocked_at, deleted_at FROM users WHERE email = ?",
            [user.email]
          );
          if (rows.length > 0) {
            const row = rows[0];
            token.id = row.id;
            token.role = row.role;
            token.canCreateProjects = row.can_create_projects === 1;
            token.hasPersonalSpace = row.has_personal_space === 1;
            token.blocked = !!(row.blocked_at || row.deleted_at);
            token.lastChecked = Date.now();
          }
        } catch (error) {
          console.error("Error en jwt callback (login):", error);
        }
        return token;
      }

      // Re-validaciones periódicas: corre cuando auth() es invocado desde
      // un contexto Node (server components, API routes). El middleware
      // Edge sólo lee el token, no ejecuta este callback.
      const now = Date.now();
      const lastChecked = typeof token.lastChecked === "number" ? token.lastChecked : 0;
      if (token.id && now - lastChecked > REVALIDATE_INTERVAL_MS) {
        try {
          const [rows] = await pool.execute<UserRow[]>(
            "SELECT id, role, can_create_projects, has_personal_space, blocked_at, deleted_at FROM users WHERE id = ?",
            [token.id]
          );
          if (rows.length === 0 || rows[0].deleted_at || rows[0].blocked_at) {
            token.blocked = true;
          } else {
            token.blocked = false;
            token.role = rows[0].role;
            token.canCreateProjects = rows[0].can_create_projects === 1;
            token.hasPersonalSpace = rows[0].has_personal_space === 1;
          }
          token.lastChecked = now;
        } catch (error) {
          // Error transitorio: no bloqueamos al usuario, dejamos el token como estaba.
          console.error("Error re-validando usuario en jwt callback:", error);
        }
      }

      return token;
    },
  },
});
