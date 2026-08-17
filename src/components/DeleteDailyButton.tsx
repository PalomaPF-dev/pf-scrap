"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { deleteDailyRecordAction } from "@/lib/actions";

/** 日次記録の削除（管理者のみ表示。サーバー側でも requireAdminSession で防ぐ）。 */
export default function DeleteDailyButton({
  recordDate,
  factory,
}: {
  recordDate: string;
  factory: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      disabled={pending}
      onClick={() => {
        if (!confirm(`${recordDate} ${factory} の日次記録を削除しますか?`)) return;
        startTransition(async () => {
          const res = await deleteDailyRecordAction(recordDate, factory);
          if (!res.ok) alert(res.message);
          router.refresh();
        });
      }}
      className="rounded p-1 text-[#dc000c] hover:bg-[#fdecea] disabled:opacity-50"
      aria-label="削除"
    >
      <Trash2 className="h-4 w-4" />
    </button>
  );
}
