"use client";

import { SessionProvider } from "next-auth/react";
import React from "react";

/** アプリ全体の Provider（next-auth のセッションをクライアントでも参照できるようにする）。 */
export default function Providers({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
