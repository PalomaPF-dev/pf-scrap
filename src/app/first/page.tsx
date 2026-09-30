import { QrCode } from "lucide-react";
import { requireEntitledSession, getFactoryView } from "@/lib/session";
import {
  countOtherFirstArticles,
  listFactoryOptions,
  listFirstArticles,
  type FirstArticle,
} from "@/lib/db";
import PageHeader from "@/components/PageHeader";
import DbErrorState from "@/components/DbErrorState";
import FirstArticlePanel from "@/components/FirstArticlePanel";
import CheckSheetImport from "@/components/CheckSheetImport";
import FirstArticleImportButton from "@/components/FirstArticleImportButton";

export const dynamic = "force-dynamic";

/**
 * ③ 初品の単品完成品重量の測定。
 * まず工場を選び、品目は職場（製造場所）ごとのQRコード一覧（品目マスターから印刷）を
 * 読み取って呼び出す。測定日・測定者は自動記録。
 * 登録＝管理者への申請となり、承認後に計算へ反映される。
 */
export default async function FirstPage({
  searchParams,
}: {
  searchParams: Promise<{ factory?: string }>;
}) {
  const session = await requireEntitledSession();
  const sp = await searchParams;

  let factoryOptions: string[];
  let factoryLocked: boolean;
  let factory: string;
  let history: FirstArticle[];
  let otherCount = 0;
  let otherPending = 0;
  try {
    // 所属工場ユーザーは自工場、上部で工場を選んだ人はその工場に固定（「全工場」ならここで選べる）
    const restriction = await getFactoryView(session);
    const factories = await listFactoryOptions(session.companyId);
    factoryLocked = restriction.restricted;
    factoryOptions = restriction.restricted ? [restriction.factory!] : factories;
    factory = restriction.restricted
      ? restriction.factory!
      : (sp.factory ?? "").trim() || factoryOptions[0] || "";
    // 一覧は上限つきなので、選択中の工場に出ない件数は別に数える（引き算だと上限でずれる）
    const [scoped, other] = await Promise.all([
      listFirstArticles(session.companyId, 200, factory || null),
      factory ? countOtherFirstArticles(session.companyId, factory) : { total: 0, pending: 0 },
    ]);
    history = scoped;
    otherCount = other.total;
    otherPending = other.pending;
  } catch (e) {
    console.error("[first]", e);
    return (
      <div className="p-4 sm:p-6">
        <PageHeader title="初品重量測定" />
        <DbErrorState />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="初品重量測定"
        description="工場を選び、品目QRコード（職場ごとの一覧表）を読み取って品目を呼び出し、実測完成品重量を登録します。測定日・測定者は自動記録。登録＝管理者への申請となり、承認された値のみ完成重量の計算に採用されます。"
        action={
          session.role === "admin" ? (
            <>
              <a
                href={`/items/qr?factory=${encodeURIComponent(factory)}`}
                className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-white px-3 text-sm font-medium text-[#555555] hover:bg-[#f7f7f5]"
              >
                <QrCode className="h-4 w-4" />
                品目QR一覧を印刷
              </a>
              <FirstArticleImportButton factory={factory} />
            </>
          ) : undefined
        }
      />
      <FirstArticlePanel
        key={factory}
        factory={factory}
        factoryOptions={factoryOptions}
        factoryLocked={factoryLocked}
        history={history}
        otherCount={otherCount}
        otherPending={otherPending}
        userName={session.userName}
        isAdmin={session.role === "admin"}
      />
      {session.role === "admin" && <CheckSheetImport key={`cs-${factory}`} factory={factory} />}
    </div>
  );
}
