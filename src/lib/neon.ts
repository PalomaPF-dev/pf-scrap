import { neon } from "@neondatabase/serverless";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * DB アダプタ（PFスクラップ管理 専用DB）。
 *
 * クラウド版（Neon HTTP ドライバ）とオンプレ版（node-postgres / pg）を
 * 同一コードベースで切り替える。db.ts / schema.ts / authDb.ts 側は
 * 「tagged template で書く・await で実行・sql.transaction にクエリ配列を渡す」
 * という Neon の使い方のまま無変更で動くことが大原則。
 * env が無ければ従来どおり neon 経路（クラウド版の挙動は一切変えない）。
 */

/** クエリ結果の1行（neon の QueryRows<false> と同形） */
export type SqlRow = Record<string, any>;

/**
 * tagged template + transaction を持つ SQL クライアントの構造的型。
 * neon() の戻り値も pg アダプタもこの形に収まる
 * （neon の transaction は引数型が NeonQueryPromise 固有のためキャストで合わせる）。
 */
export interface SqlClient {
  (strings: TemplateStringsArray, ...params: any[]): Promise<SqlRow[]>;
  transaction(queries: Promise<SqlRow[]>[]): Promise<SqlRow[][]>;
}

/**
 * ドライバ選択。
 * - DB_DRIVER=pg / neon の明示指定が最優先
 * - 未指定なら DATABASE_URL のホストで判定（`.neon.tech` で終われば neon、それ以外は pg）
 * - URL パース失敗はクラウド安全側（従来の neon 経路）に倒す
 */
export function isPgDriver(url: string): boolean {
  const driver = process.env.DB_DRIVER;
  if (driver === "pg") return true;
  if (driver === "neon") return false;
  try {
    return !new URL(url).hostname.endsWith(".neon.tech");
  } catch {
    return false;
  }
}

// ===== pg アダプタ =====

type PgPool = import("pg").Pool;

/**
 * dev の HMR でモジュールが再評価されても Pool を増殖させないよう
 * globalThis にキャッシュする（Next.js の定番イディオム）。
 * pg は動的 import で遅延ロードし、neon 経路（クラウド）では絶対に評価されない。
 * Neon URL の sslmode=require 等は pg が connectionString から解釈する。
 */
const globalForPg = globalThis as unknown as {
  _scrapPgPool?: Promise<PgPool>;
};

function getPool(url: string): Promise<PgPool> {
  if (!globalForPg._scrapPgPool) {
    globalForPg._scrapPgPool = import("pg").then(
      ({ Pool }) =>
        new Pool({
          connectionString: url,
          // サーバーレスでは関数インスタンスごとにこの Pool ができる。
          // Supabase(Supavisor) 経由ではプーラ側の接続枠を分け合うため、
          // 1インスタンスが多く抱えると他インスタンスが枯渇する。3で十分
          // （1リクエストが同時に使う接続は transaction 中でも1〜2本）。
          max: 3,
          idleTimeoutMillis: 30000,
        })
    );
  }
  return globalForPg._scrapPgPool;
}

/** tagged template を pg のプレースホルダ形式（$1, $2, …）に変換する。 */
function toQuery(
  strings: TemplateStringsArray,
  params: any[]
): { text: string; values: any[] } {
  let text = strings[0];
  for (let i = 0; i < params.length; i++) {
    text += `$${i + 1}${strings[i + 1]}`;
  }
  return { text, values: params };
}

/**
 * 遅延実行の thenable クエリ。
 *
 * なぜ遅延が必要か: db.ts は `sql.transaction([sql`...`, sql`...`])` のように
 * 「未実行のクエリの配列」を transaction に渡す（neon HTTP ドライバと同じ流儀）。
 * tagged template の評価時点で即実行してしまうと、各クエリがトランザクション外で
 * 個別のコネクションに流れて原子性が壊れる。そこで text/values を保持するだけの
 * thenable とし、await されて初めて pool.query を実行する。
 * 二重 await でも実行は1回だけ（結果プロミスをメモ化）。
 */
class PgQuery implements Promise<SqlRow[]> {
  readonly [Symbol.toStringTag] = "PgQuery";
  private result: Promise<SqlRow[]> | null = null;

  constructor(
    private readonly url: string,
    readonly text: string,
    readonly values: any[]
  ) {}

  /** 初回 await でのみ実行（単発クエリは Pool から自動取得のコネクションで実行） */
  private run(): Promise<SqlRow[]> {
    if (!this.result) {
      this.result = getPool(this.url).then((pool) =>
        pool.query<SqlRow>(this.text, this.values).then((res) => res.rows)
      );
    }
    return this.result;
  }

  /** transaction 実行側が結果を記憶させる（以後 await されても再実行しない） */
  _settle(rows: SqlRow[]): void {
    if (!this.result) this.result = Promise.resolve(rows);
  }

  then<T1 = SqlRow[], T2 = never>(
    onfulfilled?: ((value: SqlRow[]) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: any) => T2 | PromiseLike<T2>) | null
  ): Promise<T1 | T2> {
    return this.run().then(onfulfilled, onrejected);
  }

  catch<T = never>(
    onrejected?: ((reason: any) => T | PromiseLike<T>) | null
  ): Promise<SqlRow[] | T> {
    return this.run().catch(onrejected);
  }

  finally(onfinally?: (() => void) | null): Promise<SqlRow[]> {
    return this.run().finally(onfinally);
  }
}

function createPgClient(url: string): SqlClient {
  const tagged = (
    strings: TemplateStringsArray,
    ...params: any[]
  ): Promise<SqlRow[]> => {
    const { text, values } = toQuery(strings, params);
    return new PgQuery(url, text, values);
  };

  /**
   * 未実行の PgQuery 配列を単一コネクションで BEGIN → 順次実行 → COMMIT。
   * 失敗時は ROLLBACK して元のエラーをそのまま投げる。
   * pg の DatabaseError は .code に SQLSTATE を直接持つため、
   * 既存の `e?.code ?? e?.sourceError?.code` 判定（23505 等）は無修正で動く。
   */
  const transaction = async (
    queries: Promise<SqlRow[]>[]
  ): Promise<SqlRow[][]> => {
    const pool = await getPool(url);
    const conn = await pool.connect();
    try {
      await conn.query("BEGIN");
      const results: SqlRow[][] = [];
      for (const q of queries) {
        if (!(q instanceof PgQuery)) {
          throw new Error(
            "sql.transaction には本アダプタの tagged template クエリのみ渡せます"
          );
        }
        const res = await conn.query<SqlRow>(q.text, q.values);
        q._settle(res.rows);
        results.push(res.rows);
      }
      await conn.query("COMMIT");
      return results;
    } catch (e) {
      // ROLLBACK 自体の失敗（接続断など）は握り潰し、元のエラーを優先する
      try {
        await conn.query("ROLLBACK");
      } catch {
        /* noop */
      }
      throw e;
    } finally {
      conn.release();
    }
  };

  return Object.assign(tagged, { transaction });
}

// ===== 公開 API（既存シグネチャのまま） =====

/**
 * SQL クライアントの取得。
 * DATABASE_URL が無いビルド時にクラッシュしないよう遅延生成する。
 */
export function getSql(): SqlClient {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL が設定されていません");
  if (isPgDriver(url)) return createPgClient(url);
  // neon() の戻り値は実行時に SqlClient 互換（tagged template + transaction）。
  // transaction の引数型だけ NeonQueryPromise 固有のため構造的に一致せずキャストする。
  return neon(url) as unknown as SqlClient;
}

/** DATABASE_URL が設定済みか（未設定なら初期セットアップ案内を出すための判定） */
export function hasDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL);
}
