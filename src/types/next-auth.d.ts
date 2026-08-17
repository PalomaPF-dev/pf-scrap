import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      companyId: string;
      companyName: string;
      role: "admin" | "member" | "worker";
      isDemo?: boolean;
      /** 社員番号（申請者の識別子）。旧データ・admin は null 可 */
      loginId?: string | null;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
  interface User {
    companyId: string;
    companyName: string;
    role: "admin" | "member" | "worker";
    isDemo?: boolean;
    loginId?: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    companyId: string;
    companyName: string;
    role: "admin" | "member" | "worker";
    isDemo?: boolean;
    loginId?: string | null;
  }
}
