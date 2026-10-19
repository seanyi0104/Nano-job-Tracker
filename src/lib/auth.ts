import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "./db";

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Fallback keeps module import from crashing in demo mode (no OAuth
  // configured); never used for real sessions.
  secret: process.env.AUTH_SECRET ?? "demo-mode-placeholder-secret",
  adapter: PrismaAdapter(prisma),
  session: { strategy: "database" },
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          scope:
            "openid email profile https://www.googleapis.com/auth/gmail.readonly",
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
  ],
  pages: {
    signIn: "/signin",
  },
  callbacks: {
    // The Prisma adapter only writes tokens on the first linkAccount. Signing
    // in again with an already-linked account leaves the stored tokens
    // untouched, so a dead refresh_token can never be replaced by re-auth —
    // Gmail sync stays broken no matter how many times the user signs in.
    // Write them back on every sign-in.
    async signIn({ account }) {
      if (account?.provider === "google") {
        await prisma.account.updateMany({
          where: {
            provider: account.provider,
            providerAccountId: account.providerAccountId,
          },
          data: {
            access_token: account.access_token,
            expires_at: account.expires_at,
            scope: account.scope,
            id_token: account.id_token,
            token_type: account.token_type,
            // Google omits refresh_token on some grants; never clobber a
            // working one with undefined.
            ...(account.refresh_token
              ? { refresh_token: account.refresh_token }
              : {}),
          },
        });
      }
      return true;
    },
    session({ session, user }) {
      session.user.id = user.id;
      return session;
    },
  },
});
