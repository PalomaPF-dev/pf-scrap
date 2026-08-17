import { getSql } from "@/lib/neon";
import { ensureSchema } from "@/lib/schema";
import { isOnPremise } from "@/lib/onprem";

// 会社のエンタイトルメント。active = is_pro(契約済) または トライアル期限内(登録日+30日)。
// 社内運用（ON_PREMISE=1）では課金ゲートなしの永続ライセンス扱い（PFシリーズ共通）。
export const TRIAL_DAYS = 30;

export interface Entitlement {
  active: boolean;
  isPro: boolean;
  isDemo: boolean;
  trialEndsAt: string | null;
  trialDaysLeft: number | null;
  /** オンプレ版（ON_PREMISE=1）。課金なしの永続ライセンス扱い */
  onPremise?: boolean;
}

export async function getCompanyEntitlement(companyId: string): Promise<Entitlement> {
  // オンプレ版は課金ゲートなし（DB も読まない — DB 断でもロックしない）
  if (isOnPremise()) {
    return {
      active: true,
      isPro: true,
      isDemo: false,
      trialEndsAt: null,
      trialDaysLeft: null,
      onPremise: true,
    };
  }
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT is_pro, is_demo, created_at, subscription_expires_at
    FROM companies WHERE id = ${companyId} LIMIT 1`;
  const r = rows[0];
  if (!r) return { active: false, isPro: false, isDemo: false, trialEndsAt: null, trialDaysLeft: null };
  const isPro = Boolean(r.is_pro);
  const isDemo = Boolean(r.is_demo);
  const now = Date.now();

  // 契約有効＝is_pro かつ（期限未記録 or 期限が未来）。
  const expiresAt = r.subscription_expires_at ? new Date(r.subscription_expires_at as string).getTime() : null;
  const proActive = isPro && (expiresAt === null || expiresAt > now);

  const createdAt = r.created_at ? new Date(r.created_at as string) : null;
  const trialEnd = createdAt ? new Date(createdAt.getTime() + TRIAL_DAYS * 86_400_000) : null;
  const trialActive = trialEnd ? trialEnd.getTime() > now : false;
  const trialDaysLeft = trialEnd ? Math.max(0, Math.ceil((trialEnd.getTime() - now) / 86_400_000)) : null;
  return {
    // デモ会社は常に利用可（課金ゲートの対象外）
    active: isDemo || proActive || trialActive,
    isPro,
    isDemo,
    trialEndsAt: trialEnd ? trialEnd.toISOString() : null,
    trialDaysLeft,
  };
}
