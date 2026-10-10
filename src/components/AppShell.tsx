"use client";

import { useSession, signOut } from "next-auth/react";
import { usePathname } from "next/navigation";
import { LogOut, Mail } from "lucide-react";
import { AppShell as BaseAppShell, UserIdentity, type NavGroup, type NavItem } from "@paloma-pf/ui";
import type { SidebarUser } from "@/lib/sidebarUser";
import { MODULES, MODULE_GROUPS, usable, type AppModule } from "./Modules";
import { FactoryProvider } from "./FactoryScope";
import { GuidePanelProvider, GuideToggle } from "./GuidePanel";
import { GUIDE_PRINT_PATH, type GuideAudience } from "@/lib/guideMap";

/**
 * サイドバー。ホーム → 用途別のグループ（現場の記録 / 集計・照合 / 入力・取込 / マスタ・設定）→ 使い方。
 * 名前・アイコン・分け方はホームと同じ定義（Modules.ts）から作る。
 * 権限の無い機能（ops / admin）はタブごと出さず、空になったグループも出さない
 * （サーバー側でも requireOperations* / requireAdmin* で必ず防ぐ）。
 */
function navFor(canOperate: boolean, isAdmin: boolean): NavGroup[] {
  const item = (m: AppModule): NavItem => ({ href: m.href, label: m.title, icon: m.icon });
  const groups: NavGroup[] = [{ items: [item(MODULES.home)] }];
  for (const g of MODULE_GROUPS) {
    const items = g.keys.map((k) => MODULES[k]).filter((m) => usable(m, canOperate, isAdmin));
    if (items.length > 0) groups.push({ title: g.title, items: items.map(item) });
  }
  groups.push({ items: [item(MODULES.guide)] });
  return groups;
}

/**
 * シェル（サイドバー）・工場の選択・ガイドの枠を出さない画面。
 * 共通UIの既定（ログイン等）に、使い方の印刷用ページを足す（紙にするページなので要らない）。
 */
const BARE_ROUTES = [
  "/login",
  "/register",
  "/password-reset",
  "/password-reset/confirm",
  GUIDE_PRINT_PATH,
];

/** スクラップアプリのテーマ（銅色、アクティブは角丸＋丸バー）。 */
const ACCENT = "#b4632c";

/**
 * ログアウト。自アプリの Cookie を消してから、ポータルの一括ログアウトへ渡す。
 * ポータル側が各アプリの /api/logout を順に叩くので、全アプリのログインが落ちる。
 * ログアウトボタンと、無操作の自動ログアウト（AppShell の idleLogout）から呼ぶ。
 */
function logoutToPortal() {
  void signOut({ redirect: false }).then(() => {
    window.location.href = "https://portal.paloma-pf.com/?logout=1";
  });
}

/** ログインユーザー表示とログアウト。next-auth 依存のためアプリ側に置く。 */
function UserFooter({ user }: { user: SidebarUser }) {
  const { data: session } = useSession();
  if (!session?.user) return null;
  return (
    <div className="mt-auto border-t border-[#e5e5e5] px-4 py-3">
      {/* 所属・氏名・権限・データ範囲。値はすべてポータル由来（layout.tsx でサーバー側から渡す） */}
      <UserIdentity
        affiliation={user.affiliation}
        name={session.user.name ?? ""}
        role={user.role}
        scope={user.scope}
        scopeWarning={user.scopeWarning}
      />
      {/* ポータルのお問い合わせフォーム（このアプリを選択した状態で開く） */}
      <a
        href="https://portal.paloma-pf.com/?contact=scrap"
        target="_blank"
        rel="noopener noreferrer"
        className="mb-2 flex w-full items-center justify-center gap-2 rounded-lg border border-[#e5e5e5] px-3 py-2 text-xs font-medium text-[#555555] hover:bg-[#f7f7f5]"
      >
        <Mail className="h-4 w-4" />
        お問い合わせ
      </a>
      <button
        onClick={logoutToPortal}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-[#e5e5e5] px-3 py-2 text-xs font-medium text-[#555555] hover:bg-[#f7f7f5]"
      >
        <LogOut className="h-4 w-4" />
        ログアウト
      </button>
    </div>
  );
}

/**
 * スクラップアプリのシェル。共通の @paloma-pf/ui の AppShell に、
 * このアプリ固有のナビ・テーマ・ユーザー情報を差し込む。
 */
export default function AppShell({
  children,
  user,
  canOperate,
  guideAudience,
}: {
  children: React.ReactNode;
  /** サイドバーに出すログインユーザー情報（所属・権限・データ範囲）。 */
  user: SidebarUser;
  /**
   * マスタ・取込・調達入力を使えるか（生産管理部・調達部のメンバーと管理者）。
   * 部署はJWTに載せていないため、layout.tsx がサーバー側で判定して渡す。
   */
  canOperate: boolean;
  /** 作業しながら見るガイドに出すスライドの条件（layout.tsx がサーバー側で決める。使い方ページと同じ規則） */
  guideAudience: GuideAudience;
}) {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const isAdmin = session?.user?.role === "admin";
  // ログインしている通常の画面だけ、まず工場を選ばせる（ログイン・パスワード再設定・印刷用ページでは出さない）。
  // ガイドの枠も同じ画面だけに出す
  const factoryEnabled = status === "authenticated" && !BARE_ROUTES.includes(pathname);
  return (
    // 作業しながら見るガイドの枠。シェルの外側に置き、画面を移っても開いたままにする
    <GuidePanelProvider enabled={factoryEnabled} audience={guideAudience}>
      <BaseAppShell
        nav={navFor(canOperate, isAdmin)}
        bareRoutes={BARE_ROUTES}
        brand={{ eyebrow: "株式会社パロマ", title: "PFスクラップ管理" }}
        isAdmin={isAdmin}
        accent={ACCENT}
        navIndicator="pill"
        background="#f7f7f5"
        // 無操作の自動ログアウトは継続するが、切替 UI(共用/個人・表示モード)は出さない。
        // 端末種別の扱いはポータルログイン時点で対応する方針(サイドバーの圧迫防止)
        idleLogout={{ onTimeout: logoutToPortal, deviceKindSwitch: false }}
        viewModeSwitch={false}
        // 「ガイド」ボタン。PCはサイドバーの上、スマホは上の帯（どちらかしか見えない）
        sidebarTop={<GuideToggle variant="sidebar" />}
        headerRight={<GuideToggle variant="header" />}
        sidebarFooter={<UserFooter user={user} />}
      >
        <FactoryProvider enabled={factoryEnabled}>{children}</FactoryProvider>
      </BaseAppShell>
    </GuidePanelProvider>
  );
}
