/* ④ McFrame 完成品数量(加工数)取込 */
const Mcframe = {
  init() {
    document.getElementById('mcframe-month').value = Util.thisMonthStr();
    document.getElementById('mcframe-import').addEventListener('click', () => document.getElementById('mcframe-file').click());
    document.getElementById('mcframe-file').addEventListener('change', e => this.importCsv(e));
    document.getElementById('mcframe-refresh').addEventListener('click', () => this.render());
    document.getElementById('mcframe-export').addEventListener('click', () => this.exportCsv());
    this.render();
  },

  async importCsv(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const text = await Util.readTextFile(file);
    const rows = Util.parseCsv(text);
    if (!rows.length) { alert('CSVが空です。'); return; }

    // ヘッダー検出
    let start = 0;
    const h = rows[0].map(v => String(v).trim());
    const looksHeader = h.some(v => /key|年月|加工数|図番|数量/i.test(v));
    let idxKey = 0, idxYm = 1, idxQty = 2, idxBasho = -1;
    if (looksHeader) {
      start = 1;
      const find = (...names) => h.findIndex(v => names.some(n => v.toLowerCase() === n || v.includes(n)));
      const k = find('key', '管理図番');
      const b = find('製造場所');
      const y = find('年月', '日付');
      const q = find('加工数', '数量', 'qty');
      if (k >= 0) idxKey = k;
      if (b >= 0) idxBasho = b;
      if (y >= 0) idxYm = y;
      if (q >= 0) idxQty = q;
    } else if (rows[0].length >= 4 && Util.normYm(rows[0][2])) {
      // ヘッダー無し4列: 管理図番, 製造場所CD, 年月, 加工数
      idxKey = 0; idxBasho = 1; idxYm = 2; idxQty = 3;
    }

    const data = Store.getMcframe();
    const map = new Map(data.map(r => [r.ym + '|' + r.key, r]));
    const knownKeys = new Set(Store.getItems().map(it => it.key));
    let count = 0, unknown = 0, bad = 0;
    for (const r of rows.slice(start)) {
      const key = String(r[idxKey] ?? '').trim() + (idxBasho >= 0 ? String(r[idxBasho] ?? '').trim() : '');
      const ym = Util.normYm(r[idxYm]);
      const qty = Util.num(r[idxQty]);
      if (!key || !ym) { bad++; continue; }
      const id = ym + '|' + key;
      if (map.has(id)) map.get(id).qty = qty;
      else { const rec = { ym, key, qty }; data.push(rec); map.set(id, rec); }
      count++;
      if (!knownKeys.has(key)) unknown++;
    }
    Store.setMcframe(data);
    document.getElementById('mcframe-msg').textContent =
      `取込完了: ${count}件 (マスター未登録KEY: ${unknown}件 / 読取不可行: ${bad}件)`;
    this.render();
  },

  render() {
    const ym = document.getElementById('mcframe-month').value;
    const rows = Calc.monthlyItemRows(ym);
    const t = document.getElementById('mcframe-table');
    const head = `<tr><th>KEY</th><th>品名</th><th>区分</th><th class="num">加工数</th>
      <th class="num">単品完成重量(kg)</th><th>重量根拠</th>
      <th class="num">完成重量(kg)</th><th class="num">使用量(kg)</th><th class="num">理論スクラップ(kg)</th></tr>`;
    const body = rows.map(r => `<tr>
      <td>${Util.esc(r.key)}</td>
      <td>${r.item ? Util.esc(r.item.hinmei) : '<span class="badge">マスター未登録</span>'}</td>
      <td>${Util.esc(r.kubun)}</td>
      <td class="num">${Util.fmt(r.qty, 0)}</td>
      <td class="num">${Util.fmt(r.unitFinished, 6)}</td>
      <td><span class="badge ${r.unitSource === '実測' ? 'jissoku' : 'riron'}">${r.unitSource}${r.faDate ? ' ' + r.faDate : ''}</span></td>
      <td class="num">${Util.fmt(r.finished)}</td>
      <td class="num">${Util.fmt(r.usage)}</td>
      <td class="num ${r.scrap < 0 ? 'neg' : ''}">${Util.fmt(r.scrap)}</td></tr>`).join('');
    const sum = k => rows.reduce((s, r) => s + r[k], 0);
    const foot = rows.length ? `<tr class="total"><td colspan="3">合計 (${rows.length}品目)</td>
      <td class="num">${Util.fmt(sum('qty'), 0)}</td><td></td><td></td>
      <td class="num">${Util.fmt(sum('finished'))}</td><td class="num">${Util.fmt(sum('usage'))}</td>
      <td class="num">${Util.fmt(sum('scrap'))}</td></tr>` : '';
    t.innerHTML = `<thead>${head}</thead><tbody>${body || '<tr><td colspan="9">対象月の加工数データがありません</td></tr>'}${foot}</tbody>`;
  },

  exportCsv() {
    const ym = document.getElementById('mcframe-month').value;
    const rows = [['KEY', '品名', '区分', '加工数', '単品完成重量(kg)', '重量根拠', '完成重量(kg)', '使用量(kg)', '理論スクラップ(kg)']];
    for (const r of Calc.monthlyItemRows(ym)) {
      rows.push([r.key, r.item?.hinmei ?? '', r.kubun, r.qty, r.unitFinished,
        r.unitSource + (r.faDate ? ' ' + r.faDate : ''), r.finished, r.usage, r.scrap]);
    }
    Util.downloadCsv(`品目別理論スクラップ_${ym}.csv`, rows);
  },
};
