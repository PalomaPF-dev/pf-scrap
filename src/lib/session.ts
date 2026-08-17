import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "./authOptions";
import { getCompanyEntitlement } from "./entitlement";
import { getUserRoleFactory, isUserDisabled, type UserRole } from "./authDb";

export interface AppSession {
  companyId: string;
  companyName: string;
  userId: string;
  userName: string;
  email: string;
  role: "admin" | "member" | "worker";
  /** 社員番号（記録者の識別子）。旧データ・admin フォールバックは null */
  loginId: string | null;
  /** デモ会社でログイン中か（デモ専用の表示切替に使う） */
  isDemo: boolean;
}

/**
 * ログイン中の会社ID・会社名・ユーザー名・役割を返す。
 * 未ログインなら /login にリダイレクト（Server Component / Server Action 用）。
 */
export async function requireSession(): Promise<AppSession> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.companyId) {
    redirect("/login");
  }
  // ポータルで退職・削除された人は、手元に cookie が残っていてもここで止める。
  // セッションは JWT で取り消せないため、リクエストごとにDBを見る。
  if (await isUserDisabled(session.user.id)) {
    redirect("/login");
  }
  return {
    companyId: session.user.companyId,
    companyName: session.user.companyName,
    userId: session.user.id,
    userName: session.user.name ?? "",
    email: session.user.email ?? "",
    role: session.user.role ?? "admin",
    loginId: session.user.loginId ?? null,
    isDemo: Boolean(session.user.isDemo),
  };
}

/**
 * ログイン＋利用権を要求（社内運用では ON_PREMISE 短絡により常に有効）。
 * 未ログイン・利用権なしは /login にリダイレクト。
 * データを描画/更新する Server Component・Server Action はこれを使う。
 */
export async function requireEntitledSession(): Promise<AppSession> {
  const s = await requireSession();
  let active = true;
  try {
    active = (await getCompanyEntitlement(s.companyId)).active;
  } catch (e) {
    // 利用権チェックの一時失敗で利用を止めない（フェイルオープン）
    console.error("[entitlement] check failed, allowing:", e);
    return s;
  }
  if (!active) {
    redirect("/login");
  }
  return s;
}

/**
 * 管理者（role=admin）のみ許可。マスタ編集・月次入力・取込などの Server Action で使う。
 * 一般ユーザーはエラー（UI 側でもボタンを出さないが、サーバー側でも必ず防ぐ）。
 */
export async function requireAdminSession(): Promise<AppSession> {
  const s = await requireEntitledSession();
  if (s.role !== "admin") {
    throw new Error("この操作は管理者のみ実行できます");
  }
  return s;
}

/**
 * マスタ系ページ用: ログイン＋利用権に加えて管理者（role=admin）を要求。
 * 一般ユーザー（member）は "/" にリダイレクトして描画させない。
 */
export async function requireAdminPage(): Promise<AppSession> {
  const s = await requireEntitledSession();
  if (s.role !== "admin") {
    redirect("/");
  }
  return s;
}

/** リダイレクトせず、未ログインなら null を返す（任意表示用）。 */
export async function getOptionalSession() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.companyId) return null;
  // 失効済みは未ログイン扱い（requireSession と同じ判定）
  if (await isUserDisabled(session.user.id)) return null;
  return session.user;
}

/**
 * ログイン中のセッション＋ユーザーの役割（role）・所属工場（factory）を返す。未ログインなら null。
 * リダイレクトしないので、API route 側で 401/403 を返せる。
 * role・factory は DB から都度取得する（ポータルで変えたら既存セッションでも即時反映される）。
 */
export async function getSessionWithRole(): Promise<{
  companyId: string;
  companyName: string;
  userId: string;
  userName: string;
  email: string;
  isDemo: boolean;
  role: UserRole | null;
  /** 所属工場（NULL=全工場閲覧可） */
  factory: string | null;
  /** ポータル連携の職場名（表示用） */
  workplace: string | null;
} | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.companyId) return null;
  const { role, factory, workplace } = await getUserRoleFactory(
    session.user.companyId,
    session.user.id
  );
  return {
    companyId: session.user.companyId,
    companyName: session.user.companyName,
    userId: session.user.id,
    userName: session.user.name ?? "",
    email: session.user.email ?? "",
    isDemo: Boolean(session.user.isDemo),
    role,
    factory,
    workplace,
  };
}

/** ユーザーの所属工場による表示制限。 */
export interface FactoryRestriction {
  /** true = 所属工場のデータのみ表示（factory に工場名が入る） */
  restricted: boolean;
  /** 制限中の所属工場名。制限なし（工場未設定・デモ）は null */
  factory: string | null;
}

/**
 * ログイン中ユーザーの所属工場による表示制限を返す（共通ヘルパー）。**役割では緩めない**。
 * - users.factory が設定されたユーザーは所属工場のデータのみ閲覧可（**管理者も同じ**）
 * - users.factory 未設定（NULL）のユーザー（ポータル管理者・本部スタッフ等）は全工場閲覧可
 * - デモは無制限
 * factory は DB から都度取得するため、既存セッションにも即時反映される。
 * 照合は日次記録・品目の工場名との文字列一致。
 */
export async function getFactoryRestriction(
  s: Pick<AppSession, "companyId" | "userId" | "isDemo">
): Promise<FactoryRestriction> {
  if (s.isDemo) return { restricted: false, factory: null };
  const { factory } = await getUserRoleFactory(s.companyId, s.userId);
  if (!factory) return { restricted: false, factory: null };
  return { restricted: true, factory };
}
