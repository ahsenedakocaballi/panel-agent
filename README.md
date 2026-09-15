# Digico Kontrol Ajanı

Yöneticiler için Claude eklentisi. Digico Panel'i (digicopanel.com) tarayıcıda açar. Siz kendi hesabınızla giriş yaparsınız, ajan da o oturumla kayıtları **salt okunur** okuyup şu tür soruları kanıtıyla cevaplar:

- "ornek_butik için bu hafta hangi görevler yapıldı, gerekçesi ne?"
- "ornek_moda gitmek üzere. Firma ne istemişti, raporda ne yazıyor, görevlerde ne yapılmış?"
- "Personel A bu ay sorumlu olduğu firmalarda ne yaptı?"

Ajan panelde hiçbir şeyi değiştirmez: görev tamamlamaz, not eklemez, bildirim göndermez. Şifrenizi görmez, giriş formuna dokunmaz.

## Neyi okur

| Konu | Kaynak |
|---|---|
| Firma kartı | beklenti, notlar, açıklama, ayrılma/bırakma/çalışmama nedeni, durum, sorumlular |
| Yapılan işler | yönetici görevleri (açıklama, personel notu, ekler), aylık şablon (müşteri istekleri, görüşmeler, SM kontrolleri, video/ses, tutan kreatif, ciro), SM kayıtları, reklam durumu / bütçe / teşhis kayıtları, marka kurulum, web/yazılım işleri |
| Firmanın istekleri | toplantı kayıtları (müşteri talepleri, tanışma soruları, puan), memnuniyet aramaları ve yorumları, ödeme kayıtları |
| Raporlar | aylık müşteri raporları ve görev ekleri (PDF / görsel içeriği okunur) |
| Rakamlar | günlük Meta harcaması, ciro, ROAS |
| Personel | sorumlu olduğu firmalar, görevleri, ekip takibi, uyarı sayısı, yönetici notları, soru-cevap |

**Okumadıkları:** sözleşme / vergi levhası / dekont dosyaları, firma telefon ve e-posta bilgileri, masaüstü kullanım takibi, İK mülakat kayıtları.

## Gereksinimler

1. **Claude masaüstü uygulaması**, Code sekmesi. Ajan uygulamanın yerleşik tarayıcısını kullanır. Terminal sürümünde ise "Claude in Chrome" eklentisi gerekir.
2. **Windows'ta** Git for Windows: https://git-scm.com/download/win · **Mac'te** komut satırı geliştirici araçları (ilk kurulumda Mac kendisi sorar, "Yükle" deyin).
3. Panelde **yönetici** hesabı.

## Kurulum

Repo herkese açık; GitHub hesabı ya da erişim anahtarı gerekmez.

1. Claude masaüstü uygulamasında **Code** sekmesinde yeni bir sohbet açıp şunu yazın:
   > Şu Claude Code eklentisini kur: `https://github.com/ahsenedakocaballi/panel-agent.git` marketplace'ini ekle, sonra `digico-kontrol@digico` eklentisini kur.

   Terminal kullanıyorsanız aynı işi şu iki komut yapar:
   ```
   claude plugin marketplace add https://github.com/ahsenedakocaballi/panel-agent.git
   claude plugin install digico-kontrol@digico
   ```
2. Claude uygulamasını tamamen kapatıp açın (Mac'te ⌘ + Q).

**Güncelleme:** Claude'a "digico-kontrol eklentisini güncelle" yazın ya da `claude plugin marketplace update digico` ve `claude plugin update digico-kontrol@digico` komutlarını çalıştırın. Sonra uygulamayı yeniden başlatın.

## Kullanım

1. Claude'a sorunuzu yazın:
   > /panel-kontrol ornek_butik bu hafta ne yapıldı?

   > /panel-kontrol ornek_moda gitmek istiyor, son 2 ayda ne istemişler, ne yapılmış?

   > /panel-kontrol Bu ay ayrılma ihtimali olan firmalar hangileri?

   > /panel-kontrol Geçen hafta yönetici görevlerini kim yaptı, kim yapmadı?

   > /panel-kontrol Personel A'ya bu ay hangi uyarılar gönderildi?
2. Ajan paneli tarayıcı panelinde açar. Giriş yapmamışsanız sizden giriş yapmanızı ister.
3. **Giriş bilgilerinizi tarayıcıdaki panel sayfasına kendiniz girin.** Claude'a sohbet üzerinden şifre yazmayın.
4. Giriş yaptıktan sonra sohbete `/panel-kontrol devam` yazın; ajan sorunuza kaldığı yerden devam eder.

Cevaplarda her maddenin kaynağı yazar: hangi kayıt, tarih, kim. Kanıt yoksa "panelde kayıt yok" der. Tamamlandı işaretli ama içeriği boş görevleri ayrıca gösterir.

## Haftalık otomatik rapor

Claude masaüstü uygulamasında zamanlanmış görev olarak kurulur ve her pazartesi sabah şu raporu hazırlar:
- geçen haftanın yönetici görevleri (kim yaptı, kim yapmadı, notsuz tamamlananlar)
- bu ayın ayrılma riski yüksek firmaları
- yöneticinin bakması gereken en fazla 5 madde

Kurmak için Claude'a şunu yazın:

> Her pazartesi saat 09:00'da panel-kontrol ile haftalık raporu hazırlayan zamanlanmış bir görev oluştur.

Bilmeniz gerekenler:
- **Uygulama açık olmalı.** Görev uygulama açıkken çalışır. Kapalıysa bir sonraki açılışta çalışır.
- **Panelde girişli olmalısınız.** Ajanın tarayıcısında panel oturumu açık olmalı. Oturum yoksa rapor hazırlanmaz, "giriş gerekiyor" mesajı bırakılır.
- **Raporun kaydı:** Rapor ayrıca `~/.digico/raporlar/` klasörüne kaydedilir.

## Hızlı yükleme ve yardımcıyı güncelleme

Ajan her sohbetin başında salt okunur veri yardımcısını (`skills/panel-kontrol/panel-veri.js`) panele yükler. Dosyanın birebir kopyası panelde `frontend/public/ajan/panel-veri-<sürüm>.js` olarak durur. Ajan onu `SKILL.md` içinde yazan parmak iziyle (Subresource Integrity) birkaç saniyede yükler. Paneldeki kopya değiştirilirse tarayıcı onu çalıştırmaz ve ajan eklentideki kendi kopyasını sayfaya yazar; bu yavaş yol birkaç dakika sürer.

`panel-veri.js` değiştiğinde:
1. Dosyadaki sürüm numarasını artırın (`window.__digico.surum === N` kontrolü ve `surum: N`).
2. Dosyayı panel reposuna `frontend/public/ajan/panel-veri-<N>.js` olarak birebir kopyalayın ve yayına alın.
3. Parmak izini hesaplayın:
   ```
   node -e "console.log('sha384-' + require('crypto').createHash('sha384').update(require('fs').readFileSync('skills/panel-kontrol/panel-veri.js')).digest('base64'))"
   ```
4. `SKILL.md` içindeki yükleme kodunda dosya adını, sürüm kontrolünü ve `integrity` değerini güncelleyin; `.claude-plugin/plugin.json` sürümünü artırın.

Sıra önemli değil: panelde yeni dosya yokken ya da parmak izi tutmazken ajan yavaş yoldan çalışmaya devam eder.

## Bilinmesi gerekenler

- **Hız:** Ajan, uygulamada hangi model seçili olursa olsun işini daha hızlı bir modelle (Claude Sonnet) yapar. Panel yardımcısı birkaç saniyede yüklenir; "personel ne yaptı" ve "firmada ne yapıldı" gibi sorular tek bir özet çağrısıyla (genellikle birkaç saniye, en fazla ~20 saniye veri toplama) cevaplanır.
- **Veri Claude'a gider.** Sorduğunuz firma ve personele ait kayıtlar Claude tarafından işlenir. Şirketin KVKK aydınlatma metinlerinde bu kullanımın yer aldığından emin olun.
- **Raporlar yerele iner.** Okunan raporlar bilgisayarınızda `~/.digico/indirilenler/` klasörüne iner. Bu klasörü paylaşmayın, iş bitince silebilirsiniz.
- **Firma adı eşleşmesi:** Yönetici görevleri panelde firmaya bağlı değilse ajan onları görev metninde firma adının geçmesinden bulur. Firma farklı bir adla anılmışsa gözden kaçabilir.
- **Uyarılar:** Personele gönderilen uyarıların sadece sayısı okunabiliyor, metni okunamıyor.
- **Reklam durumu:** Kayıtlar gün gün çekildiği için en fazla son 31 gün alınır.
- **Okunamayan bölümler:** Bir bölüm "okunamadı" görünürse ajan bunu cevabında belirtir. Panel güncellemesinden sonra bu olursa `skills/panel-kontrol/panel-veri.js` güncellenmelidir.
