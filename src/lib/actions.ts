"use server";

import { revalidatePath } from "next/cache";
import {
  requireEntitledSession,
  requireAdminSession,
  getFactoryRestriction,
} from "./session";
import {
  addAdjustment,
  deleteAdjustment,
  deleteDailyRecord,
  deleteFirstArticle,
  deleteItem,
  deleteScale,
  getDailyRecord,
  getDailyStatus,
  getItemById,
  getMonthlyInput,
  getScaleById,
  getScaleByQr,
  KUBUN_LIST,
  listItems,
  SCALE_KIND_LIST,
  saveDailyRecord,
  saveMonthlyInput,
  updateDailyStatus,
  updateFirstArticleStatus,
  upsertFirstArticle,
  upsertItem,
  bulkUpsertItems,
  upsertMcframeQty,
  upsertMcframeDays,
  upsertProcureDays,
  upsertScale,
  type DailyEntry,
  type McframeDayRow,
  type McframeQtyRow,
  type ProcureDay,
  type Scale,
  type ScrapItem,
} from "./db";
import { isDateStr, isYmStr, normDateStr, normYm, todayStr, toNum, toNumOrNull } from "./format";
import { parseItemRef } from "./scrapTypes";

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
  kakunoCD: string;
  kakunoMei: string;
  factory: string;
}): Promise<ActionResult> {
  try {
    const s = await requireAdminSession();
    const kanriZuban = asStr(input.kanriZuban, 50);
    const seizoBashoCD = asStr(input.seizoBashoCD, 50);
    // 品目は「品目CD × 格納場所CD」の組で識別する。同じ品目CDが工場ごとに
    // 存在するため、格納場所CDが無いと品目を特定できない。
    const kakunoCD = asStr(input.kakunoCD, 50);
    if (!kanriZuban || !kakunoCD) return fail("品目CDと格納場所CDを入力してください。");
    const item: Omit<ScrapItem, "id"> = {
      kanriZuban,
      hinmei: asStr(input.hinmei),
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
      kakunoCD,
      kakunoMei: asStr(input.kakunoMei),
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
    let skipped = 0;
    const clean = [];
    for (const r of rows) {
      const kanriZuban = asStr(r.kanriZuban, 50);
      const seizoBashoCD = asStr(r.seizoBashoCD, 50);
      // 格納場所CDが無いCSV（旧様式）は、製造場所CDで代用して組を作る。
      const kakunoCD = asStr(r.kakunoCD, 50) || seizoBashoCD;
      if (!kanriZuban || !kakunoCD) {
        skipped++;
        continue;
      }
      clean.push({
        kanriZuban,
        hinmei: asStr(r.hinmei),
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
        kakunoCD,
        kakunoMei: asStr(r.kakunoMei),
        factory: asStr(r.factory, 50),
      });
    }
    const count = await bulkUpsertItems(s.companyId, clean);
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
  equipNo: string;
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
      equipNo: asStr(input.equipNo, 50),
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
  /** 箱ごとの朝礼後の累積値（scaleId → kg。文字列で届く） */
  kaishiCum?: Record<string, unknown>;
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

    // 箱ごとの朝礼後の累積値。これがその日の最初の投入の「累積(投入前)」になる。
    const kaishiCum: Record<string, number> = {};
    for (const [k, v] of Object.entries(input.kaishiCum ?? {})) {
      const n = toNumOrNull(v);
      if (n !== null && asStr(k, 50)) kaishiCum[asStr(k, 50)] = n;
    }
    // 累積の連携チェック用。箱ごとに「次に入るはずの投入前累積」を持ち回る。
    const expectedCum = new Map<string, number>(Object.entries(kaishiCum));

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

      // 累積(投入前)は自動値（朝礼後の累積値／同じ箱の直前の投入後累積）が入る。
      // 違う値にするのは訂正なので、理由が無ければ受け付けない（画面と同じ判定をサーバーでも行う）。
      const cumKey = scaleId ?? scaleName;
      const cumBefore = toNumOrNull(e.cumBefore);
      const cumAfter = toNumOrNull(e.cumAfter);
      const cumBeforeReason = asStr(e.cumBeforeReason, 200);
      const auto = expectedCum.get(cumKey);
      const corrected =
        auto !== undefined && cumBefore !== null && Math.abs(cumBefore - auto) > 0.0005;
      if (corrected && !cumBeforeReason) {
        return fail(
          `「${scaleName || cumKey}」の累積(投入前)が自動値 ${auto} kg と違います。訂正する場合は理由を入力してください。`
        );
      }
      // 次の投入に引き継ぐのは、その投入で実際に読み取った投入後累積
      if (cumAfter !== null) expectedCum.set(cumKey, cumAfter);
      else expectedCum.delete(cumKey);

      entries.push({
        jikoku: asStr(e.jikoku, 10),
        hinshu: kind,
        scaleId,
        scaleName,
        grossWeight: gross,
        tareWeight: tare,
        // スクラップ重量はサーバー側で必ず再計算（改ざん・計算ズレ防止）
        weight: Math.round((gross - tare) * 1000) / 1000,
        cumBefore,
        cumAfter,
        // 自動値のままなら理由は残さない（訂正した行だけ理由が入る）
        cumBeforeReason: corrected ? cumBeforeReason : "",
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
      // 始業時スクラップ箱残量は管理者のみが入力できる（一般ユーザーの送信値は無視）
      hakoZanryo: isAdmin ? toNum(input.hakoZanryo) : (prev?.hakoZanryo ?? 0),
      // 朝礼後の累積値は当番が読み取って入力する（残量と違い管理者限定にしない）
      kaishiCum,
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

// ===== ③ 初品重量測定（全員。登録＝管理者へ申請） =====

/**
 * QRコードから品目を引く（初品測定のQR読み取り用）。
 * QR値は「品目CD-格納場所CD」。格納場所CDが付いていない値（品目CDのみ）でも、
 * 選択中の工場で1件に絞れれば受け付ける。
 */
export async function lookupItemByQrAction(code: string, factory?: string | null) {
  const s = await requireEntitledSession();
  const raw = asStr(code, 100);
  if (!raw) return null;
  const { hinmokuCd, kakunoCd } = parseItemRef(raw);
  const f = asStr(factory ?? "", 50) || null;
  const { items } = await listItems(s.companyId, { q: hinmokuCd, factory: f, limit: 50 });
  if (kakunoCd) {
    const hit = items.find((it) => it.kanriZuban === hinmokuCd && it.kakunoCD === kakunoCd);
    if (hit) return hit;
  }
  // 格納場所CD無しの読み取り。工場内で組が1つに決まるときだけ採用する。
  const byCode = items.filter((it) => it.kanriZuban === hinmokuCd);
  const refs = new Set(byCode.map((it) => it.kakunoCD));
  if (byCode.length > 0 && refs.size === 1) return byCode[0];
  return items.find((it) => it.koZuban === raw) ?? null;
}

/**
 * 初品測定の登録。測定日はサーバー側の当日（JST）、測定者はログインユーザーを自動記録。
 * 登録と同時に管理者へ申請（pending）となり、承認された測定値のみ完成重量の計算に採用される。
 */
export async function saveFirstArticleAction(input: {
  hinmokuCD: string;
  kakunoCD: string;
  weight: unknown;
}): Promise<ActionResult> {
  try {
    const s = await requireEntitledSession();
    const hinmokuCD = asStr(input.hinmokuCD, 50);
    const kakunoCD = asStr(input.kakunoCD, 50);
    if (!hinmokuCD || !kakunoCD) return fail("品目を選択してください。");
    const weight = toNum(input.weight);
    if (weight <= 0) return fail("実測完成品重量を入力してください。");
    const measuredOn = todayStr();
    await upsertFirstArticle(s.companyId, {
      measuredOn,
      hinmokuCD,
      kakunoCD,
      weight,
      sokuteisha: s.userName || s.loginId || "",
    });
    revalidatePath("/first");
    revalidatePath("/");
    return {
      ok: true,
      message: `登録し、管理者へ申請しました（${measuredOn} / ${weight} kg）。承認後に計算へ反映されます。`,
    };
  } catch (e) {
    return fail((e as Error).message);
  }
}

export async function deleteFirstArticleAction(
  measuredOn: string,
  hinmokuCD: string,
  kakunoCD: string
): Promise<ActionResult> {
  try {
    const s = await requireEntitledSession();
    if (!isDateStr(measuredOn)) return fail("日付が正しくありません。");
    await deleteFirstArticle(s.companyId, measuredOn, asStr(hinmokuCD, 50), asStr(kakunoCD, 50));
    revalidatePath("/first");
    return { ok: true, message: "削除しました。" };
  } catch (e) {
    return fail((e as Error).message);
  }
}

/** 初品測定の承認（管理者のみ）。承認された値が完成重量の計算に使われる。 */
export async function approveFirstArticleAction(
  measuredOn: string,
  hinmokuCD: string,
  kakunoCD: string
): Promise<ActionResult> {
  try {
    const s = await requireAdminSession();
    if (!isDateStr(measuredOn)) return fail("日付が正しくありません。");
    await updateFirstArticleStatus(s.companyId, measuredOn, asStr(hinmokuCD, 50), asStr(kakunoCD, 50), {
      status: "approved",
      approvedBy: s.userName || s.loginId || "",
    });
    revalidatePath("/first");
    revalidatePath("/");
    return { ok: true, message: "承認しました。計算に反映されます。" };
  } catch (e) {
    return fail((e as Error).message);
  }
}

/** 初品測定の差し戻し（管理者のみ）。 */
export async function rejectFirstArticleAction(
  measuredOn: string,
  hinmokuCD: string,
  kakunoCD: string,
  comment: string
): Promise<ActionResult> {
  try {
    const s = await requireAdminSession();
    if (!isDateStr(measuredOn)) return fail("日付が正しくありません。");
    await updateFirstArticleStatus(s.companyId, measuredOn, asStr(hinmokuCD, 50), asStr(kakunoCD, 50), {
      status: "rejected",
      approvedBy: s.userName || s.loginId || "",
      rejectComment: asStr(comment, 500),
    });
    revalidatePath("/first");
    revalidatePath("/");
    return { ok: true, message: "差し戻しました。" };
  } catch (e) {
    return fail((e as Error).message);
  }
}

// ===== ④ McFrame取込（管理者のみ） =====

/**
 * 加工数CSVの取込。行はクライアント側でパース済み（{ itemKey, date?, ym?, qty }）。
 * 日付があれば日別（scrap_mcframe_days）、年月だけなら月次（scrap_mcframe_qty）に入れる。
 * 日別が入っている月は、月次集計でも日別の合計を使う。
 */
export async function importMcframeAction(
  rows: {
    hinmokuCD?: unknown;
    kakunoCD?: unknown;
    date?: unknown;
    ym?: unknown;
    qty?: unknown;
  }[]
): Promise<ActionResult> {
  try {
    const s = await requireAdminSession();
    if (!Array.isArray(rows) || rows.length === 0) return fail("取込データがありません。");
    if (rows.length > 10000) return fail("一度に取込できるのは10,000行までです。");
    // McFrameの実績は1日に同じ品目が何行も出るため、品目×日付で合計してから取り込む。
    const days = new Map<string, McframeDayRow>();
    const months = new Map<string, McframeQtyRow>();
    let bad = 0;
    for (const r of rows) {
      const hinmokuCD = asStr(r.hinmokuCD, 50);
      const kakunoCD = asStr(r.kakunoCD, 50);
      if (!hinmokuCD || !kakunoCD) {
        bad++;
        continue;
      }
      const qty = toNum(r.qty);
      const qdate = normDateStr(r.date);
      if (qdate) {
        const k = `${qdate}\t${hinmokuCD}\t${kakunoCD}`;
        const prev = days.get(k);
        if (prev) prev.qty += qty;
        else days.set(k, { qdate, hinmokuCD, kakunoCD, qty });
        continue;
      }
      const ym = normYm(r.ym);
      if (!ym) {
        bad++;
        continue;
      }
      const k = `${ym}\t${hinmokuCD}\t${kakunoCD}`;
      const prev = months.get(k);
      if (prev) prev.qty += qty;
      else months.set(k, { ym, hinmokuCD, kakunoCD, qty });
    }
    if (!days.size && !months.size) {
      return fail(
        "品目CD・格納場所CDと日付（または年月）を読み取れる行がありませんでした。日別は「品目CD, 格納場所CD, 日付, 加工数」、過去データ移行の月次は「品目CD, 格納場所CD, 年月, 加工数」の形式です。McFrameの製造実績をそのまま出力したファイルも取り込めます。"
      );
    }
    const dayCount = days.size ? await upsertMcframeDays(s.companyId, [...days.values()]) : 0;
    const monthCount = months.size ? await upsertMcframeQty(s.companyId, [...months.values()]) : 0;
    revalidatePath("/mcframe");
    revalidatePath("/daily");
    revalidatePath("/");
    const parts = [
      dayCount ? `日別 ${dayCount}件` : "",
      monthCount ? `月次 ${monthCount}件` : "",
    ].filter(Boolean);
    return {
      ok: true,
      message: `取込完了: ${parts.join(" / ") || "0件"}（読取不可行: ${bad}件）`,
    };
  } catch (e) {
    return fail((e as Error).message);
  }
}

// ===== ⑤ 調達入力（日次。調達担当者=全員入力可） =====

/** 対象月×工場の日次調達データを一括保存。入力者はログインユーザーを自動記録。 */
export async function saveProcureDaysAction(input: {
  factory: string;
  days: Record<string, unknown>[];
}): Promise<ActionResult> {
  try {
    const s = await requireEntitledSession();
    const factory = asStr(input.factory, 50);
    if (!factory) return fail("工場を選択してください。");
    const restriction = await getFactoryRestriction(s);
    if (restriction.restricted && factory !== restriction.factory) {
      return fail(`所属工場（${restriction.factory}）のデータのみ入力できます。`);
    }
    const rows: Omit<ProcureDay, "recordedBy">[] = [];
    for (const d of Array.isArray(input.days) ? input.days : []) {
      const pdate = asStr(d.pdate, 10);
      if (!isDateStr(pdate)) continue;
      const konyuDojo = toNumOrNull(d.konyuDojo);
      const konyuDokan = toNumOrNull(d.konyuDokan);
      const konyuSonota = toNumOrNull(d.konyuSonota);
      const baikyaku = toNumOrNull(d.baikyaku);
      const note = asStr(d.note, 500);
      // 全て空の日はスキップ（保存対象は値のある日だけ）
      if (
        konyuDojo === null &&
        konyuDokan === null &&
        konyuSonota === null &&
        baikyaku === null &&
        !note
      ) {
        continue;
      }
      rows.push({ pdate, factory, konyuDojo, konyuDokan, konyuSonota, baikyaku, note });
    }
    const count = await upsertProcureDays(s.companyId, rows, s.userName || s.loginId || "");
    revalidatePath("/procurement");
    revalidatePath("/");
    return { ok: true, message: `${count}日分を保存しました。` };
  } catch (e) {
    return fail((e as Error).message);
  }
}

/**
 * 日次調達データのCSV一括取込（週単位でのExcel取込用）。
 * 列: 日付, 工場, 購入_銅条, 購入_銅管, 購入_その他, 売却数量, 備考（1行目ヘッダー可）。
 */
export async function importProcureCsvAction(
  rows: Record<string, unknown>[]
): Promise<ActionResult> {
  try {
    const s = await requireEntitledSession();
    if (!Array.isArray(rows) || rows.length === 0) return fail("取込データがありません。");
    if (rows.length > 5000) return fail("一度に取込できるのは5,000行までです。");
    const restriction = await getFactoryRestriction(s);
    const clean: Omit<ProcureDay, "recordedBy">[] = [];
    let bad = 0;
    for (const r of rows) {
      const pdate = normDateStr(r.pdate);
      const factory = asStr(r.factory, 50);
      if (!pdate || !factory) {
        bad++;
        continue;
      }
      if (restriction.restricted && factory !== restriction.factory) {
        bad++;
        continue;
      }
      clean.push({
        pdate,
        factory,
        konyuDojo: toNumOrNull(r.konyuDojo),
        konyuDokan: toNumOrNull(r.konyuDokan),
        konyuSonota: toNumOrNull(r.konyuSonota),
        baikyaku: toNumOrNull(r.baikyaku),
        note: asStr(r.note, 500),
      });
    }
    const count = await upsertProcureDays(s.companyId, clean, s.userName || s.loginId || "");
    revalidatePath("/procurement");
    revalidatePath("/");
    return { ok: true, message: `取込完了: ${count}日分（読取不可・対象外: ${bad}行）` };
  } catch (e) {
    return fail((e as Error).message);
  }
}

/** 在庫補正の追加（棚卸等。理由必須。入力者はログインユーザー）。 */
export async function addAdjustmentAction(input: {
  adate: string;
  factory: string;
  kubun: string;
  amount: unknown;
  reason: string;
}): Promise<ActionResult> {
  try {
    const s = await requireEntitledSession();
    if (!isDateStr(input.adate)) return fail("日付を入力してください。");
    const factory = asStr(input.factory, 50);
    if (!factory) return fail("工場を選択してください。");
    const restriction = await getFactoryRestriction(s);
    if (restriction.restricted && factory !== restriction.factory) {
      return fail(`所属工場（${restriction.factory}）のデータのみ入力できます。`);
    }
    const reason = asStr(input.reason, 500);
    if (!reason) return fail("補正の理由を入力してください（棚卸差異など）。");
    const amount = toNumOrNull(input.amount);
    if (amount === null || amount === 0) return fail("補正量（±kg）を入力してください。");
    await addAdjustment(s.companyId, {
      adate: input.adate,
      factory,
      kubun: asKubun(input.kubun),
      amount,
      reason,
      recordedBy: s.userName || s.loginId || "",
    });
    revalidatePath("/procurement");
    revalidatePath("/");
    return { ok: true, message: "在庫補正を登録しました。" };
  } catch (e) {
    return fail((e as Error).message);
  }
}

export async function deleteAdjustmentAction(id: string): Promise<ActionResult> {
  try {
    const s = await requireAdminSession();
    await deleteAdjustment(s.companyId, asStr(id, 50));
    revalidatePath("/procurement");
    revalidatePath("/");
    return { ok: true, message: "削除しました。" };
  } catch (e) {
    return fail((e as Error).message);
  }
}

/**
 * 月初在庫アンカー（棚卸で確定した月初在庫）の保存（管理者のみ）。
 * 空欄はアンカー無し＝前月からの理論ロールで自動計算される。
 */
export async function saveMonthlyAnchorAction(input: {
  ym: string;
  factory: string;
  zaikoDojo: unknown;
  zaikoDokan: unknown;
  zaikoSonota: unknown;
}): Promise<ActionResult> {
  try {
    const s = await requireAdminSession();
    if (!isYmStr(input.ym)) return fail("年月が正しくありません。");
    const factory = asStr(input.factory, 50);
    if (!factory) return fail("工場を選択してください。");
    const prev = await getMonthlyInput(s.companyId, input.ym, factory);
    await saveMonthlyInput(s.companyId, {
      ym: input.ym,
      factory,
      zaikoDojo: toNumOrNull(input.zaikoDojo),
      zaikoDokan: toNumOrNull(input.zaikoDokan),
      zaikoSonota: toNumOrNull(input.zaikoSonota),
      konyuDojo: prev?.konyuDojo ?? null,
      konyuDokan: prev?.konyuDokan ?? null,
      konyuSonota: prev?.konyuSonota ?? null,
      baikyaku: prev?.baikyaku ?? null,
    });
    revalidatePath("/procurement");
    revalidatePath("/");
    return { ok: true, message: "月初在庫（棚卸アンカー）を保存しました。" };
  } catch (e) {
    return fail((e as Error).message);
  }
}

/**
 * 月次データのCSV一括取込（過去データ移行用・管理者のみ）。
 * 列: 年月, 工場, 月初在庫_銅条, 月初在庫_銅管, 月初在庫_その他,
 *     購入_銅条, 購入_銅管, 購入_その他, 売却数量（1行目ヘッダー可）。
 */
export async function importMonthlyCsvAction(
  rows: Record<string, unknown>[]
): Promise<ActionResult> {
  try {
    const s = await requireAdminSession();
    if (!Array.isArray(rows) || rows.length === 0) return fail("取込データがありません。");
    if (rows.length > 1000) return fail("一度に取込できるのは1,000行までです。");
    let count = 0;
    let bad = 0;
    for (const r of rows) {
      const ym = normYm(r.ym);
      const factory = asStr(r.factory, 50);
      if (!ym || !factory) {
        bad++;
        continue;
      }
      await saveMonthlyInput(s.companyId, {
        ym,
        factory,
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
    revalidatePath("/procurement");
    revalidatePath("/");
    return { ok: true, message: `月次データ取込完了: ${count}件（読取不可: ${bad}行）` };
  } catch (e) {
    return fail((e as Error).message);
  }
}
