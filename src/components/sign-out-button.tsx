"use client";

import { signOut } from "next-auth/react";

export function SignOutButton() {
  return (
    <button
      onClick={() => signOut({ callbackUrl: "/signin" })}
      className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
    >
      Sign out
    </button>
  );
}
