import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";

export const authConfig: NextAuthConfig = {
  trustHost: true,
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  pages: {
    signIn: "/login",
    error: "/login",
  },
  session: {
    strategy: "jwt",
  },
  callbacks: {
    // Shared session callback so middleware can also see user.id/role
    async session({ session, token }) {
      if (session.user) {
        (session.user as { id: number; role: string; canCreateProjects: boolean; hasPersonalSpace: boolean }).id = token.id as number;
        (session.user as { id: number; role: string; canCreateProjects: boolean; hasPersonalSpace: boolean }).role = token.role as string;
        (session.user as { id: number; role: string; canCreateProjects: boolean; hasPersonalSpace: boolean }).canCreateProjects = (token.canCreateProjects as boolean) || false;
        (session.user as { id: number; role: string; canCreateProjects: boolean; hasPersonalSpace: boolean }).hasPersonalSpace = (token.hasPersonalSpace as boolean) || false;
      }
      return session;
    },
  },
};
