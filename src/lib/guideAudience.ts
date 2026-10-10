import { canUseOperations, type AppSession } from "./session";
import { listShipRoutes } from "./db";
import type { GuideAudience } from "./guideMap";

/**
 * 使い方ガイドで、その人に出すスライドを決める条件（サーバー側で判定する）。
 * 使い方ページ・印刷用ページ・ガイドの枠（layout.tsx からシェルへ渡す）で同じものを使い、
 * 画面ごとに出るスライドが食い違わないようにする。判定は各画面の入口と同じ規則。
 */
export async function loadGuideAudience(
  s: Pick<AppSession, "companyId" | "userId" | "role" | "isDemo">
): Promise<GuideAudience> {
  const [canOperate, routes] = await Promise.all([
    canUseOperations(s),
    // プラ箱のスライドは、工場間の送付を設定している会社だけに出す（引けなければ出さない）
    listShipRoutes(s.companyId).catch(() => []),
  ]);
  return { canOperate, isAdmin: s.role === "admin", useShipments: routes.length > 0 };
}
