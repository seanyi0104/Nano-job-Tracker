import { auth } from "./auth";
import { prisma } from "./db";

export const DEMO_EMAIL = "demo@jobtracker.local";

// Demo mode: no Google OAuth credentials configured. The app skips
// sign-in entirely and uses the seeded demo user so the dashboard
// works straight after `npm install && npm run dev`.
export const isDemoMode = !process.env.GOOGLE_CLIENT_ID;

export interface SessionUser {
  id: string;
  name: string | null;
  email: string | null;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  if (isDemoMode) {
    const user = await prisma.user.findUnique({
      where: { email: DEMO_EMAIL },
    });
    return user ? { id: user.id, name: user.name, email: user.email } : null;
  }

  const session = await auth();
  if (!session?.user?.id) return null;
  return {
    id: session.user.id,
    name: session.user.name ?? null,
    email: session.user.email ?? null,
  };
}
