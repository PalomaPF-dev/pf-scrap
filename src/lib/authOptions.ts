import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { getSql } from "./neon";
import { ensureAuthSchema } from "./authDb";

// localhost のクッキーはポートを跨いで共有されるため、既定名（next-auth.session-token）のままだと
// 他のPFアプリの開発サーバーと相互上書きになり JWEDecryptionFailed が起きる。
// アプリ固有のクッキー名にして分離する（本番でも無害）。
// Vercel 上は NEXTAUTH_URL 未設定（VERCEL_URL フォールバック）でも必ず HTTPS。
const useSecureCookies =
  (process.env.NEXTAUTH_URL ?? "").startsWith("https://") || process.env.VERCEL === "1";
const securePrefix = useSecureCookies ? "__Secure-" : "";

/**
 * next-auth 設定（PF家族共通：社員番号＋パスワード／companies・users）。
 * セッションは JWT。companyId 単位でデータをスコープする。
 */
export const authOptions: NextAuthOptions = {
  cookies: {
    sessionToken: {
      name: `${securePrefix}scrap.session-token`,
      options: { httpOnly: true, sameSite: "lax", path: "/", secure: useSecureCookies },
    },
    callbackUrl: {
      name: `${securePrefix}scrap.callback-url`,
      options: { sameSite: "lax", path: "/", secure: useSecureCookies },
    },
    csrfToken: {
      // CSRF トークンの既定名は __Host- プレフィックス。他アプリとの衝突回避で名前だけ変える。
      name: `${useSecureCookies ? "__Host-" : ""}scrap.csrf-token`,
      options: { httpOnly: true, sameSite: "lax", path: "/", secure: useSecureCookies },
    },
  },
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        // フィールド名は互換のため email のまま（値は社員番号 login_id）
        email: { label: "社員番号", type: "text" },
        password: { label: "パスワード", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        const sql = getSql();
        // login_id 列・統一管理者ブートストラップなどを冪等に整えてからログイン処理する
        // （初回アクセスや env 追加直後でもログインできるように）。失敗しても続行。
        try {
          await ensureAuthSchema();
        } catch {
          /* スキーマ初期化の一時失敗ではログイン自体は止めない */
        }
        const loginId = credentials.email.trim();
        // ポータル一本化: 一般利用者のログインはポータルの一括ログイン（/api/sso）に集約した。
        // パスワードでの直接ログインは、ポータル・SSO障害時の復旧用に統一管理者（admin）だけ許す。
        if (loginId.toLowerCase() !== "admin") {
          throw new Error(
            "ログインはポータルから行ってください。ポータルでログインすると各アプリへ自動でログインされます。"
          );
        }
        let rows;
        try {
          rows = await sql`
            SELECT u.id, u.login_id, u.email, u.name, u.password_hash, u.role, u.pending,
                   c.id AS company_id, c.name AS company_name, c.is_demo
            FROM users u
            JOIN companies c ON c.id = u.company_id
            WHERE u.login_id = ${loginId}
            LIMIT 1
          `;
        } catch {
          // 新規DBで users/companies が未作成の場合などはログイン失敗扱い
          return null;
        }
        const user = rows[0];
        if (!user) return null;
        if (user.pending) {
          throw new Error(
            "初回ログインのため、パスワードの設定が必要です。アカウント発行時の設定リンクからパスワードを設定してください。"
          );
        }
        const valid = await bcrypt.compare(credentials.password, user.password_hash as string);
        if (!valid) return null;
        return {
          id: user.id as string,
          email: (user.email ?? null) as string | null,
          name: user.name as string,
          companyId: user.company_id as string,
          companyName: user.company_name as string,
          role: (user.role ?? "admin") as "admin" | "member" | "worker",
          isDemo: Boolean(user.is_demo),
          loginId: (user.login_id ?? null) as string | null,
        };
      },
    }),
  ],

  // セッション上限。共用PCにログインが残り続けないよう、PFシリーズ共通で12時間に揃える。
  // 無操作の自動ログアウト（@paloma-pf/ui の useIdleLogout）が主で、
  // こちらは JS が動かない場合の受け皿。updateAge は使用中に再発行する間隔。
  session: { strategy: "jwt", maxAge: 12 * 60 * 60, updateAge: 15 * 60 },

  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.companyId = user.companyId;
        token.companyName = user.companyName;
        token.role = user.role;
        token.isDemo = user.isDemo;
        token.loginId = user.loginId ?? null;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.companyId = token.companyId as string;
        session.user.companyName = token.companyName as string;
        session.user.role = (token.role ?? "admin") as "admin" | "member" | "worker";
        session.user.isDemo = Boolean(token.isDemo);
        session.user.loginId = (token.loginId ?? null) as string | null;
      }
      return session;
    },
  },

  pages: { signIn: "/login" },
  secret: process.env.NEXTAUTH_SECRET,
};
