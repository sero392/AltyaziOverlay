/** Bu genişliğin altındaki görüntüler OCR'dan önce 2 kat büyütülür (1080p kırpmaları zaten yeterince büyük). */
export const UPSCALE_BELOW_WIDTH = 1600;

/** Çift doğrusal 2x büyütme (gri). */
export function upscale2x(gray: Uint8Array, w: number, h: number): Uint8Array {
  const W = w * 2;
  const out = new Uint8Array(W * h * 2);
  for (let Y = 0; Y < h * 2; Y++) {
    const fy = Math.min(h - 1, Math.max(0, Y / 2 - 0.25));
    const y0 = fy | 0;
    const y1 = Math.min(h - 1, y0 + 1);
    const ty = fy - y0;
    const r0 = y0 * w;
    const r1 = y1 * w;
    const o = Y * W;
    for (let X = 0; X < W; X++) {
      const fx = Math.min(w - 1, Math.max(0, X / 2 - 0.25));
      const x0 = fx | 0;
      const x1 = Math.min(w - 1, x0 + 1);
      const tx = fx - x0;
      const a = gray[r0 + x0] + (gray[r0 + x1] - gray[r0 + x0]) * tx;
      const c = gray[r1 + x0] + (gray[r1 + x1] - gray[r1 + x0]) * tx;
      out[o + X] = a + (c - a) * ty + 0.5;
    }
  }
  return out;
}
