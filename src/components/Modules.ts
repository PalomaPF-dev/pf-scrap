import {
  BarChart3,
  BookOpen,
  CalendarRange,
  ClipboardList,
  Download,
  FileCheck,
  Home,
  FileSpreadsheet,
  Table2,
  LayoutDashboard,
  Package,
  PackageCheck,
  QrCode,
  Scale,
  Truck,
  Settings,
  type LucideIcon,
} from "lucide-react";

/**
 * アプリの機能の定義（名前・アイコン・説明）。
 * ホーム・サイドバー・使い方で同じ定義を使い、呼び方がぶれないようにする。
 * ops=true の機能は生産管理部・調達部のメンバーと管理者だけが使う
 * （session.ts の canUseOperations。サイドバー・ホーム・使い方で同じ規則で出し分ける）。
 */

export type ModuleKey =
  | "home"
  | "daily"
  | "dailyImport"
  | "bags"
  | "shipments"
  | "first"
  | "firstList"
  | "quality"
  | "summary"
  | "dashboard"
  | "procurement"
  | "mcframe"
  | "items"
  | "scales"
  | "settings"
  | "guide";

export interface AppModule {
  key: ModuleKey;
  href: string;
  /** 画面の名前（見出し・サイドバー） */
  title: string;
  icon: LucideIcon;
  /** 一行の説明 */
  lead: string;
  /** できること */
  points: string[];
  cta: string;
  /** 生産管理部・調達部のメンバーと管理者だけが使う */
  ops?: boolean;
  /** 管理者だけが使う（取込など、記録を一括で書き換えるもの） */
  admin?: boolean;
}

export const MODULES: Record<ModuleKey, AppModule> = {
  home: {
    key: "home",
    href: "/",
    title: "ホーム",
    icon: Home,
    lead: "使う順番と、いまの工場の状況",
    points: [],
    cta: "ホームへ",
  },
  daily: {
    key: "daily",
    href: "/daily",
    title: "日次記録",
    icon: ClipboardList,
    lead: "スクラップ箱に投入するたびに、重量計を写真で読み取って記録します",
    points: ["袋を開始し、投入前・投入後を撮るだけで重量が出る", "袋の交換（締め）もここで", "終礼で1日分を承認"],
    cta: "記録する",
  },
  dailyImport: {
    key: "dailyImport",
    href: "/daily/import",
    title: "日次記録のExcel取込",
    icon: FileSpreadsheet,
    lead: "現場のExcelの「スクラップ日次記録票」を、アプリの日次記録に取り込みます",
    points: ["取り込む前に内容を画面で確認", "既にアプリに記録がある日は既定で飛ばす"],
    cta: "取り込む",
    ops: true,
  },
  bags: {
    key: "bags",
    href: "/bags",
    title: "袋の記録",
    icon: PackageCheck,
    lead: "袋を交換するたびに締めた「この袋は◯◯kgでした」を、月ごとに一覧・承認します",
    points: ["締めの重量と記録した投入の合計の差", "袋ごとの承認", "袋の一覧・明細のCSV"],
    cta: "袋の記録を見る",
  },
  shipments: {
    key: "shipments",
    href: "/shipments",
    title: "ポリ箱（工場間）",
    icon: Truck,
    lead: "他工場へ送るスクラップをポリ箱ごとに量って出荷し、受け入れた工場で量った重量と突き合わせます",
    points: ["出荷するとポリ箱に書く番号が出る", "受け入れ側は日次記録でポリ箱を選んで投入", "未処理の箱と重量の差が一覧で分かる"],
    cta: "ポリ箱を開く",
  },
  first: {
    key: "first",
    href: "/first",
    title: "初品重量測定",
    icon: Scale,
    lead: "品目ごとに完成品1個あたりの重量を実測して登録します",
    points: ["品名のQRか品目CDで呼び出す", "承認された実測値が完成重量の計算に使われる"],
    cta: "測定を登録する",
  },
  firstList: {
    key: "firstList",
    href: "/first-list",
    title: "初品測定一覧",
    icon: Table2,
    lead: "初品測定の記録を月・工場・品目で絞り込んで一覧し、CSVに出します",
    points: ["申請中・承認済み・差し戻しの状態も一緒に", "絞り込んだままCSV出力"],
    cta: "一覧を見る",
  },
  quality: {
    key: "quality",
    href: "/quality",
    title: "品質チェックシート取込",
    icon: FileCheck,
    lead: "品質チェックシート（PDF）の備考欄に書かれた完成品重量を、初品測定として一括登録します",
    points: ["複数のPDFやフォルダごとドラッグ＆ドロップ", "読み取った内容を確認してから登録", "承認済みとして計算に反映"],
    cta: "PDFを取り込む",
    admin: true,
  },
  summary: {
    key: "summary",
    href: "/summary",
    title: "月間集計",
    icon: BarChart3,
    lead: "日次記録を月単位で、工場別・スクラップの種類別に集計します",
    points: ["種類ごとの合計と日別の一覧", "絞り込んだままCSV出力"],
    cta: "集計を見る",
  },
  dashboard: {
    key: "dashboard",
    href: "/dashboard",
    title: "照合ダッシュボード",
    icon: LayoutDashboard,
    lead: "理論スクラップと、実際の売却量・日次記録を突き合わせます",
    points: ["区分別の使用量・完成重量・理論スクラップ", "差異5%超をハイライト", "年間推移とCSV出力"],
    cta: "照合する",
  },
  procurement: {
    key: "procurement",
    href: "/procurement",
    title: "調達入力",
    icon: CalendarRange,
    lead: "区分別の購入重量・スクラップ売却数量と、月初在庫を入力します",
    points: ["日ごとの購入・売却", "月初在庫（棚卸）から使用量を在庫法で計算"],
    cta: "入力する",
    ops: true,
  },
  mcframe: {
    key: "mcframe",
    href: "/mcframe",
    title: "McFrame取込",
    icon: Download,
    lead: "McFrameの製造実績（日別の加工数）を取り込み、完成品重量と理論スクラップを出します",
    points: ["製造実績のCSV/Excelをそのまま取込", "品目別の完成重量・使用量・理論スクラップ"],
    cta: "取り込む",
    ops: true,
  },
  items: {
    key: "items",
    href: "/items",
    title: "品目マスター",
    icon: Package,
    lead: "McFrameの品目CD・格納場所CD・構成重量・完成重量を登録します",
    points: ["CSV一括取込・出力", "品名QRの印刷"],
    cta: "品目を開く",
    ops: true,
  },
  scales: {
    key: "scales",
    href: "/scales",
    title: "重量計マスター",
    icon: QrCode,
    lead: "スクラップ箱（重量計）ごとに種類・工場を登録し、QRラベルを発行します",
    points: ["QRラベルの印刷", "表示の刻み（小数点）を重量計ごとに設定"],
    cta: "重量計を開く",
    ops: true,
  },
  settings: {
    key: "settings",
    href: "/settings",
    title: "設定",
    icon: Settings,
    lead: "スクラップの種類と、このアプリで使う工場・職場を設定します",
    points: ["スクラップの種類（上銅・銅ダライなど）を増やす", "使わない工場・職場を候補から外す"],
    cta: "設定を開く",
    ops: true,
  },
  guide: {
    key: "guide",
    href: "/guide",
    title: "使い方",
    icon: BookOpen,
    lead: "日次記録の撮り方から照合まで、1画面ずつ説明します",
    points: [],
    cta: "使い方を見る",
  },
};

/**
 * 機能を用途ごとにまとめたもの。サイドバーの見出しと、ホームの「機能」一覧で同じ分け方を使う。
 * ops / admin の機能は権限のある人にだけ出す（usable で絞る）。
 */
export interface ModuleGroup {
  title: string;
  note: string;
  keys: ModuleKey[];
}

export const MODULE_GROUPS: ModuleGroup[] = [
  { title: "現場の記録", note: "毎日の投入・袋の締めと初品の実測", keys: ["daily", "bags", "shipments", "first", "firstList"] },
  { title: "集計・照合", note: "月末にズレがないかを確かめる", keys: ["summary", "dashboard"] },
  { title: "入力・取込", note: "生産管理部・調達部・管理者", keys: ["procurement", "mcframe", "dailyImport", "quality"] },
  { title: "マスタ・設定", note: "生産管理部・調達部", keys: ["scales", "items", "settings"] },
];

/** 使える機能か（ops の機能は canOperate の人だけ、admin の機能は管理者だけ） */
export const usable = (m: AppModule, canOperate: boolean, isAdmin = false) =>
  (!m.ops || canOperate) && (!m.admin || isAdmin);

/**
 * 実際の業務の順番（使い方の「はじめに」で使う）。
 * マスタを用意 → 現場で毎日記録 → 袋を締めて承認 → 他工場とポリ箱を受け渡す → 初品を実測 → 月次の在庫・購入・売却を入力
 * → McFrameの加工数を取込 → 月間集計 → 照合、の順。
 */
export interface FlowStep {
  /** 主に使う画面 */
  module: ModuleKey;
  /** 同じ手順で使うほかの画面（使えない人には出さない） */
  also?: ModuleKey[];
  title: string;
  /** 誰が・いつ */
  when: string;
  note: string;
}

export const FLOW: FlowStep[] = [
  {
    module: "scales",
    also: ["items"],
    title: "マスタを用意する",
    when: "最初に1回（生産管理部・調達部）",
    note: "重量計（スクラップ箱）を登録してQRラベルを貼り、品目マスターを取り込みます",
  },
  {
    module: "daily",
    also: ["dailyImport"],
    title: "日次記録をつける",
    when: "毎日・投入のたび（現場）",
    note: "袋を開始し、重量計を撮って投入前・投入後を読み取ります。終礼で承認者が1日分を承認します",
  },
  {
    module: "bags",
    title: "袋を締めて確かめる",
    when: "袋の交換のたび（現場）・承認は管理者",
    note: "袋を交換するときに締めた重量と、記録した投入の合計の差を袋ごとに確かめて承認します",
  },
  {
    module: "shipments",
    title: "他工場とポリ箱を受け渡す",
    when: "毎日（送る工場・受け入れる工場）",
    note: "送る工場はポリ箱ごと量って出荷し、受け入れる工場は投入したあと空のポリ箱を量って突き合わせます",
  },
  {
    module: "first",
    also: ["firstList", "quality"],
    title: "初品重量を測る",
    when: "生産した日（現場）",
    note: "完成品1個の重量を実測して登録します。承認された値が完成重量に使われます",
  },
  {
    module: "procurement",
    title: "購入・売却と月次在庫を入れる",
    when: "日次〜月末（生産管理部・調達部）",
    note: "区分別の購入重量・スクラップ売却数量と、月初在庫を入力します",
  },
  {
    module: "mcframe",
    title: "McFrameの加工数を取り込む",
    when: "日次〜月末（生産管理部・調達部）",
    note: "製造実績を取り込むと、完成品重量と理論スクラップが出ます",
  },
  {
    module: "summary",
    title: "月間集計で確かめる",
    when: "月末",
    note: "日次記録を工場別・種類別に集計し、記録漏れや承認待ちがないかを見ます",
  },
  {
    module: "dashboard",
    title: "照合する",
    when: "月末",
    note: "理論スクラップ × 売却量 × 日次記録を突き合わせ、5%超の差異を確認します",
  },
];
