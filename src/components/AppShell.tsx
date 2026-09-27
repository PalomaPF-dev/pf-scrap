"use client";

import { useSession, signOut } from "next-auth/react";
import { usePathname } from "next/navigation";
import { LogOut, Mail } from "lucide-react";
import { AppShell as BaseAppShell, UserIdentity, type NavItem } from "@paloma-pf/ui";
import type { SidebarUser } from "@/lib/sidebarUser";
import { MODULES, usable, type ModuleKey } from "./Modules";
import { FactoryProvider } from "./FactoryScope";

/**
 * サイドバーの並び。名前・アイコンはホーム・使い方と同じ定義（Modules.ts）から作る。
 * 表示順は ホーム → 照合 → 日次記録 → 月間集計 → 調達入力 → 初品測定 → マスタ類 → 使い方。
 * 生産管理部・調達部のメンバーと管理者だけが使う機能（ops）は、権限が無い人にはタブごと出さない
 * （サーバー側でも requireOperations* で必ず防ぐ）。
 */
const NAV_ORDER: ModuleKey[] = [
  "home",
  "dashboard",
  "daily",
  "summary",
  "procurement",
  "first",
  "items",
  "scales",
  "mcframe",
  "settings",
  "guide",
];

function navFor(canOperate: boolean): NavItem[] {
  return NAV_ORDER.map((k) => MODULES[k])
    .filter((m) => usable(m, canOperate))
    .map((m) => ({ href: m.href, label: m.title, icon: m.icon }));
}

/** 工場の選択を出さない画面（@paloma-pf/ui の AppShell がシェルを出さない画面と同じ）。 */
const BARE_ROUTES = ["/login", "/register", "/password-reset", "/password-reset/confirm"];

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
}: {
  children: React.ReactNode;
  /** サイドバーに出すログインユーザー情報（所属・権限・データ範囲）。 */
  user: SidebarUser;
  /**
   * マスタ・取込・調達入力を使えるか（生産管理部・調達部のメンバーと管理者）。
   * 部署はJWTに載せていないため、layout.tsx がサーバー側で判定して渡す。
   */
  canOperate: boolean;
}) {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const isAdmin = session?.user?.role === "admin";
  // ログインしている通常の画面だけ、まず工場を選ばせる（ログイン・パスワード再設定では出さない）
  const factoryEnabled = status === "authenticated" && !BARE_ROUTES.includes(pathname);
  return (
    <BaseAppShell
      nav={navFor(canOperate)}
      brand={{ eyebrow: "株式会社パロマ", title: "PFスクラップ管理" }}
      isAdmin={isAdmin}
      accent={ACCENT}
      navIndicator="pill"
      background="#f7f7f5"
      // 無操作の自動ログアウトは継続するが、切替 UI(共用/個人・表示モード)は出さない。
      // 端末種別の扱いはポータルログイン時点で対応する方針(サイドバーの圧迫防止)
      idleLogout={{ onTimeout: logoutToPortal, deviceKindSwitch: false }}
      viewModeSwitch={false}
      sidebarFooter={<UserFooter user={user} />}
    >
      <FactoryProvider enabled={factoryEnabled}>{children}</FactoryProvider>
    </BaseAppShell>
  );
}
