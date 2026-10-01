import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireEntitledSession, getFactoryRestriction } from "@/lib/session";
import { insertQualitySheet } from "@/lib/db";
import { QUALITY_SHEET_MAX_BYTES } from "@/lib/scrapTypes";
import { normYm } from "@/lib/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/quality-sheets — 品質チェックシート（PDF）を1件取り込む。
 *
 * 受け取り: multipart/form-data { file: PDF, ym: "2026-09", factory?: "大口工場" }
 * 返し    : { id, duplicate, fileName, sizeBytes, factory, ym, uploadedAt }
 *
 * 画面は複数ファイルを1件ずつこのAPIに送る（1リクエスト1ファイル）。
 * まとめて送らないのは、Vercel の関数がリクエスト本文 4.5MB までで、
 * 1件失敗しても他を取り込めるようにするため。
 * 同じ内容のPDFが既にあれば保存せず duplicate: true を返す（エラーにはしない）。
 */

/** ファイル名はパス部分を落とし、制御文字を除いて長さを抑える（表示・ダウンロード名に使う）。 */
function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\x00-\x1f\x7f]/g, "").trim();
  const safe = cleaned || "チェックシート.pdf";
  return safe.length > 200 ? safe.slice(0, 200) : safe;
}

/**
 * 中身がPDFか。拡張子や Content-Type は端末側でいくらでも変えられるので、
 * 先頭付近の "%PDF-" で判定する（仕様では先頭1024バイト以内にヘッダがある）。
 */
function looksLikePdf(buf: Buffer): boolean {
  const head = buf.subarray(0, 1024).toString("latin1");
  return head.includes("%PDF-");
}

export async function POST(req: NextRequest) {
  let s;
  try {
    s = await requireEntitledSession();
  } catch {
    return NextResponse.json({ message: "ログインが必要です" }, { status: 401 });
  }

  // 本文を読む前に大きさで弾く（multipart のオーバーヘッド分は少し余裕を見る）
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > QUALITY_SHEET_MAX_BYTES + 64 * 1024) {
    return NextResponse.json(
      { message: `1ファイル ${QUALITY_SHEET_MAX_BYTES / 1024 / 1024}MB までです` },
      { status: 413 }
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ message: "リクエストが不正です" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof Blob)) {
    return NextResponse.json({ message: "ファイルがありません" }, { status: 400 });
  }
  const ym = normYm(form.get("ym"));
  if (!ym) {
    return NextResponse.json({ message: "対象年月が不正です" }, { status: 400 });
  }

  // 工場は所属で固定（他工場の記録として残されないように）
  const restriction = await getFactoryRestriction(s);
  const factory =
    restriction.restricted && restriction.factory
      ? restriction.factory
      : String(form.get("factory") ?? "").trim().slice(0, 50);

  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.length === 0) {
    return NextResponse.json({ message: "空のファイルです" }, { status: 400 });
  }
  if (buf.length > QUALITY_SHEET_MAX_BYTES) {
    return NextResponse.json(
      { message: `1ファイル ${QUALITY_SHEET_MAX_BYTES / 1024 / 1024}MB までです` },
      { status: 413 }
    );
  }
  if (!looksLikePdf(buf)) {
    return NextResponse.json({ message: "PDFではありません" }, { status: 400 });
  }

  const fileName = cleanFileName(
    typeof (file as File).name === "string" ? (file as File).name : "チェックシート.pdf"
  );
  const sha256 = createHash("sha256").update(buf).digest("hex");

  try {
    const { sheet, duplicate } = await insertQualitySheet(s.companyId, {
      factory,
      ym,
      fileName,
      sha256,
      content: buf,
      uploadedBy: s.userName,
      uploadedById: s.userId,
    });
    return NextResponse.json({
      id: sheet.id,
      duplicate,
      fileName: sheet.fileName,
      sizeBytes: sheet.sizeBytes,
      factory: sheet.factory,
      ym: sheet.ym,
      uploadedAt: sheet.uploadedAt,
      message: duplicate
        ? `同じ内容のPDFが取込済みです（${sheet.ym} ${sheet.factory || "工場未設定"} / ${sheet.fileName}）`
        : "",
    });
  } catch (e) {
    console.error("[quality-sheets] insert failed:", e);
    return NextResponse.json({ message: "保存に失敗しました" }, { status: 500 });
  }
}
