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
  getDailyRecord,
  getItemById,
  KUBUN_LIST,
  saveDailyRecord,
  saveMonthlyInput,
  upsertFirstArticle,
  upsertItem,
  upsertMcframeQty,
  type DailyEntry,
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

// ===== ① 日次記録（全員） =====

export async function saveDailyRecordAction(input: {
  recordDate: string;
  factory: string;
  sekininsha: string;
  zenjitsuOk: boolean;
  hakoZanryo: unknown;
  kaishuSokuteichi: unknown;
  tonyuKanryo: boolean;
  shonin: string;
  biko: string;
  entries: Partial<DailyEntry>[];
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
    const entries: DailyEntry[] = (Array.isArray(input.entries) ? input.entries : [])
      .map((e) => ({
        jikoku: asStr(e.jikoku, 10),
        busho: asStr(e.busho, 50),
        kikai: asStr(e.kikai, 50),
        hinshu: asKubun(e.hinshu),
        kotei: asStr(e.kotei, 50),
        weight: toNum(e.weight),
        kirokusha: asStr(e.kirokusha, 50),
        ijo: asStr(e.ijo),
      }))
      .filter((e) => e.weight > 0 || e.jikoku || e.kikai);
    await saveDailyRecord(s.companyId, {
      recordDate: input.recordDate,
      factory,
      sekininsha: asStr(input.sekininsha, 50),
      zenjitsuOk: Boolean(input.zenjitsuOk),
      hakoZanryo: toNum(input.hakoZanryo),
      kaishuSokuteichi: toNumOrNull(input.kaishuSokuteichi),
      tonyuKanryo: Boolean(input.tonyuKanryo),
      shonin: asStr(input.shonin, 50),
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
