/* 共通ユーティリティ */
const Util = {
  /** 数値表示 (kg): カンマ区切り・小数はdigits桁 */
  fmt(v, digits = 1) {
    if (v === null || v === undefined || v === '' || isNaN(v)) return '-';
    return Number(v).toLocaleString('ja-JP', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  },
  /** パーセント表示 */
  fmtPct(v, digits = 1) {
    if (v === null || v === undefined || isNaN(v) || !isFinite(v)) return '-';
    return (v * 100).toFixed(digits) + '%';
  },
  num(v) {
    if (v === null || v === undefined || v === '') return 0;
    const n = Number(String(v).replace(/,/g, ''));
    return isNaN(n) ? 0 : n;
  },
  todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  },
  thisMonthStr() {
    return this.todayStr().slice(0, 7);
  },
  /** 2026/08, 202608, 2026-8 などを '2026-08' に正規化。失敗時 null */
  normYm(s) {
    if (s === null || s === undefined) return null;
    s = String(s).trim();
    let m = s.match(/^(\d{4})[\/\-年]?(\d{1,2})月?$/);
    if (m) {
      const y = Number(m[1]), mo = Number(m[2]);
      if (mo >= 1 && mo <= 12) return `${y}-${String(mo).padStart(2, '0')}`;
    }
    // 日付形式 (2026/08/15 等) は年月部分を採用
    m = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-]\d{1,2}/);
    if (m) {
      const y = Number(m[1]), mo = Number(m[2]);
      if (mo >= 1 && mo <= 12) return `${y}-${String(mo).padStart(2, '0')}`;
    }
    return null;
  },
  nextYm(ym) {
    const [y, m] = ym.split('-').map(Number);
    return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  },
  /** 月末日 'YYYY-MM-DD' */
  monthEnd(ym) {
    const [y, m] = ym.split('-').map(Number);
    const last = new Date(y, m, 0).getDate();
    return `${ym}-${String(last).padStart(2, '0')}`;
  },
  esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },

  /* ---------- CSV ---------- */
  /** CSVテキスト → 2次元配列 (引用符・改行対応) */
  parseCsv(text) {
    const rows = [];
    let row = [], field = '', inQ = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQ = false;
        } else field += c;
      } else if (c === '"') inQ = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        rows.push(row); row = [];
      } else field += c;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.filter(r => r.some(v => String(v).trim() !== ''));
  },
  toCsv(rows) {
    return rows.map(r => r.map(v => {
      v = String(v ?? '');
      return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    }).join(',')).join('\r\n');
  },
  /** File → テキスト (UTF-8優先、失敗時 Shift_JIS) */
  async readTextFile(file) {
    const buf = await file.arrayBuffer();
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^\uFEFF/, '');
    } catch (e) {
      return new TextDecoder('shift_jis').decode(buf);
    }
  },
  downloadCsv(filename, rows) {
    const bom = '\uFEFF';
    const blob = new Blob([bom + this.toCsv(rows)], { type: 'text/csv;charset=utf-8' });
    this.downloadBlob(filename, blob);
  },
  downloadBlob(filename, blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
};
