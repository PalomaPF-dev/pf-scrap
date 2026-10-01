import { NextRequest, NextResponse } from "next/server";
import { requireEntitledSession, getFactoryRestriction, type AppSession } from "@/lib/session";
import { deleteQualitySheet, getQualitySheet, getQualitySheetContent } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET    /api/quality-sheets/[id]            — PDF をブラウザで開く（?download=1 で保存）
 * DELETE /api/quality-sheets/[id]            — 取り消し（管理者 or 取り込んだ本人）
 *
 * どちらも自社のIDだけ。所属工場が設定されている人は自工場のものだけ（他工場は 404）。
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadSession(): Promise<AppSession | null> {
  try {
    return await requireEntitledSession();
  } catch {
    return null;
  }
}

/** 所属工場の制限にかかっていれば true（見せない・消させない）。 */
async function outOfScope(s: AppSession, factory: string): Promise<boolean> {
  const r = await getFactoryRestriction(s);
  return r.restricted && r.factory !== factory;
}

/**
 * Content-Disposition のファイル名。日本語名は RFC 5987 の filename* で渡し、
 * 古い環境向けに ASCII だけの filename も添える。
 */
function contentDisposition(kind: "inline" | "attachment", fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_") || "sheet.pdf";
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const s = await loadSession();
  if (!s) return NextResponse.json({ message: "ログインが必要です" }, { status: 401 });

  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ message: "見つかりません" }, { status: 404 });

  const found = await getQualitySheetContent(s.companyId, id).catch((e) => {
    console.error("[quality-sheets] load failed:", e);
    return null;
  });
  if (!found || (await outOfScope(s, found.meta.factory))) {
    return NextResponse.json({ message: "見つかりません" }, { status: 404 });
  }

  const download = req.nextUrl.searchParams.get("download") === "1";
  return new NextResponse(new Uint8Array(found.content), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(found.content.length),
      "Content-Disposition": contentDisposition(download ? "attachment" : "inline", found.meta.fileName),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const s = await loadSession();
  if (!s) return NextResponse.json({ message: "ログインが必要です" }, { status: 401 });

  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ message: "見つかりません" }, { status: 404 });

  const meta = await getQualitySheet(s.companyId, id).catch((e) => {
    console.error("[quality-sheets] lookup failed:", e);
    return null;
  });
  if (!meta || (await outOfScope(s, meta.factory))) {
    return NextResponse.json({ message: "見つかりません" }, { status: 404 });
  }
  // 消せるのは管理者と、取り込んだ本人だけ（誤って落とした分の取り消し用）
  if (s.role !== "admin" && meta.uploadedById !== s.userId) {
    return NextResponse.json(
      { message: "削除できるのは管理者と、取り込んだ本人だけです" },
      { status: 403 }
    );
  }

  try {
    await deleteQualitySheet(s.companyId, id);
  } catch (e) {
    console.error("[quality-sheets] delete failed:", e);
    return NextResponse.json({ message: "削除に失敗しました" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
