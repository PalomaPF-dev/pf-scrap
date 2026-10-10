"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Save, Undo2 } from "lucide-react";
import { saveBagStartAction } from "@/lib/actions";
import type { BagStart } from "@/lib/db";

const input =
  "h-10 rounded-lg border border-[#e5e5e5] bg-white px-3 text-base focus:border-[#b4632c] focus:outline-none sm:text-sm";

const SOURCE_LABEL: Record<BagStart["source"], string> = {
  setting: "設定した日",
  firstBag: "最初に袋を開いた日から推定",
  none: "まだ袋を開いていません",
};

/**
 * 袋運用の開始日（工場ごと）。
 *
 * この日から「袋単位」で管理し、それより前は従来どおり日単位の記録として扱う。
 * 設定しなくても「最初に袋を開いた日」から推定するので、ふつうは触らなくてよい。
 * 試しに作った袋があって推定がずれるときや、切替日をあらかじめ決めておきたいときに使う。
 */
export default function BagStartTable({ starts }: { starts: BagStart[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function save(factory: string, startOn: string) {
    setMsg(null);
    startTransition(async () => {
      const res = await saveBagStartAction({ factory, startOn });
      setMsg({ ok: res.ok, text: res.message ?? "" });
      if (res.ok) {
        setDraft((d) => {
          const next = { ...d };
          delete next[factory];
          return next;
        });
        router.refresh();
      }
    });
  }

  return (
    <section className="mt-4 rounded-2xl border border-[#e5e5e5] bg-white p-4 sm:p-5">
      <h2 className="text-base font-bold text-[#333333] sm:text-sm">袋単位の管理を始めた日</h2>
      <p className="mt-1 text-xs text-[#909090]">
        この日から袋を1区切りとして記録し、それより前は従来どおり日単位の記録として扱います
        （その期間は日次記録に袋の欄が出ません）。日別・月別の合計は、境目に関係なく
        これまでどおり明細から積み上げます。
      </p>

      {msg && (
        <p
          className={`mt-3 rounded-lg px-3 py-2 text-sm ${
            msg.ok ? "bg-[#eef4ee] text-[#2f6b2f]" : "bg-[#fdecea] text-[#dc000c]"
          }`}
        >
          {msg.text}
        </p>
      )}

      <ul className="mt-3 space-y-2">
        {starts.length === 0 && (
          <li className="rounded-lg bg-[#f7f7f5] px-3 py-3 text-sm text-[#707070]">
            工場が登録されていません（ポータルの工場マスタから配信されます）。
          </li>
        )}
        {starts.map((st) => {
          const value = draft[st.factory] ?? st.startOn ?? "";
          const changed = (draft[st.factory] ?? null) !== null && value !== (st.startOn ?? "");
          return (
            <li
              key={st.factory}
              className="flex flex-col gap-2 rounded-xl border border-[#e5e5e5] p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="text-sm font-bold text-[#333333]">{st.factory}</div>
                <div className="mt-0.5 text-xs text-[#909090]">
                  {st.startOn ? `${st.startOn} から袋単位` : "袋単位の管理はまだ始まっていません"}
                  <span className="ml-1">（{SOURCE_LABEL[st.source]}）</span>
                  {st.source === "setting" && st.updatedBy && (
                    <span className="ml-1">設定: {st.updatedBy}</span>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="date"
                  value={value}
                  onChange={(e) => setDraft({ ...draft, [st.factory]: e.target.value })}
                  aria-label={`${st.factory} の袋運用の開始日`}
                  className={`${input} w-44`}
                />
                <button
                  onClick={() => save(st.factory, value)}
                  disabled={pending || !changed}
                  className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-[#b4632c] px-3 text-sm font-semibold text-white hover:bg-[#96521f] disabled:opacity-50"
                >
                  <Save className="h-4 w-4" />
                  保存
                </button>
                {st.source === "setting" && (
                  <button
                    onClick={() => save(st.factory, "")}
                    disabled={pending}
                    className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-[#e5e5e5] px-3 text-sm font-medium text-[#555555] hover:bg-[#f7f7f5] disabled:opacity-50"
                  >
                    <Undo2 className="h-4 w-4" />
                    推定に戻す
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
