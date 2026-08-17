import { getUserAffiliation, type UserRole } from "./authDb";
import { getSessionWithRole } from "./session";

/**
 * サイドバー下部に出すログインユーザーの情報。
 * ポータルで所属や権限を変えたら次の描画で反映されるよう、JWT ではなく都度DBから読む。
 */
export interface SidebarUser {
  /** 所属（部署名。工場所属なら「工場名 職場名」）。未連携は null */
  affiliation: string | null;
  /** ポータル由来の役割。'admin' なら「管理者」と出る */
  role: UserRole | null;
  /** このアプリで扱えるデータの範囲の説明。null なら出さない */
  scope: string | null;
  /** scope を注意書き（赤字）にするか */
  scopeWarning: boolean;
}

const EMPTY: SidebarUser = {
  affiliation: null,
  role: null,
  scope: null,
  scopeWarning: false,
};

/** サイドバー用のユーザー情報をまとめて読む。未ログイン・取得失敗は空（表示なし）。 */
export async function loadSidebarUser(): Promise<SidebarUser> {
  try {
    const s = await getSessionWithRole();
    if (!s) return EMPTY;
    const affiliation = await getUserAffiliation(s.userId);
    // 表示制限の規則は session.ts の getFactoryRestriction と同じ。
    // 工場に所属していれば自工場の記録だけ（**管理者も同じ**）。
    // 工場未所属（ポータル管理・本部スタッフ）は全工場を見られる。
    const factory = s.isDemo ? null : s.factory;
    return {
      affiliation,
      role: s.role,
      scope: factory ? `${factory}のデータのみ` : "全工場のデータ",
      scopeWarning: false,
    };
  } catch {
    return EMPTY;
  }
}
