/* localStorage を使ったデータストア */
const Store = {
  PREFIX: 'pfscrap.',
  KEYS: ['items', 'dailyRecords', 'firstArticle', 'mcframe', 'monthlyInput', 'options'],

  read(key, def) {
    try {
      const v = localStorage.getItem(this.PREFIX + key);
      return v === null ? def : JSON.parse(v);
    } catch (e) {
      console.error('Store.read error', key, e);
      return def;
    }
  },
  write(key, val) {
    localStorage.setItem(this.PREFIX + key, JSON.stringify(val));
  },

  /* ② 品目マスター: id = KEY + '|' + 子図番 */
  getItems() { return this.read('items', []); },
  setItems(v) { this.write('items', v); },

  /* ① 日次記録: id = date + '|' + 工場 */
  getDailyRecords() { return this.read('dailyRecords', []); },
  setDailyRecords(v) { this.write('dailyRecords', v); },

  /* ③ 初品測定: {date, key, weight, sokuteisha} */
  getFirstArticle() { return this.read('firstArticle', []); },
  setFirstArticle(v) { this.write('firstArticle', v); },

  /* ④ McFrame加工数: {ym, key, qty} */
  getMcframe() { return this.read('mcframe', []); },
  setMcframe(v) { this.write('mcframe', v); },

  /* ⑤ 月次入力: {ym, zaiko:{銅条,銅管,その他}, konyu:{...}, baikyaku} */
  getMonthlyInput() { return this.read('monthlyInput', []); },
  setMonthlyInput(v) { this.write('monthlyInput', v); },

  getOptions() {
    return this.read('options', {
      kojo: ['大口'],
      busho: ['内胴', 'プレス', '加工'],
      kotei: ['切断', 'プレス', '曲げ', '溶接', 'その他'],
    });
  },
  setOptions(v) { this.write('options', v); },

  exportAll() {
    const data = { exportedAt: new Date().toISOString(), version: 1 };
    for (const k of this.KEYS) data[k] = this.read(k, null);
    return data;
  },
  importAll(data) {
    for (const k of this.KEYS) {
      if (data[k] !== undefined && data[k] !== null) this.write(k, data[k]);
    }
  },
  clearAll() {
    for (const k of this.KEYS) localStorage.removeItem(this.PREFIX + k);
  },
};
