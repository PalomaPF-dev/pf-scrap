/* 集計・照合の計算ロジック
 *
 * 定義(月次Excelシートの式を踏襲):
 *   使用量(在庫法)   = 月初在庫 + 購入重量 − 翌月月初在庫
 *   使用量(構成法)   = Σ(加工数 × 構成重量)          … McFrame取込 × マスター
 *   完成重量         = Σ(加工数 × 単品完成重量)       … 単品完成重量は初品実測を優先
 *   理論スクラップ   = 使用量 − 完成重量 (在庫法があれば在庫法、なければ構成法)
 *   ⑥ 売却 − 日次記録合計
 *   ⑦ 売却 − 理論スクラップ (=Excelの「売量vs理論」) / 日次記録 − 理論スクラップ
 */
const Calc = {
  KUBUN: ['銅条', '銅管', 'その他'],

  /** KEY単位でマスター行をグループ化 */
  itemsByKey() {
    const map = new Map();
    for (const it of Store.getItems()) {
      if (!map.has(it.key)) map.set(it.key, []);
      map.get(it.key).push(it);
    }
    return map;
  },

  /** 対象月末以前の最新初品測定値を返す。無ければ null */
  latestFirstWeight(key, ym) {
    const end = Util.monthEnd(ym);
    let best = null;
    for (const fa of Store.getFirstArticle()) {
      if (fa.key !== key || fa.date > end) continue;
      if (!best || fa.date > best.date) best = fa;
    }
    return best; // {date, key, weight, sokuteisha}
  },

  /** 月の品目別計算。加工数があるKEYごとに1行 */
  monthlyItemRows(ym) {
    const byKey = this.itemsByKey();
    const rows = [];
    for (const mc of Store.getMcframe()) {
      if (mc.ym !== ym) continue;
      const items = byKey.get(mc.key) || [];
      const qty = Util.num(mc.qty);
      const base = items[0] || null;
      const fa = this.latestFirstWeight(mc.key, ym);
      const theoUnit = base ? Util.num(base.kanseiJuryo) : 0;
      const unitFinished = fa ? Util.num(fa.weight) : theoUnit;
      const usage = items.reduce((s, it) => s + qty * Util.num(it.koseiJuryo), 0);
      const finished = qty * unitFinished;
      rows.push({
        key: mc.key,
        item: base,
        found: items.length > 0,
        kubun: base ? base.kubun : 'その他',
        qty,
        unitFinished,
        unitSource: fa ? '実測' : (base ? '理論' : '未登録'),
        faDate: fa ? fa.date : null,
        usage,
        finished,
        scrap: usage - finished,
      });
    }
    rows.sort((a, b) => b.scrap - a.scrap);
    return rows;
  },

  /** 月次入力レコード取得 */
  monthlyInput(ym) {
    return Store.getMonthlyInput().find(r => r.ym === ym) || null;
  },

  sumKubun(obj) {
    if (!obj) return 0;
    return this.KUBUN.reduce((s, k) => s + Util.num(obj[k]), 0);
  },

  /** ① 日次記録の月間集計(区分別合計と件数) */
  dailyMonthTotal(ym) {
    const total = { 全体: 0 };
    for (const k of this.KUBUN) total[k] = 0;
    let days = 0;
    for (const rec of Store.getDailyRecords()) {
      if (!rec.date.startsWith(ym)) continue;
      days++;
      for (const e of rec.entries || []) {
        const w = Util.num(e.weight);
        total['全体'] += w;
        const kb = this.KUBUN.includes(e.hinshu) ? e.hinshu : 'その他';
        total[kb] += w;
      }
    }
    return { total, days };
  },

  /** 月次サマリー(区分別 + 全体) */
  monthlySummary(ym) {
    const inp = this.monthlyInput(ym);
    const inpNext = this.monthlyInput(Util.nextYm(ym));
    const itemRows = this.monthlyItemRows(ym);
    const daily = this.dailyMonthTotal(ym);

    const perKubun = {};
    for (const kb of [...this.KUBUN, '全体']) {
      perKubun[kb] = { zaiko: null, konyu: null, zaikoNext: null, usageInv: null, usageBom: 0, finished: 0, scrapTheo: null, method: null };
    }
    for (const r of itemRows) {
      const t = perKubun[this.KUBUN.includes(r.kubun) ? r.kubun : 'その他'];
      t.usageBom += r.usage;
      t.finished += r.finished;
      perKubun['全体'].usageBom += r.usage;
      perKubun['全体'].finished += r.finished;
    }
    for (const kb of this.KUBUN) {
      const t = perKubun[kb];
      if (inp) { t.zaiko = Util.num(inp.zaiko?.[kb]); t.konyu = Util.num(inp.konyu?.[kb]); }
      if (inpNext) t.zaikoNext = Util.num(inpNext.zaiko?.[kb]);
      if (inp && inpNext) t.usageInv = t.zaiko + t.konyu - t.zaikoNext;
      const usage = t.usageInv !== null ? t.usageInv : t.usageBom;
      t.method = t.usageInv !== null ? '在庫法' : '構成法';
      t.scrapTheo = usage - t.finished;
    }
    {
      const t = perKubun['全体'];
      if (inp) { t.zaiko = this.sumKubun(inp.zaiko); t.konyu = this.sumKubun(inp.konyu); }
      if (inpNext) t.zaikoNext = this.sumKubun(inpNext.zaiko);
      if (inp && inpNext) t.usageInv = t.zaiko + t.konyu - t.zaikoNext;
      const usage = t.usageInv !== null ? t.usageInv : t.usageBom;
      t.method = t.usageInv !== null ? '在庫法' : '構成法';
      t.scrapTheo = usage - t.finished;
    }

    const baikyaku = inp ? Util.num(inp.baikyaku) : null;
    const dailyTotal = daily.total['全体'];
    const scrapTheo = perKubun['全体'].scrapTheo;

    return {
      ym, perKubun, itemRows, daily, baikyaku,
      // ⑥ 売却 vs 日次記録
      diff6: baikyaku !== null ? baikyaku - dailyTotal : null,
      rate6: baikyaku !== null && dailyTotal ? (baikyaku - dailyTotal) / dailyTotal : null,
      // ⑦ 売却 vs 理論 (Excel「売量vs理論」) / 日次 vs 理論
      diff7sell: baikyaku !== null && scrapTheo !== null ? baikyaku - scrapTheo : null,
      rate7sell: baikyaku !== null && scrapTheo ? (baikyaku - scrapTheo) / scrapTheo : null,
      diff7daily: scrapTheo !== null ? dailyTotal - scrapTheo : null,
      rate7daily: scrapTheo ? (dailyTotal - scrapTheo) / scrapTheo : null,
    };
  },
};
