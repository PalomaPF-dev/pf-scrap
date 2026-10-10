import { redirect } from "next/navigation";

/**
 * 旧URL（/first/list）。サイドバーで「初品重量測定」と同時に選択表示されてしまうため
 * 一覧は /first-list に移した。ブックマーク用に絞り込み条件ごと転送する。
 */
export default async function OldFirstListPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === "string") q.set(k, v);
  }
  const qs = q.toString();
  redirect(`/first-list${qs ? `?${qs}` : ""}`);
}
