"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import {
  addFactoryAction,
  addWorkplaceAction,
  deleteFactoryAction,
  deleteWorkplaceAction,
  setFactoryActiveAction,
  setWorkplaceActiveAction,
} from "@/lib/actions";
import type { FactoryMaster, MasterSource } from "@/lib/db";
import { ResultBanner, type PanelMessage } from "@/components/ScrapBagPanel";

const input =
  "h-10 rounded-lg border border-[#e5e5e5] bg-white px-3 text-base focus:border-[#b4632c] focus:outline-none sm:text-sm";

const SOURCE_LABEL: Record<MasterSource, string> = {
  portal: "ポータル",
  manual: "手動で追加",
  data: "記録から",
};

const SOURCE_STYLE: Record<MasterSource, string> = {
  portal: "bg-[#eef1f4] text-[#0b5ca8]",
  manual: "bg-[#faf6ef] text-[#b4632c]",
  data: "bg-[#f0f0ee] text-[#707070]",
};

/** 使う/使わないの切り替え。押すたびに反転する。 */
function UseToggle({
  active,
  disabled,
  onChange,
  label,
}: {
  active: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!active)}
      className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-full border px-3 text-xs font-bold disabled:opacity-50 ${
        active
          ? "border-[#2f6b2f] bg-[#eef4ee] text-[#2f6b2f]"
          : "border-[#cfcac3] bg-white text-[#909090]"
      }`}
    >
      <span
        className={`inline-block h-3 w-3 rounded-full ${active ? "bg-[#2f6b2f]" : "bg-[#cfcac3]"}`}
      />
      {active ? "使う" : "使わない"}
    </button>
  );
}

/**
 * 工場・職場の管理。
 *
 * ポータルは会社の全工場・全職場を配信してくるので、スクラップに関係の無い工場まで
 * 候補に出ていた。ここで「使う/使わない」を切り替え、必要なら手で追加する。
 *
 * - ポータル配信の工場・職場は削除できない（消しても次の配信で戻る）。使わないにする
 * - 記録で使われている工場は削除できない（記録は工場名を文字列で持っているため）
 * - 手で追加して、まだ使っていない工場・職場だけ削除できる
 */
export default function FactoryMasterTable({ factories }: { factories: FactoryMaster[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<PanelMessage | null>(null);
  const [newFactory, setNewFactory] = useState("");
  const [newWorkplace, setNewWorkplace] = useState<Record<string, string>>({});
  const [showHidden, setShowHidden] = useState(false);

  function run(fn: () => Promise<{ ok: boolean; message?: string }>, after?: () => void) {
    setMsg(null);
    startTransition(async () => {
      const res = await fn();
      setMsg({ ok: res.ok, text: res.message ?? "" });
      if (res.ok) {
        after?.();
        router.refresh();
      }
    });
  }

  const used = factories.filter((f) => f.active);
  const hidden = factories.filter((f) => !f.active);
  const shown = showHidden ? [...used, ...hidden] : used;

  return (
    <section className="mb-4 rounded-2xl border border-[#e5e5e5] bg-white p-4 sm:p-5">
      <h2 className="text-base font-bold text-[#333333] sm:text-sm">工場・職場</h2>
      <p className="mt-1 text-xs text-[#909090]">
        「使う」にした工場だけが、日次記録・月間集計・重量計マスターなどの工場の候補に出ます。
        使わないにしても記録は消えません。ポータルから配信された工場・職場は削除できないので、
        関係の無いものは「使わない」にしてください。
      </p>

      {msg && <ResultBanner msg={msg} className="mt-3" />}

      {/* 工場の追加 */}
      <form
        className="mt-3 flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => addFactoryAction(newFactory), () => setNewFactory(""));
        }}
      >
        <input
          value={newFactory}
          onChange={(e) => setNewFactory(e.target.value)}
          placeholder="工場名（例: 大口）"
          aria-label="追加する工場名"
          className={`${input} w-56`}
        />
        <button
          type="submit"
          disabled={pending || !newFactory.trim()}
          className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-[#b4632c] px-3 text-sm font-semibold text-white hover:bg-[#96521f] disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          工場を追加
        </button>
      </form>

      <ul className="mt-3 space-y-2">
        {shown.length === 0 && (
          <li className="rounded-lg bg-[#f7f7f5] px-3 py-3 text-sm text-[#707070]">
            使う工場がありません。上で追加するか、「使わない工場も表示」から戻してください。
          </li>
        )}
        {shown.map((f) => {
          const deletable = f.source !== "portal" && f.usage === 0;
          const wpInput = newWorkplace[f.name] ?? "";
          return (
            <li
              key={`${f.code ?? "data"}|${f.name}`}
              className={`rounded-xl border p-3 ${
                f.active ? "border-[#e5e5e5] bg-white" : "border-dashed border-[#cfcac3] bg-[#f7f7f5]"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className={`text-sm font-bold ${f.active ? "text-[#333333]" : "text-[#909090]"}`}>
                    {f.name}
                  </span>
                  <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold ${SOURCE_STYLE[f.source]}`}>
                    {SOURCE_LABEL[f.source]}
                  </span>
                  <span className="text-xs text-[#909090]">
                    {f.usage > 0 ? `記録 ${f.usage.toLocaleString("ja-JP")}件` : "記録なし"}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <UseToggle
                    active={f.active}
                    disabled={pending}
                    label={`${f.name} を使う`}
                    onChange={(next) => run(() => setFactoryActiveAction(f.name, next))}
                  />
                  {deletable && (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => {
                        if (!confirm(`工場「${f.name}」を削除しますか？（職場も一緒に消えます）`)) return;
                        run(() => deleteFactoryAction(f.name));
                      }}
                      aria-label={`${f.name} を削除`}
                      className="inline-flex h-9 items-center gap-1 rounded-lg border border-[#dc000c] px-2.5 text-xs font-semibold text-[#dc000c] hover:bg-[#fdecea] disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      削除
                    </button>
                  )}
                </div>
              </div>

              {/* 職場 */}
              {f.active && (
                <div className="mt-2 border-t border-[#f0f0ee] pt-2">
                  <div className="mb-1.5 text-xs text-[#707070]">職場</div>
                  {f.workplaces.length === 0 ? (
                    <p className="text-xs text-[#909090]">職場はまだありません。</p>
                  ) : (
                    <ul className="flex flex-wrap gap-1.5">
                      {f.workplaces.map((w) => (
                        <li
                          key={w.code}
                          className={`inline-flex items-center gap-1 rounded-full border py-0.5 pl-2.5 pr-1 text-xs ${
                            w.active
                              ? "border-[#e5e5e5] bg-white text-[#333333]"
                              : "border-dashed border-[#cfcac3] bg-[#f7f7f5] text-[#909090] line-through"
                          }`}
                        >
                          {w.name}
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => run(() => setWorkplaceActiveAction(w.code, !w.active))}
                            className="rounded-full px-1.5 py-0.5 text-[11px] font-semibold text-[#707070] no-underline hover:bg-[#f0f0ee] disabled:opacity-50"
                            aria-label={`${w.name} を${w.active ? "使わない" : "使う"}にする`}
                          >
                            {/* 状態ではなく操作の名前にする（「使わない」だと状態に見えて紛らわしい） */}
                            {w.active ? "外す" : "戻す"}
                          </button>
                          {w.source !== "portal" && (
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() => {
                                if (!confirm(`職場「${w.name}」を削除しますか？`)) return;
                                run(() => deleteWorkplaceAction(w.code));
                              }}
                              className="rounded-full p-1 text-[#dc000c] hover:bg-[#fdecea] disabled:opacity-50"
                              aria-label={`${w.name} を削除`}
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  <form
                    className="mt-2 flex flex-wrap items-center gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      run(
                        () => addWorkplaceAction(f.name, wpInput),
                        () => setNewWorkplace((d) => ({ ...d, [f.name]: "" }))
                      );
                    }}
                  >
                    <input
                      value={wpInput}
                      onChange={(e) => setNewWorkplace((d) => ({ ...d, [f.name]: e.target.value }))}
                      placeholder="職場名（例: 内胴組立）"
                      aria-label={`${f.name} に追加する職場名`}
                      className={`${input} h-9 w-48`}
                    />
                    <button
                      type="submit"
                      disabled={pending || !wpInput.trim()}
                      className="inline-flex h-9 items-center gap-1 rounded-lg border border-[#b4632c] px-2.5 text-xs font-semibold text-[#b4632c] hover:bg-[#faf6ef] disabled:opacity-50"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      職場を追加
                    </button>
                  </form>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {hidden.length > 0 && (
        <button
          type="button"
          onClick={() => setShowHidden((v) => !v)}
          className="mt-3 text-xs font-semibold text-[#b4632c] underline"
        >
          {showHidden ? "使わない工場を隠す" : `使わない工場も表示（${hidden.length}件）`}
        </button>
      )}
    </section>
  );
}
