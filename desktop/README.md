# Altyazı Çevirmeni — Masaüstü (Windows)

Mobil uygulamanın Electron sürümü. Çalışma mantığı aynı: PS5'in Remote Play yayını (gömülü chiaki-ng) arka planda alınır, alttaki okuma alanı OCR'lanır, filtrelerden geçen altyazı çevrilir ve ekranın altında (her şeyin üstünde, tıklamaları geçiren pencerede) ya da Android TV'de ("Altyazı TV", aynı protokol) gösterilir.

```
altyazi-rp.exe (chiaki-ng, C) ──H.264──▶ gizli pencere (WebCodecs çöz → alt %20 kırp → gri)
        ▲ komutlar                                   │
        │                                            ▼
   Electron ana süreç: piksel diff → altyazi-ocr.exe (Windows.Media.Ocr) → filtreler → DeepL / Google
                                                                            │
                                         ekran altı altyazı penceresi ◀────┴────▶ Android TV (TCP 47800)
```

| Mobil (Android) | Masaüstü |
|---|---|
| `remoteplay_jni.c` (JNI) | `native/rp-helper/main.c` (stdin komut / stdout ikili paket) |
| MediaCodec | WebCodecs `VideoDecoder` (`src/decoder`) |
| ML Kit metin tanıma | Windows OCR (`native/ocr-helper`, C#) |
| `ocr/*.kt` filtreleri | `src/main/pipeline/filters.ts` (birebir port) |
| ML Kit çeviri | Google Çeviri (anahtarsız web uç noktası) |
| DeepL / önbellek / yedek | `src/services/translation` paylaşılıyor (aynı dosyalar) |
| — | Yerel yapay zeka: llama.cpp (Vulkan) + TranslateGemma 4B, ilk kullanımda `userData/llm` altına indirilir (`src/main/llm`) |
| Yüzen pencere | `src/overlay` |
| Ön plan servisi + bildirim | Sistem tepsisi |

## Derleme

Gerekenler: Node 22+, Python 3 (araç zinciri için), .NET SDK 10.

```bash
cd desktop
npm install
python -m venv native/.toolchain
native/.toolchain/Scripts/python -m pip install ziglang cmake ninja
npm run build:native   # resources/bin/altyazi-rp.exe + altyazi-ocr.exe
npm start
```

`npm test` filtre testlerini, `npm run typecheck` tip kontrolünü çalıştırır.
