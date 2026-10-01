import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { authOptions } from "./authOptions";
import { getCompanyEntitlement } from "./entitlement";
import { ALL_FACTORIES, FACTORY_COOKIE } from "./factoryCookie";
import {
  getUserDepartment,
  getUserRoleFactory,
  isUserDisabled,
  type UserRole,
} from "./authDb";

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

/**
 * 品目マスター・重量計マスター・McFrame取込・調達入力を扱える部署。
 * ポータルの部署名（pf-portal の pf_portal_departments）と同じ表記にすること。
 * 課まで分かれている場合（例「調達部 第一課」）も通るよう、前方一致で判定する。
 */
export const OPERATIONS_DEPARTMENTS = ["生産管理部", "調達部"] as const;

/** 部署名が上記のいずれかか（空白を除いた前方一致）。 */
function isOperationsDepartment(department: string | null): boolean {
  const d = (department ?? "").replace(/[\s　]/g, "");
  if (!d) return false;
  return OPERATIONS_DEPARTMENTS.some((n) => d.startsWith(n.replace(/[\s　]/g, "")));
}

/**
 * マスタ（品目・重量計）・McFrame取込・調達入力を扱えるか。
 * - ポータルの管理者（role=admin）… 初期設定・障害対応のため常に可
 * - 生産管理部 / 調達部 のメンバー … 日常の入力担当なので可
 * - それ以外の部署 … 不可（画面のタブも出さない）
 * 部署はDBから都度読むので、ポータルで異動を反映したら次の描画で効く。
 */
export async function canUseOperations(
  s: Pick<AppSession, "companyId" | "userId" | "role" | "isDemo">
): Promise<boolean> {
  if (s.isDemo) return true;
  if (s.role === "admin") return true;
  try {
    return isOperationsDepartment(await getUserDepartment(s.userId));
  } catch (e) {
    // 部署が引けないときは開けない（誤って全員に見せない）
    console.error("[operations] department lookup failed:", e);
    return false;
  }
}

/**
 * マスタ・取込・調達入力のページ用。権限が無ければ "/" へ戻す。
 * 画面のタブも出さないが、URL直打ちをここで止める。
 */
export async function requireOperationsPage(): Promise<AppSession> {
  const s = await requireEntitledSession();
  if (!(await canUseOperations(s))) {
    redirect("/");
  }
  return s;
}

/** マスタ・取込・調達入力の Server Action 用。権限が無ければエラー。 */
export async function requireOperationsSession(): Promise<AppSession> {
  const s = await requireEntitledSession();
  if (!(await canUseOperations(s))) {
    throw new Error(
      `この操作は${OPERATIONS_DEPARTMENTS.join("・")}のメンバーと管理者のみ実行できます`
    );
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

/** 画面に出すときの工場（所属による制限＋画面上部で選んだ工場）。 */
export interface FactoryView extends FactoryRestriction {
  /**
   * true = この工場に固定して表示する（factory に工場名が入る）。
   * 所属工場の人は所属工場、全工場を見られる人は上部で選んだ工場。
   * 「全工場」を選んだときは false で、各画面の工場フィルタ（?factory=）で絞り込める。
   */
  restricted: boolean;
  factory: string | null;
  /** 全工場を見られる人か（所属工場が未設定・デモ）。上部の「工場を切り替え」を出すかに使う */
  all: boolean;
  /** 所属工場。全工場を見られる人は null */
  home: string | null;
}

/**
 * 画面の表示に使う工場を返す（一覧・ダッシュボード・集計の絞り込みの既定値）。
 * - 所属工場の人: getFactoryRestriction と同じく所属工場に固定（Cookie は見ない）
 * - 全工場を見られる人: 上部で選んだ工場（Cookie）。「全工場」または未選択なら固定しない
 * 見てよい範囲は getFactoryRestriction で決まり、Cookie はその中での絞り込みにしか使わないので、
 * Cookie を書き換えても範囲は広がらない。**書き込みの権限判定には使わない**（getFactoryRestriction を使う）。
 */
export async function getFactoryView(
  s: Pick<AppSession, "companyId" | "userId" | "isDemo">
): Promise<FactoryView> {
  const r = await getFactoryRestriction(s);
  if (r.restricted) return { ...r, all: false, home: r.factory };
  const picked = await readPickedFactory();
  return picked
    ? { restricted: true, factory: picked, all: true, home: null }
    : { restricted: false, factory: null, all: true, home: null };
}

/** 上部で選んだ工場（Cookie）。「全工場」・未選択・壊れた値は null */
async function readPickedFactory(): Promise<string | null> {
  const raw = (await cookies()).get(FACTORY_COOKIE)?.value ?? "";
  if (!raw || raw === ALL_FACTORIES) return null;
  try {
    // 工場名は短いので、長すぎる値は壊れた Cookie として捨てる
    const v = decodeURIComponent(raw).trim();
    return v && v.length <= 50 ? v : null;
  } catch {
    return null;
  }
}
