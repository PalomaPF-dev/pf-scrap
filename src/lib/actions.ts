"use server";

import { revalidatePath } from "next/cache";
import { getUserAffiliation } from "./authDb";
import {
  requireEntitledSession,
  requireAdminSession,
  requireOperationsSession,
  getFactoryRestriction,
} from "./session";
import {
  addAdjustment,
  clearBagStart,
  closeBag,
  correctBagClose,
  deleteAdjustment,
  deleteEmptyBag,
  deleteDailyRecord,
  deleteFirstArticle,
  deleteItem,
  deleteScale,
  getBagById,
  getBagChainSeeds,
  getBagStart,
  getDailyRecord,
  getDailyStatus,
  getItemById,
  getMonthlyInput,
  getScaleById,
  getScaleReads,
  getScaleByQr,
  importDailyRecord,
  listScales,
  countScrapKindUsage,
  deleteScrapKind,
  getScrapKindById,
  KUBUN_LIST,
  listItems,
  listOpenBags,
  listScrapKinds,
  openBag,
  reopenBag,
  setBagApproval,
  setBagStart,
  syncClosedBagTotals,
  upsertScrapKind,
  SCALE_KIND_LIST,
  saveDailyRecord,
  saveMonthlyInput,
  updateDailyStatus,
  updateFirstArticleStatus,
  upsertFirstArticle,
  bulkUpsertFirstArticles,
  listItemRefs,
  upsertItem,
  bulkUpsertItems,
  upsertMcframeQty,
  upsertMcframeDays,
  upsertProcureDays,
  upsertScale,
  type DailyEntry,
  type ScrapBag,
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

// ===== ② 品目マスター（生産管理部・調達部のメンバーと管理者のみ） =====

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
    const s = await requireOperationsSession();
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
    const s = await requireOperationsSession();
    const item = await getItemById(s.companyId, id);
    if (!item) return fail("対象の品目が見つかりません。");
    await deleteItem(s.companyId, id);
    revalidatePath("/items");
    return { ok: true, message: "削除しました。" };
  } catch (e) {
    return fail((e as Error).message);
  }
}

/** 品目マスターのCSV一括取込（生産管理部・調達部と管理者のみ）。行はクライアント側でパース済み。 */
export async function importItemsAction(
  rows: Record<string, unknown>[]
): Promise<ActionResult> {
  try {
    const s = await requireOperationsSession();
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

// ===== 設定: スクラップ種類マスター（生産管理部・調達部のメンバーと管理者のみ） =====

export async function saveScrapKindAction(input: {
  id?: string | null;
  name: string;
  sort: unknown;
  active: boolean;
}): Promise<ActionResult> {
  try {
    const s = await requireOperationsSession();
    const name = asStr(input.name, 30);
    if (!name) return fail("種類名を入力してください。");
    const kinds = await listScrapKinds(s.companyId);
    // 同じ名前は作れない（日次記録は種類名で集計するため、名前が識別子になる）
    const dup = kinds.find((k) => k.name === name && k.id !== (input.id ?? ""));
    if (dup) return fail(`「${name}」は既に登録されています。`);
    await upsertScrapKind(s.companyId, {
      id: input.id ?? null,
      name,
      sort: Math.trunc(toNum(input.sort)),
      active: Boolean(input.active),
    });
    revalidatePath("/settings");
    revalidatePath("/scales");
    revalidatePath("/daily");
    return { ok: true, message: "保存しました。" };
  } catch (e) {
    return fail((e as Error).message);
  }
}

/**
 * 種類の削除。重量計や過去の記録で使われている種類は消せない
 * （消すと集計名だけが残って対応が取れなくなるため、「使用しない」に変更してもらう）。
 */
export async function deleteScrapKindAction(id: string): Promise<ActionResult> {
  try {
    const s = await requireOperationsSession();
    const kind = await getScrapKindById(s.companyId, id);
    if (!kind) return fail("対象の種類が見つかりません。");
    const used = await countScrapKindUsage(s.companyId, kind.name);
    if (used.scales > 0 || used.entries > 0) {
      return fail(
        `「${kind.name}」は使用中のため削除できません（重量計 ${used.scales}件 / 記録 ${used.entries}件）。` +
          "「使用しない」に切り替えると、新規の選択肢から外れます。"
      );
    }
    await deleteScrapKind(s.companyId, id);
    revalidatePath("/settings");
    revalidatePath("/scales");
    revalidatePath("/daily");
    return { ok: true, message: "削除しました。" };
  } catch (e) {
    return fail((e as Error).message);
  }
}

// ===== 重量計（スクラップ箱）マスター（生産管理部・調達部のメンバーと管理者のみ） =====

/** 正の数だけを受ける（未入力・0・負は null）。重量計の仕様欄で使う。 */
function positiveOrNull(v: unknown): number | null {
  const n = toNumOrNull(v);
  return n !== null && n > 0 ? n : null;
}

export async function saveScaleAction(input: {
  id?: string | null;
  qrCode: string;
  equipNo: string;
  name: string;
  kind: string;
  factory: string;
  sort: unknown;
  active: boolean;
  /** ひょう量（最大） kg。表示器のパネルの印字。空欄可 */
  capacity?: unknown;
  /** 目量（最小表示単位） kg。空欄可 */
  division?: unknown;
  /** 袋を交換する目安 kg。空欄なら既定値 */
  bagTargetKg?: unknown;
}): Promise<ActionResult> {
  try {
    const s = await requireOperationsSession();
    const qrCode = asStr(input.qrCode, 100);
    const name = asStr(input.name, 100);
    if (!qrCode) return fail("QRコード値を入力してください。");
    if (!name) return fail("名称を入力してください。");
    // 種類は設定マスタにあるものだけ受け付ける（先頭を既定にする）
    const kinds = await listScrapKinds(s.companyId, { activeOnly: true });
    const names = kinds.map((k) => k.name);
    const kind = names.includes(String(input.kind))
      ? String(input.kind)
      : names[0] ?? SCALE_KIND_LIST[0];
    await upsertScale(s.companyId, {
      id: input.id ?? null,
      qrCode,
      equipNo: asStr(input.equipNo, 50),
      name,
      kind,
      factory: asStr(input.factory, 50),
      sort: Math.trunc(toNum(input.sort)),
      active: Boolean(input.active),
      // 未入力は null のまま（AI読取で何も仮定しない）。0や負の値は未入力と同じ扱い。
      capacity: positiveOrNull(input.capacity),
      division: positiveOrNull(input.division),
      // 袋の交換の目安。未入力は既定値（BAG_TARGET_KG）を使う
      bagTargetKg: positiveOrNull(input.bagTargetKg),
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
    const s = await requireOperationsSession();
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
  hakoZanryo?: unknown;
  /**
   * 箱ごとの朝礼後の累積値（scaleId → kg。文字列で届く）。
   * 朝礼確認を廃止したので新しい画面からは届かない。省略時は既存値を保つ。
   */
  kaishiCum?: Record<string, unknown>;
  /** 朝礼確認の項目。省略時は既存値を保つ（過去の記録を壊さないため） */
  zenjitsuOk?: boolean;
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
    // 種類は設定マスタにあるものだけ通す。過去の記録に残っている種類名は
    // そのまま活かしたいので、無効なものも含めた全件で判定する。
    const kindNames = (await listScrapKinds(s.companyId)).map((k) => k.name);

    // 箱ごとの朝礼後の累積値。過去の記録では最初の投入の「累積(投入前)」の元になる。
    // 朝礼確認を廃止したので新しい画面からは届かない。届かなければ既存値を保つ。
    let kaishiCum: Record<string, number> = prev?.kaishiCum ?? {};
    if (input.kaishiCum !== undefined) {
      kaishiCum = {};
      for (const [k, v] of Object.entries(input.kaishiCum)) {
        const n = toNumOrNull(v);
        if (n !== null && asStr(k, 50)) kaishiCum[asStr(k, 50)] = n;
      }
    }
    // ===== 袋（スクラップ袋） =====
    // 明細は「その投入が入った袋」を持つ（袋管理より前の明細は null のまま）。
    const bagIds = (Array.isArray(input.entries) ? input.entries : [])
      .map((e) => asStr(e.bagId ?? "", 50))
      .filter(Boolean);
    const bags = new Map<string, ScrapBag>();
    for (const id of new Set(bagIds)) {
      const bag = await getBagById(s.companyId, id);
      if (!bag) return fail("袋が見つかりません。画面を再読み込みしてください。");
      if (bag.factory !== factory) {
        return fail(`袋「${bag.bagNo}」は別の工場（${bag.factory}）のものです。`);
      }
      bags.set(id, bag);
    }
    // 締め済みの袋に新しい投入は足せない。締めた時点の数字が後から変わってしまうため。
    // 既にその袋で保存されている件数を超えたら「足した」と判断する。
    const storedPerBag = new Map<string, number>();
    for (const e of prev?.entries ?? []) {
      if (e.bagId) storedPerBag.set(e.bagId, (storedPerBag.get(e.bagId) ?? 0) + 1);
    }
    const incomingPerBag = new Map<string, number>();
    for (const id of bagIds) incomingPerBag.set(id, (incomingPerBag.get(id) ?? 0) + 1);
    for (const [id, n] of incomingPerBag) {
      const bag = bags.get(id);
      if (bag && bag.status !== "open" && n > (storedPerBag.get(id) ?? 0)) {
        return fail(
          `袋「${bag.bagNo}」は締め済みです。新しい投入は、いま記録中の袋に記録してください。`
        );
      }
    }

    // 累積の連携チェック用。「次に入るはずの投入前の表示値」を持ち回る。
    // 袋がある明細は袋ごと（袋を交換すると表示値が 0 に戻るので、重量計では繋がらない）。
    // 袋管理より前の明細は、従来どおり重量計ごと（キーは scaleId）。
    const expectedCum = new Map<string, number>(Object.entries(kaishiCum));
    // 日をまたいだ袋は前日の最後の投入後を引き継ぐ。まだ投入が無ければ袋の開始値。
    const bagSeeds = await getBagChainSeeds(s.companyId, [...bags.keys()], prev?.id ?? null);
    for (const [id, bag] of bags) expectedCum.set(id, bagSeeds.get(id) ?? bag.startCum);

    // AI読取の値（サーバー側のログ）。採用値がこれと違うときだけ訂正理由を求める。
    // ログはクライアントから書き換えられないので、これが「機械が読んだ事実」になる。
    const readIds = (Array.isArray(input.entries) ? input.entries : [])
      .flatMap((e) => [asStr(e.cumBeforeReadId ?? "", 50), asStr(e.cumAfterReadId ?? "", 50)])
      .filter(Boolean);
    const reads = await getScaleReads(s.companyId, readIds);

    // 記録者の表示名。「大口工場 内胴 大口太郎」のように所属を前に付ける。
    const affiliation = await getUserAffiliation(s.userId);
    const recorder = [affiliation, s.userName || s.loginId || ""].filter(Boolean).join(" ");

    const entries: DailyEntry[] = [];
    for (const e of Array.isArray(input.entries) ? input.entries : []) {
      const gross = toNumOrNull(e.grossWeight);
      const tare = toNumOrNull(e.tareWeight);
      const cumBefore = toNumOrNull(e.cumBefore);
      const cumAfter = toNumOrNull(e.cumAfter);
      // 旧様式の行（投入前重量・箱重量を持つ）。AI読取の導入前に記録されたもの。
      // 再保存で重量が変わらないよう、旧様式は従来どおり ①−② で計算する。
      const legacy = gross !== null || tare !== null;
      if (!legacy && cumBefore === null && cumAfter === null) continue; // 未入力行はスキップ
      if (legacy) {
        if (gross === null || tare === null) {
          return fail("投入前重量（箱含む）と箱重量（空き箱）の両方を入力してください。");
        }
        if (gross < tare) {
          return fail("投入前重量（箱含む）が箱重量（空き箱）より小さい行があります。");
        }
      } else {
        if (cumBefore === null || cumAfter === null) {
          return fail("投入前と投入後の表示値の両方が必要です。読み取るか手入力してください。");
        }
        if (cumAfter < cumBefore) {
          return fail(
            `投入後の表示値（${cumAfter} kg）が投入前（${cumBefore} kg）より小さくなっています。読み取りを確認してください。`
          );
        }
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
      if (!kindNames.includes(kind)) kind = kindNames[0] ?? SCALE_KIND_LIST[0];

      const bagId = asStr(e.bagId ?? "", 50) || null;
      const cumKey = bagId ?? scaleId ?? scaleName;
      const cumBeforeReadId = asStr(e.cumBeforeReadId ?? "", 50) || null;
      const cumAfterReadId = asStr(e.cumAfterReadId ?? "", 50) || null;
      const cumBeforeReason = asStr(e.cumBeforeReason, 200);
      const cumAfterReason = asStr(e.cumAfterReason, 200);

      // 投入前の出どころ: AI読取があればそれ、無ければ連携値（朝礼後の累積／前の投入後）。
      // 「人が機械の値を上書きしたとき」だけ理由を求める。
      const beforeAi = cumBeforeReadId ? reads.get(cumBeforeReadId) : undefined;
      const beforeSource = beforeAi?.value ?? expectedCum.get(cumKey);
      const beforeCorrected =
        beforeSource !== undefined &&
        beforeSource !== null &&
        cumBefore !== null &&
        Math.abs(cumBefore - beforeSource) > 0.0005;
      if (beforeCorrected && !cumBeforeReason) {
        return fail(
          `「${scaleName || cumKey}」の投入前の表示値が${beforeAi ? "AI読取値" : "自動値"} ${beforeSource} kg と違います。訂正する場合は理由を入力してください。`
        );
      }

      // 投入後はAI読取だけが出どころ（連携値は無い）
      const afterAi = cumAfterReadId ? reads.get(cumAfterReadId) : undefined;
      const afterCorrected =
        afterAi?.value !== undefined &&
        afterAi.value !== null &&
        cumAfter !== null &&
        Math.abs(cumAfter - afterAi.value) > 0.0005;
      if (afterCorrected && !cumAfterReason) {
        return fail(
          `「${scaleName || cumKey}」の投入後の表示値がAI読取値 ${afterAi!.value} kg と違います。訂正する場合は理由を入力してください。`
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
        // スクラップ重量はサーバー側で必ず再計算（改ざん・計算ズレ防止）。
        // 新様式は「投入後 − 投入前」。箱は常に重量計に載っているので箱重量は相殺される。
        weight: legacy
          ? Math.round((gross! - tare!) * 1000) / 1000
          : Math.round((cumAfter! - cumBefore!) * 1000) / 1000,
        cumBefore,
        cumAfter,
        // 機械の値のままなら理由は残さない（上書きした行だけ理由が入る）
        cumBeforeReason: beforeCorrected ? cumBeforeReason : "",
        cumAfterReason: afterCorrected ? cumAfterReason : "",
        cumBeforeReadId,
        cumAfterReadId,
        bagId,
        // 記録者は「所属（工場 職場）＋氏名」。ログインユーザーから毎回サーバーで組み立てる。
        // 既存行は元の記録者をそのまま残す（誰が入れたかを後から書き換えない）。
        kirokusha: asStr(e.kirokusha, 120) || recorder,
        ijo: asStr(e.ijo),
        // Excelから取り込んだ行が持つ発生元（部署・機械・品種・工程）。
        // 新しい画面では入力しないが、編集して保存し直しても消えないように持ち回る。
        busho: asStr(e.busho, 50),
        kikai: asStr(e.kikai, 50),
        zairyo: asStr(e.zairyo, 50),
        kotei: asStr(e.kotei, 50),
      });
    }
    await saveDailyRecord(s.companyId, {
      recordDate: input.recordDate,
      factory,
      sekininsha: asStr(input.sekininsha, 50) || s.userName,
      zenjitsuOk: input.zenjitsuOk === undefined ? (prev?.zenjitsuOk ?? false) : Boolean(input.zenjitsuOk),
      // 始業時スクラップ箱残量は管理者のみが入力できる（一般ユーザーの送信値は無視）
      hakoZanryo:
        isAdmin && input.hakoZanryo !== undefined ? toNum(input.hakoZanryo) : (prev?.hakoZanryo ?? 0),
      // 朝礼後の累積値は当番が読み取って入力する（残量と違い管理者限定にしない）
      kaishiCum,
      kaishuSokuteichi: toNumOrNull(input.kaishuSokuteichi),
      tonyuKanryo: Boolean(input.tonyuKanryo),
      shonin: prev?.shonin ?? "",
      biko: asStr(input.biko, 2000),
      updatedBy: s.loginId ?? s.userName,
      entries,
    });
    // 締め済みの袋の合計を取り直す。承認済みの中身が変わっていたら承認を外す
    // （管理者が確認した数字と違うものを、承認済みのままにしない）。
    const revoked = await syncClosedBagTotals(s.companyId, [...bags.keys()]);
    revalidatePath("/daily");
    revalidatePath("/");
    const total = entries.reduce((t, e) => t + e.weight, 0);
    const revokedMsg = revoked.length
      ? `（袋 ${revoked.map((b) => b.bagNo).join("・")} は中身が変わったため承認を外しました。再度承認してください）`
      : "";
    return { ok: true, message: `保存しました（当日合計 ${total.toFixed(1)} kg）。${revokedMsg}` };
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
    // 承認は終礼時に1日1回。記録者からの申請は無くしたので、下書きからそのまま承認する。
    if (rec.status === "approved") return fail("この日はすでに承認されています。");
    // 空の日を承認できてしまうと「確認した」証跡の意味が無くなる
    if (rec.entries.length === 0) {
      return fail("投入の記録が1件もありません。記録されてから承認してください。");
    }
    // 承認者も記録者と同じ規則で「所属＋氏名」を残す
    const affiliation = await getUserAffiliation(s.userId);
    const approver =
      [affiliation, s.userName || s.loginId || ""].filter(Boolean).join(" ") || "承認者";
    await updateDailyStatus(s.companyId, recordDate, f, {
      status: "approved",
      approvedBy: approver,
    });
    revalidatePath("/daily");
    revalidatePath("/summary");
    return { ok: true, message: `${recordDate} の記録を承認しました。` };
  } catch (e) {
    return fail((e as Error).message);
  }
}

/** 承認の取り消し（管理者のみ）。理由つきで記録者へ返し、編集できる状態に戻す。 */
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

// ===== スクラップ袋（交換までを1区切りにする） =====

/**
 * 同じ重量計で袋を二重に開こうとしたときは、DB の部分ユニーク索引が弾く。
 * 現場に出るのは「袋が二重になっている」ことなので、そう読める文言に直す。
 */
function bagErrorMessage(e: unknown): string {
  const code = (e as { code?: string; sourceError?: { code?: string } })?.code
    ?? (e as { sourceError?: { code?: string } })?.sourceError?.code;
  if (code === "23505") {
    return "この重量計では別の袋が記録中です。画面を再読み込みして、記録中の袋を確認してください。";
  }
  return (e as Error).message;
}

/** 記録者・承認者の表示名（所属＋氏名）。日次記録と同じ規則で残す。 */
async function actorName(s: {
  userId: string;
  userName?: string | null;
  loginId?: string | null;
}): Promise<string> {
  const affiliation = await getUserAffiliation(s.userId);
  return [affiliation, s.userName || s.loginId || ""].filter(Boolean).join(" ");
}

/**
 * 袋を開く（新しいカゴ＋袋をセットしたとき）。
 * 通常は風袋引きして 0kg を確認してから始めるので開始の表示値は 0。
 * 使いかけの袋から記録を始めるときだけ、その時点の表示値を入れる。
 */
export async function openBagAction(input: {
  factory: string;
  scaleId: string;
  date: string;
  startCum: unknown;
  /** 風袋引きして 0kg を確認したか（開始が 0 のときは必須） */
  taraOk: boolean;
  note: string;
}): Promise<ActionResult> {
  try {
    const s = await requireEntitledSession();
    if (!isDateStr(input.date)) return fail("日付が正しくありません。");
    const factory = asStr(input.factory, 50);
    if (!factory) return fail("工場を入力してください。");
    const restriction = await getFactoryRestriction(s);
    if (restriction.restricted && factory !== restriction.factory) {
      return fail(`所属工場（${restriction.factory}）の袋のみ開始できます。`);
    }
    const scale = await getScaleById(s.companyId, asStr(input.scaleId, 50));
    if (!scale) return fail("重量計が見つかりません。一覧から選び直してください。");
    const open = await listOpenBags(s.companyId, factory);
    if (open.some((b) => b.scaleId === scale.id)) {
      return fail(
        `「${scale.name}」にはすでに記録中の袋があります。交換するときは「袋を交換する」から締めてください。`
      );
    }
    // 袋運用の開始日より前の日付には袋を作らない。
    // その期間は従来どおり日単位の記録として残す（過去を袋で塗り替えない）。
    const bagStart = await getBagStart(s.companyId, factory);
    const effectiveStart = bagStart.startOn ?? todayStr();
    if (input.date < effectiveStart) {
      return fail(
        `${effectiveStart} から袋単位の管理を始めています。それより前の ${input.date} は日単位の記録なので、袋は開けません。`
      );
    }
    const startCum = toNum(input.startCum);
    if (startCum < 0) return fail("開始の表示値は 0 以上で入力してください。");
    if (startCum === 0 && !input.taraOk) {
      return fail(
        "風袋引きして 0kg を確認してから開始してください。0kg でない場合は、その表示値を入力してください。"
      );
    }
    const bag = await openBag(s.companyId, {
      factory,
      scaleId: scale.id,
      scaleName: scale.name,
      kind: scale.kind,
      openedOn: input.date,
      openedBy: await actorName(s),
      startCum,
      note: asStr(input.note, 500),
    });
    revalidatePath("/daily");
    return {
      ok: true,
      message: `袋 ${bag.bagNo} を開始しました（開始の表示値 ${startCum.toFixed(1)} kg）。`,
    };
  } catch (e) {
    return fail(bagErrorMessage(e));
  }
}

/**
 * 袋を締める（＝交換する）。カゴを降ろす前の表示値がこの袋の重量になる。
 * 続けて次の袋を開くところまでを1回の操作にする（現場の交換と同じ順番）。
 */
export async function closeBagAction(input: {
  bagId: string;
  date: string;
  closeCum: unknown;
  closeCumReadId: string | null;
  closeCumReason: string;
  note: string;
  /** 続けて次の袋を開くか（新しいカゴを載せて風袋引きした直後） */
  openNext: boolean;
  taraOk: boolean;
}): Promise<ActionResult> {
  try {
    const s = await requireEntitledSession();
    if (!isDateStr(input.date)) return fail("日付が正しくありません。");
    const bag = await getBagById(s.companyId, asStr(input.bagId, 50));
    if (!bag) return fail("袋が見つかりません。画面を再読み込みしてください。");
    if (bag.status !== "open") return fail(`袋 ${bag.bagNo} はすでに締められています。`);
    const restriction = await getFactoryRestriction(s);
    if (restriction.restricted && bag.factory !== restriction.factory) {
      return fail(`所属工場（${restriction.factory}）の袋のみ締められます。`);
    }
    if (input.date < bag.openedOn) {
      return fail(`袋 ${bag.bagNo} は ${bag.openedOn} に開いています。それより前の日付では締められません。`);
    }
    const closeCum = toNumOrNull(input.closeCum);
    if (closeCum === null) {
      return fail("交換直前の表示値がありません。カゴを降ろす前に読み取るか、手入力してください。");
    }
    if (closeCum < bag.startCum) {
      return fail(
        `交換直前の表示値（${closeCum} kg）が、この袋の開始の表示値（${bag.startCum} kg）より小さくなっています。読み取りを確認してください。`
      );
    }

    // AI読取の値を人が変えたときは理由を残す（明細の訂正と同じ規則）。
    // 読取ログはサーバーしか書けないので、これが「機械が読んだ事実」になる。
    const readId = asStr(input.closeCumReadId ?? "", 50) || null;
    const reason = asStr(input.closeCumReason, 200);
    if (readId) {
      const reads = await getScaleReads(s.companyId, [readId]);
      const ai = reads.get(readId);
      if (
        ai?.value !== undefined &&
        ai.value !== null &&
        Math.abs(closeCum - ai.value) > 0.0005 &&
        !reason
      ) {
        return fail(
          `交換直前の表示値がAI読取値 ${ai.value} kg と違います。訂正する場合は理由を入力してください。`
        );
      }
    }

    const who = await actorName(s);
    const ok = await closeBag(s.companyId, bag.id, {
      closedOn: input.date,
      closedBy: who,
      closeCum,
      closeCumReadId: readId,
      closeCumReason: reason,
      // 締めた時点の明細合計。保存済みの明細から取る（未保存の投入は含まれない）
      totalWeight: bag.runningTotal,
      note: asStr(input.note, 500),
    });
    if (!ok) return fail("袋を締められませんでした。画面を再読み込みしてください。");

    const weight = Math.round((closeCum - bag.startCum) * 1000) / 1000;
    const gap = Math.round((weight - bag.runningTotal) * 1000) / 1000;
    let message =
      `袋 ${bag.bagNo} を締めました。この袋は ${weight.toFixed(1)} kg でした` +
      `（記録した投入の合計 ${bag.runningTotal.toFixed(1)} kg`;
    message += Math.abs(gap) > 0.0005 ? `／差 ${gap.toFixed(1)} kg）。` : "）。";

    if (input.openNext) {
      if (!input.taraOk) {
        return {
          ok: true,
          message:
            message +
            " 次の袋は開いていません。新しいカゴを載せて風袋引きし、0kg を確認してから「袋を開始する」を押してください。",
        };
      }
      if (!bag.scaleId) return { ok: true, message };
      const next = await openBag(s.companyId, {
        factory: bag.factory,
        scaleId: bag.scaleId,
        scaleName: bag.scaleName,
        kind: bag.kind,
        openedOn: input.date,
        openedBy: who,
        startCum: 0,
        note: "",
      });
      message += ` 続けて袋 ${next.bagNo} を開始しました。`;
    }
    revalidatePath("/daily");
    revalidatePath("/");
    return { ok: true, message };
  } catch (e) {
    return fail(bagErrorMessage(e));
  }
}

/** 袋の締めを承認（管理者のみ）。1日に複数回、袋ごとに確認する。 */
export async function approveBagAction(bagId: string): Promise<ActionResult> {
  try {
    const s = await requireAdminSession();
    const bag = await getBagById(s.companyId, asStr(bagId, 50));
    if (!bag) return fail("袋が見つかりません。");
    if (bag.status === "open") return fail("まだ締められていない袋は承認できません。");
    if (bag.status === "approved") return fail(`袋 ${bag.bagNo} はすでに承認されています。`);
    await setBagApproval(s.companyId, bag.id, {
      status: "approved",
      approvedBy: (await actorName(s)) || "承認者",
    });
    revalidatePath("/daily");
    revalidatePath("/summary");
    return { ok: true, message: `袋 ${bag.bagNo} を承認しました。` };
  } catch (e) {
    return fail((e as Error).message);
  }
}

/**
 * 締めの表示値を直す（管理者のみ）。袋は締めたまま数字だけ入れ直す。
 * 交換すると次の袋が開くので、記録中に戻さずに直せる経路が要る
 * （読み違い・撮り直しの訂正はこちらが本筋）。
 */
export async function correctBagCloseAction(input: {
  bagId: string;
  closeCum: unknown;
  reason: string;
}): Promise<ActionResult> {
  try {
    const s = await requireAdminSession();
    const bag = await getBagById(s.companyId, asStr(input.bagId, 50));
    if (!bag) return fail("袋が見つかりません。");
    if (bag.status === "open") {
      return fail("この袋は記録中です。締めるときに表示値を入力してください。");
    }
    const closeCum = toNumOrNull(input.closeCum);
    if (closeCum === null) return fail("直したあとの表示値を入力してください。");
    if (closeCum < bag.startCum) {
      return fail(
        `表示値（${closeCum} kg）が、この袋の開始の表示値（${bag.startCum} kg）より小さくなっています。`
      );
    }
    const reason = asStr(input.reason, 200);
    if (!reason) return fail("訂正理由を入力してください（記録として残ります）。");
    const ok = await correctBagClose(s.companyId, bag.id, { closeCum, reason });
    if (!ok) return fail("締め値を直せませんでした。画面を再読み込みしてください。");
    const weight = Math.round((closeCum - bag.startCum) * 1000) / 1000;
    revalidatePath("/daily");
    revalidatePath("/");
    return {
      ok: true,
      message:
        `袋 ${bag.bagNo} の締め値を ${closeCum.toFixed(1)} kg に直しました` +
        `（この袋は ${weight.toFixed(1)} kg）。` +
        (bag.status === "approved" ? " 数字が変わったので承認待ちに戻しました。" : ""),
    };
  } catch (e) {
    return fail(bagErrorMessage(e));
  }
}

/**
 * 締めの取り消し（管理者のみ）。締めたのが間違いだった袋を記録中へ戻し、
 * 続けてその袋に投入できるようにする。
 *
 * 交換のときは次の袋が自動で開くので、そのままでは「1台の重量計に記録中の袋は1つ」に
 * 引っかかって戻せない。次の袋にまだ投入が1件も無ければ、交換で開いただけの袋なので
 * 消してから戻す。すでに投入があるなら戻せないので、締め値の訂正へ案内する。
 */
export async function reopenBagAction(bagId: string): Promise<ActionResult> {
  try {
    const s = await requireAdminSession();
    const bag = await getBagById(s.companyId, asStr(bagId, 50));
    if (!bag) return fail("袋が見つかりません。");
    if (bag.status === "open") return fail("この袋は記録中です。");

    let removed = "";
    if (bag.scaleId) {
      const open = (await listOpenBags(s.companyId, bag.factory)).find(
        (b) => b.scaleId === bag.scaleId
      );
      if (open) {
        if (open.entryCount > 0) {
          return fail(
            `次の袋 ${open.bagNo} に投入が ${open.entryCount} 件記録されているため、記録中に戻せません（1台の重量計に記録中の袋は1つまで）。締め値の数字だけを直す場合は「締め値を直す」を使ってください。`
          );
        }
        if (!(await deleteEmptyBag(s.companyId, open.id))) {
          return fail("次の袋を戻せませんでした。画面を再読み込みしてください。");
        }
        removed = open.bagNo;
      }
    }

    const ok = await reopenBag(s.companyId, bag.id);
    if (!ok) return fail("締めを取り消せませんでした。画面を再読み込みしてください。");
    revalidatePath("/daily");
    revalidatePath("/");
    return {
      ok: true,
      message:
        `袋 ${bag.bagNo} を記録中に戻しました。` +
        (removed ? `交換で開いた袋 ${removed}（投入なし）は取り消しました。` : ""),
    };
  } catch (e) {
    return fail(bagErrorMessage(e));
  }
}

/**
 * 袋運用の開始日を決める（生産管理部・調達部のメンバーと管理者）。
 * この日から袋単位、それより前は従来どおり日単位の記録として扱う。
 * 空文字を渡すと設定を消し、「最初に袋を開いた日」からの推定に戻る。
 */
export async function saveBagStartAction(input: {
  factory: string;
  startOn: string;
}): Promise<ActionResult> {
  try {
    const s = await requireOperationsSession();
    const factory = asStr(input.factory, 50);
    if (!factory) return fail("工場を選んでください。");
    const startOn = asStr(input.startOn, 10);
    if (!startOn) {
      await clearBagStart(s.companyId, factory);
      revalidatePath("/settings");
      revalidatePath("/daily");
      revalidatePath("/summary");
      revalidatePath("/bags");
      return { ok: true, message: `${factory} の開始日の設定を消しました（記録から推定します）。` };
    }
    if (!isDateStr(startOn)) return fail("開始日は年月日で入力してください。");
    await setBagStart(
      s.companyId,
      factory,
      startOn,
      [await getUserAffiliation(s.userId), s.userName || s.loginId || ""].filter(Boolean).join(" ")
    );
    revalidatePath("/settings");
    revalidatePath("/daily");
    revalidatePath("/summary");
    revalidatePath("/bags");
    return {
      ok: true,
      message: `${factory} は ${startOn} から袋単位の管理になります（それより前は日単位の記録のままです）。`,
    };
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
 * 品目CD（または品名・子図番）で品目を探す（初品測定の候補表示用）。
 * 同じ品目CDが格納場所ごとに存在するため、品目CD×格納場所CDで1件に畳んで返す。
 * 入力した文字で始まる品目CDを先に出す（打った番号そのものが上に来るように）。
 */
export async function searchItemsAction(
  query: string,
  factory?: string | null
): Promise<ScrapItem[]> {
  const s = await requireEntitledSession();
  const q = asStr(query, 50);
  if (q.length < 2) return [];
  const f = asStr(factory ?? "", 50) || null;
  const { items } = await listItems(s.companyId, { q, factory: f, limit: 300 });
  const uniq = new Map<string, ScrapItem>();
  for (const it of items) {
    // 子図番ごとに行があるので、品目（品目CD×格納場所CD）単位に畳む
    const k = `${it.kanriZuban}\t${it.kakunoCD}`;
    if (!uniq.has(k)) uniq.set(k, it);
  }
  const rank = (it: ScrapItem) =>
    it.kanriZuban === q ? 0 : it.kanriZuban.startsWith(q) ? 1 : 2;
  return [...uniq.values()]
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        a.kanriZuban.localeCompare(b.kanriZuban) ||
        a.kakunoCD.localeCompare(b.kakunoCD)
    )
    .slice(0, 20);
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

/**
 * 初品測定のExcel/CSV一括取込（過去分の移行用・管理者のみ）。
 * 現場のブックは1件ずつ承認して回せる量ではないので、取り込んだ時点で承認済みにする
 * （＝取込操作そのものが管理者による一括承認）。
 *
 * 桁ズレの直し方: 品目マスターの完成重量(理論) →（無ければ）構成重量 →（無ければ）
 * その品目の測定値の中央値、を基準に、10のべき乗ぶんズレていて基準に十分近づく値だけ直す。
 * 測定値どうしの中央値を基準にすると、同じ品目の記録がまとめて桁違いのとき
 * （多数派が誤り）に逆へ直してしまうため、マスターを先に見る。
 * 10のべき乗では説明できないズレは直さず「要確認」として件数を返す。
 */
export async function importFirstArticlesAction(input: {
  factory?: string;
  rows: {
    hinmokuCD?: unknown;
    kakunoCD?: unknown;
    seizoBashoCD?: unknown;
    measuredOn?: unknown;
    weight?: unknown;
  }[];
}): Promise<ActionResult> {
  try {
    const s = await requireAdminSession();
    const rows = Array.isArray(input?.rows) ? input.rows : [];
    if (rows.length === 0) return fail("取込データがありません。");
    if (rows.length > 30000) return fail("一度に取込できるのは30,000行までです。");
    const factory = asStr(input?.factory, 50);

    type Parsed = {
      hinmokuCD: string;
      kakunoHint: string;
      seizoHint: string;
      measuredOn: string;
      weight: number;
    };
    const parsed: Parsed[] = [];
    let bad = 0;
    for (const r of rows) {
      const hinmokuCD = asStr(r.hinmokuCD, 50);
      const measuredOn = normDateStr(r.measuredOn);
      const weight = toNum(r.weight);
      if (!hinmokuCD || !measuredOn || weight <= 0) {
        bad++;
        continue;
      }
      parsed.push({
        hinmokuCD,
        kakunoHint: asStr(r.kakunoCD, 50),
        seizoHint: asStr(r.seizoBashoCD, 50),
        measuredOn,
        weight,
      });
    }
    if (parsed.length === 0) return fail("品目CD・測定日・実測重量を読み取れる行がありませんでした。");

    // 品目マスターから格納場所CDを決める（同じ品目CDが複数の格納場所にあるときは工場で絞る）
    const refs = await listItemRefs(s.companyId, [...new Set(parsed.map((p) => p.hinmokuCD))]);
    const byCode = new Map<string, typeof refs>();
    for (const ref of refs) {
      const list = byCode.get(ref.hinmokuCD);
      if (list) list.push(ref);
      else byCode.set(ref.hinmokuCD, [ref]);
    }
    type Resolved = Parsed & { ref: (typeof refs)[number] };
    const resolved: Resolved[] = [];
    const unknownCodes = new Set<string>();
    const ambiguousCodes = new Set<string>();
    for (const p of parsed) {
      let cand = byCode.get(p.hinmokuCD) ?? [];
      if (cand.length === 0) {
        unknownCodes.add(p.hinmokuCD);
        continue;
      }
      const narrow = (list: typeof cand, f: (r: (typeof refs)[number]) => boolean) => {
        const hit = list.filter(f);
        return hit.length > 0 ? hit : list;
      };
      if (p.kakunoHint) cand = narrow(cand, (r) => r.kakunoCD === p.kakunoHint);
      if (cand.length > 1 && p.seizoHint) cand = narrow(cand, (r) => r.seizoBashoCD === p.seizoHint);
      if (cand.length > 1 && factory) cand = narrow(cand, (r) => r.factory === factory);
      if (cand.length > 1) {
        ambiguousCodes.add(p.hinmokuCD);
        continue;
      }
      resolved.push({ ...p, ref: cand[0] });
    }
    if (resolved.length === 0) {
      return fail(
        `取り込める行がありませんでした。品目マスターに無い品目CD: ${[...unknownCodes].slice(0, 10).join(", ")}${unknownCodes.size > 10 ? " ほか" : ""}`
      );
    }

    // 品目ごとの基準値（マスター優先、無ければ測定値の中央値）
    const groups = new Map<string, Resolved[]>();
    for (const r of resolved) {
      const k = `${r.ref.hinmokuCD}\t${r.ref.kakunoCD}`;
      const list = groups.get(k);
      if (list) list.push(r);
      else groups.set(k, [r]);
    }
    const median = (a: number[]) => {
      const t = [...a].sort((x, y) => x - y);
      return t[Math.floor(t.length / 2)] ?? 0;
    };

    const sokuteisha = `Excel取込${factory ? `（${factory}）` : ""}`;
    const out: {
      measuredOn: string;
      hinmokuCD: string;
      kakunoCD: string;
      weight: number;
      sokuteisha: string;
      note: string;
    }[] = [];
    const fixed: string[] = [];
    let fixedCount = 0;
    const check: string[] = [];
    let checkCount = 0;
    for (const [, list] of groups) {
      const ref = list[0].ref;
      const anchor =
        ref.kanseiJuryo > 0
          ? ref.kanseiJuryo
          : ref.koseiJuryo > 0
            ? ref.koseiJuryo
            : median(list.map((r) => r.weight));
      for (const r of list) {
        let weight = r.weight;
        let note = "Excel取込";
        if (anchor > 0) {
          const k = Math.round(Math.log10(weight / anchor));
          if (k !== 0 && Math.abs(k) <= 3) {
            // 10で割った端数（0.017499999…）が残らないよう有効桁で丸める
            const scaled = Number((weight / 10 ** k).toPrecision(10));
            // 10のべき乗ぶん直して基準に十分近づくときだけ採用する
            if (Math.abs(scaled / anchor - 1) <= 0.35) {
              note = `Excel取込・桁補正 ${r.weight} → ${scaled}`;
              if (fixedCount < 8) fixed.push(`${r.hinmokuCD} ${r.measuredOn} ${r.weight}→${scaled}`);
              fixedCount++;
              weight = scaled;
            }
          }
          const gap = weight / anchor;
          if (gap > 2 || gap < 0.5) {
            if (checkCount < 8) check.push(`${r.hinmokuCD} ${r.measuredOn} ${weight}（理論${anchor}）`);
            checkCount++;
          }
        }
        out.push({
          measuredOn: r.measuredOn,
          hinmokuCD: ref.hinmokuCD,
          kakunoCD: ref.kakunoCD,
          weight,
          sokuteisha,
          note,
        });
      }
    }
    const count = await bulkUpsertFirstArticles(
      s.companyId,
      out,
      s.userName || s.loginId || ""
    );
    revalidatePath("/first");
    revalidatePath("/mcframe");
    revalidatePath("/");
    const lines = [`取込完了: ${count}件を承認済みで登録しました。`];
    if (fixedCount) {
      lines.push(`桁補正 ${fixedCount}件（他の日の水準に合わせました）: ${fixed.join(" / ")}${fixedCount > fixed.length ? " ほか" : ""}`);
    }
    if (checkCount) {
      lines.push(`要確認 ${checkCount}件（理論値と2倍以上ちがい、桁ズレでは説明できません。そのまま登録しています）: ${check.join(" / ")}${checkCount > check.length ? " ほか" : ""}`);
    }
    if (unknownCodes.size) {
      lines.push(`品目マスターに無く取り込めなかった品目CD ${unknownCodes.size}件: ${[...unknownCodes].slice(0, 10).join(", ")}${unknownCodes.size > 10 ? " ほか" : ""}`);
    }
    if (ambiguousCodes.size) {
      lines.push(`格納場所を特定できなかった品目CD ${ambiguousCodes.size}件（工場を選び直してください）: ${[...ambiguousCodes].slice(0, 10).join(", ")}`);
    }
    if (bad) lines.push(`読み取れなかった行 ${bad}件`);
    return { ok: true, message: lines.join("\n") };
  } catch (e) {
    return fail((e as Error).message);
  }
}

// ===== ④ McFrame取込（生産管理部・調達部のメンバーと管理者のみ） =====

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
    const s = await requireOperationsSession();
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

// ===== ⑤ 調達入力（日次。生産管理部・調達部のメンバーと管理者のみ） =====

/** 対象月×工場の日次調達データを一括保存。入力者はログインユーザーを自動記録。 */
export async function saveProcureDaysAction(input: {
  factory: string;
  days: Record<string, unknown>[];
}): Promise<ActionResult> {
  try {
    const s = await requireOperationsSession();
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
    const s = await requireOperationsSession();
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
    const s = await requireOperationsSession();
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
    const s = await requireOperationsSession();
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
    const s = await requireOperationsSession();
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
    const s = await requireOperationsSession();
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

// ===== ① 日次記録: Excel（紙様式）の記録票の取込（生産管理部・調達部のメンバーと管理者のみ） =====

/** 取込1回分の結果。日付ごとにどうなったかを画面に出す。 */
export interface DailyImportResult {
  ok: boolean;
  message: string;
  /** 取り込んだ日付 */
  imported: string[];
  /** 既に記録があるので飛ばした日付（上書きを選べば取り込める） */
  skipped: string[];
  failed: { date: string; message: string }[];
  /** 取込のために新しく作った種類（設定 > スクラップ種類に追加される） */
  createdKinds: string[];
}

const importFailed = (message: string): DailyImportResult => ({
  ok: false,
  message,
  imported: [],
  skipped: [],
  failed: [],
  createdKinds: [],
});

/**
 * Excelの日次記録票（箱の種類ごとのブック）を、日付×工場の記録票として取り込む。
 *
 * - 明細の重量はサーバー側で計算し直す（投入重量−箱重量。片方しか無い行は送られてきた重量）
 * - 累積（投入前/投入後）は箱ごとの積み上げで埋める（Excelの「累積」列と同じ考え方）
 * - Excelに責任者のサインがある日は承認済みとして取り込む（承認者はサインの名前）
 * - 既に記録がある日は既定で飛ばす。mode="overwrite" のときだけ置き換える
 */
export async function importDailyExcelAction(input: {
  factory: string;
  mode: "skip" | "overwrite";
  /** Excelに責任者サインが無い日も承認済みにする（承認者は取込者）。過去分の一括移行用 */
  approveAll?: boolean;
  days: {
    recordDate: string;
    sekininsha?: string;
    shonin?: string;
    tonyuKanryo?: boolean;
    hakoZanryo?: unknown;
    kaishuSokuteichi?: unknown;
    biko?: string;
    entries: Record<string, unknown>[];
  }[];
}): Promise<DailyImportResult> {
  try {
    const s = await requireOperationsSession();
    const factory = asStr(input.factory, 50);
    if (!factory) return importFailed("取込先の工場を選んでください。");
    // 所属工場のあるユーザーは自工場にしか取り込めない（サーバー側で必ず防ぐ）
    const restriction = await getFactoryRestriction(s);
    if (restriction.restricted && factory !== restriction.factory) {
      return importFailed(`所属工場（${restriction.factory}）にのみ取り込めます。`);
    }
    const days = Array.isArray(input.days) ? input.days : [];
    if (days.length === 0) return importFailed("取込データがありません。");
    if (days.length > 40) return importFailed("一度に取込できるのは40日分までです。");

    // 種類マスタに無い箱の種類（銅スクラップなど）は、取込のときに作る
    const kinds = await listScrapKinds(s.companyId);
    const kindNames = new Set(kinds.map((k) => k.name));
    let nextSort = kinds.reduce((m, k) => Math.max(m, k.sort), 0);
    const createdKinds: string[] = [];
    for (const day of days) {
      for (const e of day.entries ?? []) {
        const kind = asStr(e.kind, 20);
        if (!kind || kindNames.has(kind)) continue;
        nextSort += 1;
        await upsertScrapKind(s.companyId, { name: kind, sort: nextSort, active: true });
        kindNames.add(kind);
        createdKinds.push(kind);
      }
    }

    // 箱（重量計）は、その種類の登録が1台だけのときに紐づける。
    // 複数ある・未登録のときは種類だけ残す（後から画面で直せる）。
    const scales = await listScales(s.companyId, { factory, activeOnly: true });
    const scaleOfKind = new Map<string, Scale>();
    for (const kind of kindNames) {
      const hit = scales.filter((sc) => sc.kind === kind);
      if (hit.length === 1) scaleOfKind.set(kind, hit[0]);
    }

    const imported: string[] = [];
    const skipped: string[] = [];
    const failed: { date: string; message: string }[] = [];

    for (const day of days) {
      const recordDate = normDateStr(day.recordDate);
      if (!recordDate) {
        failed.push({ date: asStr(day.recordDate, 20), message: "日付が読み取れません" });
        continue;
      }
      const rows = Array.isArray(day.entries) ? day.entries : [];
      if (rows.length === 0) {
        failed.push({ date: recordDate, message: "明細がありません" });
        continue;
      }
      if (rows.length > 300) {
        failed.push({ date: recordDate, message: "1日の明細が300件を超えています" });
        continue;
      }
      const prev = await getDailyRecord(s.companyId, recordDate, factory);
      if (prev && prev.entries.length > 0 && input.mode !== "overwrite") {
        skipped.push(recordDate);
        continue;
      }

      // 箱ごとの累積（投入前＝それまでの合計、投入後＝投入後の合計）
      const cum = new Map<string, number>();
      const entries: DailyEntry[] = [];
      for (const e of rows) {
        const kindRaw = asStr(e.kind, 20);
        const kind = kindNames.has(kindRaw) ? kindRaw : (kinds[0]?.name ?? SCALE_KIND_LIST[0]);
        const gross = toNumOrNull(e.gross);
        const tare = toNumOrNull(e.tare);
        // 重量は必ずサーバーで決める。投入重量と箱重量が揃っていればその差、
        // 片方しか無い行（実投入だけの記録）は送られてきた重量を使う。
        const weight =
          gross !== null && tare !== null
            ? Math.round((gross - tare) * 1000) / 1000
            : Math.round((toNumOrNull(e.weight) ?? 0) * 1000) / 1000;
        if (!(weight > 0)) continue;
        const before = cum.get(kind) ?? 0;
        const after = Math.round((before + weight) * 1000) / 1000;
        cum.set(kind, after);
        const scale = scaleOfKind.get(kind) ?? null;
        entries.push({
          jikoku: asStr(e.jikoku, 10),
          hinshu: kind,
          scaleId: scale?.id ?? null,
          scaleName: scale?.name ?? kind,
          grossWeight: gross,
          tareWeight: tare,
          weight,
          cumBefore: before,
          cumAfter: after,
          cumBeforeReason: "",
          cumAfterReason: "",
          cumBeforeReadId: null,
          cumAfterReadId: null,
          // Excelの期間は袋管理より前なので、袋には紐づけない（袋なし＝日単位の記録）
          bagId: null,
          kirokusha: asStr(e.kirokusha, 120),
          ijo: asStr(e.ijo),
          busho: asStr(e.busho, 50),
          kikai: asStr(e.kikai, 50),
          zairyo: asStr(e.zairyo, 50),
          kotei: asStr(e.kotei, 50),
        });
      }
      if (entries.length === 0) {
        failed.push({ date: recordDate, message: "取り込める明細がありません" });
        continue;
      }

      // Excelで責任者がサインしている日は、その時点で承認された記録として扱う。
      // サインが無い日は下書き。approveAll のときだけ取込者の承認として扱う
      const shonin = asStr(day.shonin, 50);
      const approval = shonin
        ? { status: "approved" as const, approvedBy: `${shonin}（Excel）` }
        : input.approveAll
          ? { status: "approved" as const, approvedBy: `${s.userName || s.loginId || ""}（Excel取込）` }
          : { status: "draft" as const, approvedBy: "" };
      try {
        await importDailyRecord(
          s.companyId,
          {
            recordDate,
            factory,
            sekininsha: asStr(day.sekininsha, 50),
            zenjitsuOk: prev?.zenjitsuOk ?? false,
            hakoZanryo: toNumOrNull(day.hakoZanryo) ?? 0,
            kaishiCum: {},
            kaishuSokuteichi: toNumOrNull(day.kaishuSokuteichi),
            tonyuKanryo: Boolean(day.tonyuKanryo),
            shonin,
            biko: asStr(day.biko, 2000),
            updatedBy: `${s.loginId ?? s.userName}（Excel取込）`,
            entries,
          },
          approval
        );
        imported.push(recordDate);
      } catch (e) {
        failed.push({ date: recordDate, message: (e as Error).message });
      }
    }

    revalidatePath("/daily");
    revalidatePath("/summary");
    revalidatePath("/");
    const parts = [`取込 ${imported.length}日`];
    if (skipped.length) parts.push(`既存のため飛ばし ${skipped.length}日`);
    if (failed.length) parts.push(`エラー ${failed.length}日`);
    if (createdKinds.length) parts.push(`種類を追加: ${createdKinds.join("・")}`);
    return {
      ok: failed.length === 0,
      message: parts.join(" / "),
      imported,
      skipped,
      failed,
      createdKinds,
    };
  } catch (e) {
    return importFailed((e as Error).message);
  }
}
