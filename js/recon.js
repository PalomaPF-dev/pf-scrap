/* ⑥⑦ 照合ダッシュボード */
const Recon = {
  init() {
    document.getElementById('recon-month').value = Util.thisMonthStr();
    document.getElementById('recon-refresh').addEventListener('click', () => this.render());
    document.getElementById('recon-export').addEventListener('click', () => this.exportYear());
    this.render();
  },

  render() {
    const ym = document.getElementById('recon-month').value;
    const s = Calc.monthlySummary(ym);
    this.renderSummary(s);
    this.render6(s);
    this.render7(s);
    this.renderYear(ym.slice(0, 4));
  },

  renderSummary(s) {
    const t = document.getElementById('recon-summary');
    const head = `<tr><th>区分</th><th class="num">月初在庫</th><th class="num">購入重量</th><th class="num">翌月月初在庫</th>
      <th class="num">使用量</th><th>使用量算出</th><th class="num">構成重量(参考)</th><th class="num">完成重量</th><th class="num">理論スクラップ</th></tr>`;
    const body = [...Calc.KUBUN, '全体'].map(kb => {
      const r = s.perKubun[kb];
      const usage = r.usageInv !== null ? r.usageInv : r.usageBom;
      return `<tr class="${kb === '全体' ? 'total' : ''}"><td>${kb}</td>
        <td class="num">${Util.fmt(r.zaiko)}</td><td class="num">${Util.fmt(r.konyu)}</td><td class="num">${Util.fmt(r.zaikoNext)}</td>
        <td class="num">${Util.fmt(usage)}</td><td><span class="badge">${r.method ?? '-'}</span></td>
        <td class="num">${Util.fmt(r.usageBom)}</td><td class="num">${Util.fmt(r.finished)}</td>
        <td class="num ${r.scrapTheo < 0 ? 'neg' : ''}">${Util.fmt(r.scrapTheo)}</td></tr>`;
    }).join('');
    t.innerHTML = `<thead>${head}</thead><tbody>${body}</tbody>`;
  },

  render6(s) {
    const t = document.getElementById('recon-6');
    const dailyTotal = s.daily.total['全体'];
    const rows = [
      ['スクラップ売却数量 (⑤入力)', s.baikyaku, ''],
      ['日次記録スクラップ合計 (①)', dailyTotal, `${s.daily.days}日分`],
      ['差異 (売却 − 日次記録)', s.diff6, ''],
      ['差異率', null, s.rate6 !== null ? Util.fmtPct(s.rate6) : '-'],
    ];
    t.innerHTML = '<tbody>' + rows.map(([label, v, note], i) => `<tr>
      <th>${label}</th>
      <td class="num ${i === 2 && v !== null ? (Math.abs(v) / Math.max(dailyTotal, 1) > 0.05 ? 'warn' : 'ok') : ''}">${v !== null ? Util.fmt(v) + (i < 3 ? ' kg' : '') : ''}</td>
      <td>${note}</td></tr>`).join('') + '</tbody>';
  },

  render7(s) {
    const t = document.getElementById('recon-7');
    const theo = s.perKubun['全体'].scrapTheo;
    const rows = [
      ['理論スクラップ (全体)', theo, `算出: ${s.perKubun['全体'].method ?? '-'}`],
      ['売却 − 理論 (売量vs理論)', s.diff7sell, s.rate7sell !== null ? '率 ' + Util.fmtPct(s.rate7sell) : ''],
      ['日次記録 − 理論', s.diff7daily, s.rate7daily !== null ? '率 ' + Util.fmtPct(s.rate7daily) : ''],
    ];
    t.innerHTML = '<tbody>' + rows.map(([label, v, note], i) => `<tr>
      <th>${label}</th>
      <td class="num ${i > 0 && v !== null ? (theo && Math.abs(v) / Math.abs(theo) > 0.05 ? 'warn' : 'ok') : ''}">${v !== null ? Util.fmt(v) + ' kg' : '-'}</td>
      <td>${note}</td></tr>`).join('') + '</tbody>';
  },

  yearRows(year) {
    const rows = [];
    for (let m = 1; m <= 12; m++) {
      const ym = `${year}-${String(m).padStart(2, '0')}`;
      const s = Calc.monthlySummary(ym);
      const g = s.perKubun['全体'];
      const hasData = s.baikyaku !== null || g.zaiko !== null || s.itemRows.length || s.daily.days;
      if (!hasData) continue;
      rows.push({
        ym,
        baikyaku: s.baikyaku,
        zaiko: g.zaiko, konyu: g.konyu,
        usage: g.usageInv !== null ? g.usageInv : (s.itemRows.length ? g.usageBom : null),
        usageBom: s.itemRows.length ? g.usageBom : null,
        finished: s.itemRows.length ? g.finished : null,
        scrapTheo: (g.zaiko !== null || s.itemRows.length) ? g.scrapTheo : null,
        daily: s.daily.days ? s.daily.total['全体'] : null,
        diff7sell: s.diff7sell, diff6: s.diff6,
      });
    }
    return rows;
  },

  renderYear(year) {
    const rows = this.yearRows(year);
    const t = document.getElementById('recon-year');
    const head = `<tr><th>年月</th><th class="num">月初在庫</th><th class="num">購入重量</th><th class="num">使用量</th>
      <th class="num">構成重量</th><th class="num">完成重量</th><th class="num">理論SCP</th>
      <th class="num">SCP売量</th><th class="num">日次記録</th><th class="num">売量vs理論</th><th class="num">売却vs日次</th></tr>`;
    const body = rows.map(r => `<tr><td>${r.ym}</td>
      <td class="num">${Util.fmt(r.zaiko)}</td><td class="num">${Util.fmt(r.konyu)}</td>
      <td class="num">${Util.fmt(r.usage)}</td><td class="num">${Util.fmt(r.usageBom)}</td>
      <td class="num">${Util.fmt(r.finished)}</td><td class="num">${Util.fmt(r.scrapTheo)}</td>
      <td class="num">${Util.fmt(r.baikyaku)}</td><td class="num">${Util.fmt(r.daily)}</td>
      <td class="num ${r.diff7sell > 0 ? 'pos' : r.diff7sell < 0 ? 'neg' : ''}">${Util.fmt(r.diff7sell)}</td>
      <td class="num ${r.diff6 > 0 ? 'pos' : r.diff6 < 0 ? 'neg' : ''}">${Util.fmt(r.diff6)}</td></tr>`).join('');
    t.innerHTML = `<thead>${head}</thead><tbody>${body || '<tr><td colspan="11">データがありません</td></tr>'}</tbody>`;
  },

  exportYear() {
    const year = document.getElementById('recon-month').value.slice(0, 4);
    const rows = [['年月', '月初在庫', '購入重量', '使用量', '構成重量', '完成重量', '理論SCP', 'SCP売量', '日次記録SCP', '売量vs理論', '売却vs日次記録']];
    for (const r of this.yearRows(year)) {
      rows.push([r.ym, r.zaiko ?? '', r.konyu ?? '', r.usage ?? '', r.usageBom ?? '', r.finished ?? '',
        r.scrapTheo ?? '', r.baikyaku ?? '', r.daily ?? '', r.diff7sell ?? '', r.diff6 ?? '']);
    }
    Util.downloadCsv(`月次照合_${year}.csv`, rows);
  },
};
