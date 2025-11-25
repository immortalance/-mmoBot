# Wiki Category Manager

Türkçe Wikipedia'da kategorileri otomatik olarak yöneten bir Node.js botu. İngilizce Wikipedia'daki kategorileri karşılaştırarak, Türkçe Wikipedia'da eksik olan kategori atamalarını tespit eder ve otomatik olarak ekler.

## 🚀 Özellikler
Cat4.js
- İngilizce ve Türkçe Wikipedia kategorilerini karşılaştırma
- Wikidata üzerinden madde eşleştirmesi
- Eksik kategori atamalarını otomatik tespit
- Toplu kategori ekleme
- Yorum içindeki kategorileri aktif hale getirme
- Rate limiting ve hata yönetimi

  Cat-com.js
- İngilizce ve Türkçe Wikipedia kategorilerini karşılaştırma
- Wikidata üzerinden madde eşleştirmesi
- Eksik kategorilerin tespiti
- Türkçe Wikipedia'da bulunmayan fakat içerisine badde eklenebilecek kategorilerin tespiti.
- Potansiyeli olan kategorilerin QID ve içeriklerinin istatistikleri
- Rate limiting ve hata yönetimi

## 📋 Gereksinimler

- Node.js v14 veya üzeri
- npm veya yarn
- Wikipedia bot hesabı

## 🛠️ Kurulum

1. Repoyu klonlayın:
```bash
git clone https://github.com/kullaniciadi/wiki-category-manager.git
cd wiki-category-manager
```

2. Bağımlılıkları yükleyin:
```bash
npm install
```

3. `config.json` dosyasını oluşturun:
```json
{
  "api_url": "https://tr.wikipedia.org/w/api.php",
  "username": "BotKullaniciAdiniz",
  "password": "BotSifreniz",
  "user_agent": "WikiCategoryBot/1.0 (https://tr.wikipedia.org/wiki/Kullanıcı:BotKullaniciAdiniz)"
}
```

## 📝 Kullanım

### Dosyadan kategori listesi okuma:

```bash
node cat4.js -f kategoriler.txt
```

### Komut satırından kategori girme:

```bash
node cat4.js -c "Bilim" "Teknoloji" "Sanat"
```

### Kategori listesi dosya formatı (kategoriler.txt):

```
Bilim
Teknoloji
Sanat
# Bu bir yorumdur, işlenmez
Spor
```

## 🔧 Nasıl Çalışır?

1. **Kategori Analizi**: İngilizce Wikipedia'daki bir kategorinin tüm üyelerini alır
2. **Wikidata Eşleştirme**: Her maddenin Wikidata ID'sini bulur
3. **Türkçe Karşılık**: Wikidata üzerinden Türkçe karşılıklarını bulur
4. **Eksik Tespit**: Türkçe Wikipedia'da kategorisi eksik maddeleri tespit eder
5. **Otomatik Ekleme**: Eksik kategorileri maddelere ekler

## ⚙️ Yapılandırma

Bot aşağıdaki API'leri kullanır:
- İngilizce Wikipedia API: `https://en.wikipedia.org/w/api.php`
- Türkçe Wikipedia API: `https://tr.wikipedia.org/w/api.php`
- Wikidata API: `https://www.wikidata.org/w/api.php`

## 🔒 Güvenlik

- `config.json` dosyasını **asla** Git'e eklemeyin
- Bot şifrenizi güvenli bir şekilde saklayın
- Wikipedia bot politikalarına uyun

## 📊 Performans

- Batch işleme: 50 madde/grup
- Rate limiting: 400ms - 1000ms arası gecikme
- Timeout: 30 saniye

## 🤝 Katkıda Bulunma

1. Fork yapın
2. Feature branch oluşturun (`git checkout -b feature/AmazingFeature`)
3. Değişikliklerinizi commit edin (`git commit -m 'Add some AmazingFeature'`)
4. Branch'inizi push edin (`git push origin feature/AmazingFeature`)
5. Pull Request açın

## 📜 Lisans

MIT

## ⚠️ Uyarılar

- Bu bot Wikipedia'da değişiklik yapar, dikkatli kullanın
- Test etmek için önce test wiki'de deneyin
- Wikipedia bot politikalarına uyun
- Yoğun saatlerde kullanmaktan kaçının

## 🐛 Bilinen Sorunlar

- Büyük kategorilerde (10000+ madde) bellek kullanımı yüksek olabilir
- Bazı özel karakterli başlıklarda sorun yaşanabilir

## 📧 İletişim

Sorularınız için Wikipedia kullanıcı sayfamdan ulaşabilirsiniz.
