/**
 * 画面上部で選んだ工場を持たせる Cookie。サーバー（session.ts）と画面（FactoryScope.tsx）で共有する。
 * Cookie は利用者が書き換えられるので、**見てよい範囲は必ずサーバーが所属から決め**、
 * この値は範囲の中での絞り込みにしか使わない。
 */
export const FACTORY_COOKIE = "sc_factory";
/** 「全工場」を選んだときの Cookie の値 */
export const ALL_FACTORIES = "__all__";
