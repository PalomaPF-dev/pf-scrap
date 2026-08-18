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

export interface ScrapItem {
  id: string;
  kanriZuban: string;
  hinmei: string;
  key: string;
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
  itemKey: string;
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
