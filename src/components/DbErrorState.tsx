import { Database } from "lucide-react";

/** データベース未接続・接続失敗時に、画面を落とさず平易な案内を出す。 */
export default function DbErrorState() {
  return (
    <div className="mx-auto mt-10 max-w-lg rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-600">
        <Database className="h-6 w-6" />
      </div>
      <h2 className="text-base font-bold text-amber-800">データに接続できません</h2>
      <p className="mt-2 text-sm text-amber-700">
        一時的な通信の問題の可能性があります。しばらく待ってからページを再読み込みしてください。
        <br />
        解決しない場合は、システム管理者にご確認ください。
      </p>
    </div>
  );
}
