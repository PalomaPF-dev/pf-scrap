/* タブ切替・設定・初期化 */
const App = {
  init() {
    document.querySelectorAll('#tabs button').forEach(btn => {
      btn.addEventListener('click', () => this.showTab(btn.dataset.tab));
    });

    // 設定: バックアップ
    document.getElementById('backup-export').addEventListener('click', () => {
      const data = Store.exportAll();
      const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
      Util.downloadBlob(`スクラップ管理バックアップ_${Util.todayStr()}.json`, blob);
    });
    document.getElementById('backup-import').addEventListener('click', () => document.getElementById('backup-file').click());
    document.getElementById('backup-file').addEventListener('change', async e => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      if (!confirm('バックアップを復元すると、含まれるデータで上書きされます。よろしいですか?')) return;
      try {
        Store.importAll(JSON.parse(await file.text()));
        document.getElementById('settings-msg').textContent = '復元しました。';
        this.refreshAll();
      } catch (err) {
        alert('復元に失敗しました: ' + err.message);
      }
    });
    document.getElementById('data-clear').addEventListener('click', () => {
      if (!confirm('全データを削除します。よろしいですか?')) return;
      if (!confirm('本当に削除しますか? この操作は元に戻せません。バックアップの取得をお勧めします。')) return;
      Store.clearAll();
      this.refreshAll();
      document.getElementById('settings-msg').textContent = '全データを削除しました。';
    });

    // 設定: 選択肢
    const opt = Store.getOptions();
    document.getElementById('opt-kojo').value = opt.kojo.join(',');
    document.getElementById('opt-busho').value = opt.busho.join(',');
    document.getElementById('opt-kotei').value = opt.kotei.join(',');
    document.getElementById('opt-save').addEventListener('click', () => {
      const parse = id => document.getElementById(id).value.split(/[,、]/).map(s => s.trim()).filter(Boolean);
      Store.setOptions({ kojo: parse('opt-kojo'), busho: parse('opt-busho'), kotei: parse('opt-kotei') });
      Daily.renderOptions();
      alert('保存しました。新しい選択肢は日次記録の行追加から反映されます。');
    });

    Master.init();
    Daily.init();
    First.init();
    Mcframe.init();
    Monthly.init();
    Recon.init();
  },

  showTab(name) {
    document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    document.querySelectorAll('.tab').forEach(s => s.classList.toggle('active', s.id === 'tab-' + name));
    // タブ表示時に最新データで再描画
    if (name === 'recon') Recon.render();
    if (name === 'mcframe') Mcframe.render();
    if (name === 'first') { First.renderCandidates(); First.renderHistory(); }
    if (name === 'master') Master.render();
    if (name === 'daily') Daily.renderAgg();
  },

  refreshAll() {
    Master.render();
    Daily.load();
    Daily.renderAgg();
    First.renderCandidates();
    First.renderHistory();
    Mcframe.render();
    Monthly.render();
    Recon.render();
  },
};

document.addEventListener('DOMContentLoaded', () => App.init());
