"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { Building2, ChevronRight, Factory, Globe } from "lucide-react";
import { ALL_FACTORIES, FACTORY_COOKIE } from "@/lib/factoryCookie";

/**
 * 工場の選択。アプリを開いたら**まず工場を選ぶ**（PF作業改善と同じ流れ）。
 *
 * - 所属工場の人: 所属工場に決まっているので選ばない（切り替えもできない）
 * - 全工場を見られる人（所属工場が未設定のポータル管理者・本部スタッフ）:
 *   最初に工場（または全工場）を選ぶ。どの画面からでも上部のバーで切り替えられる
 *
 * 選んだ工場は Cookie に置き、各画面はそれを工場の既定値にする（session.ts の getFactoryView）。
 * 見てよい範囲はサーバーが所属から決めるので、Cookie を書き換えても他の工場は見えない。
 */

interface ScopeInfo {
  all: boolean;
  home: string | null;
  /** いま選んでいる工場。null は全工場 */
  factory: string | null;
  factories: string[];
}

interface Ctx extends ScopeInfo {
  choose: (factory: string | null) => void;
  openPicker: () => void;
}

const FactoryCtx = createContext<Ctx | null>(null);

/** いま扱っている工場（null は全工場）。Provider の外では null */
export function useFactory(): Ctx | null {
  return useContext(FactoryCtx);
}

function readCookie(): string | null {
  const m = document.cookie.match(new RegExp(`(?:^|; )${FACTORY_COOKIE}=([^;]*)`));
  return m ? m[1] : null;
}

function safeDecode(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

function writeCookie(factory: string | null) {
  const v = factory == null ? ALL_FACTORIES : encodeURIComponent(factory);
  document.cookie = `${FACTORY_COOKIE}=${v}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
}

/** 選び直したとき、URL の ?factory= が前の工場のまま残らないように外す */
function urlWithoutFactory(): string {
  const u = new URL(window.location.href);
  u.searchParams.delete("factory");
  return u.pathname + u.search + u.hash;
}

export function FactoryProvider({
  enabled,
  children,
}: {
  /** ログインしているときだけ工場を選ばせる（ログイン画面などでは何もしない） */
  enabled: boolean;
  children: React.ReactNode;
}) {
  const [info, setInfo] = useState<ScopeInfo | null>(null);
  const [failed, setFailed] = useState(false);
  /** 全工場を見られる人がまだ工場を選んでいない、または切り替えを開いた */
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    fetch("/api/scope", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: ScopeInfo) => {
        setInfo(j);
        // 未選択、または選んでいた工場が候補から外れた（設定で「使わない」にした等）ときは選び直す
        const c = readCookie();
        const stale =
          c != null && c !== ALL_FACTORIES && j.factories.length > 0 && !j.factories.includes(safeDecode(c));
        if (j.all && (c == null || stale)) setPicking(true);
      })
      .catch(() => setFailed(true));
  }, [enabled]);

  const choose = (factory: string | null) => {
    writeCookie(factory);
    // 開いている画面のデータは前の工場のものなので、読み込み直す
    window.location.replace(urlWithoutFactory());
  };

  // 取得に失敗したときは、選択なしでそのまま使わせる（範囲はサーバー側で守られている）
  if (!enabled || failed) return <>{children}</>;
  if (!info) return <p className="p-6 text-sm text-[#909090]">読み込み中...</p>;

  const ctx: Ctx = { ...info, choose, openPicker: () => setPicking(true) };
  return (
    <FactoryCtx.Provider value={ctx}>
      {picking && info.all ? (
        <FactoryGate
          info={info}
          onChoose={choose}
          onCancel={readCookie() != null ? () => setPicking(false) : undefined}
        />
      ) : (
        <>
          <FactoryBar />
          {children}
        </>
      )}
    </FactoryCtx.Provider>
  );
}

/** 最初に出す工場の選択画面（全工場を見られる人だけ） */
function FactoryGate({
  info,
  onChoose,
  onCancel,
}: {
  info: ScopeInfo;
  onChoose: (f: string | null) => void;
  onCancel?: () => void;
}) {
  const pickedAll = readCookie() === ALL_FACTORIES;
  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-8">
      <h1 className="text-xl font-bold text-slate-800 sm:text-2xl">工場を選んでください</h1>
      <p className="mt-1 text-sm text-slate-500">
        選んだ工場の日次記録・集計・照合・マスタを表示します。あとから画面上部でいつでも切り替えられます。
      </p>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {info.factories.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => onChoose(f)}
            className={`flex items-center gap-3 rounded-2xl border bg-white px-4 py-4 text-left hover:border-[#b4632c] hover:bg-[#faf6ef] ${
              info.factory === f ? "border-[#b4632c] ring-2 ring-[#f3e3d3]" : "border-[#e5e5e5]"
            }`}
          >
            <Factory className="h-6 w-6 shrink-0 text-[#b4632c]" />
            <span className="grow text-base font-bold text-[#333333]">{f}</span>
            <ChevronRight className="h-4 w-4 text-[#c9c9c9]" />
          </button>
        ))}
        <button
          type="button"
          onClick={() => onChoose(null)}
          className={`flex items-center gap-3 rounded-2xl border border-dashed bg-white px-4 py-4 text-left hover:border-[#b4632c] hover:bg-[#faf6ef] ${
            pickedAll ? "border-[#b4632c]" : "border-[#c9c9c9]"
          }`}
        >
          <Globe className="h-6 w-6 shrink-0 text-[#707070]" />
          <span className="grow">
            <span className="block text-base font-bold text-[#333333]">全工場</span>
            <span className="block text-[11px] text-[#707070]">全社合算で見るとき・工場をまたいで比べるとき</span>
          </span>
          <ChevronRight className="h-4 w-4 text-[#c9c9c9]" />
        </button>
      </div>
      {info.factories.length === 0 && (
        <p className="mt-3 rounded-lg bg-[#fff3e0] px-3 py-2 text-sm text-[#a15c00]">
          工場の一覧を取得できませんでした（ポータルから工場マスタが届いていない可能性があります）。「全工場」で開いてください。
        </p>
      )}
      <p className="mt-4 flex items-center gap-1.5 text-xs text-[#707070]">
        <Building2 className="h-3.5 w-3.5 shrink-0" />
        所属工場が未設定の方（ポータル管理者・本部スタッフ）は全工場を閲覧できます。工場所属の方は所属工場だけが表示されます。
      </p>
      {onCancel && (
        <button type="button" onClick={onCancel} className="mt-4 text-sm text-[#707070] underline">
          切り替えずに戻る
        </button>
      )}
    </div>
  );
}

/** 全画面の上に出す、いまの工場と切り替え（印刷には出さない） */
function FactoryBar() {
  const f = useFactory();
  if (!f) return null;
  return (
    <div className="no-print flex flex-wrap items-center gap-2 border-b border-[#e5e5e5] bg-white px-4 py-2 text-sm sm:px-6">
      {f.factory ? (
        <Factory className="h-4 w-4 text-[#b4632c]" />
      ) : (
        <Globe className="h-4 w-4 text-[#707070]" />
      )}
      <span className="font-bold text-[#333333]">{f.factory ?? "全工場"}</span>
      {f.all ? (
        <button
          type="button"
          onClick={f.openPicker}
          className="rounded-lg border border-[#c9c9c9] px-2 py-0.5 text-xs text-[#555555] hover:bg-[#f7f7f5]"
        >
          工場を切り替え
        </button>
      ) : (
        <span className="text-[11px] text-[#909090]">所属工場のデータを表示しています</span>
      )}
    </div>
  );
}
