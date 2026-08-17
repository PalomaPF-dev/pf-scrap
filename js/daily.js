/* ① 日次記録(スクラップ日次記録票) */
const Daily = {
  init() {
    document.getElementById('daily-date').value = Util.todayStr();
    document.getElementById('daily-agg-month').value = Util.thisMonthStr();
    this.renderOptions();

    document.getElementById('daily-load').addEventListener('click', () => this.load());
    document.getElementById('daily-save').addEventListener('click', () => this.save());
    document.getElementById('daily-add-row').addEventListener('click', () => this.addRow());
    document.getElementById('daily-kaishu').addEventListener('input', () => this.updateTotal());
    document.getElementById('daily-agg-refresh').addEventListener('click', () => this.renderAgg());
    document.getElementById('daily-agg-export').addEventListener('click', () => this.exportAgg());

    this.load();
    this.renderAgg();
  },

  renderOptions() {
    const opt = Store.getOptions();
    document.getElementById('kojo-list').innerHTML = opt.kojo.map(k => `<option value="${Util.esc(k)}">`).join('');
    const kojoInput = document.getElementById('daily-kojo');
    if (!kojoInput.value) kojoInput.value = opt.kojo[0] || '';
  },

  recId() {
    return document.getElementById('daily-date').value + '|' + document.getElementById('daily-kojo').value.trim();
  },

  addRow(e = {}) {
    const opt = Store.getOptions();
    const tbody = document.querySelector('#daily-entries tbody');
    const tr = document.createElement('tr');
    const sel = (opts, val) => opts.map(o => `<option ${o === val ? 'selected' : ''}>${Util.esc(o)}</option>`).join('');
    tr.innerHTML = `
      <td><input type="time" class="e-time" value="${Util.esc(e.time ?? '')}"></td>
      <td><select class="e-busho"><option value=""></option>${sel(opt.busho, e.busho)}</select></td>
      <td><input class="e-kikai" size="8" value="${Util.esc(e.kikai ?? '')}"></td>
      <td><select class="e-hinshu">${sel(['銅条', '銅管', 'その他'], e.hinshu ?? '銅条')}</select></td>
      <td><select class="e-kotei"><option value=""></option>${sel(opt.kotei, e.kotei)}</select></td>
      <td><input type="number" step="0.1" min="0" class="e-weight num" style="width:7em" value="${Util.esc(e.weight ?? '')}"></td>
      <td><input class="e-kirokusha" size="8" value="${Util.esc(e.kirokusha ?? '')}"></td>
      <td><input class="e-ijo" size="10" value="${Util.esc(e.ijo ?? '')}"></td>
      <td><button class="row-del" title="行削除">✕</button></td>`;
    tr.querySelector('.e-weight').addEventListener('input', () => this.updateTotal());
    tr.querySelector('.row-del').addEventListener('click', () => { tr.remove(); this.updateTotal(); });
    tbody.appendChild(tr);
  },

  readEntries() {
    return [...document.querySelectorAll('#daily-entries tbody tr')].map(tr => ({
      time: tr.querySelector('.e-time').value,
      busho: tr.querySelector('.e-busho').value,
      kikai: tr.querySelector('.e-kikai').value.trim(),
      hinshu: tr.querySelector('.e-hinshu').value,
      kotei: tr.querySelector('.e-kotei').value,
      weight: Util.num(tr.querySelector('.e-weight').value),
      kirokusha: tr.querySelector('.e-kirokusha').value.trim(),
      ijo: tr.querySelector('.e-ijo').value.trim(),
    })).filter(e => e.weight > 0 || e.time || e.kikai);
  },

  updateTotal() {
    const total = this.readEntries().reduce((s, e) => s + e.weight, 0);
    document.getElementById('daily-total').textContent = Util.fmt(total, 1);
    const kaishu = document.getElementById('daily-kaishu').value;
    const out = document.getElementById('daily-sairitsu');
    if (kaishu !== '' && total > 0) {
      out.textContent = Util.fmtPct((Util.num(kaishu) - total) / total);
    } else {
      out.textContent = '-';
    }
  },

  load() {
    const rec = Store.getDailyRecords().find(r => r.id === this.recId());
    document.querySelector('#daily-entries tbody').innerHTML = '';
    document.getElementById('daily-sekinin').value = rec?.sekininsha ?? '';
    document.getElementById('daily-zenjitsu').checked = rec?.zenjitsuOK ?? false;
    document.getElementById('daily-zanryo').value = rec?.hakoZanryo ?? 0;
    document.getElementById('daily-kaishu').value = rec?.kaishuSokuteichi ?? '';
    document.getElementById('daily-tonyu').checked = rec?.tonyuKanryo ?? false;
    document.getElementById('daily-shonin').value = rec?.shonin ?? '';
    document.getElementById('daily-biko').value = rec?.biko ?? '';
    (rec?.entries?.length ? rec.entries : [{}, {}, {}]).forEach(e => this.addRow(e));
    this.updateTotal();
  },

  save() {
    const date = document.getElementById('daily-date').value;
    const kojo = document.getElementById('daily-kojo').value.trim();
    if (!date || !kojo) { alert('日付と工場を入力してください。'); return; }
    const entries = this.readEntries();
    const rec = {
      id: date + '|' + kojo,
      date, kojo,
      sekininsha: document.getElementById('daily-sekinin').value.trim(),
      zenjitsuOK: document.getElementById('daily-zenjitsu').checked,
      hakoZanryo: Util.num(document.getElementById('daily-zanryo').value),
      entries,
      total: entries.reduce((s, e) => s + e.weight, 0),
      kaishuSokuteichi: document.getElementById('daily-kaishu').value === '' ? null : Util.num(document.getElementById('daily-kaishu').value),
      tonyuKanryo: document.getElementById('daily-tonyu').checked,
      shonin: document.getElementById('daily-shonin').value.trim(),
      biko: document.getElementById('daily-biko').value.trim(),
      savedAt: new Date().toISOString(),
    };
    const recs = Store.getDailyRecords().filter(r => r.id !== rec.id);
    recs.push(rec);
    recs.sort((a, b) => a.id.localeCompare(b.id));
    Store.setDailyRecords(recs);
    this.renderAgg();
    alert(`保存しました: ${date} ${kojo} / 当日合計 ${Util.fmt(rec.total, 1)} kg`);
  },

  aggRows(ym) {
    const recs = Store.getDailyRecords().filter(r => r.date.startsWith(ym));
    recs.sort((a, b) => a.id.localeCompare(b.id));
    return recs.map(r => {
      const byKubun = { 銅条: 0, 銅管: 0, その他: 0 };
      for (const e of r.entries || []) {
        byKubun[byKubun[e.hinshu] !== undefined ? e.hinshu : 'その他'] += e.weight;
      }
      const total = r.total ?? (r.entries || []).reduce((s, e) => s + e.weight, 0);
      return {
        date: r.date, kojo: r.kojo, sekininsha: r.sekininsha,
        total, byKubun,
        kaishu: r.kaishuSokuteichi,
        sai: r.kaishuSokuteichi !== null && r.kaishuSokuteichi !== undefined && total > 0
          ? (r.kaishuSokuteichi - total) / total : null,
        shonin: r.shonin, ijoCount: (r.entries || []).filter(e => e.ijo).length,
      };
    });
  },

  renderAgg() {
    const ym = document.getElementById('daily-agg-month').value;
    const rows = this.aggRows(ym);
    const t = document.getElementById('daily-agg');
    const head = '<tr><th>日付</th><th>工場</th><th>責任者</th><th class="num">銅条(kg)</th><th class="num">銅管(kg)</th><th class="num">その他(kg)</th><th class="num">合計(kg)</th><th class="num">回収箱測定値</th><th class="num">差異率</th><th>承認</th><th class="num">異常件数</th></tr>';
    const body = rows.map(r => `<tr>
      <td>${r.date}</td><td>${Util.esc(r.kojo)}</td><td>${Util.esc(r.sekininsha)}</td>
      <td class="num">${Util.fmt(r.byKubun['銅条'])}</td><td class="num">${Util.fmt(r.byKubun['銅管'])}</td><td class="num">${Util.fmt(r.byKubun['その他'])}</td>
      <td class="num">${Util.fmt(r.total)}</td>
      <td class="num">${Util.fmt(r.kaishu)}</td>
      <td class="num ${r.sai !== null && Math.abs(r.sai) > 0.05 ? 'warn' : ''}">${Util.fmtPct(r.sai)}</td>
      <td>${r.shonin ? '✔ ' + Util.esc(r.shonin) : '<span class="badge">未承認</span>'}</td>
      <td class="num">${r.ijoCount || ''}</td></tr>`).join('');
    const sum = k => rows.reduce((s, r) => s + (k === 'total' ? r.total : r.byKubun[k]), 0);
    const foot = rows.length ? `<tr class="total"><td colspan="3">月間合計 (${rows.length}日分)</td>
      <td class="num">${Util.fmt(sum('銅条'))}</td><td class="num">${Util.fmt(sum('銅管'))}</td><td class="num">${Util.fmt(sum('その他'))}</td>
      <td class="num">${Util.fmt(sum('total'))}</td><td colspan="4"></td></tr>` : '';
    t.innerHTML = `<thead>${head}</thead><tbody>${body}${foot}</tbody>`;
    if (!rows.length) t.innerHTML += `<tbody><tr><td colspan="11">対象月の記録がありません</td></tr></tbody>`;
  },

  exportAgg() {
    const ym = document.getElementById('daily-agg-month').value;
    const rows = [['日付', '工場', '責任者', '銅条(kg)', '銅管(kg)', 'その他(kg)', '合計(kg)', '回収箱測定値', '差異率', '承認', '異常件数']];
    for (const r of this.aggRows(ym)) {
      rows.push([r.date, r.kojo, r.sekininsha, r.byKubun['銅条'], r.byKubun['銅管'], r.byKubun['その他'],
        r.total, r.kaishu ?? '', r.sai !== null ? (r.sai * 100).toFixed(2) + '%' : '', r.shonin, r.ijoCount]);
    }
    Util.downloadCsv(`日次記録集計_${ym}.csv`, rows);
  },
};
