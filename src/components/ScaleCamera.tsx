"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, ImageUp, Loader2, X } from "lucide-react";
import type { ScalePhotoResult } from "@/lib/scrapTypes";

/**
 * 重量計を1枚撮って、QRコードと表示値を同時に取る。
 *
 * - QRは端末側で解読する（画像認識より確実で、通信も要らない）
 * - 表示値はサーバー（/api/scale-read）に送ってAIが読む。APIキーを端末に置かないため
 * - 読めなかったときは値を返さない。呼び出し側が手入力に落とす
 *
 * カメラが使えない端末（PC等）でも動くよう、写真を選ぶ経路も用意する。
 */

/** 送信サイズを抑えるための長辺の上限。7セグ表示はこの解像度で十分読める。 */
const MAX_EDGE = 1280;
const JPEG_QUALITY = 0.82;

/** video/canvas から JPEG の data URL を作る（長辺 MAX_EDGE に縮小）。 */
function toDataUrl(src: HTMLVideoElement | HTMLImageElement, w: number, h: number): string {
  const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("画像を処理できませんでした");
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
}

function dataUrlToFile(dataUrl: string): File {
  const [head, body] = dataUrl.split(",");
  const mime = /:(.*?);/.exec(head)?.[1] ?? "image/jpeg";
  const bin = atob(body);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return new File([buf], "scale.jpg", { type: mime });
}

/** 撮った写真からQRを解読する。読めなくてもエラーにしない（手動選択の経路があるため）。 */
async function decodeQr(dataUrl: string): Promise<string> {
  try {
    const { Html5Qrcode } = await import("html5-qrcode");
    const scanner = new Html5Qrcode("scale-photo-decoder");
    try {
      return await scanner.scanFile(dataUrlToFile(dataUrl), false);
    } finally {
      try {
        scanner.clear();
      } catch {
        /* 解放できなくても読み取り結果には影響しない */
      }
    }
  } catch {
    return "";
  }
}

export default function ScaleCamera({
  phase,
  recordDate,
  factory,
  scaleId,
  expectedFor,
  needQr,
  label,
  disabled,
  onResult,
  onError,
}: {
  phase: "before" | "after";
  recordDate: string;
  factory: string;
  /** 既に箱が決まっているとき。ログに残す */
  scaleId?: string | null;
  /**
   * 写真から読めたQRを渡すと、その重量計の「直前の投入後の表示値」を返す関数。
   * 小数点を見落とした「10倍」の読み取りを弾くためにサーバーへ送る。
   *
   * 関数で受けるのは、1枚目は撮る前にどの箱か分からないため。QRを解読してから
   * 呼ぶことで、比較相手が「直前に選んでいた別の箱」になるのを防ぐ。
   */
  expectedFor?: (qr: string) => number | null;
  /** 同じ写真からQRも読むか（箱の選択を兼ねるとき true） */
  needQr: boolean;
  label: string;
  disabled?: boolean;
  onResult: (r: ScalePhotoResult) => void;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [camReady, setCamReady] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const stopCamera = useCallback(() => {
    const st = streamRef.current;
    streamRef.current = null;
    setCamReady(false);
    if (st) for (const t of st.getTracks()) t.stop();
  }, []);

  // 画面を離れてもカメラを掴んだままにしない
  useEffect(() => stopCamera, [stopCamera]);

  async function openCamera() {
    setOpen(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCamReady(true);
      }
    } catch {
      // カメラが無い/許可されない端末は写真を選ぶ経路に案内する
      setCamReady(false);
    }
  }

  function close() {
    stopCamera();
    setOpen(false);
  }

  /** 撮影/選択した画像を、QR解読 → AI読取 の順に処理する。 */
  async function process(dataUrl: string) {
    setBusy(true);
    try {
      const qr = needQr ? await decodeQr(dataUrl) : "";
      // QRが分かってから、その箱の引き継ぎ値を取る
      const expected = expectedFor ? expectedFor(qr) : null;
      const res = await fetch("/api/scale-read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // qr も送る。箱が未選択の1枚目でも、ログにどの重量計かを残せるようにする
        body: JSON.stringify({
          image: dataUrl,
          phase,
          scaleId: scaleId ?? "",
          qr,
          expected: expected ?? null,
          recordDate,
          factory,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // 読取が使えなくても運用は止めない。QRだけ返して手入力に落とす。
        onError(data?.message ?? "読み取りに失敗しました。手入力してください。");
        if (qr) onResult({ readId: "", value: null, digits: "", confidence: "low", note: "", qr });
        return;
      }
      onResult({ ...data, qr });
      close();
    } catch (e) {
      onError("読み取りに失敗しました: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function shoot() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) {
      onError("カメラの映像がまだ届いていません。少し待ってからもう一度押してください。");
      return;
    }
    void process(toDataUrl(v, v.videoWidth, v.videoHeight));
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // 同じ写真を選び直せるようにする
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => void process(toDataUrl(img, img.naturalWidth, img.naturalHeight));
      img.onerror = () => onError("画像を読み込めませんでした。");
      img.src = String(reader.result);
    };
    reader.onerror = () => onError("画像を読み込めませんでした。");
    reader.readAsDataURL(file);
  }

  return (
    <>
      {/* QR解読の作業用（表示しない） */}
      <div id="scale-photo-decoder" className="hidden" />

      <button
        type="button"
        onClick={openCamera}
        disabled={disabled || busy}
        className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#b4632c] text-base font-semibold text-white hover:bg-[#96521f] disabled:opacity-50 sm:h-11 sm:w-auto sm:px-5 sm:text-sm"
      >
        {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
        {busy ? "読み取り中…" : label}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/90 p-3">
          <div className="mb-2 flex items-center justify-between text-white">
            <span className="text-sm font-semibold">{label}</span>
            <button type="button" onClick={close} aria-label="閉じる" className="rounded-lg p-1.5">
              <X className="h-6 w-6" />
            </button>
          </div>

          <div className="relative flex-1 overflow-hidden rounded-xl bg-black">
            {/* playsInline を付けないと iOS が全画面再生に切り替えてしまう */}
            <video
              ref={videoRef}
              playsInline
              muted
              className="h-full w-full object-contain"
            />
            {camReady && (
              <div className="pointer-events-none absolute inset-x-6 top-1/2 -translate-y-1/2 rounded-xl border-2 border-dashed border-white/70 py-14 text-center text-xs text-white/90">
                {needQr ? "QRコードと表示部の両方が枠に入るように" : "表示部が枠に入るように"}
              </div>
            )}
            {!camReady && (
              <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-white/80">
                カメラを準備しています。使えない端末では下の「写真を選ぶ」からどうぞ。
              </p>
            )}
          </div>

          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <button
              type="button"
              onClick={shoot}
              disabled={busy || !camReady}
              className="inline-flex h-14 items-center justify-center gap-2 rounded-xl bg-white px-6 text-base font-bold text-[#333333] disabled:opacity-40 sm:h-12"
            >
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
              {busy ? "読み取り中…" : "撮って読み取る"}
            </button>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="inline-flex h-14 items-center justify-center gap-2 rounded-xl border border-white/40 px-6 text-base font-semibold text-white disabled:opacity-40 sm:h-12"
            >
              <ImageUp className="h-5 w-5" />
              写真を選ぶ
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={onFile}
            aria-label="重量計の写真"
            className="hidden"
          />
        </div>
      )}
    </>
  );
}
