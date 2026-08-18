import type { Metadata, Viewport } from "next";
import { Noto_Sans_JP } from "next/font/google";
import "./globals.css";
import Providers from "@/components/Providers";
import AppShell from "@/components/AppShell";
import { loadSidebarUser } from "@/lib/sidebarUser";
import { canUseOperations, getOptionalSession } from "@/lib/session";

/**
 * 本文フォント。OS標準任せだと Mac=ヒラギノ / Windows=メイリオ で見え方が変わるため、
 * PFシリーズ共通のフォントを配信して両OSで同じ表示にする（ポータルと同じ Noto Sans JP）。
 * next/font はビルド時にフォントを取り込んで自前配信するので、実行時の外部リクエストは無い。
 */
const notoSansJP = Noto_Sans_JP({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  display: "swap",
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: "PFスクラップ管理",
  description:
    "スクラップ重量管理システム（日次記録・理論スクラップとスクラップ売却の照合）",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "PFスクラップ管理", statusBarStyle: "default" },
  icons: { icon: "/icon-192.png", apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // サイドバーに出す所属・権限・データ範囲。ポータルから連携された値を都度DBから読む
  // （JWTには載せないので、ポータルで変えたら次の描画で反映される）。
  const user = await loadSidebarUser();
  // マスタ・取込・調達入力のタブを出すかどうか（生産管理部・調達部のメンバーと管理者）。
  // 部署はJWTに載せずDBから読むので、ポータルで異動を反映したら次の描画で効く。
  const sess = await getOptionalSession();
  const canOperate = sess
    ? await canUseOperations({
        companyId: sess.companyId,
        userId: sess.id,
        role: sess.role ?? "admin",
        isDemo: Boolean(sess.isDemo),
      })
    : false;

  return (
    <html lang="ja" className={notoSansJP.variable}>
      <body className="antialiased">
        <Providers>
          <AppShell user={user} canOperate={canOperate}>
            {children}
          </AppShell>
        </Providers>
      </body>
    </html>
  );
}
