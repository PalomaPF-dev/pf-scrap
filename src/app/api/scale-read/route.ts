import { NextRequest, NextResponse } from "next/server";
import { requireEntitledSession, getFactoryRestriction } from "@/lib/session";
import { getScaleById, getScaleByQr, insertScaleRead } from "@/lib/db";
import { hasAiKey, readScaleDisplay } from "@/lib/aiRead";
import { isDateStr } from "@/lib/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/scale-read — 重量計の表示値をAIで読む。
 *
 * 受け取り: { image: "data:image/jpeg;base64,...", phase, scaleId?, qr?, expected?, recordDate?, factory? }
 * 返し    : { readId, value, digits, confidence, note }
 *
 * 読んだ結果は value が null（読めなかった）でも必ずログに残す。あとで
 * 「AIはこう読んだのに、記録はこうなっている」を突き合わせられるようにするため。
 * APIキーはこのサーバー側だけで使う。
 */

/** 画像は 5MB まで（携帯のカメラ1枚は圧縮後 1MB 未満に収まる）。 */
const MAX_BYTES = 5 * 1024 * 1024;

/** a が b とほぼ同じか（20%以内、最低1kgの余裕）。桁ズレの判定に使う。 */
function near(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(1, Math.abs(b) * 0.2);
}

/**
 * 小数点の見落としは「10倍」「1/10」の誤りになり、しかも数字自体は鮮明なので
 * AIは確信度を高く返してくる。実際に 31.5 を 315 と読む例が出ている。
 *
 * 投入前の表示値は、同じ箱の直前の投入後とほぼ一致するはず。そこで
 * 「そのままでは合わないのに、小数点を1桁ずらすと合う」ときは、桁がずれたと
 * みなして採用しない。プロンプトと違い、こちらは確実に効く。
 */
function looksShifted(value: number, expected: number): boolean {
  if (!Number.isFinite(expected) || expected <= 0) return false;
  if (near(value, expected)) return false;
  return near(value / 10, expected) || near(value * 10, expected);
}

const ALLOWED = {
  "image/jpeg": true,
  "image/png": true,
  "image/webp": true,
} as const;
type Allowed = keyof typeof ALLOWED;

/** data URL を種別と本体に分ける。 */
function parseDataUrl(v: unknown): { mediaType: Allowed; base64: string } | null {
  if (typeof v !== "string") return null;
  const m = /^data:([a-z/+-]+);base64,(.+)$/i.exec(v.trim());
  if (!m) return null;
  const mediaType = m[1].toLowerCase();
  if (!(mediaType in ALLOWED)) return null;
  const base64 = m[2];
  // base64 は元データの約4/3。デコードせずに大きさを弾く。
  if (base64.length * 0.75 > MAX_BYTES) return null;
  return { mediaType: mediaType as Allowed, base64 };
}

export async function POST(req: NextRequest) {
  let s;
  try {
    s = await requireEntitledSession();
  } catch {
    return NextResponse.json({ message: "ログインが必要です" }, { status: 401 });
  }

  if (!hasAiKey()) {
    return NextResponse.json(
      { message: "AI読取が未設定です（ANTHROPIC_API_KEY）。手入力してください。" },
      { status: 503 }
    );
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ message: "リクエストが不正です" }, { status: 400 });
  }

  const img = parseDataUrl((body as Record<string, unknown>).image);
  if (!img) {
    return NextResponse.json(
      { message: "画像を読み取れません（JPEG/PNG/WebP、5MBまで）" },
      { status: 400 }
    );
  }

  const phase = (body as Record<string, unknown>).phase === "after" ? "after" : "before";
  // 直前の投入後の表示値（画面が持っている引き継ぎ値）。桁ズレの検出だけに使う。
  const rawExpected = Number((body as Record<string, unknown>).expected);
  const expected = Number.isFinite(rawExpected) && rawExpected > 0 ? rawExpected : null;
  const scaleId = String((body as Record<string, unknown>).scaleId ?? "").trim() || null;
  const rawDate = String((body as Record<string, unknown>).recordDate ?? "").trim();
  const recordDate = isDateStr(rawDate) ? rawDate : null;

  // 工場は所属で固定（他工場の記録として残されないように）
  const restriction = await getFactoryRestriction(s);
  const factory =
    restriction.restricted && restriction.factory
      ? restriction.factory
      : String((body as Record<string, unknown>).factory ?? "").trim().slice(0, 50);

  // 重量計は自社のものだけ。名称はログのスナップショットに残す。
  // 引き当ては「写真に写っていたQR」を最優先にする。選択中の箱を優先すると、
  // 別の箱を撮ったときに直前の箱の記録になってしまい、監査で追えなくなる。
  // QRが写っていない写真（投入後）だけ、選択中の箱で補う。
  const qr = String((body as Record<string, unknown>).qr ?? "").trim().slice(0, 200);
  let scaleName = "";
  let validScaleId: string | null = null;
  const scale =
    (qr ? await getScaleByQr(s.companyId, qr) : null) ??
    (scaleId ? await getScaleById(s.companyId, scaleId) : null);
  if (scale) {
    validScaleId = scale.id;
    scaleName = scale.name;
  }

  try {
    const result = await readScaleDisplay(img.base64, img.mediaType);

    // 桁ズレの疑いがあれば採用しない。AIが読んだ値そのものはログに残すので、
    // 「AIはこう読んだが桁がずれていた」という事実は後から追える。
    let value = result.value;
    let note = result.note;
    let confidence = result.confidence;
    if (value !== null && expected !== null && looksShifted(value, expected)) {
      note = `小数点の位置が疑わしいため採用しませんでした（読取 ${value} kg / 直前の表示値 ${expected} kg）。表示器に近づいて撮り直すか、手入力してください。`;
      value = null;
      confidence = "low";
    }

    const readId = await insertScaleRead(s.companyId, {
      recordDate,
      factory,
      scaleId: validScaleId,
      scaleName,
      phase,
      // ログにはAIが読んだ値をそのまま残す（採用しなかった理由は note に入る）
      value: result.value,
      digits: result.digits,
      confidence: result.confidence,
      note,
      model: result.model,
      readBy: s.userName || s.loginId || "",
    });
    return NextResponse.json(
      {
        readId,
        value,
        digits: result.digits,
        confidence,
        note,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    console.error("[scale-read]", e);
    return NextResponse.json(
      { message: "読み取りに失敗しました。もう一度撮るか、手入力してください。" },
      { status: 502 }
    );
  }
}
