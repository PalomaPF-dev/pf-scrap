"use server";

import { revalidatePath } from "next/cache";
import {
  requireEntitledSession,
  requireAdminSession,
  getFactoryRestriction,
} from "./session";
import {
  deleteDailyRecord,
  deleteFirstArticle,
  deleteItem,
  deleteScale,
  getDailyRecord,
  getDailyStatus,
  getItemById,
  getScaleById,
  getScaleByQr,
  KUBUN_LIST,
  SCALE_KIND_LIST,
  saveDailyRecord,
  saveMonthlyInput,
  updateDailyStatus,
  upsertFirstArticle,
  upsertItem,
  upsertMcframeQty,
  upsertScale,
  type DailyEntry,
  type Scale,
  type ScrapItem,
} from "./db";
import { isDateStr, isYmStr, normYm, toNum, toNumOrNull } from "./format";

export type ActionResult = { ok: true; message?: string } | { ok: false; message: string };

const fail = (message: string): ActionResult => ({ ok: false, message });

const asStr = (v: unknown, max = 200): string => String(v ?? "").trim().slice(0, max);

const asKubun = (v: unknown): string =>
  (KUBUN_LIST as readonly string[]).includes(String(v)) ? String(v) : "その他";

// ===== ② 品目マスター（管理者のみ） =====

export async function saveItemAction(input: {
  kanriZuban: string;
  hinmei: string;
  kubun: string;
  oyaZuban: string;
  oyaHinmei: string;
  koZuban: string;
  koHinmei: string;
  tani: string;
  koseiJuryo: unknown;
  kanseiJuryo: unknown;
  seizoBashoCD: string;
  seizoBashoMei: string;
  factory: string;
}): Promise<ActionResult> {
  try {
    const s = await requireAdminSession();
    const kanriZuban = asStr(input.kanriZuban, 50);
    const seizoBashoCD = asStr(input.seizoBashoCD, 50);
    if (!kanriZuban || !seizoBashoCD) return fail("管理図番と製造場所CDを入力してください。");
    const item: Omit<ScrapItem, "id"> = {
      kanriZuban,
      hinmei: asStr(input.hinmei),
      // KEY = 管理図番 + 製造場所CD（McFrame の設定に合わせて自動生成）
      key: kanriZuban + seizoBashoCD,
      kubun: asKubun(input.kubun),
      oyaZuban: asStr(input.oyaZuban, 50),
      oyaHinmei: asStr(input.oyaHinmei),
      koZuban: asStr(input.koZuban, 50),
      koHinmei: asStr(input.koHinmei),
      tani: asStr(input.tani, 10) || "K",
      koseiJuryo: toNum(input.koseiJuryo),
      kanseiJuryo: toNum(input.kanseiJuryo),
      seizoBashoCD,
      seizoBashoMei: asStr(input.seizoBashoMei),
      factory: asStr(input.factory, 50),
    };
    await upsertItem(s.companyId, item);
    revalidatePath("/items");
    return { ok: true, message: "保存しました。" };
  } catch (e) {
    return fail((e as Error).message);
  }
}

export async function deleteItemAction(id: string): Promise<ActionResult> {
  try {
    const s = await requireAdminSession();
    const item = await getItemById(s.companyId, id);
    if (!item) return fail("対象の品目が見つかりません。");
    await deleteItem(s.companyId, id);
    revalidatePath("/items");
    return { ok: true, message: "削除しました。" };
  } catch (e) {
    return fail((e as Error).message);
  }
}

/** 品目マスターのCSV一括取込（管理者のみ）。行はクライアント側でパース済み。 */
export async function importItemsAction(
  rows: Record<string, unknown>[]
): Promise<ActionResult> {
  try {
    const s = await requireAdminSession();
    if (!Array.isArray(rows) || rows.length === 0) return fail("取込データがありません。");
    if (rows.length > 5000) return fail("一度に取込できるのは5,000行までです。");
    let count = 0;
    let skipped = 0;
    for (const r of rows) {
      const kanriZuban = asStr(r.kanriZuban, 50);
      const seizoBashoCD = asStr(r.seizoBashoCD, 50);
      let key = asStr(r.key, 100);
      if (!key) key = kanriZuban + seizoBashoCD;
      if (!key) {
        skipped++;
        continue;
      }
      const kz = kanriZuban || (seizoBashoCD && key.endsWith(seizoBashoCD)
        ? key.slice(0, key.length - seizoBashoCD.length)
        : key);
      await upsertItem(s.companyId, {
        kanriZuban: kz,
        hinmei: asStr(r.hinmei),
        key,
        kubun: asKubun(r.kubun),
        oyaZuban: asStr(r.oyaZuban, 50),
        oyaHinmei: asStr(r.oyaHinmei),
        koZuban: asStr(r.koZuban, 50),
        koHinmei: asStr(r.koHinmei),
        tani: asStr(r.tani, 10) || "K",
        koseiJuryo: toNum(r.koseiJuryo),
        kanseiJuryo: toNum(r.kanseiJuryo),
        seizoBashoCD,
        seizoBashoMei: asStr(r.seizoBashoMei),
        factory: asStr(r.factory, 50),
      });
      count++;
    }
    revalidatePath("/items");
    return { ok: true, message: `品目マスター取込完了: ${count}件 / スキップ ${skipped}件` };
  } catch (e) {
    return fail((e as Error).message);
  }
}

// ===== 重量計（スクラップ箱）マスター（管理者のみ） =====

export async function saveScaleAction(input: {
  id?: string | null;
  qrCode: string;
  name: string;
  kind: string;
  factory: string;
  sort: unknown;
  active: boolean;
}): Promise<ActionResult> {
  try {
    const s = await requireAdminSession();
    const qrCode = asStr(input.qrCode, 100);
    const name = asStr(input.name, 100);
    if (!qrCode) return fail("QRコード値を入力してください。");
    if (!name) return fail("名称を入力してください。");
    const kind = (SCALE_KIND_LIST as readonly string[]).includes(String(input.kind))
      ? String(input.kind)
      : "上銅";
    await upsertScale(s.companyId, {
      id: input.id ?? null,
      qrCode,
      name,
      kind,
      factory: asStr(input.factory, 50),
      sort: Math.trunc(toNum(input.sort)),
      active: Boolean(input.active),
    });
    revalidatePath("/scales");
    revalidatePath("/daily");
    return { ok: true, message: "保存しました。" };
  } catch (e) {
    return fail((e as Error).message);
  }
}

export async function deleteScaleAction(id: string): Promise<ActionResult> {
  try {
    const s = await requireAdminSession();
    const scale = await getScaleById(s.companyId, id);
    if (!scale) return fail("対象の重量計が見つかりません。");
    await deleteScale(s.companyId, id);
    revalidatePath("/scales");
    revalidatePath("/daily");
    return { ok: true, message: "削除しました。" };
  } catch (e) {
    return fail((e as Error).message);
  }
}

/** QRコード読み取り結果から重量計を引く（日次記録の箱選択用）。 */
export async function lookupScaleByQrAction(qrCode: string): Promise<Scale | null> {
  const s = await requireEntitledSession();
  const code = asStr(qrCode, 100);
  if (!code) return null;
  return getScaleByQr(s.companyId, code);
}

// ===== ① 日次記録（全員） =====

/** 承認状態による編集可否。申請中・承認済みは記録者は触れない（管理者は可）。 */
async function assertDailyEditable(
  companyId: string,
  recordDate: string,
  factory: string,
  isAdmin: boolean
): Promise<string | null> {
  const status = await getDailyStatus(companyId, recordDate, factory);
  if (status === "pending" && !isAdmin) {
    return "この記録は申請中のため編集できません（管理者の承認待ち）。";
  }
  if (status === "approved" && !isAdmin) {
    return "この記録は承認済みのため編集できません。修正が必要な場合は管理者へ連絡してください。";
  }
  return null;
}

export async function saveDailyRecordAction(input: {
  recordDate: string;
  factory: string;
  sekininsha: string;
  zenjitsuOk: boolean;
  hakoZanryo: unknown;
  kaishuSokuteichi: unknown;
  tonyuKanryo: boolean;
  biko: string;
  /** 明細（クライアントからは数値も文字列で届く。サーバー側で検証・再計算） */
  entries: Record<string, unknown>[];
}): Promise<ActionResult> {
  try {
    const s = await requireEntitledSession();
    if (!isDateStr(input.recordDate)) return fail("日付を入力してください。");
    const factory = asStr(input.factory, 50);
    if (!factory) return fail("工場を入力してください。");
    // 所属工場ユーザーは自工場の記録しか保存できない（サーバー側で必ず防ぐ）
    const restriction = await getFactoryRestriction(s);
    if (restriction.restricted && factory !== restriction.factory) {
      return fail(`所属工場（${restriction.factory}）の記録のみ保存できます。`);
    }
    const isAdmin = s.role === "admin";
    const lockMsg = await assertDailyEditable(s.companyId, input.recordDate, factory, isAdmin);
    if (lockMsg) return fail(lockMsg);

    const prev = await getDailyRecord(s.companyId, input.recordDate, factory);
    const entries: DailyEntry[] = [];
    for (const e of Array.isArray(input.entries) ? input.entries : []) {
      const gross = toNumOrNull(e.grossWeight);
      const tare = toNumOrNull(e.tareWeight);
      if (gross === null && tare === null) continue; // 未入力行はスキップ
      if (gross === null || tare === null) {
        return fail("投入前重量（箱含む）と箱重量（空き箱）の両方を入力してください。");
      }
      if (gross < tare) {
        return fail("投入前重量（箱含む）が箱重量（空き箱）より小さい行があります。");
      }
      // 箱（重量計）のスナップショット。マスターが引ければ名称・種類を採用
      const scaleId = asStr(e.scaleId ?? "", 50) || null;
      let scaleName = asStr(e.scaleName, 100);
      let kind = asStr(e.hinshu, 20);
      if (scaleId) {
        const scale = await getScaleById(s.companyId, scaleId);
        if (scale) {
          scaleName = scale.name;
          kind = scale.kind;
        }
      }
      if (!(SCALE_KIND_LIST as readonly string[]).includes(kind)) kind = "上銅";
      entries.push({
        jikoku: asStr(e.jikoku, 10),
        hinshu: kind,
        scaleId,
        scaleName,
        grossWeight: gross,
        tareWeight: tare,
        // スクラップ重量はサーバー側で必ず再計算（改ざん・計算ズレ防止）
        weight: Math.round((gross - tare) * 1000) / 1000,
        cumBefore: toNumOrNull(e.cumBefore),
        cumAfter: toNumOrNull(e.cumAfter),
        // 記録者はログインユーザーを自動記録（既存行は元の記録者を保持）
        kirokusha: asStr(e.kirokusha, 50) || s.userName || s.loginId || "",
        ijo: asStr(e.ijo),
      });
    }
    await saveDailyRecord(s.companyId, {
      recordDate: input.recordDate,
      factory,
      sekininsha: asStr(input.sekininsha, 50) || s.userName,
      zenjitsuOk: Boolean(input.zenjitsuOk),
      hakoZanryo: toNum(input.hakoZanryo),
      kaishuSokuteichi: toNumOrNull(input.kaishuSokuteichi),
      tonyuKanryo: Boolean(input.tonyuKanryo),
      shonin: prev?.shonin ?? "",
      biko: asStr(input.biko, 2000),
      updatedBy: s.loginId ?? s.userName,
      entries,
    });
    revalidatePath("/daily");
    revalidatePath("/");
    const total = entries.reduce((t, e) => t + e.weight, 0);
    return { ok: true, message: `保存しました（当日合計 ${total.toFixed(1)} kg）。` };
  } catch (e) {
    return fail((e as Error).message);
  }
}

/** 管理者へ申請（保存済みの記録を pending にする）。 */
export async function submitDailyRecordAction(
  recordDate: string,
  factory: string
): Promise<ActionResult> {
  try {
    const s = await requireEntitledSession();
    if (!isDateStr(recordDate)) return fail("日付が正しくありません。");
    const f = asStr(factory, 50);
    const restriction = await getFactoryRestriction(s);
    if (restriction.restricted && f !== restriction.factory) {
      return fail(`所属工場（${restriction.factory}）の記録のみ申請できます。`);
    }
    const rec = await getDailyRecord(s.companyId, recordDate, f);
    if (!rec) return fail("先に記録を保存してください。");
    if (rec.entries.length === 0) return fail("投入記録が1件もありません。記録してから申請してください。");
    if (rec.status === "pending") return fail("すでに申請中です。");
    if (rec.status === "approved") return fail("すでに承認済みです。");
    await updateDailyStatus(s.companyId, recordDate, f, {
      status: "pending",
      appliedBy: s.userName || s.loginId || "",
    });
    revalidatePath("/daily");
    return { ok: true, message: "管理者へ申請しました。承認されるまで編集できません。" };
  } catch (e) {
    return fail((e as Error).message);
  }
}

/** 承認（管理者のみ）。 */
export async function approveDailyRecordAction(
  recordDate: string,
  factory: string
): Promise<ActionResult> {
  try {
    const s = await requireAdminSession();
    if (!isDateStr(recordDate)) return fail("日付が正しくありません。");
    const f = asStr(factory, 50);
    const rec = await getDailyRecord(s.companyId, recordDate, f);
    if (!rec) return fail("対象の記録が見つかりません。");
    if (rec.status !== "pending") return fail("申請中の記録のみ承認できます。");
    await updateDailyStatus(s.companyId, recordDate, f, {
      status: "approved",
      approvedBy: s.userName || s.loginId || "",
    });
    revalidatePath("/daily");
    return { ok: true, message: "承認しました。" };
  } catch (e) {
    return fail((e as Error).message);
  }
}

/** 差し戻し（管理者のみ）。コメント付きで記録者へ返す。 */
export async function rejectDailyRecordAction(
  recordDate: string,
  factory: string,
  comment: string
): Promise<ActionResult> {
  try {
    const s = await requireAdminSession();
    if (!isDateStr(recordDate)) return fail("日付が正しくありません。");
    const f = asStr(factory, 50);
    const rec = await getDailyRecord(s.companyId, recordDate, f);
    if (!rec) return fail("対象の記録が見つかりません。");
    if (rec.status !== "pending" && rec.status !== "approved") {
      return fail("申請中または承認済みの記録のみ差し戻しできます。");
    }
    await updateDailyStatus(s.companyId, recordDate, f, {
      status: "rejected",
      approvedBy: s.userName || s.loginId || "",
      rejectComment: asStr(comment, 500),
    });
    revalidatePath("/daily");
    return { ok: true, message: "差し戻しました。" };
  } catch (e) {
    return fail((e as Error).message);
  }
}

/** 日次記録の削除（管理者のみ）。 */
export async function deleteDailyRecordAction(
  recordDate: string,
  factory: string
): Promise<ActionResult> {
  try {
    const s = await requireAdminSession();
    if (!isDateStr(recordDate)) return fail("日付が正しくありません。");
    await deleteDailyRecord(s.companyId, recordDate, asStr(factory, 50));
    revalidatePath("/daily");
    revalidatePath("/");
    return { ok: true, message: "削除しました。" };
  } catch (e) {
    return fail((e as Error).message);
  }
}

/** 日次記録の読込（フォームの「読込」ボタン用）。 */
export async function loadDailyRecordAction(recordDate: string, factory: string) {
  const s = await requireEntitledSession();
  if (!isDateStr(recordDate)) return null;
  return getDailyRecord(s.companyId, recordDate, asStr(factory, 50));
}

// ===== ③ 初品重量測定（全員） =====

export async function saveFirstArticleAction(input: {
  measuredOn: string;
  itemKey: string;
  weight: unknown;
  sokuteisha: string;
}): Promise<ActionResult> {
  try {
    const s = await requireEntitledSession();
    if (!isDateStr(input.measuredOn)) return fail("測定日を入力してください。");
    const itemKey = asStr(input.itemKey, 100);
    if (!itemKey) return fail("品目を選択してください。");
    const weight = toNum(input.weight);
    if (weight <= 0) return fail("実測完成品重量を入力してください。");
    await upsertFirstArticle(s.companyId, {
      measuredOn: input.measuredOn,
      itemKey,
      weight,
      sokuteisha: asStr(input.sokuteisha, 50) || (s.userName || ""),
    });
    revalidatePath("/first");
    revalidatePath("/");
    return { ok: true, message: "登録しました。" };
  } catch (e) {
    return fail((e as Error).message);
  }
}

export async function deleteFirstArticleAction(
  measuredOn: string,
  itemKey: string
): Promise<ActionResult> {
  try {
    const s = await requireEntitledSession();
    if (!isDateStr(measuredOn)) return fail("日付が正しくありません。");
    await deleteFirstArticle(s.companyId, measuredOn, asStr(itemKey, 100));
    revalidatePath("/first");
    return { ok: true, message: "削除しました。" };
  } catch (e) {
    return fail((e as Error).message);
  }
}

// ===== ④ McFrame取込（管理者のみ） =====

/** 加工数CSVの取込。行はクライアント側でパース済み（{ itemKey, ym, qty }）。 */
export async function importMcframeAction(
  rows: { itemKey?: unknown; ym?: unknown; qty?: unknown }[]
): Promise<ActionResult> {
  try {
    const s = await requireAdminSession();
    if (!Array.isArray(rows) || rows.length === 0) return fail("取込データがありません。");
    if (rows.length > 10000) return fail("一度に取込できるのは10,000行までです。");
    const clean: { ym: string; itemKey: string; qty: number }[] = [];
    let bad = 0;
    for (const r of rows) {
      const itemKey = asStr(r.itemKey, 100);
      const ym = normYm(r.ym);
      if (!itemKey || !ym) {
        bad++;
        continue;
      }
      clean.push({ ym, itemKey, qty: toNum(r.qty) });
    }
    const count = await upsertMcframeQty(s.companyId, clean);
    revalidatePath("/mcframe");
    revalidatePath("/");
    return { ok: true, message: `取込完了: ${count}件（読取不可行: ${bad}件）` };
  } catch (e) {
    return fail((e as Error).message);
  }
}

// ===== ⑤ 月次入力（管理者のみ） =====

export async function saveMonthlyInputsAction(
  rows: { ym: string; [k: string]: unknown }[]
): Promise<ActionResult> {
  try {
    const s = await requireAdminSession();
    if (!Array.isArray(rows)) return fail("保存データがありません。");
    let count = 0;
    for (const r of rows) {
      if (!isYmStr(r.ym)) continue;
      await saveMonthlyInput(s.companyId, {
        ym: r.ym,
        zaikoDojo: toNumOrNull(r.zaikoDojo),
        zaikoDokan: toNumOrNull(r.zaikoDokan),
        zaikoSonota: toNumOrNull(r.zaikoSonota),
        konyuDojo: toNumOrNull(r.konyuDojo),
        konyuDokan: toNumOrNull(r.konyuDokan),
        konyuSonota: toNumOrNull(r.konyuSonota),
        baikyaku: toNumOrNull(r.baikyaku),
      });
      count++;
    }
    revalidatePath("/monthly");
    revalidatePath("/");
    return { ok: true, message: `${count}か月分を保存しました。` };
  } catch (e) {
    return fail((e as Error).message);
  }
}
