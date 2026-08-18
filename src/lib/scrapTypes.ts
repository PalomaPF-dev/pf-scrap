/**
 * クライアント/サーバー共用の型・定数。
 * db.ts は DB ドライバ（サーバー専用）を import するため、クライアントコンポーネントが
 * 必要とする型とラベルはここに分離する（db.ts から再エクスポートされる）。
 */

/** スクラップの区分（品種）。品目マスター・月次入力で共通。 */
export const KUBUN_LIST = ["銅条", "銅管", "その他"] as const;
export type Kubun = (typeof KUBUN_LIST)[number];

/** スクラップ箱（重量計）の種類。日次記録は投入先の箱をこの2種から選ぶ。 */
export const SCALE_KIND_LIST = ["上銅", "銅ダライ"] as const;
export type ScaleKind = (typeof SCALE_KIND_LIST)[number];

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
  /** 記録者（ログインユーザーを自動記録） */
  kirokusha: string;
  ijo: string;
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
}
