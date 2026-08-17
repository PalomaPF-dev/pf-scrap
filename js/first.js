/* ③ 初品 完成品重量測定 */
const First = {
  selectedKey: null,

  init() {
    document.getElementById('first-date').value = Util.todayStr();
    document.getElementById('first-search').addEventListener('input', () => this.renderCandidates());
    document.getElementById('first-save').addEventListener('click', () => this.save());
    this.renderCandidates();
    this.renderHistory();
  },

  renderCandidates() {
    const q = document.getElementById('first-search').value.trim().toLowerCase();
    const t = document.getElementById('first-candidates');
    const byKey = Calc.itemsByKey();
    const rows = [];
    for (const [key, items] of byKey) {
      const it = items[0];
      if (q && ![it.koZuban, it.oyaZuban, it.kanriZuban, key, it.hinmei, it.koHinmei]
        .some(v => String(v ?? '').toLowerCase().includes(q))) continue;
      rows.push(it);
      if (rows.length >= 30) break;
    }
    t.innerHTML = '<thead><tr><th>選択</th><th>KEY</th><th>管理図番</th><th>品名</th><th>子図番</th><th>区分</th><th class="num">理論完成重量</th><th class="num">最新実測</th></tr></thead><tbody>' +
      rows.map(it => {
        const fa = Calc.latestFirstWeight(it.key, '9999-12');
        return `<tr data-key="${Util.esc(it.key)}" class="${it.key === this.selectedKey ? 'selected' : ''}">
          <td><button class="pick-btn" data-key="${Util.esc(it.key)}">選択</button></td>
          <td>${Util.esc(it.key)}</td><td>${Util.esc(it.kanriZuban)}</td><td>${Util.esc(it.hinmei)}</td>
          <td>${Util.esc(it.koZuban)}</td><td>${Util.esc(it.kubun)}</td>
          <td class="num">${Util.fmt(it.kanseiJuryo, 6)}</td>
          <td class="num">${fa ? Util.fmt(fa.weight, 6) + ' (' + fa.date + ')' : '-'}</td></tr>`;
      }).join('') + '</tbody>';
    t.querySelectorAll('.pick-btn').forEach(b => b.addEventListener('click', () => {
      this.selectedKey = b.dataset.key;
      const it = (Calc.itemsByKey().get(this.selectedKey) || [])[0];
      document.getElementById('first-selected').textContent = it ? `${it.key} ${it.hinmei}` : this.selectedKey;
      this.renderCandidates();
    }));
  },

  save() {
    if (!this.selectedKey) { alert('品目を選択してください。'); return; }
    const date = document.getElementById('first-date').value;
    const weight = document.getElementById('first-weight').value;
    if (!date || weight === '' || Util.num(weight) <= 0) { alert('測定日と重量を入力してください。'); return; }
    const list = Store.getFirstArticle().filter(f => !(f.key === this.selectedKey && f.date === date));
    list.push({
      date, key: this.selectedKey,
      weight: Util.num(weight),
      sokuteisha: document.getElementById('first-sokuteisha').value.trim(),
    });
    list.sort((a, b) => (b.date + b.key).localeCompare(a.date + a.key));
    Store.setFirstArticle(list);
    document.getElementById('first-weight').value = '';
    this.renderCandidates();
    this.renderHistory();
    alert('登録しました。');
  },

  remove(key, date) {
    if (!confirm('この測定記録を削除しますか?')) return;
    Store.setFirstArticle(Store.getFirstArticle().filter(f => !(f.key === key && f.date === date)));
    this.renderCandidates();
    this.renderHistory();
  },

  renderHistory() {
    const byKey = Calc.itemsByKey();
    const t = document.getElementById('first-history');
    const list = Store.getFirstArticle().slice(0, 200);
    t.innerHTML = '<thead><tr><th>測定日</th><th>KEY</th><th>品名</th><th class="num">実測完成重量(kg)</th><th class="num">理論値(kg)</th><th class="num">差</th><th>測定者</th><th></th></tr></thead><tbody>' +
      list.map(f => {
        const it = (byKey.get(f.key) || [])[0];
        const theo = it ? Util.num(it.kanseiJuryo) : null;
        const diff = theo !== null && theo !== 0 ? f.weight - theo : null;
        return `<tr><td>${f.date}</td><td>${Util.esc(f.key)}</td><td>${Util.esc(it?.hinmei ?? '(マスター未登録)')}</td>
          <td class="num">${Util.fmt(f.weight, 6)}</td><td class="num">${Util.fmt(theo, 6)}</td>
          <td class="num ${diff > 0 ? 'pos' : diff < 0 ? 'neg' : ''}">${Util.fmt(diff, 6)}</td>
          <td>${Util.esc(f.sokuteisha)}</td>
          <td><button class="row-del" data-key="${Util.esc(f.key)}" data-date="${f.date}">✕</button></td></tr>`;
      }).join('') + '</tbody>';
    t.querySelectorAll('.row-del').forEach(b => b.addEventListener('click', () => this.remove(b.dataset.key, b.dataset.date)));
  },
};
