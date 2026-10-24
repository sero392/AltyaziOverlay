# Altyazı Çevirmeni (AltyaziOverlay)

PS5 oyunlarındaki **İngilizce altyazıları okuyup Türkçe çevirisini TV'de oyunun üstünde gösteren** açık kaynak bir Android uygulaması.

> **English summary:** An Android app that watches your PS5 through Remote Play (embedded [chiaki-ng](https://github.com/streetpea/chiaki-ng)), reads the in-game English subtitles with on-device OCR, translates them to Turkish with DeepL and shows the translation on top of the game on an Android TV. You keep playing on the TV with your own controller; the phone stays on the table, screen off.

Oyunu her zamanki gibi PS5'ten HDMI ile TV'de, kendi kolunla oynarsın. Telefon masada durur, ekranı kapalı olabilir:

```
PS5 ──HDMI──▶ TV (oyun, gecikmesiz)
 │                ▲
 │ Remote Play     │ Wi-Fi (çeviri metni)
 ▼                │
Telefon: yayını çöz → alt bölgeyi kırp → OCR → altyazı filtreleri → DeepL ─┘
```

Hiçbir görüntü telefonun ekranına çizilmez ve buluta gönderilmez. OCR telefonda yapılır, dışarıya yalnızca çevrilecek altyazı metni (DeepL'e) gider.

---

## Özellikler

- **Ek uygulama gerekmez.** PS Remote Play istemcisi (chiaki-ng) uygulamanın içinde gömülü; ekran kaydı izni de gerekmiyor.
- **Arka planda çalışır.** Telefon ekranı kapalıyken de altyazıları okur. Bağlantı koparsa kendiliğinden yeniden bağlanır.
- **PS5'i bulur ve uyandırır.** PS5'i ağda kendisi bulur; bekleme modundaysa **Başlat**'a basınca uyandırır.
- **Hafif OCR.** Google ML Kit telefonda çalışır. Kareler yalnızca alttaki okuma alanından alınır ve değişmeyen kareler OCR'a hiç gönderilmez.
- **Sadece altyazıyı çevirir.** Altyazı olmayan yazılar elenir: envanter ve menüler, kontrol ipuçları ("Press L3 + R3 to…", "Hold L1…"), OCR'ın her karede farklı okuduğu yazılar.
- **DeepL ile çeviri.** Önceki satırı bağlam olarak gönderir; tekrar eden replikler önbellekten gelir.
- **Android TV alıcısı (`Altyazı TV`).** Çeviriyi HDMI görüntüsünün üstüne yazar. Telefon TV'yi ağda kendisi bulur (mDNS).
- **Kurulum sihirbazı ve yönetim paneli.** İlk açılışta adım adım kurulum, sonrasında tüm ayarlar tek panelde.

## Gereksinimler

| | |
|---|---|
| Telefon | Android 7.0+ (arm64). Test edilen: Redmi Note 10S (Android 13) |
| Konsol | PS5 (PS4 kodu var, test edilmedi) — aynı Wi-Fi ağında |
| TV (isteğe bağlı) | Android TV / Google TV 8.0+. Test edilen: Vestel Cosmos (Android TV 11) |
| Çeviri | Ücretsiz [DeepL API Free](https://www.deepl.com/pro-api) anahtarı (ayda 500.000 karakter) |
| PSN | Remote Play için **ayrı, ücretsiz bir PSN hesabı** (aşağıya bak) |

### Neden ayrı bir PSN hesabı?

PS5, bir Remote Play oturumu başladığında o kullanıcının kol atamasını Remote Play cihazına taşır. Telefon senin hesabınla bağlanırsa oyundaki kolun kopar. Bu yüzden:

1. Ücretsiz yeni bir PSN hesabı aç ve PS5'e kullanıcı olarak ekle.
2. **Bu hesapla** oturum açıkken: *Ayarlar › Sistem › Uzaktan Oynatma › Uzaktan Oynatmayı Etkinleştir.* Bu ayar yeni hesapta kapalı gelir. Kapalıyken PS5 bağlantıyı `0x80108b12` koduyla reddeder; uygulama bunu tanıyıp sana bildirir.
3. Telefonu bu hesapla eşleştir: *Uzaktan Oynatma › Cihazı Bağla* ekranındaki 8 haneli kodu sihirbaza gir.

Sen oyunu kendi hesabınla, kendi kolunla oynamaya devam edersin. Telefon ikinci hesap üzerinden yalnızca izler; hiçbir tuş veya ses girişi göndermez.

## Kurulum (kullanıcı)

1. Telefona uygulamayı, TV'ye `Altyazı TV`'yi kur (bkz. [Derleme](#derleme)).
2. TV'de `Altyazı TV`'ye ekranın üstüne çizme izni ver. Android TV'de bu iznin ayar ekranı çoğu zaman yoktur; bilgisayardan bir kez şu komutu çalıştır:
   ```bash
   adb shell appops set com.altyazioverlay.tv SYSTEM_ALERT_WINDOW allow
   ```
   TV açıldığında alıcı kendiliğinden başlar.
3. Telefonda uygulamayı aç. Kurulum sihirbazı sırasıyla Remote Play hesabını, PS5 seçimini, hesap kimliğini, eşleştirmeyi, DeepL anahtarını ve TV bağlantısını soracak.
4. Oyunu aç, telefonda **Başlat**'a bas ve telefonu bırak.

**Okuma ayarları:** Ekran 300 ms'de bir okunur ve yalnızca alttaki %20'lik alana bakılır. Bu ayarlar şimdilik arayüzde gizli; değiştirmek için `src/hooks/useOcrSettings.ts` içindeki `DEFAULT_OCR_SETTINGS` değerlerini düzenle.

## Derleme

Gerekenler: Node 22+, JDK 17, Android SDK (platform 37, build-tools 37.0.0), NDK 27.1.12297006, CMake 3.22.1.

```bash
git clone --recursive https://github.com/sero392/AltyaziOverlay.git
cd AltyaziOverlay
npm install
```

Sürüm (release) APK'ları JS paketini içine gömer, Metro sunucusu gerekmez:

```bash
npm run bundle:android
cd android
./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a -PprebundledJs
./gradlew :tv:assembleRelease
```

Çıktılar: `android/app/build/outputs/apk/release/app-release.apk` (telefon), `android/tv/build/outputs/apk/release/tv-release.apk` (TV).

Geliştirme sırasında Metro ile çalıştırmak için: `npx react-native start`, ardından `adb reverse tcp:8081 tcp:8081` ve `./gradlew :app:installDebug`.

> **Windows notu:** Proje yolunun kısa olmasına dikkat et (ör. `C:\dev\AltyaziOverlay`). NDK/CMake derlemesi 260 karakterlik yol sınırına takılır.
>
> **İmza notu:** Depodaki `android/app/debug.keystore`, React Native şablonunun herkese açık deneme anahtarıdır. APK'ları başkalarıyla paylaşacaksan kendi imza anahtarını oluştur ve depoya ekleme.

## Mimari

```
android/
  app/          Telefon uygulaması (React Native + Kotlin)
    capture/    Kare kaynakları: RemotePlayFrameSource (varsayılan), ScreenCaptureManager (yedek, devre dışı)
    ocr/        ML Kit, piksel diff, metin diff, altyazı / arayüz filtreleri
    service/    RemotePlayService (ön plan servisi), ConsolePreparer (bulma + uyandırma)
    core/       TvLink (TV bağlantısı), olay yolu, yüzen pencere denetimi
    bridge/     React Native native modülleri
  remoteplay/   PS Remote Play kütüphanesi: chiaki-ng çekirdeği (C) + JNI + MediaCodec
  tv/           Android TV alıcısı (saf Kotlin): TCP sunucu + NSD + ekran üstü pencere
src/            React Native arayüzü: kurulum sihirbazı, yönetim paneli, DeepL istemcisi
third_party/chiaki-ng   git submodule (v1.10.0, değiştirilmeden)
```

Önemli tasarım kararları:

- **chiaki-ng kendi CMake dosyamızla derlenir** (`android/remoteplay/src/main/cpp/CMakeLists.txt`). Submodule'e dokunulmaz.
  - OpenSSL yerine Mbed TLS kullanılır.
  - İnternet üzerinden Remote Play (holepunch: curl, json-c, miniupnpc) çıkarılmıştır; `holepunch_stub.c` yalnızca yerel ağ bağlantısını bırakır.
  - Protokol kodu (`generated/takion.pb.*`) önceden üretilmiştir, derleme sırasında Python gerekmez.
- **İzleyici modu:** chiaki'nin yayın başında gönderdiği "sanal kontrolcü bağlandı" ve "mikrofon aç" mesajları, derleme sırasında `streamconnection.c`'nin bir kopyasında devre dışı bırakılır.
- **Ham YUV kare:** Video çözücüden `COLOR_FormatYUV420Flexible` istenir. Bazı çözücüler (MediaTek) yüzeye kendi özel formatlarında yazdığı için `ImageReader` kullanılmaz.
- **JS zamanlayıcıları kullanılmaz.** React Native, uygulama arka plandayken JS `setTimeout`'larını durdurur ve `fetch` de buna takılır. Bu yüzden DeepL istekleri native OkHttp ile, beklemeler native zamanlayıcıyla yapılır.

## Sınırlamalar

- Yalnızca Latin alfabeli kaynak dil (ML Kit Latin modeli), hedef dil Türkçe.
- Tamamı BÜYÜK HARFLE yazılmış altyazılar menü sanılıp elenebilir.
- Görev ipuçları ("Hunt another deer" gibi) altyazıyla aynı göründüğü için çevrilir.
- Sadece yerel ağ: PS5 ile telefon aynı ağda olmalı.
- MIUI gibi agresif pil yönetimi olan sistemlerde uzun oturumlarda uygulamayı pil optimizasyonundan muaf tutmak gerekebilir.

## Lisans

Bu proje **GNU Affero General Public License v3.0** ile lisanslanmıştır (bkz. [`LICENSE`](LICENSE)). Gömülü [chiaki-ng](https://github.com/streetpea/chiaki-ng) de AGPL-3.0 lisanslıdır. Uygulamayı değiştirip dağıtırsan ya da bir ağ hizmeti olarak sunarsan kaynak kodunu da aynı lisansla paylaşmalısın.

Üçüncü taraf bileşenler:

| Bileşen | Lisans |
|---|---|
| [chiaki-ng](https://github.com/streetpea/chiaki-ng) (ve nanopb, jerasure, gf-complete) | AGPL-3.0 (+ kendi lisansları) |
| [Mbed TLS](https://github.com/Mbed-TLS/mbedtls) | Apache-2.0 |
| [React Native](https://github.com/facebook/react-native) | MIT |
| [Google ML Kit Text Recognition](https://developers.google.com/ml-kit/terms) | Google'ın kapalı kaynak lisansı (ikili bağımlılık) |

> ML Kit kapalı kaynaklı bir Google kütüphanesidir ve derleme sırasında Maven'den indirilir; depoda yer almaz. Bu bağımlılıkla derlenmiş APK'ları dağıtmanın AGPL ile uyumu tartışmalıdır. Uyumu tam sağlamak isteyenler OCR'ı açık kaynak bir motorla (ör. Tesseract) değiştirebilir.

## Yasal uyarı

Bu proje Sony Interactive Entertainment ile hiçbir şekilde bağlantılı değildir ve onlar tarafından onaylanmamıştır. "PlayStation", "PS5", "PS4", "DualSense" ve "DualShock" Sony Interactive Entertainment Inc.'in tescilli markalarıdır. DeepL, DeepL SE'nin markasıdır. Uygulama yalnızca kendi konsolunla, kendi yerel ağında kullanılmak içindir; kullanımın PlayStation Network ve DeepL kullanım koşullarına uygun olması senin sorumluluğundadır.

## Teşekkürler

- [chiaki-ng](https://github.com/streetpea/chiaki-ng) ve özgün [Chiaki](https://git.sr.ht/~thestr4ng3r/chiaki) geliştiricileri: PS Remote Play protokolünün açık kaynak uygulaması.
- [DeepL](https://www.deepl.com): çeviri API'si.
