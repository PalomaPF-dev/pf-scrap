"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2 } from "lucide-react";

/** メールのリンクから開く、新しいパスワードの設定画面。 */
export default function PasswordResetConfirmPage() {
  return (
    <Suspense fallback={null}>
      <ConfirmInner />
    </Suspense>
  );
}

function ConfirmInner() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("パスワードは8文字以上にしてください。");
      return;
    }
    if (password !== password2) {
      setError("確認用のパスワードが一致しません。同じものを2回入力してください。");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/password-reset/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.message || "変更に失敗しました。時間をおいて再度お試しください。");
        setLoading(false);
        return;
      }
      setDone(true);
    } catch {
      setError("通信エラーが発生しました。時間をおいて再度お試しください。");
    }
    setLoading(false);
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#f7f7f5]">
      <div className="h-1 shrink-0 bg-[#b4632c]" />
      <div className="flex flex-1 items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="mb-8 text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icon-192.png" alt="" className="mx-auto mb-4 h-16 w-16 rounded-2xl" />
            <p className="text-[11px] tracking-[0.08em] text-[#707070]">生産・調達統括本部</p>
            <h1 className="mt-1 text-2xl font-bold text-[#333333]">PFスクラップ管理</h1>
            <p className="mt-1 text-sm text-[#707070]">新しいパスワードの設定</p>
          </div>

          <div className="rounded-2xl border border-[#e5e5e5] bg-white px-8 py-8">
            {done ? (
              <div className="text-center">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-[#f7f7f5] text-[#b4632c]">
                  <CheckCircle2 className="h-6 w-6" />
                </div>
                <h2 className="text-lg font-semibold text-[#333333]">パスワードを変更しました</h2>
                <p className="mt-3 text-sm text-[#333333]">
                  新しいパスワードでログインしてください。
                </p>
                <Link
                  href="/login"
                  className="mt-6 inline-block rounded-lg bg-[#b4632c] px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#96521f]"
                >
                  ログイン画面へ
                </Link>
              </div>
            ) : !token ? (
              <div className="text-center">
                <h2 className="text-lg font-semibold text-[#333333]">リンクが正しくありません</h2>
                <p className="mt-3 text-sm leading-relaxed text-[#333333]">
                  メールに記載されたリンクをそのまま開いてください。
                  リンクの有効期限（60分）が切れている場合は、もう一度最初からやり直してください。
                </p>
                <Link
                  href="https://portal.paloma-pf.com"
                  className="mt-6 inline-block rounded-lg bg-[#b4632c] px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#96521f]"
                >
                  ポータルへ戻る
                </Link>
              </div>
            ) : (
              <>
                <h2 className="text-lg font-semibold text-[#333333]">新しいパスワードを設定</h2>
                <div className="mt-2 h-[3px] w-9 rounded-full bg-[#b4632c]" />
                <p className="mt-3 mb-6 text-sm text-[#707070]">
                  新しいパスワード（8文字以上）を2回入力してください。
                </p>
                <form onSubmit={onSubmit} className="space-y-4">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-[#333333]">
                      新しいパスワード（8文字以上）
                    </label>
                    <input
                      type="password"
                      required
                      minLength={8}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full rounded-lg border border-[#e5e5e5] px-3 py-2 text-sm focus:border-[#b4632c] focus:outline-none focus:ring-1 focus:ring-[#b4632c]"
                      placeholder="••••••••"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-[#333333]">
                      新しいパスワード（確認のためもう一度）
                    </label>
                    <input
                      type="password"
                      required
                      minLength={8}
                      value={password2}
                      onChange={(e) => setPassword2(e.target.value)}
                      className="w-full rounded-lg border border-[#e5e5e5] px-3 py-2 text-sm focus:border-[#b4632c] focus:outline-none focus:ring-1 focus:ring-[#b4632c]"
                      placeholder="••••••••"
                    />
                  </div>
                  {error && (
                    <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                      {error}
                    </div>
                  )}
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full rounded-lg bg-[#b4632c] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#96521f] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {loading ? "変更中…" : "パスワードを変更する"}
                  </button>
                </form>
              </>
            )}
          </div>
          <div className="mt-4 text-center">
            <a
              href="https://portal.paloma-pf.com"
              className="text-sm text-[#707070] transition-colors hover:text-[#b4632c]"
            >
              ← ポータルへ戻る
            </a>
          </div>
        </div>
      </div>
      <footer className="bg-[#323232] py-4 text-center text-[11px] tracking-[0.08em] text-white/75">
        株式会社パロマ 生産・調達統括本部
      </footer>
    </div>
  );
}
