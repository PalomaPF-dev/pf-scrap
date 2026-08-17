/* ② 品目マスター */
const Master = {
  COLS: [
    ['kanriZuban', '管理図番'], ['hinmei', '品名'], ['key', 'KEY'], ['kubun', '区分'],
    ['oyaZuban', '親図番'], ['oyaHinmei', '親品名'], ['koZuban', '子図番'], ['koHinmei', '子品名'],
    ['tani', '単位'], ['koseiJuryo', '構成重量'], ['kanseiJuryo', '完成重量(理論)'],
    ['seizoBashoCD', '製造場所CD'], ['seizoBashoMei', '製造場所名'], ['kojo', '工場'],
  ],

  init() {
    document.getElementById('master-search').addEventListener('input', () => this.render());
    document.getElementById('master-new').addEventListener('click', () => this.openDialog(null));
    document.getElementById('master-export').addEventListener('click', () => this.exportCsv());
    document.getElementById('master-import').addEventListener('click', () => document.getElementById('master-file').click());
    document.getElementById('master-file').addEventListener('change', e => this.importCsv(e));

    const form = document.getElementById('master-form');
    const sync = () => {
      form.key.value = (form.kanriZuban.value.trim() + form.seizoBashoCD.value.trim());
    };
    form.kanriZuban.addEventListener('input', sync);
    form.seizoBashoCD.addEventListener('input', sync);
    document.getElementById('master-dialog').addEventListener('close', e => {
      if (e.target.returnValue === 'ok') this.save(form);
    });
    this.render();
  },

  filtered() {
    const q = document.getElementById('master-search').value.trim().toLowerCase();
    const items = Store.getItems();
    if (!q) return items;
    return items.filter(it =>
      [it.koZuban, it.oyaZuban, it.kanriZuban, it.key, it.hinmei, it.koHinmei, it.oyaHinmei]
        .some(v => String(v ?? '').toLowerCase().includes(q)));
  },

  render() {
    const items = this.filtered();
    const t = document.getElementById('master-table');
    const head = '<tr>' + this.COLS.map(c => `<th>${c[1]}</th>`).join('') + '<th></th></tr>';
    const rows = items.slice(0, 500).map(it => '<tr>' + this.COLS.map(([k]) => {
      const v = it[k];
      const num = k === 'koseiJuryo' || k === 'kanseiJuryo';
      return `<td class="${num ? 'num' : ''}">${num ? Util.fmt(v, 6) : Util.esc(v)}</td>`;
    }).join('') + `<td><button data-id="${Util.esc(it.id)}" class="edit-btn">編集</button> <button data-id="${Util.esc(it.id)}" class="row-del del-btn">✕</button></td></tr>`).join('');
    t.innerHTML = `<thead>${head}</thead><tbody>${rows}</tbody>`;
    if (items.length > 500) {
      t.insertAdjacentHTML('beforeend', `<tfoot><tr><td colspan="${this.COLS.length + 1}">${items.length}件中500件を表示(検索で絞り込んでください)</td></tr></tfoot>`);
    }
    t.querySelectorAll('.edit-btn').forEach(b => b.addEventListener('click', () => this.openDialog(b.dataset.id)));
    t.querySelectorAll('.del-btn').forEach(b => b.addEventListener('click', () => this.remove(b.dataset.id)));
  },

  openDialog(id) {
    const form = document.getElementById('master-form');
    form.reset();
    document.getElementById('master-dialog-title').textContent = id ? '品目編集' : '品目登録';
    if (id) {
      const it = Store.getItems().find(x => x.id === id);
      if (!it) return;
      for (const [k] of this.COLS) if (form[k] !== undefined) form[k].value = it[k] ?? '';
      form.id.value = it.id;
    } else {
      form.id.value = '';
    }
    document.getElementById('master-dialog').showModal();
  },

  save(form) {
    const it = {};
    for (const [k] of this.COLS) if (form[k] !== undefined) it[k] = form[k].value.trim();
    it.key = it.kanriZuban + it.seizoBashoCD;
    it.koseiJuryo = Util.num(it.koseiJuryo);
    it.kanseiJuryo = Util.num(it.kanseiJuryo);
    const newId = it.key + '|' + it.koZuban;
    const items = Store.getItems();
    const oldId = form.id.value;
    const dupIdx = items.findIndex(x => x.id === newId);
    if (oldId) {
      const idx = items.findIndex(x => x.id === oldId);
      if (dupIdx >= 0 && dupIdx !== idx) { alert('同じKEY×子図番の品目が既に存在します。'); return; }
      it.id = newId;
      if (idx >= 0) items[idx] = it; else items.push(it);
    } else {
      if (dupIdx >= 0) { alert('同じKEY×子図番の品目が既に存在します。編集で修正してください。'); return; }
      it.id = newId;
      items.push(it);
    }
    Store.setItems(items);
    this.render();
  },

  remove(id) {
    if (!confirm('この品目を削除しますか?')) return;
    Store.setItems(Store.getItems().filter(x => x.id !== id));
    this.render();
  },

  exportCsv() {
    const rows = [this.COLS.map(c => c[1])];
    for (const it of Store.getItems()) rows.push(this.COLS.map(([k]) => it[k] ?? ''));
    Util.downloadCsv('品目マスター.csv', rows);
  },

  async importCsv(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const text = await Util.readTextFile(file);
    const rows = Util.parseCsv(text);
    if (!rows.length) { alert('CSVが空です。'); return; }
    // ヘッダー行から列位置を判定(日本語名 or 英語キー)。判定不可なら列順を仮定
    const header = rows[0].map(v => String(v).trim());
    const colIdx = {};
    let hasHeader = false;
    for (let i = 0; i < this.COLS.length; i++) {
      const [k, jp] = this.COLS[i];
      const idx = header.findIndex(h => h === jp || h === k || (jp.includes('(') && h === jp.split('(')[0]));
      if (idx >= 0) { colIdx[k] = idx; hasHeader = true; }
    }
    if (!hasHeader) this.COLS.forEach(([k], i) => colIdx[k] = i);
    const dataRows = hasHeader ? rows.slice(1) : rows;

    const items = Store.getItems();
    const byId = new Map(items.map(x => [x.id, x]));
    let added = 0, updated = 0, skipped = 0;
    for (const r of dataRows) {
      const it = {};
      for (const [k] of this.COLS) it[k] = colIdx[k] !== undefined ? String(r[colIdx[k]] ?? '').trim() : '';
      if (!it.kanriZuban && !it.key) { skipped++; continue; }
      if (!it.key) it.key = it.kanriZuban + it.seizoBashoCD;
      if (!it.kanriZuban && it.seizoBashoCD && it.key.endsWith(it.seizoBashoCD)) {
        it.kanriZuban = it.key.slice(0, it.key.length - it.seizoBashoCD.length);
      }
      it.koseiJuryo = Util.num(it.koseiJuryo);
      it.kanseiJuryo = Util.num(it.kanseiJuryo);
      if (!it.kubun) it.kubun = 'その他';
      it.id = it.key + '|' + it.koZuban;
      if (byId.has(it.id)) { Object.assign(byId.get(it.id), it); updated++; }
      else { items.push(it); byId.set(it.id, it); added++; }
    }
    Store.setItems(items);
    this.render();
    alert(`品目マスター取込完了: 追加 ${added}件 / 更新 ${updated}件 / スキップ ${skipped}件`);
  },
};
