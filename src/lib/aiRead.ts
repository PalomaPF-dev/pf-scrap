/**
 * 重量計の表示値を写真から読む（AI読取）。
 *
 * 現場は「重量計の上にスクラップ箱が常に載っている」運用なので、投入の前後で
 * 表示値を1回ずつ読めば、その差がそのままスクラップ重量になる。手入力を無くす
 * ことが目的なので、読めなかったときは黙って推測せず、必ず null を返して
 * 手入力に落とす（間違った数字を自動で入れるほうが危険なため）。
 *
 * APIキーはサーバー専用。このファイルはクライアントから import しない。
 */
import Anthropic from "@anthropic-ai/sdk";

/** 7セグメント表示の読み取りに十分で、かつ速い（現場は1投入ごとに待つ）。 */
const MODEL = "claude-sonnet-5";

export type ReadConfidence = "high" | "medium" | "low";

export interface ScaleReadResult {
  /** 読み取れた重量 kg。読めなければ null（手入力に落とす） */
  value: number | null;
  /** 表示器に出ていた文字列そのまま（例 "112.4"）。監査で人が見て確かめる用 */
  digits: string;
  confidence: ReadConfidence;
  /** 読めなかった理由・注意点（ピンボケ、表示が隠れている等） */
  note: string;
  model: string;
}

export function hasAiKey(): boolean {
  return Boolean((process.env.ANTHROPIC_API_KEY || "").trim());
}

const PROMPT = `あなたは工場のスクラップ計量を支援します。写真に写っている「重量計（台はかり）の表示器」の数値を読み取ってください。

必ず次のJSONだけを返してください。前後に説明文を付けないでください。
{"value": 数値 or null, "digits": "表示されていた文字列", "unit": "kg" or "g" or null, "decimalPoint": "visible" or "absent" or "unsure", "confidence": "high" or "medium" or "low", "note": "短い補足"}

■ 最重要: 小数点
この表示器は 0.1kg 単位まで表示します。実際の運用で最も多い誤りは、
**小数点を見落として 31.5 を 315 と読む（10倍になる）誤り**です。数字そのものが
くっきり見えていても、小数点だけが薄く写ることがよくあります。
- 数字を読む前に、まず「桁と桁の間の小数点」を探してください。7セグ表示の小数点は
  数字の右下にある小さな点で、光の当たり方や角度で消えたように見えます。
- 小数点が見えた → decimalPoint: "visible"、digits にも小数点を入れる（例 "31.5"）
- 小数点が無いと確信できる → decimalPoint: "absent"
- **どちらか判断できない → decimalPoint: "unsure" とし、value は必ず null にする**
  （小数点の位置が違うと10倍間違うので、迷ったら読まないでください）
- 小数点があるのに末尾が 0 のとき（例 "36.0"）も、必ず小数点を含めて digits に書く。

■ そのほかの規則
- value は kg に換算した数値。表示が g なら 1000 で割る。
- 小数点以外でも、少しでも判読に迷う桁があるときは value を null にし、
  confidence を "low"、note に理由を書く。推測で数字を埋めないでください。
- 表示器が写っていない、ピンボケ、光の反射で読めない場合も value は null。
  その場合は note に「表示器が写っていません」など、撮り直しの助けになる理由を書く。
- 数値以外の表示（ERR, ----, 0点表示など）は value を null にし、digits にその表示を入れる。
- QRコードやラベルの文字は読まないでください。読むのは表示器の数値だけです。`;

/** JSONだけを返すよう指示しているが、前後に文字が付いても拾えるようにする。 */
function parseJson(text: string): Record<string, unknown> | null {
  const t = text.trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(t.slice(start, end + 1));
    return obj && typeof obj === "object" ? (obj as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function toConfidence(v: unknown): ReadConfidence {
  return v === "high" || v === "medium" || v === "low" ? v : "low";
}

/**
 * 画像から表示値を読む。
 * @param base64 画像本体（data URL のヘッダを除いた部分）
 * @param mediaType image/jpeg 等
 */
export async function readScaleDisplay(
  base64: string,
  mediaType: "image/jpeg" | "image/png" | "image/webp"
): Promise<ScaleReadResult> {
  const client = new Anthropic();
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 300,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
          { type: "text", text: PROMPT },
        ],
      },
    ],
  });

  const text = res.content
    .map((c) => (c.type === "text" ? c.text : ""))
    .join("")
    .trim();
  const obj = parseJson(text);
  if (!obj) {
    return {
      value: null,
      digits: "",
      confidence: "low",
      note: "読み取り結果を解釈できませんでした",
      model: MODEL,
    };
  }

  // 小数点の位置が確信できないまま数字だけ返してくることがある。ここで必ず落とす。
  const decimalPoint = obj.decimalPoint;
  const unit = typeof obj.unit === "string" ? obj.unit.toLowerCase() : null;
  let value: number | null = null;
  if (typeof obj.value === "number" && Number.isFinite(obj.value)) {
    value = unit === "g" ? obj.value / 1000 : obj.value;
    // 表示器の分解能を超える桁は持たない（0.1kg 刻みの機種でも 0.001 まで許容）
    value = Math.round(value * 1000) / 1000;
    if (value < 0) value = null;
  }
  let confidence = toConfidence(obj.confidence);
  // 確信度が low のものは採用しない。現場が気づかないまま誤った値が入るのを防ぐ。
  if (confidence === "low") value = null;
  // 小数点が判断できていないなら、桁がくっきり見えていても採用しない（10倍間違いを防ぐ）
  if (decimalPoint === "unsure") {
    value = null;
    confidence = "low";
  }

  const note = typeof obj.note === "string" ? obj.note.slice(0, 200) : "";
  return {
    value,
    digits: typeof obj.digits === "string" ? obj.digits.slice(0, 40) : "",
    confidence,
    note: decimalPoint === "unsure" ? `小数点の位置が判別できません${note ? `（${note}）` : ""}` : note,
    model: MODEL,
  };
}
