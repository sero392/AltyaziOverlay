# Altyazı TV — LG webOS

Android TV'deki "Altyazı TV" alıcısının LG karşılığı. Telefon ve masaüstü uygulamasıyla aynı protokolü konuşur (TCP 47800, mDNS `_altyazi._tcp`); o uygulamalarda değişiklik gerekmez.

## Android TV'den farkı

webOS'ta uygulamalar başka bir girişin (HDMI) **üstüne çizemez**; Android TV'deki "diğer uygulamaların üstünde göster" izninin karşılığı yok. Bu yüzden uygulama PS5'in bağlı olduğu HDMI girişini **kendi içinde tam ekran gösterir** ve çeviriyi onun üstüne yazar (`<video>` + `service/webos-external` kaynağı, `ext://hdmi:N`). Bu özellik LG tarafından belgelenmemiştir.

Bilinmesi gerekenler (gerçek bir LG TV'de henüz denenmedi):
- Oyun TV'nin oyun modu yerine uygulamanın video katmanında gösterilir; **giriş gecikmesi artabilir.**
- Uygulama açıkken TV'nin kendi giriş/ses ayarları uygulamaya göre davranabilir.
- Servis Node 8 ile uyumludur: **webOS 5 (2020) ve sonrası** hedeflenir.

## Yapı

```
app/       web uygulaması: HDMI girişi + altyazı, kumandayla HDMI 1-4 seçimi (OK = panel)
service/   JS servisi: TCP 47800 alıcısı (receiver.js) + mDNS duyurusu (mdns.js)
```

## Paketleme

```bash
cd webos
npm install
npm run package        # out/com.altyazioverlay.tv_<sürüm>_all.ipk
```

## TV'ye kurulum (Geliştirici Modu)

1. [LG Developer](https://webostv.developer.lge.com) hesabı aç; TV'de **LG Content Store**'dan **Developer Mode** uygulamasını kur, hesapla giriş yap, **Dev Mode Status** ve **Key Server**'ı aç, TV'yi yeniden başlat.
2. Bilgisayarda TV'yi ekle (IP'si Developer Mode uygulamasında yazar; parola için ekrandaki passphrase):
   ```bash
   npx ares-setup-device --add lgtv -i "host=TV_IP" -i "port=9922" -i "username=prisoner"
   npx ares-novacom --device lgtv --getkey
   ```
3. Kur ve aç:
   ```bash
   npx ares-install --device lgtv out/com.altyazioverlay.tv_0.1.0_all.ipk
   npx ares-launch --device lgtv com.altyazioverlay.tv
   ```

Geliştirici Modu oturumu 50 saatte bir dolar; Developer Mode uygulamasında **Extend** ile uzatılır (süresi dolarsa uygulama TV'den silinir).

## Kullanım

Uygulamayı aç, ◀ ▶ ile PS5'in bağlı olduğu HDMI girişini seç. Telefon / masaüstü uygulamasında TV bağlantısını aç; TV ağda kendiliğinden bulunur, bulunmazsa paneldeki IP'yi elle gir.
