import crypto from "crypto";
import { getSql } from "./neon";

/**
 * パスワード再設定トークン。
 * - 生トークンはメールのリンクにのみ載せ、DB には SHA-256 ハッシュだけ保存する
 *   （DB が読まれてもトークンを再現できない）。
 * - 有効期限 60分・使い捨て（used_at 記録）。
 */

export const RESET_TOKEN_TTL_MINUTES = 60;

/** password_reset_tokens テーブルを冪等に作成（このシリーズの慣例に合わせた自動作成）。 */
export async function ensurePasswordResetSchema(): Promise<void> {
  const sql = getSql();
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        used_at    TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    await sql`
      CREATE INDEX IF NOT EXISTS password_reset_tokens_user_idx
      ON password_reset_tokens(user_id)`;
  } catch {
    /* 同時初回アクセスのカタログ競合（42P07 等）は無視（schema.ts の safeDdl と同方針） */
  }
}

/** 再設定トークンを新規発行（戻り値はメールに載せる生トークン）。 */
export function generateResetToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/** DB 保存・照合用の SHA-256 ハッシュ。 */
export function hashResetToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** リンクの base URL（NEXTAUTH_URL 優先・末尾スラッシュは除去）。 */
export function resetLinkBase(): string {
  const base = process.env.NEXTAUTH_URL || "https://scrap.paloma-pf.com";
  return base.replace(/\/+$/, "");
}
