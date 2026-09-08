/**
 * 現場のExcel「スクラップ日次記録票」を読み取って、アプリの日次記録に載せる形に直す。
 * 純粋関数だけを置く（ファイル読み込みは xlsx.ts、保存は actions.ts）。
 *
 * ■ 取り込み元のExcel（1シート＝1日×1つの箱）
 *   【1】朝礼確認   前日記録の結果 / 箱の残量(kg)
 *   【2】日中記録   日付・時刻・部署・機械・品種・工程・投入重量・箱重量・実投入・累積・カウンタ重量・記録者・異常
 *   【3】終礼集計   当日合計 / 回収箱測定値 / 投入確認 / 責任者承認
 *   【4】備考
 * 列の位置はブックによって違う（「累積差」列がある版・無い版がある）ので、
 * 必ず見出し行の文言から列を探す。行数も日によって違うため、
 * 見出しの次の行から【3】終礼集計の手前までを明細とみなす。
 *
 * ■ 日付
 * 日付セル（C3）は前日のシートを複製したまま直されていないことが多い（実データで9件）。
 * シート名（例「上銅7.23」）がいちばん確かなので、シート名を第一の根拠にし、
 * 日付セル・明細の日付列と食い違う場合は警告として残す。
 * 年はシート名に無いので、取込画面で指定した年を使い、月が大きく戻ったら翌年に繰り上げる。
 *
 * ■ 重量
 * 「実投入」列は数式（投入重量−箱重量）だが、手入力で上書きされている行が実データに1件あった。
 * 累積・カウンタ重量とは投入重量−箱重量の側が一致していたので、両方あるときは
 * 投入重量−箱重量を採用し、実投入と食い違う行は警告に出す（アプリの再計算規則とも揃う）。
 */

import type { XlsxCell, XlsxSheet } from "./xlsx";

export interface DailyExcelEntry {
  /** 元シートの行番号（1始まり）。警告表示に使う */
  row: number;
  jikoku: string;
  busho: string;
  kikai: string;
  /** Excelの「品種」（銅条・パイプなど材質）。箱の種類（hinshu）とは別物 */
  zairyo: string;
  kotei: string;
  /** 投入重量(kg)＝箱ごと計った重さ */
  gross: number | null;
  /** 箱重量(kg)＝空き箱 */
  tare: number | null;
  /** 取り込む重量。投入重量−箱重量（両方あるとき）、無ければ実投入 */
  weight: number;
  kirokusha: string;
  ijo: string;
}

export interface DailyExcelSheet {
  sheetName: string;
  /** シート名から決めた日付（YYYY-MM-DD） */
  date: string;
  factory: string;
  sekininsha: string;
  /** 【3】責任者承認のサイン */
  shonin: string;
  /** 【3】投入確認の確認者（空＝未確認） */
  tonyuKanryoBy: string;
  hakoZanryo: number | null;
  kaishuSokuteichi: number | null;
  biko: string;
  entries: DailyExcelEntry[];
  /** 明細から計算した当日合計 */
  total: number;
  /** Excelの「当日合計」セル（照合用） */
  excelTotal: number | null;
  warnings: string[];
}

export interface DailyExcelFile {
  /** ブック内で取り込めたシート（日付順ではなくブックの並び順） */
  sheets: DailyExcelSheet[];
  /** 明細が無い・記録票ではないシート（マスター・Sheet1 など） */
  skipped: string[];
}

/** 記録票のシート名から見当をつけた箱の種類。 */
export function guessKind(sheetNames: string[]): string {
  const joined = sheetNames.join(" ");
  if (joined.includes("ダライ")) return "銅ダライ";
  if (joined.includes("上銅")) return "上銅";
  if (joined.includes("スクラップ")) return "銅スクラップ";
  return "";
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

/** 「7月23」「7/23」「7.23（2）」などから 月・日 を取り出す。 */
function monthDayOf(value: string): { month: number; day: number } | null {
  const s = value.normalize("NFKC").replace(/[\s　]/g, "");
  const m = s.match(/(\d{1,2})\s*[./\-月]\s*(\d{1,2})/);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { month, day };
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
    const md = monthDayOf(v);
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
    if (typeof v === "string") return null; // 次のラベル（例「kg」「差異率」）に到達
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

interface ColumnMap {
  date: number;
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

/** 明細の見出し行を探す（「時刻」と「投入重量」がある行）。 */
function findHeaderRow(rows: XlsxCell[][]): number {
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const hasTime = findCell(row, (s) => s === "時刻") >= 0;
    const hasWeight = findCell(row, (s) => s.startsWith("投入重量") || s.startsWith("実投入")) >= 0;
    if (hasTime && hasWeight) return r;
  }
  return -1;
}

function columnsOf(header: XlsxCell[]): ColumnMap {
  const at = (pred: (s: string) => boolean): number => findCell(header, pred);
  return {
    date: at((s) => s === "日付"),
    time: at((s) => s === "時刻"),
    busho: at((s) => s === "部署"),
    kikai: at((s) => s === "機械"),
    zairyo: at((s) => s === "品種"),
    kotei: at((s) => s === "工程"),
    gross: at((s) => s.startsWith("投入重量")),
    tare: at((s) => s.startsWith("箱重量")),
    net: at((s) => s.startsWith("実投入")),
    kirokusha: at((s) => s === "記録者"),
    ijo: at((s) => s === "異常"),
  };
}

/** 1シート（＝1日×1つの箱）を読む。記録票でない・明細が無いシートは null。 */
function parseSheet(sheet: XlsxSheet, date: string): DailyExcelSheet | null {
  const rows = sheet.rows;
  const headerRow = findHeaderRow(rows);
  if (headerRow < 0) return null;
  const col = columnsOf(rows[headerRow] ?? []);
  const warnings: string[] = [];

  // 【3】終礼集計の見出し行まで（見つからなければシート末尾まで）が明細
  const summaryAt = findLabel(rows, (s) => s.includes("終礼集計"), { from: headerRow + 1 });
  const entriesEnd = summaryAt ? summaryAt.row : rows.length;

  const entries: DailyExcelEntry[] = [];
  let lastTime = "";
  for (let r = headerRow + 1; r < entriesEnd; r++) {
    const row = rows[r] ?? [];
    const gross = col.gross >= 0 ? numOf(row[col.gross]) : null;
    const tare = col.tare >= 0 ? numOf(row[col.tare]) : null;
    const net = col.net >= 0 ? numOf(row[col.net]) : null;
    // 空行（数式だけが入っている行は 実投入=0）は飛ばす
    if (!((gross ?? 0) > 0 || (tare ?? 0) > 0 || (net ?? 0) > 0)) continue;

    let weight: number;
    if (gross !== null && tare !== null) {
      weight = round3(gross - tare);
      if (net !== null && Math.abs(net - weight) > 0.005) {
        warnings.push(
          `${r + 1}行目: 実投入 ${net}kg と 投入重量−箱重量 ${weight}kg が違います。${weight}kg で取り込みます`
        );
      }
    } else if (net !== null) {
      weight = round3(net);
    } else {
      continue;
    }
    if (weight <= 0) {
      warnings.push(`${r + 1}行目: 重量が ${weight}kg のため取り込みません`);
      continue;
    }

    const jikoku = col.time >= 0 ? timeOf(row[col.time]) : "";
    if (jikoku) lastTime = jikoku;
    entries.push({
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
      ijo: col.ijo >= 0 ? text(row[col.ijo], 200) : "",
    });
  }
  if (entries.length === 0) return null;

  // 日付セル・明細の日付列がシート名と食い違っていたら警告（シート名を採用する）
  const dateLabel = findLabel(rows, (s) => s === "日付", { to: headerRow });
  const cellDate = dateLabel ? dateOfCell(valueRightOf(rows[dateLabel.row] ?? [], dateLabel.col)) : null;
  if (cellDate && cellDate !== date) {
    warnings.push(`日付セル(${cellDate})がシート名と違います。シート名の ${date} で取り込みます`);
  }

  const factoryLabel = findLabel(rows, (s) => s === "工場", { to: headerRow });
  const sekininshaLabel = findLabel(rows, (s) => s.startsWith("当番責任者"), { to: headerRow });
  const zanryoLabel = findLabel(rows, (s) => s.startsWith("残量"), { to: headerRow });

  // 【3】終礼集計
  let kaishuSokuteichi: number | null = null;
  let excelTotal: number | null = null;
  let tonyuKanryoBy = "";
  let shonin = "";
  if (summaryAt) {
    const totalLabel = findLabel(rows, (s) => s === "当日合計", { from: summaryAt.row });
    if (totalLabel) {
      const row = rows[totalLabel.row] ?? [];
      excelTotal = numberRightOf(row, totalLabel.col);
      const kaishuCol = findCell(row, (s) => s.startsWith("回収箱測定値"));
      if (kaishuCol >= 0) kaishuSokuteichi = numberRightOf(row, kaishuCol);
    }
    const tonyuLabel = findLabel(rows, (s) => s.startsWith("投入確認"), { from: summaryAt.row });
    if (tonyuLabel) {
      const row = rows[tonyuLabel.row] ?? [];
      // 「完了」は印刷された文言なので、その右にある名前が確認者
      const doneCol = findCell(row, (s) => s === "完了");
      const name = doneCol >= 0 ? textRightOf(row, doneCol) : "";
      tonyuKanryoBy = name.includes("備考") ? "" : name;
    }
    const shoninLabel = findLabel(rows, (s) => s.startsWith("責任者承認"), { from: summaryAt.row });
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

  const total = round3(entries.reduce((t, e) => t + e.weight, 0));
  if (excelTotal !== null && Math.abs(excelTotal - total) > 0.05) {
    warnings.push(
      `Excelの当日合計 ${round3(excelTotal)}kg と明細の合計 ${total}kg が違います（明細の合計で取り込みます）`
    );
  }
  // 回収箱測定値が前日のシートのまま直っていないことがある（実データで1件）
  if (kaishuSokuteichi !== null && Math.abs(kaishuSokuteichi - total) > Math.max(1, total * 0.05)) {
    warnings.push(
      `回収箱測定値 ${kaishuSokuteichi}kg と明細の合計 ${total}kg が離れています。Excelの値をご確認ください`
    );
  }

  return {
    sheetName: sheet.name,
    date,
    factory: factoryLabel ? textRightOf(rows[factoryLabel.row] ?? [], factoryLabel.col) : "",
    sekininsha: sekininshaLabel ? textRightOf(rows[sekininshaLabel.row], sekininshaLabel.col) : "",
    shonin,
    tonyuKanryoBy,
    hakoZanryo: zanryoLabel ? numberRightOf(rows[zanryoLabel.row], zanryoLabel.col) : null,
    kaishuSokuteichi,
    biko: bikoParts.join(" / ").slice(0, 500),
    entries,
    total,
    excelTotal,
    warnings,
  };
}

/**
 * ブック1冊を読む。シート名から日付を決め、12月→1月のような戻りがあれば年を繰り上げる。
 * baseYear は取込画面で指定した年（既定はブック内の日付セルから推定）。
 */
export function parseDailyExcelWorkbook(sheets: XlsxSheet[], baseYear: number): DailyExcelFile {
  const out: DailyExcelSheet[] = [];
  const skipped: string[] = [];
  let year = baseYear;
  let prevMonth: number | null = null;
  for (const sheet of sheets) {
    const md = monthDayOf(sheet.name);
    if (!md) {
      skipped.push(sheet.name);
      continue;
    }
    // 月が大きく戻ったら年をまたいだとみなす（12月→1月。並び替えの前後関係では動かさない）
    if (prevMonth !== null && md.month <= prevMonth - 6) year++;
    prevMonth = md.month;
    const date = ymd(year, md.month, md.day);
    if (!date) {
      skipped.push(sheet.name);
      continue;
    }
    const parsed = parseSheet(sheet, date);
    if (!parsed) {
      skipped.push(sheet.name);
      continue;
    }
    out.push(parsed);
  }
  return { sheets: out, skipped };
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

// ===== 取込用のかたち（日付ごとに1枚の記録票へまとめる） =====

export interface DailyImportEntry {
  jikoku: string;
  /** 箱の種類（上銅 / 銅ダライ / 銅スクラップ…） */
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

export interface DailyExcelSource {
  /** 箱の種類（ファイルごとに1つ） */
  kind: string;
  fileName: string;
  file: DailyExcelFile;
}

/**
 * 複数のブック（箱の種類ごとに1冊）を日付でまとめ、1日=1枚の記録票にする。
 * アプリの日次記録は「日付×工場」で1枚なので、上銅・銅ダライ・銅スクラップの
 * シートは同じ日の記録票の明細として並ぶ。
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
      for (const e of sheet.entries) {
        day.entries.push({
          jikoku: e.jikoku,
          kind: src.kind,
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
      if (!day.sekininsha && sheet.sekininsha) day.sekininsha = sheet.sekininsha;
      if (!day.shonin && sheet.shonin) day.shonin = sheet.shonin;
      // 1つでも投入確認が空の箱があれば「全量投入の確認済み」にはしない
      if (!sheet.tonyuKanryoBy) day.tonyuKanryo = false;
      if (sheet.hakoZanryo !== null) day.hakoZanryo = (day.hakoZanryo ?? 0) + sheet.hakoZanryo;
      // 回収箱測定値は箱ごとの値。アプリは1日1つなので、その日の箱の合計を入れる
      if (sheet.kaishuSokuteichi !== null) {
        day.kaishuSokuteichi = round3((day.kaishuSokuteichi ?? 0) + sheet.kaishuSokuteichi);
      } else {
        missingKaishu.add(sheet.date);
        day.warnings.push(
          `[${src.kind} ${sheet.sheetName}] 回収箱測定値が未記入のため、この日の回収箱測定値は空で取り込みます`
        );
      }
      day.sources.push({
        kind: src.kind,
        sheetName: sheet.sheetName,
        count: sheet.entries.length,
        total: sheet.total,
      });
      for (const w of sheet.warnings) day.warnings.push(`[${src.kind} ${sheet.sheetName}] ${w}`);
      // シートの工場が取込先と違う（別の工場のブックを選んでいる）ときは気づけるようにする
      const sheetFactory = norm(sheet.factory);
      if (target && sheetFactory && !sheetFactory.includes(target) && !target.includes(sheetFactory)) {
        day.warnings.push(
          `[${src.kind} ${sheet.sheetName}] シートの工場「${sheet.factory}」が取込先と違います`
        );
      }

      // 備考は、どのシートから来たかが後から分かるように組み立てる
      const parts = [
        `${src.kind}: シート「${sheet.sheetName}」${sheet.entries.length}件 ${sheet.total}kg`,
        sheet.kaishuSokuteichi !== null ? `回収箱 ${sheet.kaishuSokuteichi}kg` : "",
        sheet.tonyuKanryoBy ? `投入確認 ${sheet.tonyuKanryoBy}` : "",
        sheet.shonin ? `承認 ${sheet.shonin}` : "",
        sheet.biko,
      ].filter(Boolean);
      day.biko = day.biko ? `${day.biko}\n${parts.join(" / ")}` : parts.join(" / ");
    }
  }

  const days = [...byDate.values()];
  for (const day of days) {
    if (missingKaishu.has(day.recordDate)) day.kaishuSokuteichi = null;
    // 時刻順（時刻が無い行は箱ごとの並びのまま最後へ）
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
