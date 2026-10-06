/** 数値表示 (kg): カンマ区切り・小数 digits 桁。null/NaN は "-"。 */
export function fmt(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "-";
  return Number(v).toLocaleString("ja-JP", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** パーセント表示（v は割合。0.05 → "5.0%"）。 */
export function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || Number.isNaN(v) || !Number.isFinite(v)) return "-";
  return (v * 100).toFixed(digits) + "%";
}

/** 入力値 → 数値（カンマ除去。空・不正は 0）。 */
export function toNum(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isNaN(n) ? 0 : n;
}

/** 入力値 → 数値 or null（空欄は null のまま保持する月次入力用）。 */
export function toNumOrNull(v: unknown): number | null {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isNaN(n) ? null : n;
}

/** 今日 'YYYY-MM-DD'（JST）。 */
export function todayStr(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

/** 今月 'YYYY-MM'（JST）。 */
export function thisMonthStr(): string {
  return todayStr().slice(0, 7);
}

/** 2026/08, 202608, 2026-8, 2026/08/15 などを '2026-08' に正規化。失敗時 null。 */
export function normYm(s: unknown): string | null {
  if (s === null || s === undefined) return null;
  const t = String(s).trim();
  let m = t.match(/^(\d{4})[/\-年]?(\d{1,2})月?$/);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    if (mo >= 1 && mo <= 12) return `${y}-${String(mo).padStart(2, "0")}`;
  }
  m = t.match(/^(\d{4})[/\-](\d{1,2})[/\-]\d{1,2}/);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    if (mo >= 1 && mo <= 12) return `${y}-${String(mo).padStart(2, "0")}`;
  }
  return null;
}

/**
 * 2026/8/5, 2026-08-05, Excelのシリアル日付表示等を 'YYYY-MM-DD' に正規化。失敗時 null。
 * baseYm（'YYYY-MM'）を渡すと、年の無い「9月1日」「9/1」も読む。Excelで「m月d日」表示の
 * 列をCSVに保存すると年が落ちるため。年は baseYm に最も近い月になる年を採る
 * （1月の画面で「12月28日」なら前年）。
 */
export function normDateStr(s: unknown, baseYm?: string): string | null {
  if (s === null || s === undefined) return null;
  const t = String(s).trim();
  const md = baseYm && isYmStr(baseYm) ? t.match(/^(\d{1,2})[/\-月](\d{1,2})日?$/) : null;
  if (md) {
    const mo = Number(md[1]);
    const d = Number(md[2]);
    const base = Number(baseYm!.slice(0, 4)) * 12 + Number(baseYm!.slice(5, 7)) - 1;
    const y = [-1, 0, 1]
      .map((k) => Number(baseYm!.slice(0, 4)) + k)
      .reduce((a, b) =>
        Math.abs(b * 12 + mo - 1 - base) < Math.abs(a * 12 + mo - 1 - base) ? b : a
      );
    // 実在する日付だけ通す（9月31日などは読めない扱い）
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (mo >= 1 && mo <= 12 && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d) {
      return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
    return null;
  }
  const m = t.match(/^(\d{4})[/\-年](\d{1,2})[/\-月](\d{1,2})日?/);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }
  return null;
}

/** 'YYYY-MM-DD' 形式か。 */
export function isDateStr(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/** 'YYYY-MM' 形式か。 */
export function isYmStr(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}$/.test(s);
}
