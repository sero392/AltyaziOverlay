// Masaüstü altyazı penceresi (Android'deki FloatingSubtitleWindow karşılığı).
import type { SubtitleStyle } from '../shared/types';

declare global {
  interface Window {
    overlay: {
      onText(cb: (t: string) => void): void;
      onStyle(cb: (s: SubtitleStyle) => void): void;
    };
  }
}

const box = document.getElementById('box')!;

function hexToRgba(hex: string, opacity: number) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  const n = m ? parseInt(m[1], 16) : 0;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${opacity / 100})`;
}

window.overlay.onText(text => {
  box.textContent = text;
});

window.overlay.onStyle(s => {
  // Ayardaki boyut TV içindir (sp); masaüstünde 1080p ekrana göre ölçeklenir.
  box.style.fontSize = `${((s.fontSize * 1.3) / 1080) * screen.height}px`;
  box.style.color = s.textColor;
  box.style.background = hexToRgba(s.bgColor, s.bgOpacity);
});
