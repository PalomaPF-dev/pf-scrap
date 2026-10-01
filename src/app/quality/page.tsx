import Link from "next/link";
import { Table2 } from "lucide-react";
import { requireAdminPage, getFactoryView } from "@/lib/session";
import { listFactoryOptions } from "@/lib/db";
import PageHeader from "@/components/PageHeader";
import DbErrorState from "@/components/DbErrorState";
import ScaleFactoryFilter from "@/components/ScaleFactoryFilter";
import CheckSheetImport from "@/components/CheckSheetImport";

export const dynamic = "force-dynamic";

/**
 * 品質チェックシート（PDF）から初品重量を一括登録する画面（管理者のみ）。
 * ファイルサーバーの月フォルダ（…\02_PDF\2026\202609）のPDFを、フォルダごと
 * ドラッグ＆ドロップして読み、備考欄の完成品重量を初品測定として登録する。
 * PDFはブラウザ内で読み、ファイル自体は保存しない。
 * 工場は品目マスターとの照合に使う。所属工場・上部で選んだ工場があればそれに固定。
 */
export default async function QualityPage({
  searchParams,
}: {
  searchParams: Promise<{ factory?: string }>;
}) {
  const session = await requireAdminPage();
  const sp = await searchParams;

  let factoryOptions: string[];
  let factoryLocked: boolean;
  let factory: string;
  try {
    const view = await getFactoryView(session);
    const factories = await listFactoryOptions(session.companyId);
    factoryLocked = view.restricted;
    factoryOptions = factoryLocked ? [view.factory!] : factories;
    factory = factoryLocked ? view.factory! : (sp.factory ?? "").trim() || factoryOptions[0] || "";
  } catch (e) {
    console.error("[quality]", e);
    return (
      <div className="p-4 sm:p-6">
        <PageHeader title="品質チェックシート取込" />
        <DbErrorState />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="品質チェックシート取込"
        description="内胴ベンダーなどの品質チェックシート（PDF）をまとめてドラッグ＆ドロップすると、備考欄に書かれた完成品重量を読み取り、加工日×図番の初品測定として登録します。ファイル自体は保存しません。"
        action={
          <Link
            href="/first-list"
            className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-white px-3 text-sm font-medium text-[#555555] hover:bg-[#f7f7f5]"
          >
            <Table2 className="h-4 w-4" />
            初品測定一覧
          </Link>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <ScaleFactoryFilter
          factory={factory}
          factoryOptions={factoryOptions}
          factoryLocked={factoryLocked}
        />
        {!factoryLocked && (
          <span className="text-xs text-[#707070]">図番の照合に使う品目マスターの工場です</span>
        )}
      </div>

      <CheckSheetImport key={factory} factory={factory} standalone />
    </div>
  );
}
