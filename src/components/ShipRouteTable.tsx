"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setShipRouteAction } from "@/lib/actions";

const input =
  "h-10 rounded-lg border border-[#e5e5e5] bg-white px-3 text-base focus:border-[#b4632c] focus:outline-none sm:text-sm";

/**
 * 工場間のスクラップ送付（どの工場がどこへポリ箱を送るか）。
 *
 * 送る工場は「ポリ箱（工場間）」で出荷を登録でき、送り先の工場は日次記録で
 * 届いたポリ箱を選んで投入できるようになる。送り先で投入した分は、照合では
 * 送った工場のスクラップとして数え、売却との突合は送り先（処理した工場）で数える。
 */
export default function ShipRouteTable({
  factories,
  routes,
}: {
  factories: string[];
  routes: { fromFactory: string; toFactory: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const toOf = new Map(routes.map((r) => [r.fromFactory, r.toFactory]));
  const receivers = new Set(routes.map((r) => r.toFactory));
  // 設定済みで、工場の候補から外れた工場も並べる（外し忘れに気付けるように）
  const names = [...factories, ...routes.map((r) => r.fromFactory).filter((f) => !factories.includes(f))];

  function change(from: string, to: string) {
    setMsg(null);
    startTransition(async () => {
      const res = await setShipRouteAction(from, to);
      setMsg({ ok: res.ok, text: res.message ?? "" });
      if (res.ok) router.refresh();
    });
  }

  return (
    <section className="mt-4 rounded-2xl border border-[#e5e5e5] bg-white p-4 sm:p-5">
      <h2 className="text-base font-bold text-[#333333] sm:text-sm">工場間のスクラップ送付（ポリ箱）</h2>
      <p className="mt-1 text-xs text-[#909090]">
        自工場で処理せず、ポリ箱で他工場へ送る工場は送り先を選んでください。送る工場は「ポリ箱（工場間）」で
        1箱ずつ量って出荷を登録し、送り先は日次記録で届いたポリ箱を選んで投入します。照合ダッシュボードでは、
        送り先で投入した分を送った工場のスクラップとして数えます（売却との突合は送り先で数えます）。
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

      <ul className="mt-3 divide-y divide-[#eeeeee] rounded-xl border border-[#e5e5e5]">
        {names.map((f) => {
          const to = toOf.get(f) ?? "";
          return (
            <li key={f} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
              <span className="font-bold text-[#333333]">
                {f}
                {receivers.has(f) && (
                  <span className="ml-2 rounded bg-[#e8f0f8] px-1.5 py-0.5 text-xs font-bold text-[#0b5ca8]">
                    受け入れ: {routes.filter((r) => r.toFactory === f).map((r) => r.fromFactory).join("・")}
                  </span>
                )}
              </span>
              <label className="flex items-center gap-2 text-xs text-[#707070]">
                スクラップの処理
                <select
                  value={to}
                  disabled={pending}
                  onChange={(e) => change(f, e.target.value)}
                  aria-label={`${f} のスクラップの処理`}
                  className={`${input} w-56`}
                >
                  <option value="">自工場で処理</option>
                  {factories
                    .filter((x) => x !== f)
                    .map((x) => (
                      <option key={x} value={x}>
                        {x} へポリ箱で送る
                      </option>
                    ))}
                </select>
              </label>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
