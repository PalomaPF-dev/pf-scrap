/**
 * クライアント/サーバー共用の型・定数。
 * db.ts は DB ドライバ（サーバー専用）を import するため、クライアントコンポーネントが
 * 必要とする型とラベルはここに分離する（db.ts から再エクスポートされる）。
 */

/** スクラップの区分（品種）。品目マスター・月次入力で共通。 */
export const KUBUN_LIST = ["銅条", "銅管", "その他"] as const;
export type Kubun = (typeof KUBUN_LIST)[number];

/**
 * スクラップの種類（上銅 / 銅ダライ / 銅スクラップ …）。
 * 現場の運用で増えるため、設定画面（scrap_kinds）で追加できる。
 * 下の SCALE_KIND_LIST は、種類が1件も登録されていないときの既定値としてだけ使う。
 */
export interface ScrapKind {
  id: string;
  name: string;
  /** 表示順（小さいほど先） */
  sort: number;
  /** 使用中か。無効にすると新規の選択肢から消えるが、過去の記録は残る */
  active: boolean;
}

/** 種類マスターが空のときの既定値。 */
export const SCALE_KIND_LIST = ["上銅", "銅ダライ"] as const;
export type ScaleKind = (typeof SCALE_KIND_LIST)[number];

/**
 * 種類ごとの色。設定で自由に増やせるので、並び順で色を割り当てる。
 * 記録票・一覧・タグで同じ色になるよう、表示側は必ずこれを使う。
 */
const KIND_COLORS = [
  "bg-[#faf6ef] text-[#b4632c]",
  "bg-[#eef1f4] text-[#0b5ca8]",
  "bg-[#eef4ee] text-[#2f6b2f]",
  "bg-[#f4eef4] text-[#7b2f7b]",
  "bg-[#fdf3e6] text-[#a15c00]",
  "bg-[#eef4f4] text-[#0b7a7a]",
];

/** 種類名から色を決める（並び順が分かるときは order を渡す）。 */
export function kindColor(name: string, order?: number): string {
  if (order !== undefined && order >= 0) return KIND_COLORS[order % KIND_COLORS.length];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return KIND_COLORS[h % KIND_COLORS.length];
}

/** 日次記録票の承認状態。 */
export type DailyStatus = "draft" | "pending" | "approved" | "rejected";

export const DAILY_STATUS_LABEL: Record<DailyStatus, string> = {
  draft: "下書き",
  pending: "申請中",
  approved: "承認済み",
  rejected: "差し戻し",
};

/**
 * 品目の識別子は「品目CD × 格納場所CD」の組。
 * 同じ品目CDでも工場（格納場所）が違えば別物のため、単独では特定できない
 * （実データでも5品目が大口・直方の両方に存在する）。
 * QRコードや1行表示のように1本の文字列にしたいときだけ、この区切りで連結する。
 */
export const ITEM_REF_SEP = "-";

/** 品目CD と 格納場所CD を1本の文字列にする（QR値・表示用）。 */
export function itemRef(hinmokuCd: string, kakunoCd: string): string {
  const h = (hinmokuCd ?? "").trim();
  const k = (kakunoCd ?? "").trim();
  return k ? `${h}${ITEM_REF_SEP}${k}` : h;
}

/**
 * itemRef の逆変換。格納場所CDが付いていない値（品目CDのみ）も受け付ける。
 * 読み取り側は、格納場所CDが空なら工場の絞り込みなどで一意に決める。
 */
export function parseItemRef(value: string): { hinmokuCd: string; kakunoCd: string } {
  const v = (value ?? "").trim();
  const i = v.indexOf(ITEM_REF_SEP);
  if (i <= 0) return { hinmokuCd: v, kakunoCd: "" };
  return { hinmokuCd: v.slice(0, i), kakunoCd: v.slice(i + ITEM_REF_SEP.length) };
}

export interface ScrapItem {
  id: string;
  /** 品目CD（McFrameの品目ＣＤ。旧・管理図番） */
  kanriZuban: string;
  hinmei: string;
  kubun: string;
  oyaZuban: string;
  oyaHinmei: string;
  koZuban: string;
  koHinmei: string;
  tani: string;
  koseiJuryo: number;
  kanseiJuryo: number;
  seizoBashoCD: string;
  seizoBashoMei: string;
  /** 格納場所CD／名（McFrameの格納場所。品目CDとセットで品目を identify する） */
  kakunoCD: string;
  kakunoMei: string;
  factory: string;
}

export interface DailyEntry {
  /** 記録時刻（HH:MM。入力時に自動で入る） */
  jikoku: string;
  /** 投入先の箱の種類（上銅/銅ダライ。重量計マスターのスナップショット） */
  hinshu: string;
  /** 重量計（スクラップ箱）。マスター削除後も表示できるよう名称もスナップショット */
  scaleId: string | null;
  scaleName: string;
  /** 投入前重量（箱含む）kg */
  grossWeight: number | null;
  /** 箱重量（空き箱）kg */
  tareWeight: number | null;
  /** スクラップ重量 = grossWeight − tareWeight（サーバー側で再計算） */
  weight: number;
  /** スクラップ箱の重量計の累積表示値（投入前/投入後）kg。整合確認用 */
  cumBefore: number | null;
  cumAfter: number | null;
  /**
   * 投入前累積の訂正理由。投入前累積は「朝礼後の累積値」または同じ箱の直前の
   * 投入後累積が自動で入るため、それと違う値を入れたときだけ理由が入る（空＝自動値のまま）。
   */
  cumBeforeReason: string;
  /** 投入後累積の訂正理由。AI読取の値を手で変えたときだけ入る。 */
  cumAfterReason: string;
  /**
   * この累積値の元になったAI読取（scrap_scale_reads.id）。null＝AIを使わず手入力した。
   * ログ側はサーバーしか書き込めないので、採用値と突き合わせれば人が上書きした差分が分かる。
   */
  cumBeforeReadId: string | null;
  cumAfterReadId: string | null;
  /**
   * この投入が入った袋（scrap_bags.id）。袋管理より前の記録は null。
   * 累積の引き継ぎ・「投入後 < 投入前」の判定は、この袋の中だけで行う
   * （袋を交換すると表示値が 0 に戻るため、重量計ごとでは繋がらない）。
   */
  bagId: string | null;
  /** 記録者（ログインユーザーを自動記録） */
  kirokusha: string;
  ijo: string;
  /**
   * 紙様式（Excel）から取り込んだ行だけが持つ発生元の情報。
   * 新しい画面の入力では使わないが、取り込んだ記録を編集・再保存しても消えないよう持ち回る。
   * 部署 / 機械 / 品種（銅条・パイプ等の材質） / 工程。
   */
  busho: string;
  kikai: string;
  zairyo: string;
  kotei: string;
}

export interface DailyRecord {
  id: string;
  recordDate: string; // YYYY-MM-DD
  factory: string;
  sekininsha: string;
  zenjitsuOk: boolean;
  hakoZanryo: number;
  /**
   * 箱（重量計）ごとの朝礼後の累積値 kg。scaleId をキーに持つ。
   * その日の最初の投入では、この値が「累積(投入前)」に自動で入る。
   */
  kaishiCum: Record<string, number>;
  kaishuSokuteichi: number | null;
  tonyuKanryo: boolean;
  shonin: string;
  biko: string;
  updatedBy: string;
  status: DailyStatus;
  appliedBy: string;
  appliedAt: string | null;
  approvedBy: string;
  approvedAt: string | null;
  rejectComment: string;
  entries: DailyEntry[];
}

/**
 * スクラップ袋の状態。
 *   open     … 記録中（この袋に投入している）
 *   closed   … 締め済み（カゴから外した。承認待ち）
 *   approved … 承認済み（管理者が締めの数字を確認した）
 */
export type BagStatus = "open" | "closed" | "approved";

export const BAG_STATUS_LABEL: Record<BagStatus, string> = {
  open: "記録中",
  closed: "締め済み（承認待ち）",
  approved: "承認済み",
};

/**
 * 袋を交換する目安の重量 kg。破損防止のため 700〜800kg で交換する運用。
 * 超えても記録は止めない（未満での交換もあるため）。重量計ごとに
 * bagTargetKg が登録されていればそちらを使う。
 */
export const BAG_TARGET_KG = 800;

/**
 * スクラップ袋（鉄カゴにセットする袋）。交換までが1区切りで、記入用紙・Excelの
 * 1枚に対応する。1日に何度も交換され、夜勤帯の投入で翌日まで続くこともあるため、
 * 日付ではなく「開いてから締めるまで」で管理する。
 */
export interface ScrapBag {
  id: string;
  factory: string;
  /** 載せている重量計（総重量計）。マスター削除後も表示できるよう名称も持つ */
  scaleId: string | null;
  scaleName: string;
  kind: string;
  /** 袋No（開始日 + その日の順番。例 20260831-2）。記入用紙・引き取りの突き合わせに使う */
  bagNo: string;
  seq: number;
  openedOn: string;
  openedAt: string | null;
  openedBy: string;
  /** 開始の表示値 kg。風袋引きして 0 を確認してから始めるので通常は 0 */
  startCum: number;
  closedOn: string | null;
  closedAt: string | null;
  closedBy: string;
  /** 交換直前の表示値 kg。「この袋は◯◯kgでした」の◯◯ */
  closeCum: number | null;
  closeCumReason: string;
  closeCumReadId: string | null;
  /** 締めた時点の明細合計 kg（締めるまでは null） */
  totalWeight: number | null;
  status: BagStatus;
  approvedBy: string;
  approvedAt: string | null;
  note: string;
  /** 集計（保存済みの明細から都度計算）: この袋に記録された合計・件数・最後の投入後 */
  runningTotal: number;
  entryCount: number;
  lastCum: number | null;
}

/**
 * 袋の重量（＝現場が紙に書く「この袋は◯◯kg」）。締めの表示値から開始値を引く。
 * 通常は開始が 0 なので締めの表示値そのもの。締める前は null。
 */
export function bagWeight(b: ScrapBag): number | null {
  if (b.closeCum === null) return null;
  return Math.round((b.closeCum - b.startCum) * 1000) / 1000;
}

/**
 * 袋の重量と、アプリに記録された明細合計の差 kg。
 * 0 でなければ、記録していない投入・読み取りの誤り・他部署の投入のいずれか。
 */
export function bagGap(b: ScrapBag): number | null {
  const w = bagWeight(b);
  if (w === null) return null;
  const total = b.totalWeight ?? b.runningTotal;
  return Math.round((w - total) * 1000) / 1000;
}

/** 初品測定の承認状態（登録と同時に申請＝pending。承認済みのみ計算に採用）。 */
export type FaStatus = "pending" | "approved" | "rejected";

export const FA_STATUS_LABEL: Record<FaStatus, string> = {
  pending: "申請中",
  approved: "承認済み",
  rejected: "差し戻し",
};

export interface FirstArticle {
  measuredOn: string;
  /** 品目CD × 格納場所CD（品目の識別子） */
  hinmokuCD: string;
  kakunoCD: string;
  weight: number;
  sokuteisha: string;
  status: FaStatus;
  approvedBy: string;
  rejectComment: string;
  /** 品目マスターの表示用（品名・理論値）。未登録は null */
  hinmei: string | null;
  kanseiJuryo: number | null;
}

/** 重量計（スクラップ箱）マスター。QRコードで呼び出す。 */
export interface Scale {
  id: string;
  qrCode: string;
  /** 設備番号（重量計の管理番号） */
  equipNo: string;
  name: string;
  kind: string;
  factory: string;
  sort: number;
  active: boolean;
  /**
   * ひょう量（最大） kg。表示器のパネルに印字されている値。
   * これを超える読み取りは誤読として弾く。未登録は null。
   */
  capacity: number | null;
  /**
   * 目量（最小表示単位） kg。1 なら小数点なし、0.1 なら小数第1位まで。
   * AIへの指示と、読み取り値の刻みの検証に使う。未登録は null。
   */
  division: number | null;
  /**
   * 袋を交換する目安 kg。未登録は BAG_TARGET_KG を使う。
   * 超えても記録は止めず、注意表示だけ出す。
   */
  bagTargetKg: number | null;
}

/** AI読取の確信度。low は採用せず、必ず手入力に落とす。 */
export type ReadConfidence = "high" | "medium" | "low";

/** /api/scale-read の応答。value が null なら手入力してもらう。 */
export interface ScaleReadResponse {
  /** 読取ログのID。採用したら明細に持たせる（監査で突き合わせるため） */
  readId: string;
  value: number | null;
  digits: string;
  confidence: ReadConfidence;
  note: string;
}

/** 撮影1枚から得られるもの（QRは端末側で解読するので、サーバー応答には含まれない）。 */
export interface ScalePhotoResult extends ScaleReadResponse {
  /** 同じ写真から読めたQRコード。読めなければ空 */
  qr: string;
}
