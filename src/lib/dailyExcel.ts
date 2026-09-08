/**
 * 現場のExcel「スクラップ日次記録票」を読み取って、アプリの日次記録に載せる形に直す。
 * 純粋関数だけを置く（ファイル読み込みは xlsx.ts、保存は actions.ts）。
 *
 * ■ 取り込み元のExcel（1シート＝1日分の記録票）。工場ごとに様式が少し違う。
 *   【1】朝礼確認   前日記録の結果 / 箱の残量(kg)
 *   【2】日中記録   時刻・部署・機械・品種・工程・重量・箱重量・スクラップ重量・記録者・異常
 *                   （大口: 投入重量/箱重量/実投入/累積/カウンタ重量、日付列あり）
 *   【3】終礼集計   大口: 当日合計 / 回収箱測定値 / 投入確認 / 責任者承認
 *                   直方: 計量時総重量 / 袋重量×袋数 → 計量重量 / 計量前測定値 / 投入確認 / 責任者承認
 *   【4】備考
 * 列の位置・有無はブックによって違うので、必ず見出し行の文言から列を探す。
 * 行数も日によって違うため、見出しの次の行から【3】終礼集計の手前までを明細とみなす。
 *
 * ■ ブックと箱の種類
 *   大口: 箱の種類ごとに1冊（上銅 / 銅ダライ / 銅スクラップ）。種類はブック単位。
 *   直方: 部署ごとに1冊（プレス / ベンダー / 炉中）。種類は明細の「品種」列（銅条 / 銅管）と、
 *         シート名の「下銅」で区別する。→ 取込画面で「品種列から」を選ぶ。
 *
 * ■ 日付
 * 日付セルは前日のシートを複製したまま直されていないことが多い（直方は全シートが同じ日付）。
 * シート名（「上銅7.23」「日次記録票 【9.8】 (14)」「【0602】」）がいちばん確かなので、
 * シート名を第一の根拠にし、日付セルと食い違う場合は警告として残す。
 * 年はシート名に無いので、取込画面で指定した年を使い、月が大きく戻ったら翌年に繰り上げる。
 * 「【5.29・6.1分①】」のように複数の日付を持つシートは、行の余白に日付（シリアル値）が
 * あればそれで日ごとに分け、無ければ最初の日付にまとめて警告する。
 *
 * ■ 重量
 * 「実投入／スクラップ重量」列は数式（重量−箱重量）だが、手入力で上書きされている行が
 * 実データにあった。累積・カウンタ重量とは重量−箱重量の側が一致していたので、両方あるときは
 * 重量−箱重量を採用し、食い違う行は警告に出す（アプリの再計算規則とも揃う）。
 */

import type { XlsxCell, XlsxSheet } from "./xlsx";

export interface DailyExcelEntry {
  /** 元シートの行番号（1始まり）。警告表示に使う */
  row: number;
  jikoku: string;
  busho: string;
  kikai: string;
  /** Excelの「品種」（銅条・銅管・パイプなど材質）。箱の種類（hinshu）とは別物 */
  zairyo: string;
  kotei: string;
  /** 重量(kg)＝箱ごと計った重さ。箱重量とセットのときだけ持つ */
  gross: number | null;
  /** 箱重量(kg)＝空き箱 */
  tare: number | null;
  /** 取り込む重量。重量−箱重量（両方あるとき）、無ければ実投入／スクラップ重量 */
  weight: number;
  kirokusha: string;
  ijo: string;
}

export interface DailyExcelSheet {
  sheetName: string;
  /** シート名から決めた日付（YYYY-MM-DD） */
  date: string;
  /** 【1】の日付セル（照合用。前日のシートを複製したまま直っていないことが多い） */
  cellDate: string | null;
  /** シート名に含まれる種類の語（「上銅 7.1」→ 上銅、「【8.17】下銅」→ 下銅）。無ければ空 */
  kindHint: string;
  factory: string;
  sekininsha: string;
  /** 【3】責任者承認のサイン */
  shonin: string;
  /** 【3】投入確認（完了 / 確認者名あり＝true、残あり・空欄＝false） */
  tonyuKanryo: boolean;
  tonyuKanryoBy: string;
  hakoZanryo: number | null;
  /** 回収箱測定値（大口）／計量重量（直方: 計量時総重量−袋重量×袋数）。未記入は null */
  kaishuSokuteichi: number | null;
  biko: string;
  entries: DailyExcelEntry[];
  /** 明細から計算した当日合計 */
  total: number;
  /** Excelの「当日合計」「計量前測定値」セル（照合用） */
  excelTotal: number | null;
  warnings: string[];
}

export interface DailyExcelFile {
  /** ブック内で取り込めるシート（日付順ではなくブックの並び順） */
  sheets: DailyExcelSheet[];
  /** 対象外のシート（マスター・原紙・日付が読めない など）。明細があるのに対象外なら件数を出す */
  skipped: { sheetName: string; entries: number }[];
}

/**
 * シート名に出てくる種類の語。長い語（銅ダライ）から先に見る。
 * 「下胴」は現場の書きぶれ（下銅）。
 */
const KIND_WORDS: { kind: string; words: string[] }[] = [
  { kind: "銅ダライ", words: ["銅ダライ", "ダライ"] },
  { kind: "銅スクラップ", words: ["銅スクラップ", "スクラップ"] },
  { kind: "上銅", words: ["上銅"] },
  { kind: "下銅", words: ["下銅", "下胴"] },
  { kind: "銅管", words: ["銅管"] },
  { kind: "銅条", words: ["銅条"] },
  { kind: "黄銅", words: ["黄銅"] },
  { kind: "自動盤", words: ["自動盤"] },
];

/** シート名に種類の語があればその種類。 */
export function kindFromName(sheetName: string): string {
  const s = sheetName.normalize("NFKC");
  for (const k of KIND_WORDS) {
    if (k.words.some((w) => s.includes(w))) return k.kind;
  }
  return "";
}

/**
 * ブック全体の箱の種類の見当。日付のあるシートの過半数に同じ種類の語があればそれ
 * （大口のブック）。直方のように一部のシートだけ「下銅」が付くブックは空を返す。
 */
export function guessKind(sheetNames: string[]): string {
  const dated = sheetNames.filter((n) => datesOfName(n).dates.length > 0);
  if (dated.length === 0) return "";
  const count = new Map<string, number>();
  for (const n of dated) {
    const k = kindFromName(n);
    if (k) count.set(k, (count.get(k) ?? 0) + 1);
  }
  const top = [...count.entries()].sort((a, b) => b[1] - a[1])[0];
  return top && top[1] * 2 > dated.length ? top[0] : "";
}

/** 全角→半角・空白除去。見出しやラベルの照合に使う。 */
function norm(v: XlsxCell): string {
  if (v === null || v === undefined) return "";
  return String(v)
    .normalize("NFKC")
    .replace(/[\s　"']/g, "");
}

function text(v: XlsxCell, max = 200): string {
  if (v === null || v === undefined) return "";
  return String(v).replace(/[\r\n]+/g, " ").trim().slice(0, max);
}

function numOf(v: XlsxCell): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v.normalize("NFKC").replace(/[,\s]/g, ""));
    return v.trim() !== "" && Number.isFinite(n) ? n : null;
  }
  return null;
}

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/** Excelのシリアル値 → YYYY-MM-DD。1900年うるう年バグ込みの基準日（1899-12-30）。 */
function serialToDate(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1) return null;
  const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

interface MonthDay {
  month: number;
  day: number;
}

function validMd(month: number, day: number): MonthDay | null {
  return month >= 1 && month <= 12 && day >= 1 && day <= 31 ? { month, day } : null;
}

/**
 * シート名などの文字列から 月・日 をすべて取り出す。
 *   「上銅7.23」「7 .29」「6月5日」「【0602】」「5.29・6.1分①」→ 複数
 * range は「8.07-17」のような期間表記（最初の日付にまとめて取り込む）。
 */
export function datesOfName(value: string): { dates: MonthDay[]; range: boolean } {
  const s = value.normalize("NFKC").replace(/[\s　]/g, "");
  const dates: MonthDay[] = [];
  const re = /(\d{1,2})[./\-月](\d{1,2})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const md = validMd(Number(m[1]), Number(m[2]));
    if (md) dates.push(md);
  }
  if (dates.length === 0) {
    // 区切りの無い「0602」のような4桁（月日）
    const m4 = s.match(/(?<!\d)(\d{2})(\d{2})(?!\d)/);
    if (m4) {
      const md = validMd(Number(m4[1]), Number(m4[2]));
      if (md) dates.push(md);
    }
  }
  const range = /\d{1,2}[./\-月]\d{1,2}[-〜~]\d{1,2}(?![./\-月])/.test(s);
  return { dates, range };
}

function ymd(year: number, month: number, day: number): string | null {
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return d.toISOString().slice(0, 10);
}

/** セル値（シリアル値・文字列）から日付らしきものを YYYY-MM-DD で読む。 */
function dateOfCell(v: XlsxCell): string | null {
  if (typeof v === "number") return serialToDate(v);
  if (typeof v === "string") {
    const md = datesOfName(v).dates[0];
    const y = v.normalize("NFKC").match(/(20\d{2})/);
    if (md && y) return ymd(Number(y[1]), md.month, md.day);
  }
  return null;
}

/** 時刻セル（シリアル値の小数部・文字列）→ "HH:MM"。 */
function timeOf(v: XlsxCell): string {
  if (typeof v === "number") {
    const frac = v - Math.floor(v);
    const mins = Math.round(frac * 24 * 60) % (24 * 60);
    return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
  }
  if (typeof v === "string") {
    // 「10；20」のような打ち間違いも拾う
    const m = v.normalize("NFKC").match(/(\d{1,2})\s*[:;：時]\s*(\d{1,2})/);
    if (!m) return "";
    const h = Number(m[1]);
    const mi = Number(m[2]);
    if (h > 23 || mi > 59) return "";
    return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
  }
  return "";
}

/** ラベルのあるセルから右へ、最初の数値を返す。別のラベル（文字列）に当たったら打ち切る。 */
function numberRightOf(row: XlsxCell[], from: number): number | null {
  for (let c = from + 1; c < row.length; c++) {
    const v = row[c];
    if (v === null || v === undefined || v === "") continue;
    if (typeof v === "string") {
      if (v.trim() === "") continue; // 全角空白だけのセル
      return null; // 次のラベル（例「kg」「差異率」）に到達
    }
    const n = numOf(v);
    if (n !== null) return n;
  }
  return null;
}

/** ラベルのあるセルから右へ、最初の値を返す（結合セルのぶん離れていることがある）。 */
function valueRightOf(row: XlsxCell[], from: number): XlsxCell {
  for (let c = from + 1; c < row.length; c++) {
    const v = row[c];
    if (v === null || v === undefined || v === "") continue;
    if (typeof v === "string" && v.trim() === "") continue;
    return v;
  }
  return null;
}

/** ラベルのあるセルから右へ、最初の文字列を返す。 */
function textRightOf(row: XlsxCell[], from: number, max = 50): string {
  return text(valueRightOf(row, from), max);
}

/** 行の中で、正規化した文字列が pred を満たすセルの位置。 */
function findCell(row: XlsxCell[], pred: (s: string) => boolean): number {
  for (let c = 0; c < row.length; c++) {
    const s = norm(row[c]);
    if (s && pred(s)) return c;
  }
  return -1;
}

/** シート全体から、ラベルのある行と列を探す。 */
function findLabel(
  rows: XlsxCell[][],
  pred: (s: string) => boolean,
  opts: { from?: number; to?: number } = {}
): { row: number; col: number } | null {
  const from = opts.from ?? 0;
  const to = Math.min(opts.to ?? rows.length, rows.length);
  for (let r = from; r < to; r++) {
    const c = findCell(rows[r] ?? [], pred);
    if (c >= 0) return { row: r, col: c };
  }
  return null;
}

/** ラベルの右の数値（シート全体から探す）。ラベルが無ければ null。 */
function numberAfterLabel(
  rows: XlsxCell[][],
  pred: (s: string) => boolean,
  opts: { from?: number; to?: number } = {}
): number | null {
  const at = findLabel(rows, pred, opts);
  return at ? numberRightOf(rows[at.row] ?? [], at.col) : null;
}

interface ColumnMap {
  time: number;
  busho: number;
  kikai: number;
  zairyo: number;
  kotei: number;
  gross: number;
  tare: number;
  net: number;
  kirokusha: number;
  ijo: number;
}

const isGrossHeader = (s: string) => s.startsWith("投入重量") || s.startsWith("重量");
const isNetHeader = (s: string) => s.startsWith("実投入") || s.startsWith("スクラップ重量");

/** 明細の見出し行を探す（「時刻」と重量の列がある行）。 */
function findHeaderRow(rows: XlsxCell[][]): number {
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const hasTime = findCell(row, (s) => s === "時刻") >= 0;
    const hasWeight = findCell(row, (s) => isGrossHeader(s) || isNetHeader(s)) >= 0;
    if (hasTime && hasWeight) return r;
  }
  return -1;
}

function columnsOf(header: XlsxCell[]): ColumnMap {
  const at = (pred: (s: string) => boolean): number => findCell(header, pred);
  return {
    time: at((s) => s === "時刻"),
    busho: at((s) => s === "部署"),
    kikai: at((s) => s === "機械"),
    zairyo: at((s) => s === "品種"),
    kotei: at((s) => s === "工程"),
    gross: at(isGrossHeader),
    tare: at((s) => s.startsWith("箱重量")),
    net: at(isNetHeader),
    kirokusha: at((s) => s === "記録者"),
    ijo: at((s) => s === "異常"),
  };
}

/** 「異常」列の「なし」「－」は異常なし＝空にする（そのまま入れると異常件数に数えられる）。 */
function ijoOf(v: XlsxCell): string {
  const s = text(v, 200);
  const n = norm(s);
  if (!n || ["なし", "無し", "無", "-", "ー", "—", "なし。"].includes(n)) return "";
  return s;
}

/**
 * 明細行の余白（見出しの無い右側の列）にある日付。
 * 「【5.29・6.1分①】」のような複数日のシートで、行ごとにどの日の分かを示している。
 */
function rowDateOf(row: XlsxCell[], from: number): string | null {
  for (let c = from; c < row.length; c++) {
    const v = row[c];
    if (typeof v === "number" && v > 40000 && v < 60000) return serialToDate(v);
  }
  return null;
}

interface SheetDates {
  /** シート名の日付（YYYY-MM-DD）。複数日のシートは2つ以上 */
  dates: string[];
  range: boolean;
}

/** 1シートを読む。複数日のシートは日ごとに分けて返す。記録票でない・明細が無いシートは空配列。 */
function parseSheet(sheet: XlsxSheet, sd: SheetDates): DailyExcelSheet[] {
  const rows = sheet.rows;
  const headerRow = findHeaderRow(rows);
  if (headerRow < 0) return [];
  const header = rows[headerRow] ?? [];
  const col = columnsOf(header);
  const warnings: string[] = [];
  const mainDate = sd.dates[0];

  // 【3】終礼集計の見出し行まで（見つからなければシート末尾まで）が明細
  const summaryAt = findLabel(rows, (s) => s.includes("終礼集計"), { from: headerRow + 1 });
  const entriesEnd = summaryAt ? summaryAt.row : rows.length;
  // 余白列（記録者・異常より右）の先頭。複数日のシートで行ごとの日付を探す範囲。
  // 余白列にも「6/2計測」のような見出しが付いていることがあるので、見出しの長さでは決めない
  const marginFrom = Math.max(...Object.values(col)) + 1;

  const byDate = new Map<string, DailyExcelEntry[]>();
  let lastTime = "";
  for (let r = headerRow + 1; r < entriesEnd; r++) {
    const row = rows[r] ?? [];
    let gross = col.gross >= 0 ? numOf(row[col.gross]) : null;
    let tare = col.tare >= 0 ? numOf(row[col.tare]) : null;
    const net = col.net >= 0 ? numOf(row[col.net]) : null;
    // 空行（数式だけが入っている行は 実投入=0）は飛ばす
    if (!((gross ?? 0) > 0 || (tare ?? 0) > 0 || (net ?? 0) > 0)) continue;

    let weight: number;
    if (gross !== null && tare !== null) {
      weight = round3(gross - tare);
      if (net !== null && Math.abs(net - weight) > 0.005) {
        warnings.push(
          `${r + 1}行目: スクラップ重量 ${net}kg と 重量−箱重量 ${weight}kg が違います。${weight}kg で取り込みます`
        );
      }
    } else if (net !== null) {
      weight = round3(net);
      gross = null;
      tare = null;
    } else if (gross !== null) {
      // 箱重量の列が無い様式（重量＝スクラップ重量）
      weight = round3(gross);
      gross = null;
      tare = null;
    } else {
      continue;
    }
    if (weight <= 0) {
      warnings.push(`${r + 1}行目: 重量が ${weight}kg のため取り込みません`);
      continue;
    }

    const jikoku = col.time >= 0 ? timeOf(row[col.time]) : "";
    if (jikoku) lastTime = jikoku;
    // 複数日のシートだけ、行の余白の日付でどの日の分かを決める
    let date = mainDate;
    if (sd.dates.length > 1) {
      const rd = rowDateOf(row, marginFrom);
      if (rd && sd.dates.includes(rd)) date = rd;
    }
    const list = byDate.get(date) ?? [];
    list.push({
      row: r + 1,
      // 時刻が空の行は、Excelの見た目どおり直前の行と同じ時刻とみなす
      jikoku: jikoku || lastTime,
      busho: col.busho >= 0 ? text(row[col.busho], 50) : "",
      kikai: col.kikai >= 0 ? text(row[col.kikai], 50) : "",
      zairyo: col.zairyo >= 0 ? text(row[col.zairyo], 50) : "",
      kotei: col.kotei >= 0 ? text(row[col.kotei], 50) : "",
      gross,
      tare,
      weight,
      kirokusha: col.kirokusha >= 0 ? text(row[col.kirokusha], 120) : "",
      ijo: col.ijo >= 0 ? ijoOf(row[col.ijo]) : "",
    });
    byDate.set(date, list);
  }
  if (byDate.size === 0) return [];

  // 日付セル。シート名と食い違うときの警告はブック単位で出す（parseDailyExcelWorkbook）
  const dateLabel = findLabel(rows, (s) => s === "日付", { to: headerRow });
  const cellDate = dateLabel ? dateOfCell(valueRightOf(rows[dateLabel.row] ?? [], dateLabel.col)) : null;
  if (sd.range) {
    warnings.push(`シート名が期間（複数日）の表記です。すべて ${mainDate} の記録として取り込みます`);
  }
  if (sd.dates.length > 1 && byDate.size === 1) {
    warnings.push(
      `シート名に複数の日付がありますが、行ごとの日付が無いので すべて ${mainDate} の記録として取り込みます`
    );
  }

  const factoryLabel = findLabel(rows, (s) => s === "工場", { to: headerRow });
  const sekininshaLabel = findLabel(rows, (s) => s.startsWith("当番責任者"), { to: headerRow });
  const zanryoLabel = findLabel(rows, (s) => s.startsWith("残量"), { to: headerRow });

  // 【3】終礼集計（大口: 当日合計・回収箱測定値 / 直方: 計量前測定値・計量重量）
  let kaishuSokuteichi: number | null = null;
  let excelTotal: number | null = null;
  let tonyuKanryo = false;
  let tonyuKanryoBy = "";
  let shonin = "";
  if (summaryAt) {
    const from = summaryAt.row;
    const totalLabel = findLabel(rows, (s) => s === "当日合計", { from });
    if (totalLabel) {
      const row = rows[totalLabel.row] ?? [];
      excelTotal = numberRightOf(row, totalLabel.col);
      const kaishuCol = findCell(row, (s) => s.startsWith("回収箱測定値"));
      if (kaishuCol >= 0) kaishuSokuteichi = numberRightOf(row, kaishuCol);
    } else {
      excelTotal = numberAfterLabel(rows, (s) => s.startsWith("計量前測定値"), { from });
      // 計量重量 = 計量時総重量 − 袋重量×袋数。総重量が未記入だと −袋重量 になるので、総重量があるときだけ採用
      const sou = numberAfterLabel(rows, (s) => s.startsWith("計量時総重量"), { from });
      if (sou !== null) kaishuSokuteichi = numberAfterLabel(rows, (s) => s === "計量重量", { from });
    }
    const tonyuLabel = findLabel(rows, (s) => s.startsWith("投入確認"), { from });
    if (tonyuLabel) {
      const row = rows[tonyuLabel.row] ?? [];
      // 「完了」は印刷された文言。その右が「完了」（選択式）か確認者の名前なら確認済み、
      // 「残あり」や注意書き（残あり時は備考へ）・空欄なら未確認
      const doneCol = findCell(row, (s) => s === "完了");
      const next = doneCol >= 0 ? textRightOf(row, doneCol) : "";
      const n = norm(next);
      if (n === "完了") tonyuKanryo = true;
      else if (n && !n.startsWith("残あり") && !n.includes("備考")) {
        tonyuKanryo = true;
        tonyuKanryoBy = next;
      }
    }
    const shoninLabel = findLabel(rows, (s) => s.startsWith("責任者承認"), { from });
    if (shoninLabel) {
      const row = rows[shoninLabel.row] ?? [];
      const signCol = findCell(row, (s) => s === "サイン");
      shonin = signCol >= 0 ? textRightOf(row, signCol) : "";
    }
  }

  // 【4】備考（見出しの次の行から、末尾の注意書き「※…」の手前まで）
  const bikoAt = findLabel(rows, (s) => s.includes("【4】"), { from: summaryAt ? summaryAt.row : headerRow });
  const bikoParts: string[] = [];
  if (bikoAt) {
    for (let r = bikoAt.row + 1; r < rows.length; r++) {
      const line = (rows[r] ?? [])
        .map((v) => text(v, 200))
        .filter((s) => s && !s.startsWith("※"))
        .join(" ");
      if (line) bikoParts.push(line);
    }
  }

  const allEntries = [...byDate.values()].flat();
  const grandTotal = round3(allEntries.reduce((t, e) => t + e.weight, 0));
  if (excelTotal !== null && Math.abs(excelTotal - grandTotal) > 0.05) {
    warnings.push(
      `Excelの当日合計 ${round3(excelTotal)}kg と明細の合計 ${grandTotal}kg が違います（明細の合計で取り込みます）`
    );
  }
  // 回収箱測定値が前日のシートのまま直っていないことがある（実データで1件）
  if (kaishuSokuteichi !== null && Math.abs(kaishuSokuteichi - grandTotal) > Math.max(1, grandTotal * 0.05)) {
    warnings.push(
      `回収箱測定値（計量重量）${kaishuSokuteichi}kg と明細の合計 ${grandTotal}kg が離れています。Excelの値をご確認ください`
    );
  }
  // 日ごとに分けたシートは、終礼の計量値がどの日の分か分からないので入れない
  if (byDate.size > 1 && kaishuSokuteichi !== null) {
    warnings.push("複数日をまとめて計量しているため、回収箱測定値は空で取り込みます");
    kaishuSokuteichi = null;
  }

  const base = {
    sheetName: sheet.name,
    cellDate,
    kindHint: kindFromName(sheet.name),
    factory: factoryLabel ? textRightOf(rows[factoryLabel.row] ?? [], factoryLabel.col) : "",
    sekininsha: sekininshaLabel ? textRightOf(rows[sekininshaLabel.row], sekininshaLabel.col) : "",
    shonin,
    tonyuKanryo,
    tonyuKanryoBy,
    hakoZanryo: zanryoLabel ? numberRightOf(rows[zanryoLabel.row], zanryoLabel.col) : null,
    biko: bikoParts.join(" / ").slice(0, 500),
  };
  return [...byDate.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, entries], i) => ({
      ...base,
      date,
      kaishuSokuteichi,
      entries,
      total: round3(entries.reduce((t, e) => t + e.weight, 0)),
      excelTotal: byDate.size > 1 ? null : excelTotal,
      // 警告はシート単位。分けたときは最初の日にだけ付ける
      warnings: i === 0 ? warnings : [],
    }));
}

/** 同じ内容のシートかどうかの照合キー（複製されたシートを二重に取り込まないため）。 */
function entriesSignature(s: DailyExcelSheet): string {
  return `${s.date}|${s.entries.map((e) => `${e.jikoku}:${e.gross}:${e.tare}:${e.weight}`).join(";")}`;
}

/**
 * ブック1冊を読む。シート名から日付を決め、12月→1月のような戻りがあれば年を繰り上げる。
 * baseYear は取込画面で指定した年（既定はブック内の日付セルから推定）。
 */
export function parseDailyExcelWorkbook(sheets: XlsxSheet[], baseYear: number): DailyExcelFile {
  const out: DailyExcelSheet[] = [];
  const skipped: { sheetName: string; entries: number }[] = [];
  const seen = new Map<string, DailyExcelSheet>();
  let year = baseYear;
  let prevMonth: number | null = null;
  for (const sheet of sheets) {
    const { dates: mds, range } = datesOfName(sheet.name);
    if (mds.length === 0) {
      // 日付が読めないシート。明細があるならその件数を出して気づけるようにする
      skipped.push({ sheetName: sheet.name, entries: countEntries(sheet) });
      continue;
    }
    // 月が大きく戻ったら年をまたいだとみなす（12月→1月。並び替えの前後関係では動かさない）
    if (prevMonth !== null && mds[0].month <= prevMonth - 6) year++;
    prevMonth = mds[0].month;
    const dates: string[] = [];
    for (const md of mds) {
      const d = ymd(year, md.month, md.day);
      if (d && !dates.includes(d)) dates.push(d);
    }
    if (dates.length === 0) {
      skipped.push({ sheetName: sheet.name, entries: countEntries(sheet) });
      continue;
    }
    const parsed = parseSheet(sheet, { dates, range });
    if (parsed.length === 0) {
      skipped.push({ sheetName: sheet.name, entries: 0 });
      continue;
    }
    for (const p of parsed) {
      const sig = entriesSignature(p);
      const dup = seen.get(sig);
      if (dup) {
        dup.warnings.push(`「${p.sheetName}」は「${dup.sheetName}」と同じ内容なので取り込みません（複製されたシート）`);
        continue;
      }
      seen.set(sig, p);
      out.push(p);
    }
  }

  // 日付セルがシート名と違うシート。同じ日付が何枚にも残っていれば「原紙の日付のまま」なので
  // 1回だけ知らせ、それ以外（前日のシートを複製したまま）は1枚ずつ警告する。
  const mismatched = out.filter((p) => p.cellDate && p.cellDate !== p.date);
  const cellDateCount = new Map<string, number>();
  for (const p of mismatched) cellDateCount.set(p.cellDate!, (cellDateCount.get(p.cellDate!) ?? 0) + 1);
  for (const p of mismatched) {
    const n = cellDateCount.get(p.cellDate!) ?? 0;
    if (n >= 3) {
      if (p === mismatched.find((q) => q.cellDate === p.cellDate)) {
        p.warnings.unshift(
          `日付セルが ${n}枚のシートで「${p.cellDate}」のまま（原紙の日付）です。すべてシート名の日付で取り込みます`
        );
      }
    } else {
      p.warnings.unshift(`日付セル(${p.cellDate})がシート名と違います。シート名の ${p.date} で取り込みます`);
    }
  }
  return { sheets: out, skipped };
}

/** 記録票の明細行数（対象外シートの表示用。日付は見ない）。 */
function countEntries(sheet: XlsxSheet): number {
  return parseSheet(sheet, { dates: ["0000-00-00"], range: false }).reduce((t, s) => t + s.entries.length, 0);
}

/** ブック内の日付セルから年を推定する（見つからなければ null）。 */
export function guessYear(sheets: XlsxSheet[]): number | null {
  const years: number[] = [];
  for (const sheet of sheets) {
    const headerRow = findHeaderRow(sheet.rows);
    if (headerRow < 0) continue;
    const label = findLabel(sheet.rows, (s) => s === "日付", { to: headerRow });
    if (!label) continue;
    const d = dateOfCell(valueRightOf(sheet.rows[label.row] ?? [], label.col));
    const y = d ? Number(d.slice(0, 4)) : NaN;
    // 1900年（日付セルの入力ミス）や空欄は数えない
    if (Number.isFinite(y) && y >= 2000 && y <= 2100) years.push(y);
  }
  if (years.length === 0) return null;
  const count = new Map<number, number>();
  for (const y of years) count.set(y, (count.get(y) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

/** ブック内の明細でいちばん多い「品種」（直方のように種類を品種列で分けるブックの既定値）。 */
export function commonZairyo(file: DailyExcelFile): string {
  const count = new Map<string, number>();
  for (const s of file.sheets) {
    for (const e of s.entries) {
      if (e.zairyo) count.set(e.zairyo, (count.get(e.zairyo) ?? 0) + 1);
    }
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
}

// ===== 取込用のかたち（日付ごとに1枚の記録票へまとめる） =====

export interface DailyImportEntry {
  jikoku: string;
  /** 箱の種類（上銅 / 銅ダライ / 銅スクラップ / 銅条 / 銅管…） */
  kind: string;
  busho: string;
  kikai: string;
  zairyo: string;
  kotei: string;
  gross: number | null;
  tare: number | null;
  weight: number;
  kirokusha: string;
  ijo: string;
}

export interface DailyImportDay {
  recordDate: string;
  sekininsha: string;
  shonin: string;
  tonyuKanryo: boolean;
  hakoZanryo: number | null;
  kaishuSokuteichi: number | null;
  biko: string;
  entries: DailyImportEntry[];
  /** 画面表示用: どのシートから来たか */
  sources: { kind: string; sheetName: string; count: number; total: number }[];
  total: number;
  warnings: string[];
}

/**
 * 箱の種類の決め方。
 *   file   … ブック全体で1つ（大口: 種類ごとのブック）
 *   zairyo … シート名の種類の語 → 明細の「品種」列 → 既定（直方: 部署ごとのブック）
 */
export type KindMode = "file" | "zairyo";

export interface DailyExcelSource {
  /** 箱の種類（kindMode=file のとき全明細、zairyo のとき品種が空の明細に使う） */
  kind: string;
  kindMode: KindMode;
  fileName: string;
  file: DailyExcelFile;
}

function kindOfEntry(src: DailyExcelSource, sheet: DailyExcelSheet, e: DailyExcelEntry): string {
  if (src.kindMode !== "zairyo") return src.kind;
  return sheet.kindHint || e.zairyo || src.kind;
}

/**
 * 複数のブックを日付でまとめ、1日=1枚の記録票にする。
 * アプリの日次記録は「日付×工場」で1枚なので、箱・部署ごとのシートは同じ日の記録票の明細として並ぶ。
 */
export function buildDailyImport(
  sources: DailyExcelSource[],
  opts: { factory?: string } = {}
): DailyImportDay[] {
  const byDate = new Map<string, DailyImportDay>();
  const target = norm(opts.factory ?? "");
  // 回収箱測定値が未記入の箱がある日は、合計しても比べられないので空で取り込む
  const missingKaishu = new Set<string>();

  for (const src of sources) {
    for (const sheet of src.file.sheets) {
      let day = byDate.get(sheet.date);
      if (!day) {
        day = {
          recordDate: sheet.date,
          sekininsha: "",
          shonin: "",
          tonyuKanryo: true,
          hakoZanryo: null,
          kaishuSokuteichi: null,
          biko: "",
          entries: [],
          sources: [],
          total: 0,
          warnings: [],
        };
        byDate.set(sheet.date, day);
      }
      const kinds: string[] = [];
      for (const e of sheet.entries) {
        const kind = kindOfEntry(src, sheet, e);
        if (!kinds.includes(kind)) kinds.push(kind);
        day.entries.push({
          jikoku: e.jikoku,
          kind,
          busho: e.busho,
          kikai: e.kikai,
          zairyo: e.zairyo,
          kotei: e.kotei,
          gross: e.gross,
          tare: e.tare,
          weight: e.weight,
          kirokusha: e.kirokusha,
          ijo: e.ijo,
        });
      }
      const kindLabel = kinds.join("・");
      if (!day.sekininsha && sheet.sekininsha) day.sekininsha = sheet.sekininsha;
      if (!day.shonin && sheet.shonin) day.shonin = sheet.shonin;
      // 1つでも投入確認が無いシートがあれば「全量投入の確認済み」にはしない
      if (!sheet.tonyuKanryo) day.tonyuKanryo = false;
      if (sheet.hakoZanryo !== null) day.hakoZanryo = (day.hakoZanryo ?? 0) + sheet.hakoZanryo;
      // 回収箱測定値は箱（シート）ごとの値。アプリは1日1つなので、その日の合計を入れる
      if (sheet.kaishuSokuteichi !== null) {
        day.kaishuSokuteichi = round3((day.kaishuSokuteichi ?? 0) + sheet.kaishuSokuteichi);
      } else {
        missingKaishu.add(sheet.date);
        day.warnings.push(
          `[${kindLabel} ${sheet.sheetName}] 回収箱測定値（計量重量）が未記入のため、この日の回収箱測定値は空で取り込みます`
        );
      }
      day.sources.push({
        kind: kindLabel,
        sheetName: sheet.sheetName,
        count: sheet.entries.length,
        total: sheet.total,
      });
      for (const w of sheet.warnings) day.warnings.push(`[${kindLabel} ${sheet.sheetName}] ${w}`);
      // シートの工場が取込先と違う（別の工場のブックを選んでいる）ときは気づけるようにする
      const sheetFactory = norm(sheet.factory);
      if (target && sheetFactory && !sheetFactory.includes(target) && !target.includes(sheetFactory)) {
        day.warnings.push(
          `[${kindLabel} ${sheet.sheetName}] シートの工場「${sheet.factory}」が取込先と違います`
        );
      }

      // 備考は、どのシートから来たかが後から分かるように組み立てる
      const parts = [
        `${kindLabel}: シート「${sheet.sheetName}」${sheet.entries.length}件 ${sheet.total}kg`,
        sheet.kaishuSokuteichi !== null ? `回収箱 ${sheet.kaishuSokuteichi}kg` : "",
        sheet.tonyuKanryo ? `投入確認${sheet.tonyuKanryoBy ? ` ${sheet.tonyuKanryoBy}` : "済"}` : "",
        sheet.shonin ? `承認 ${sheet.shonin}` : "",
        sheet.biko,
      ].filter(Boolean);
      day.biko = day.biko ? `${day.biko}\n${parts.join(" / ")}` : parts.join(" / ");
    }
  }

  const days = [...byDate.values()];
  for (const day of days) {
    if (missingKaishu.has(day.recordDate)) day.kaishuSokuteichi = null;
    // 時刻順（時刻が無い行はシートごとの並びのまま最後へ）
    day.entries = day.entries
      .map((e, i) => ({ e, i }))
      .sort((a, b) => {
        const ka = a.e.jikoku || "99:99";
        const kb = b.e.jikoku || "99:99";
        return ka === kb ? a.i - b.i : ka < kb ? -1 : 1;
      })
      .map((x) => x.e);
    day.total = round3(day.entries.reduce((t, e) => t + e.weight, 0));
    day.biko = `※Excelの日次記録票から取込\n${day.biko}`.slice(0, 2000);
  }
  days.sort((a, b) => (a.recordDate < b.recordDate ? -1 : a.recordDate > b.recordDate ? 1 : 0));
  return days;
}
