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
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user, account }) {
      if (account?.provider === "google") {
        try {
          const [rows] = await pool.execute<UserRow[]>(
            "SELECT id, email, name, image, role FROM users WHERE email = ?",
            [user.email]
          );

          if (rows.length === 0) {
            // Usuario no registrado - denegar acceso
            return false;
          }

          // Actualizar nombre e imagen si cambiaron
          const dbUser = rows[0];
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
      if (account && user) {
        try {
          const [rows] = await pool.execute<UserRow[]>(
            "SELECT id, role, can_create_projects, has_personal_space FROM users WHERE email = ?",
            [user.email]
          );
          if (rows.length > 0) {
            token.id = rows[0].id;
            token.role = rows[0].role;
            token.canCreateProjects = rows[0].can_create_projects === 1;
            token.hasPersonalSpace = rows[0].has_personal_space === 1;
          }
        } catch (error) {
          console.error("Error en jwt callback:", error);
        }
      }
      return token;
    },
  },
});
