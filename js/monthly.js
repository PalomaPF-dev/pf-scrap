/* ⑤ 月次入力: 月初在庫・購入重量・スクラップ売却数量 */
const Monthly = {
  init() {
    document.getElementById('monthly-year').value = new Date().getFullYear();
    document.getElementById('monthly-refresh').addEventListener('click', () => this.render());
    document.getElementById('monthly-save').addEventListener('click', () => this.save());
    this.render();
  },

  render() {
    const year = Util.num(document.getElementById('monthly-year').value);
    const data = Store.getMonthlyInput();
    const t = document.getElementById('monthly-table');
    const head = `<tr><th rowspan="2">年月</th><th colspan="3">月初在庫(kg)</th><th class="num" rowspan="2">月初在庫<br>全体</th>
      <th colspan="3">購入重量(kg)</th><th class="num" rowspan="2">購入重量<br>全体</th>
      <th class="num" rowspan="2">スクラップ<br>売却数量(kg)</th></tr>
      <tr><th class="num">銅条</th><th class="num">銅管</th><th class="num">その他</th>
      <th class="num">銅条</th><th class="num">銅管</th><th class="num">その他</th></tr>`;
    let body = '';
    for (let m = 1; m <= 12; m++) {
      const ym = `${year}-${String(m).padStart(2, '0')}`;
      const rec = data.find(r => r.ym === ym) || { zaiko: {}, konyu: {}, baikyaku: '' };
      const cell = (grp, kb) => `<td class="num"><input type="number" step="0.1" style="width:8em"
        data-ym="${ym}" data-grp="${grp}" data-kb="${kb}" value="${rec[grp]?.[kb] ?? ''}"></td>`;
      body += `<tr><td>${ym}</td>
        ${cell('zaiko', '銅条')}${cell('zaiko', '銅管')}${cell('zaiko', 'その他')}
        <td class="num sum-zaiko" data-ym="${ym}">${Util.fmt(Calc.sumKubun(rec.zaiko))}</td>
        ${cell('konyu', '銅条')}${cell('konyu', '銅管')}${cell('konyu', 'その他')}
        <td class="num sum-konyu" data-ym="${ym}">${Util.fmt(Calc.sumKubun(rec.konyu))}</td>
        <td class="num"><input type="number" step="0.1" style="width:8em" data-ym="${ym}" data-grp="baikyaku" value="${rec.baikyaku ?? ''}"></td></tr>`;
    }
    t.innerHTML = `<thead>${head}</thead><tbody>${body}</tbody>`;
    t.querySelectorAll('input').forEach(inp => inp.addEventListener('input', () => this.updateSums(inp.dataset.ym)));
  },

  updateSums(ym) {
    for (const grp of ['zaiko', 'konyu']) {
      let s = 0;
      document.querySelectorAll(`#monthly-table input[data-ym="${ym}"][data-grp="${grp}"]`)
        .forEach(inp => s += Util.num(inp.value));
      const cell = document.querySelector(`#monthly-table .sum-${grp}[data-ym="${ym}"]`);
      if (cell) cell.textContent = Util.fmt(s);
    }
  },

  save() {
    const year = Util.num(document.getElementById('monthly-year').value);
    const data = Store.getMonthlyInput().filter(r => !r.ym.startsWith(String(year) + '-'));
    for (let m = 1; m <= 12; m++) {
      const ym = `${year}-${String(m).padStart(2, '0')}`;
      const rec = { ym, zaiko: {}, konyu: {}, baikyaku: null };
      let hasVal = false;
      document.querySelectorAll(`#monthly-table input[data-ym="${ym}"]`).forEach(inp => {
        if (inp.value === '') return;
        hasVal = true;
        if (inp.dataset.grp === 'baikyaku') rec.baikyaku = Util.num(inp.value);
        else rec[inp.dataset.grp][inp.dataset.kb] = Util.num(inp.value);
      });
      if (hasVal) data.push(rec);
    }
    data.sort((a, b) => a.ym.localeCompare(b.ym));
    Store.setMonthlyInput(data);
    alert(`${year}年の月次入力を保存しました。`);
  },
};
