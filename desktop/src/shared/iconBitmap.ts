/**
 * Uygulama simgesi (mobildeki gibi altyazılı konuşma balonu), kodla çizilir: ayrı görsel
 * dosyası gerekmez. Mavi yuvarlatılmış balon, sol altta kuyruk, içinde iki beyaz altyazı satırı.
 * Çıktı: BGRA, önceden çarpılmış alfa. Hem çalışma anında (tepsi/pencere) hem paketlemede
 * (scripts/build-icon.mjs -> .png) kullanılır.
 */
export function drawIconBgra(size: number): Uint8Array {
  const S = 4; // kenar yumuşatma için alt örnekleme
  const buf = new Uint8Array(size * size * 4);
  const inRoundRect = (x: number, y: number, x0: number, y0: number, x1: number, y1: number, r: number) => {
    if (x < x0 || x > x1 || y < y0 || y > y1) {
      return false;
    }
    const cx = Math.min(Math.max(x, x0 + r), x1 - r);
    const cy = Math.min(Math.max(y, y0 + r), y1 - r);
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  };
  const inTail = (x: number, y: number) => {
    // Üçgen: (0.22,0.70) (0.42,0.70) (0.18,0.92)
    const ax = 0.22, ay = 0.7, bx = 0.44, by = 0.7, cx = 0.16, cy = 0.93;
    const d = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) =>
      (px - rx) * (qy - ry) - (qx - rx) * (py - ry);
    const d1 = d(x, y, ax, ay, bx, by);
    const d2 = d(x, y, bx, by, cx, cy);
    const d3 = d(x, y, cx, cy, ax, ay);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  };
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let bubble = 0;
      let line = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const x = (px + (sx + 0.5) / S) / size;
          const y = (py + (sy + 0.5) / S) / size;
          const inBubble = inRoundRect(x, y, 0.06, 0.1, 0.94, 0.74, 0.16) || inTail(x, y);
          if (inBubble) {
            bubble++;
            if (inRoundRect(x, y, 0.22, 0.3, 0.78, 0.38, 0.04) || inRoundRect(x, y, 0.3, 0.47, 0.7, 0.55, 0.04)) {
              line++;
            }
          }
        }
      }
      const n = S * S;
      const a = bubble / n;
      const l = bubble ? line / bubble : 0;
      // Mavi (#2563eb) ile beyaz arası karışım; BGRA, önceden çarpılmış alfa.
      const r = 0x25 + (255 - 0x25) * l;
      const g = 0x63 + (255 - 0x63) * l;
      const b = 0xeb + (255 - 0xeb) * l;
      const i = (py * size + px) * 4;
      buf[i] = Math.round(b * a);
      buf[i + 1] = Math.round(g * a);
      buf[i + 2] = Math.round(r * a);
      buf[i + 3] = Math.round(255 * a);
    }
  }
  return buf;
}
