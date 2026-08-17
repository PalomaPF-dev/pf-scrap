/**
 * オンプレ（社内）版の判定。ON_PREMISE=1 のとき利用権ゲートを無効化する（entitlement.ts）。
 */
export const isOnPremise = (): boolean => process.env.ON_PREMISE === "1";
