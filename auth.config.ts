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
    // Shared session callback so middleware can also see user.id/role/blocked
    async session({ session, token }) {
      if (session.user) {
        type AppSessionUser = {
          id: number;
          role: string;
          canCreateProjects: boolean;
          hasPersonalSpace: boolean;
          blocked: boolean;
        };
        const u = session.user as unknown as AppSessionUser;
        u.id = token.id as number;
        u.role = token.role as string;
        u.canCreateProjects = (token.canCreateProjects as boolean) || false;
        u.hasPersonalSpace = (token.hasPersonalSpace as boolean) || false;
        u.blocked = (token.blocked as boolean) || false;
      }
      return session;
    },
  },
};
