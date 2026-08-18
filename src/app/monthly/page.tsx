import { redirect } from "next/navigation";

/** 旧・月次入力は「調達入力（日次）」に統合した。ブックマーク互換のためリダイレクト。 */
export default function MonthlyPage() {
  redirect("/procurement");
}
