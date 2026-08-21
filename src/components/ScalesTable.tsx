"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Printer, Trash2, X } from "lucide-react";
import { deleteScaleAction, saveScaleAction } from "@/lib/actions";
import { kindColor, type Scale, type ScrapKind } from "@/lib/scrapTypes";

const td = "border border-[#e5e5e5] px-2.5 py-1.5 whitespace-nowrap align-middle";
const th = "border border-[#e5e5e5] bg-[#f0f0ee] px-2.5 py-1.5 text-left font-semibold whitespace-nowrap";
const input =
  "w-full rounded-lg border border-[#e5e5e5] bg-white px-2.5 py-1.5 text-sm focus:border-[#b4632c] focus:outline-none";

type Draft = {
  id: string | null;
  qrCode: string;
  equipNo: string;
  name: string;
  kind: string;
  factory: string;
  sort: string;
  active: boolean;
};

const emptyDraft = (factory: string): Draft => ({
  id: null,
  qrCode: "",
  equipNo: "",
  name: "",
  kind: "",
  factory,
  sort: "0",
  active: true,
});

/** QRコード値の自動生成（SCP- + 8桁英数）。 */
function genCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `SCP-${s}`;
}

/** QRコード画像。qrcode ライブラリでクライアント側生成（印刷して重量計に貼る）。 */
function QrImage({ value, size = 96 }: { value: string; size?: number }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void import("qrcode").then((QRCode) =>
      QRCode.toDataURL(value, { width: size * 2, margin: 1 }).then((u: string) => {
        if (alive) setUrl(u);
      })
    );
    return () => {
      alive = false;
    };
  }, [value, size]);
  if (!url) return <div style={{ width: size, height: size }} className="bg-[#f0f0ee]" />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={value} width={size} height={size} />;
}

export default function ScalesTable({
  scales,
  factory,
  factoryOptions,
  kinds,
}: {
  scales: Scale[];
  /** 絞り込み中の工場（新規登録の既定値にも使う） */
  factory: string;
  factoryOptions: string[];
  /** スクラップ種類（設定マスタ。使用中のものだけ） */
  kinds: ScrapKind[];
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");
  const [printTarget, setPrintTarget] = useState<Scale | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    if (!draft) return;
    setError("");
    startTransition(async () => {
      const res = await saveScaleAction(draft);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setDraft(null);
      router.refresh();
    });
  }

  function remove(s: Scale) {
    if (!confirm(`重量計「${s.name}」を削除しますか?（過去の記録は名称のまま残ります）`)) return;
    startTransition(async () => {
      const res = await deleteScaleAction(s.id);
      if (!res.ok) alert(res.message);
      router.refresh();
    });
  }

  return (
    <>
      <div className="mb-4">
        <button
          onClick={() => {
            setError("");
            setDraft({ ...emptyDraft(factory), kind: kinds[0]?.name ?? "", qrCode: genCode() });
          }}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#b4632c] px-3 py-2 text-sm font-semibold text-white hover:bg-[#96521f]"
        >
          <Plus className="h-4 w-4" />
          新規登録
        </button>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-[#e5e5e5] bg-white p-1">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className={th}>工場</th>
              <th className={th}>設備番号</th>
              <th className={th}>名称</th>
              <th className={th}>種類</th>
              <th className={th}>QRコード</th>
              <th className={th}>QR値</th>
              <th className={th}>状態</th>
              <th className={th}></th>
            </tr>
          </thead>
          <tbody>
            {scales.length === 0 && (
              <tr>
                <td className={td} colSpan={8}>
                  重量計が未登録です。「新規登録」から、種類ごとのスクラップ箱の重量計を登録してください。
                </td>
              </tr>
            )}
            {scales.map((s) => (
              <tr key={s.id}>
                <td className={td}>{s.factory || "（全工場）"}</td>
                <td className={`${td} font-mono font-semibold`}>{s.equipNo || "-"}</td>
                <td className={`${td} font-semibold`}>{s.name}</td>
                <td className={td}>
                  <span
                    className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold ${
                      kindColor(s.kind, kinds.findIndex((k) => k.name === s.kind))
                    }`}
                  >
                    {s.kind}
                  </span>
                </td>
                <td className={td}>
                  <QrImage value={s.qrCode} size={72} />
                </td>
                <td className={`${td} font-mono text-xs`}>{s.qrCode}</td>
                <td className={td}>
                  {s.active ? (
                    "使用中"
                  ) : (
                    <span className="text-[#909090]">停止</span>
                  )}
                </td>
                <td className={td}>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setPrintTarget(s)}
                      className="rounded p-1 text-[#555555] hover:bg-[#f0f0ee]"
                      aria-label="QRを印刷"
                      title="QRラベルを印刷"
                    >
                      <Printer className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => {
                        setError("");
                        setDraft({
                          id: s.id,
                          qrCode: s.qrCode,
                          equipNo: s.equipNo,
                          name: s.name,
                          kind: s.kind,
                          factory: s.factory,
                          sort: String(s.sort),
                          active: s.active,
                        });
                      }}
                      className="rounded p-1 text-[#555555] hover:bg-[#f0f0ee]"
                      aria-label="編集"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => remove(s)}
                      className="rounded p-1 text-[#dc000c] hover:bg-[#fdecea]"
                      aria-label="削除"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 登録/編集ダイアログ */}
      {draft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-bold text-[#333333]">
                {draft.id ? "重量計の編集" : "重量計の登録"}
              </h2>
              <button
                onClick={() => setDraft(null)}
                className="rounded p-1.5 text-[#555555] hover:bg-[#f0f0ee]"
                aria-label="閉じる"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-3">
              <label className="flex flex-col gap-1 text-xs text-[#707070]">
                設備番号（重量計の管理番号。一覧・ラベルに出ます）
                <input
                  value={draft.equipNo}
                  onChange={(e) => setDraft({ ...draft, equipNo: e.target.value })}
                  className={`${input} font-mono`}
                  placeholder="例: SC-001"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-[#707070]">
                名称*（例: 上銅スクラップ箱①）
                <input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  className={input}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-[#707070]">
                種類
                <select
                  value={draft.kind}
                  onChange={(e) => setDraft({ ...draft, kind: e.target.value })}
                  className={input}
                >
                  {/* 種類は「設定」で追加できる。使用中のものだけ選べる */}
                  {!kinds.some((k) => k.name === draft.kind) && draft.kind !== "" && (
                    <option value={draft.kind}>{draft.kind}（使用しない）</option>
                  )}
                  {kinds.map((k) => (
                    <option key={k.id} value={k.name}>
                      {k.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-[#707070]">
                QRコード値*（重量計に貼るQRの中身）
                <div className="flex gap-2">
                  <input
                    value={draft.qrCode}
                    onChange={(e) => setDraft({ ...draft, qrCode: e.target.value })}
                    className={`${input} font-mono`}
                  />
                  <button
                    onClick={() => setDraft({ ...draft, qrCode: genCode() })}
                    className="shrink-0 rounded-lg border border-[#e5e5e5] px-2.5 text-xs text-[#555555] hover:bg-[#f7f7f5]"
                  >
                    自動生成
                  </button>
                </div>
              </label>
              <label className="flex flex-col gap-1 text-xs text-[#707070]">
                工場（空欄で全工場から選択可）
                <select
                  value={draft.factory}
                  onChange={(e) => setDraft({ ...draft, factory: e.target.value })}
                  className={input}
                >
                  <option value="">（全工場）</option>
                  {!factoryOptions.includes(draft.factory) && draft.factory !== "" && (
                    <option value={draft.factory}>{draft.factory}</option>
                  )}
                  {factoryOptions.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex items-center gap-4">
                <label className="flex flex-col gap-1 text-xs text-[#707070]">
                  表示順
                  <input
                    type="number"
                    value={draft.sort}
                    onChange={(e) => setDraft({ ...draft, sort: e.target.value })}
                    className={`${input} w-24 text-right`}
                  />
                </label>
                <label className="mt-4 flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={draft.active}
                    onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
                    className="h-4 w-4 accent-[#b4632c]"
                  />
                  使用中（日次記録の選択肢に出す）
                </label>
              </div>
            </div>
            {error && (
              <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setDraft(null)}
                className="rounded-lg border border-[#e5e5e5] px-4 py-2 text-sm text-[#555555] hover:bg-[#f7f7f5]"
              >
                キャンセル
              </button>
              <button
                onClick={save}
                disabled={pending}
                className="rounded-lg bg-[#b4632c] px-4 py-2 text-sm font-semibold text-white hover:bg-[#96521f] disabled:opacity-50"
              >
                {pending ? "保存中…" : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* QRラベル印刷ビュー */}
      {printTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 print:bg-white print:p-0">
          <div className="w-full max-w-xs rounded-2xl bg-white p-6 text-center shadow-xl print:max-w-none print:rounded-none print:shadow-none">
            <div className="no-print mb-3 flex items-center justify-between">
              <h3 className="text-sm font-bold text-[#333333]">QRラベル</h3>
              <button
                onClick={() => setPrintTarget(null)}
                className="rounded p-1.5 text-[#555555] hover:bg-[#f0f0ee]"
                aria-label="閉じる"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex flex-col items-center gap-2">
              <QrImage value={printTarget.qrCode} size={220} />
              {printTarget.equipNo && (
                <div className="font-mono text-xl font-bold text-[#333333]">{printTarget.equipNo}</div>
              )}
              <div className="text-lg font-bold text-[#333333]">{printTarget.name}</div>
              <div className="text-sm text-[#707070]">
                {printTarget.kind} ／ {printTarget.factory || "全工場"}
              </div>
              <div className="font-mono text-xs text-[#909090]">{printTarget.qrCode}</div>
            </div>
            <button
              onClick={() => window.print()}
              className="no-print mt-4 inline-flex items-center gap-1.5 rounded-lg bg-[#b4632c] px-4 py-2 text-sm font-semibold text-white hover:bg-[#96521f]"
            >
              <Printer className="h-4 w-4" />
              印刷
            </button>
          </div>
        </div>
      )}
    </>
  );
}
