---
name: derle
description: Altyazı Çevirmeni uygulamasını derler - JS paketini oluşturur, telefon (app) ve TV (tv) release APK'larını, Windows masaüstü exe'sini ve LG webOS ipk'sını üretir ve dist/ klasörüne kopyalar. Kullanıcı "derle", "build al", "APK üret", "exe üret", "ipk üret" dediğinde veya /derle çalıştırdığında kullan.
---

# Uygulamayı derle

Kullanıcı bu skill'i çalıştırdığında hiçbir şey sormadan aşağıdaki adımları sırayla uygula. Bir adım başarısız olursa dur, hatanın ilgili kısmını kullanıcıya göster ve sonraki adımlara geçme.

Derleme uzun sürebilir (NDK/CMake ile birlikte birkaç dakika); Gradle komutlarını 10 dakikalık zaman aşımıyla çalıştır. Komutları Bash aracıyla çalıştır. Gradle çıktısını `| tail` ile kesme (çıkış kodu kaybolur); bunun yerine log dosyasına yaz ve çıkış kodunu kontrol et, hata olursa log'un sonundaki `FAILURE`/`error` kısmını göster.

JAVA_HOME ortamda tanımlı değil. Her Gradle komutundan önce JDK 17'yi ayarla:
```bash
export JAVA_HOME="${JAVA_HOME:-$(ls -d "$HOME"/.jdks/jdk-17* | head -1)}"
```

1. **JS paketi** (proje kökünde):
   ```bash
   npm run bundle:android
   ```

2. **Telefon APK'sı** (`android/` içinde):
   ```bash
   ./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a -PprebundledJs > ../build-app.log 2>&1; echo "exit=$?"
   ```

3. **TV APK'sı** (`android/` içinde):
   ```bash
   ./gradlew :tv:assembleRelease > ../build-tv.log 2>&1; echo "exit=$?"
   ```

4. **Masaüstü yardımcıları** (`desktop/` içinde): chiaki-ng (`altyazi-rp.exe`, zig cc) ve Windows OCR (`altyazi-ocr.exe`, dotnet) derlenir, `desktop/resources/bin/` altına konur:
   ```bash
   npm run build:native > ../build-desktop-native.log 2>&1; echo "exit=$?"
   ```
   - `desktop/native/.toolchain` yoksa önce araç zincirini kur:
     ```bash
     python -m venv native/.toolchain && native/.toolchain/Scripts/python -m pip install ziglang cmake ninja
     ```
   - "Access is denied" / `EBUSY` ile kopyalama başarısız olursa uygulama (`npm start`) açıktır ve exe'leri kilitliyordur: kullanıcıya uygulamayı kapatmasını söyle, kendin süreci öldürme.

5. **Masaüstü exe'si** (`desktop/` içinde): simge + esbuild paketi + electron-builder (portable, tek dosya):
   ```bash
   npm run dist:win > ../build-desktop.log 2>&1; echo "exit=$?"
   ```
   Çıktı: `desktop/out/AltyaziCevirmeni-masaustu.exe`.

6. **LG webOS paketi** (`webos/` içinde; `node_modules` yoksa önce `npm install`): simgeler + `ares-package`:
   ```bash
   npm run package > ../build-webos.log 2>&1; echo "exit=$?"
   ```
   Çıktı: `webos/out/com.altyazioverlay.tv_<sürüm>_all.ipk`. "requiredACG" uyarısı beklenir (webOS 26'ya kadar zorunlu değil); `Success` satırı yoksa log'u göster.

7. **Çıktıları `dist/` klasörüne kopyala** (proje kökünde, klasör yoksa oluştur):
   - `android/app/build/outputs/apk/release/app-release.apk` → `dist/AltyaziCevirmeni-telefon.apk`
   - `android/tv/build/outputs/apk/release/tv-release.apk` → `dist/AltyaziTV.apk`
   - `desktop/out/AltyaziCevirmeni-masaustu.exe` → `dist/AltyaziCevirmeni-masaustu.exe`
   - `webos/out/com.altyazioverlay.tv_*_all.ipk` → `dist/AltyaziTV-LG.ipk`

8. **Rapor:** Kısaca başarılı/başarısız durumu, APK'ların, exe'nin ve ipk'nın yolunu ve boyutunu (MB) bildir.

Kullanıcı yalnızca birini isterse ("sadece exe", "sadece APK") sadece ilgili adımları çalıştır: masaüstü için 4-5 ve 7'deki exe kopyası, LG TV için 6 ve 7'deki ipk kopyası, Android için 1-3 ve 7'deki APK kopyaları.

Notlar:
- `node_modules` yoksa önce `npm install` çalıştır (kökte ve `desktop/` içinde ayrı ayrı).
- Masaüstü exe'si .NET 10 Çalışma Zamanı gerektirir (OCR yardımcısı framework-dependent derlenir); başka bilgisayara verilecekse bunu kullanıcıya hatırlat.
- `third_party/chiaki-ng` boşsa önce `git submodule update --init --recursive` çalıştır.
- Cihaza kurulum yapma; kullanıcı ayrıca isterse `adb install -r dist/...` (Android) ya da `npx ares-install` (LG, Geliştirici Modu gerekir; bkz. webos/README.md) öner.
