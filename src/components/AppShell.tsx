"use client";

import { useSession, signOut } from "next-auth/react";
import {
  LayoutDashboard,
  ClipboardList,
  Scale,
  Package,
  Download,
  CalendarRange,
  BarChart3,
  QrCode,
  Settings,
  LogOut,
  Mail,
} from "lucide-react";
import { AppShell as BaseAppShell, UserIdentity, type NavItem } from "@paloma-pf/ui";
import type { SidebarUser } from "@/lib/sidebarUser";

/** 全員が使うナビ（日次記録・月間集計・初品測定・照合の閲覧）。 */
const NAV_COMMON: NavItem[] = [
  { href: "/", label: "照合ダッシュボード", icon: LayoutDashboard },
  { href: "/daily", label: "日次記録", icon: ClipboardList },
  { href: "/summary", label: "月間集計", icon: BarChart3 },
  { href: "/first", label: "初品重量測定", icon: Scale },
];

/**
 * 生産管理部・調達部のメンバーと管理者だけが使うナビ。
 * 権限が無い人にはタブごと出さない（サーバー側でも requireOperations* で必ず防ぐ）。
 */
const NAV_OPERATIONS: NavItem[] = [
  { href: "/procurement", label: "調達入力", icon: CalendarRange },
  { href: "/items", label: "品目マスター", icon: Package },
  { href: "/scales", label: "重量計マスター", icon: QrCode },
  { href: "/mcframe", label: "McFrame取込", icon: Download },
  { href: "/settings", label: "設定", icon: Settings },
];

/** 表示順は 照合 → 日次記録 → 月間集計 → 調達入力 → 初品測定 → マスタ類。 */
function navFor(canOperate: boolean): NavItem[] {
  if (!canOperate) return NAV_COMMON;
  const [dashboard, daily, summary, first] = NAV_COMMON;
  const [procurement, ...masters] = NAV_OPERATIONS;
  return [dashboard, daily, summary, procurement, first, ...masters];
}

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
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "admin";
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
      {children}
    </BaseAppShell>
  );
}
