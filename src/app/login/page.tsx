"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";

// useSearchParams はプリレンダー時に Suspense 境界が必要
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}

function LoginInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // ログイン後の戻り先（オープンリダイレクト防止でアプリ内パスのみ許可）
  const rawCallback = searchParams.get("callbackUrl") ?? "";
  const callbackUrl =
    rawCallback.startsWith("/") && !rawCallback.startsWith("//") ? rawCallback : "/";
  const ssoError = searchParams.get("error") === "sso";

  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // 戻る操作などでページが復元されたとき、押していないのに「ログイン中…」のまま
  // 表示される状態バグを防ぐ（bfcache 復元時にローディング状態をリセット）
  useEffect(() => {
    const reset = (e: PageTransitionEvent) => {
      if (e.persisted) {
        setLoading(false);
      }
    };
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    // フィールド名 email は互換のため（値は社員番号）
    const res = await signIn("credentials", { email: loginId, password, redirect: false });
    setLoading(false);
    if (res?.error) {
      // authorize が投げた具体的なメッセージ（パスワード未設定など）はそのまま表示する
      setError(
        res.error === "CredentialsSignin"
          ? "社員番号またはパスワードが違います。"
          : res.error
      );
      return;
    }
    router.push(callbackUrl);
    router.refresh();
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#f7f7f5]">
      <div className="h-1 shrink-0 bg-[#b4632c]" />
      <div className="flex flex-1 items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="rounded-2xl border border-[#e5e5e5] bg-white px-8 py-8">
            <div className="mb-6 flex flex-col items-center text-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/icon-192.png" alt="" className="mx-auto mb-3 h-16 w-16 rounded-2xl" />
              <p className="text-xs text-[#707070] tracking-wide">生産・調達統括本部</p>
              <h1 className="text-xl font-bold text-[#333333]">PFスクラップ管理</h1>
              <p className="mt-1 text-xs text-[#707070]">スクラップ重量管理システム</p>
            </div>

            <h2 className="mb-6 text-lg font-semibold text-[#333333] after:mt-2 after:block after:h-[3px] after:w-8 after:rounded-full after:bg-[#b4632c] after:content-['']">
              ログイン
            </h2>

            {ssoError && (
              <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                ポータルからのログインに失敗しました。ポータルでログインし直してから、
                もう一度このアプリを開いてください。
              </div>
            )}

            {/*
              ログインの主経路はポータル(SSO 一括ログイン)。
              一般ユーザーはパスワードログインを使えない(admin のみ許可)ため、
              使えないフォームを主役にせず、ポータルへの導線を最初に出す。
            */}
            <a
              href="https://portal.paloma-pf.com/"
              className="flex w-full items-center justify-center rounded-lg bg-[#b4632c] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#96521f]"
            >
              ポータルでログイン
            </a>
            <p className="mt-2 text-center text-xs text-[#707070]">
              ポータルでログインすると各アプリは自動でログインされます。
              ホーム画面に追加したアプリでも同じ手順です。
            </p>

            {/* SSO 障害時の復旧用。パスワードログインは admin のみ受け付ける */}
            <details className="mt-6 rounded-lg border border-[#e5e5e5] px-4 py-3">
              <summary className="cursor-pointer select-none text-sm font-medium text-[#555555]">
                管理者ログイン(SSO 障害時用)
              </summary>
              <div className="mt-4">
                <form onSubmit={onSubmit} className="space-y-4">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-[#333333]">社員番号</label>
                    <input
                      type="text"
                      autoComplete="username"
                      required
                      value={loginId}
                      onChange={(e) => setLoginId(e.target.value)}
                      className="w-full rounded-lg border border-[#d5d5d5] bg-white px-3 py-2 text-sm focus:border-[#b4632c] focus:outline-none focus:ring-1 focus:ring-[#b4632c]"
                      placeholder="admin"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-[#333333]">パスワード</label>
                    <input
                      type="password"
                      autoComplete="current-password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full rounded-lg border border-[#d5d5d5] bg-white px-3 py-2 text-sm focus:border-[#b4632c] focus:outline-none focus:ring-1 focus:ring-[#b4632c]"
                      placeholder="••••••••"
                    />
                  </div>
                  {error && (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                      {error}
                    </div>
                  )}
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full rounded-lg bg-[#333333] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#111111] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {loading ? "ログイン中…" : "ログイン"}
                  </button>
                </form>
              </div>
            </details>
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
