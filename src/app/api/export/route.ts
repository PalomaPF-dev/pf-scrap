import { NextRequest, NextResponse } from "next/server";
import { canUseOperations, getSessionWithRole } from "@/lib/session";
import {
  DAILY_STATUS_LABEL,
  listDailyAgg,
  listItems,
  listScales,
  listScrapKinds,
} from "@/lib/db";
import { monthlyItemRows, yearSummary } from "@/lib/calc";
import { toCsv } from "@/lib/csv";
import { isYmStr } from "@/lib/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * CSV出力（記録保管・報告用）。
 *   GET /api/export?type=daily&ym=YYYY-MM     … 日次記録の月間集計
 *   GET /api/export?type=mcframe&ym=YYYY-MM   … 品目別の理論スクラップ計算結果
 *   GET /api/export?type=recon&year=YYYY      … 年間照合一覧
 *   GET /api/export?type=items                … 品目マスター（管理者のみ）
 * UTF-8 BOM 付き（Excel でそのまま開ける）。
 */

const pct = (v: number | null): string => (v === null ? "" : (v * 100).toFixed(2) + "%");

function csvResponse(filename: string, rows: (string | number | null | undefined)[][]): NextResponse {
  return new NextResponse("\uFEFF" + toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(req: NextRequest) {
  const s = await getSessionWithRole();
  if (!s) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  // マスタ・取込の出力は、画面と同じく生産管理部・調達部のメンバーと管理者だけ
  const canOperate = () =>
    canUseOperations({
      companyId: s.companyId,
      userId: s.userId,
      role: (s.role ?? "member") as "admin" | "member" | "worker",
      isDemo: s.isDemo,
    });
  const denied = NextResponse.json(
    { message: "生産管理部・調達部のメンバーと管理者のみ出力できます" },
    { status: 403 }
  );

  const type = req.nextUrl.searchParams.get("type") ?? "";
  const ymParam = req.nextUrl.searchParams.get("ym") ?? "";
  const factoryParam = (req.nextUrl.searchParams.get("factory") ?? "").trim();
  const kindParam = (req.nextUrl.searchParams.get("kind") ?? "").trim();
  const yearParam = Number(req.nextUrl.searchParams.get("year"));

  try {
    if (type === "daily") {
      if (!isYmStr(ymParam)) return NextResponse.json({ message: "ymが必要です" }, { status: 400 });
      // 所属工場ユーザーは自工場分のみ（画面と同じ範囲）。それ以外は ?factory= の絞り込みに従う。
      const restrictedFactory = s.isDemo ? null : s.factory;
      const factory = restrictedFactory ?? (factoryParam || null);
      const [agg, kinds] = await Promise.all([
        listDailyAgg(s.companyId, ymParam, factory),
        listScrapKinds(s.companyId),
      ]);
      // 種類は設定で増やせるので、列もマスタから作る（マスタに無い種類は末尾）
      const kindNames = [
        ...kinds.map((k) => k.name),
        ...[...new Set(agg.flatMap((r) => Object.keys(r.byKind)))]
          .filter((n) => !kinds.some((k) => k.name === n))
          .sort(),
      ];
      // 月間集計画面と同じ絞り込み。種類を指定したときは、その種類の列と投入があった日だけ出す
      const kind = kindNames.includes(kindParam) ? kindParam : "";
      const kindCols = kind ? [kind] : kindNames;
      const days = kind ? agg.filter((r) => (r.byKind[kind] ?? 0) !== 0) : agg;
      const rows: (string | number | null)[][] = [
        kind
          ? ["日付", "工場", "責任者", `${kind}(kg)`, "状態", "承認者"]
          : ["日付", "工場", "責任者", ...kindCols.map((n) => `${n}(kg)`), "合計(kg)", "回収箱測定値", "差異率", "状態", "承認者", "異常件数"],
      ];
      for (const r of days) {
        const sai =
          r.kaishuSokuteichi !== null && r.total > 0
            ? (r.kaishuSokuteichi - r.total) / r.total
            : null;
        rows.push(
          kind
            ? [r.recordDate, r.factory, r.sekininsha, r.byKind[kind] ?? 0, DAILY_STATUS_LABEL[r.status], r.approvedBy]
            : [
                r.recordDate,
                r.factory,
                r.sekininsha,
                ...kindCols.map((n) => r.byKind[n] ?? 0),
                r.total,
                r.kaishuSokuteichi ?? "",
                pct(sai),
                DAILY_STATUS_LABEL[r.status],
                r.approvedBy,
                r.ijoCount || "",
              ]
        );
      }
      // ファイル名で絞り込み条件が分かるようにする（複数の条件で出しても取り違えない）
      const suffix = [factory, kind].filter(Boolean).join("_");
      return csvResponse(`日次記録集計_${ymParam}${suffix ? `_${suffix}` : ""}.csv`, rows);
    }

    if (type === "mcframe") {
      // McFrame取込の画面と同じ権限（品目別の計算結果）
      if (!(await canOperate())) return denied;
      if (!isYmStr(ymParam)) return NextResponse.json({ message: "ymが必要です" }, { status: 400 });
      const items = await monthlyItemRows(s.companyId, ymParam);
      const rows: (string | number | null)[][] = [
        ["品目CD", "格納場所CD", "品名", "区分", "加工数", "単品完成重量(kg)", "重量根拠", "完成重量(kg)", "使用量(kg)", "理論スクラップ(kg)"],
      ];
      for (const r of items) {
        rows.push([
          r.hinmokuCD,
          r.kakunoCD,
          r.hinmei ?? "",
          r.kubun,
          r.qty,
          r.unitFinished,
          r.unitSource + (r.faDate ? ` ${r.faDate}` : ""),
          r.finished,
          r.usage,
          r.scrap,
        ]);
      }
      return csvResponse(`品目別理論スクラップ_${ymParam}.csv`, rows);
    }

    if (type === "recon") {
      const year =
        Number.isInteger(yearParam) && yearParam >= 2000 && yearParam <= 2100
          ? yearParam
          : new Date().getFullYear();
      const factoryParam = (req.nextUrl.searchParams.get("factory") ?? "").trim() || null;
      const years = await yearSummary(s.companyId, year, factoryParam);
      const rows: (string | number | null)[][] = [
        ["年月", "月初在庫", "購入重量", "使用量", "構成重量", "完成重量", "理論SCP", "SCP売量", "日次記録SCP", "売量vs理論", "売却vs日次記録"],
      ];
      for (const r of years) {
        rows.push([
          r.ym,
          r.zaiko ?? "",
          r.konyu ?? "",
          r.usage ?? "",
          r.usageBom ?? "",
          r.finished ?? "",
          r.scrapTheo ?? "",
          r.baikyaku ?? "",
          r.daily ?? "",
          r.diff7sell ?? "",
          r.diff6 ?? "",
        ]);
      }
      return csvResponse(`月次照合_${year}.csv`, rows);
    }

    if (type === "items") {
      // マスタの出力はマスタ編集と同じ権限
      if (!(await canOperate())) return denied;
      // 画面の絞り込み（工場・製造場所・検索語）をそのまま出力に反映する
      const itemFactory = (req.nextUrl.searchParams.get("factory") ?? "").trim() || null;
      const itemWorkplace = (req.nextUrl.searchParams.get("workplace") ?? "").trim() || null;
      const itemQ = (req.nextUrl.searchParams.get("q") ?? "").trim();
      const { items } = await listItems(s.companyId, {
        q: itemQ,
        factory: itemFactory,
        workplace: itemWorkplace,
        limit: 2000,
      });
      const rows: (string | number | null)[][] = [
        ["品目CD", "格納場所CD", "格納場所名", "品名", "区分", "親図番", "親品名", "子図番", "子品名", "単位", "構成重量", "完成重量(理論)", "製造場所CD", "製造場所名", "工場"],
      ];
      for (const it of items) {
        rows.push([
          it.kanriZuban,
          it.kakunoCD,
          it.kakunoMei,
          it.hinmei,
          it.kubun,
          it.oyaZuban,
          it.oyaHinmei,
          it.koZuban,
          it.koHinmei,
          it.tani,
          it.koseiJuryo,
          it.kanseiJuryo,
          it.seizoBashoCD,
          it.seizoBashoMei,
          it.factory,
        ]);
      }
      const suffix = [itemFactory, itemWorkplace].filter(Boolean).join("_");
      return csvResponse(`品目マスター${suffix ? "_" + suffix : ""}.csv`, rows);
    }

    if (type === "scales") {
      // テプラ（差し込み印刷）用。QR値の列をQRオブジェクトに割り当てて刷る。
      if (!(await canOperate())) return denied;
      const scaleFactory = (req.nextUrl.searchParams.get("factory") ?? "").trim() || null;
      const scales = await listScales(s.companyId, { factory: scaleFactory });
      const rows: (string | number | null)[][] = [
        ["工場", "設備番号", "名称", "種類", "QR値", "状態"],
      ];
      for (const sc of scales) {
        rows.push([
          sc.factory,
          sc.equipNo,
          sc.name,
          sc.kind,
          sc.qrCode,
          sc.active ? "使用中" : "停止",
        ]);
      }
      return csvResponse(`重量計QR${scaleFactory ? "_" + scaleFactory : ""}.csv`, rows);
    }

    return NextResponse.json({ message: "typeが不正です" }, { status: 400 });
  } catch (e) {
    console.error("[export]", e);
    return NextResponse.json({ message: "出力に失敗しました" }, { status: 500 });
  }
}
