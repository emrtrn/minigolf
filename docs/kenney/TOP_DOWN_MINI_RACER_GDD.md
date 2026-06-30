# Top-down Mini Racer — Oyun Tasarım Dokümanı (GDD)

> Tarih: 2026-06-26
> Durum: Tasarım / v1 planı. Kod uygulanmadı.
> Amaç: Forge platformu üzerine kurulacak ikinci oyun adayı **Top-down Mini
> Racer**'ın vizyonunu, oynanışını, fizik modelini, ghost sistemini, kapsamını
> ve gereken Forge platform işini tanımlamak.
> Kaynak: Fikir havuzu [`KENNEY_GAME_IDEAS.md`](./KENNEY_GAME_IDEAS.md) (#2, ilk
> oyun adayı 🟢). Asset: `kenney_toy-car-kit` (158 model) + `kenney_city-kit-roads`
> (73 model) (+ `kenney_car-kit` araç çeşitliliği). Paket kataloğu:
> [`docs/kenney/KENNEY_CATALOG.md`](../kenney/KENNEY_CATALOG.md).
> Kardeş doküman: [`MINI_GOLF_GDD.md`](./MINI_GOLF_GDD.md) (aynı format + ortak
> "saf çekirdek fizik" ve repo/sınır kararları).

## Temel kararlar (bu GDD'nin sütunları)

Bu doküman aşağıdaki üç karara göre yazıldı:

1. **Sürüş hissi:** **Arcade drift** — köşelerde savrulan, el freni ile kayan,
   affedici "Micro Machines" hissi. Tekrar oynanırlık ve ghost ile yarışmak için.
2. **Fizik:** Özel **arcade araç fiziği** — hafif, deterministik, headless test
   edilebilir saf çekirdek (hız + yön + yanal kayma + sürtünme). Oyun build'i bir
   fizik motoruna (Rapier) bağlı değildir. **Ghost/replay'i mümkün kılar.**
3. **v1 kapsam:** Tek oyuncu, **zaman denemesi + ghost** — en iyi turunu geçmeye
   çalış; en iyi koşunun hayaleti yanında oynar. Önce **1 pist** cilalanır (dikey
   dilim), sonra birkaç piste + ghost kayıt/oynatmaya genişler.

---

## 1. Yüksek konsept

> Kuşbakışı bir minyatür yarış pistinde, savrulan oyuncak arabanla en hızlı turu
> kovala. Köşeye gel, gaz kes, el frenine bas, drift'le çık. Her tur kendi
> hayaletinle (ghost) yarış — geçen en iyi koşun yanında saydam bir hayalet olarak
> tekrar oynar. Saniyenin yüzde birini tıraşlamak için sürekli "bir tur daha".

Tür: Arcade / time-attack yarış. Oturum: 2–10 dk (pist başına, çok tekrarlı).
Tek oyuncu, yerel. Web-first (masaüstü + dokunmatik).

## 2. Tasarım sütunları

1. **Bir tur daha.** Çekirdek cazibe ghost'a karşı kendi rekorunu tıraşlamak.
   Kısa tur + anında restart = yüksek tekrar.
2. **Tatmin edici drift.** Savrulma kontrollü ve okunur; el freni ile bilerek
   kaydır, gazla toparlanır. Şans değil, hat ve dozaj.
3. **Deterministik = adil + tekrar oynatılabilir.** Aynı girdi aynı sonucu verir;
   ghost bu yüzden mümkün ve güvenilir.
4. **Modüler pist.** Pistler Kenney yol parçalarından Forge editöründe (snapping +
   placement) kurulur. Yeni pist = yeni layout.

## 3. Çekirdek oynanış döngüsü

```
Piste başla (start/finish kapısında araç)
   ↓
Geri sayım (3-2-1-GO!) → ghost da aynı anda başlar
   ↓
Sür: gaz / yön / fren / el freni → drift'le köşeleri al
   ↓
Checkpoint'lerden geç (kestirme/ters yön sayılmaz)
   ↓
Start/finish çizgisini geç → tur süresi kaydedilir
   ↓
Tur < en iyi mi?  ── Evet ──→ yeni rekor + ghost güncellenir
   │ Hayır
   ↓
Devam (sonraki tur) / Restart (R) / pist menüsü
```

Yan durumlar:
- **Ters yön / kestirme:** Checkpoint sırası zorunlu; atlanan checkpoint turu
  geçersiz kılar (uyarı + tur sayılmaz).
- **Pist dışı (off-track):** Çimende/dışında yavaşlama (sürtünme artışı), düşme
  yok (top-down düz zemin). Opsiyonel: belirli "void" bölgesine düşersen son
  checkpoint'e reset.
- **Sıkışma:** Restart (R) her an mevcut; takılan araba için ceza yok.

## 4. Kontroller ve kamera

### 4.1 Sürüş girdisi

Forge input zaten klavye + fare + gamepad + dokunmatik kaynaklarını destekliyor.

- **Klavye:** Yukarı/W = gaz, Aşağı/S = fren+geri, Sol-Sağ/A-D = direksiyon,
  Space = el freni (drift), R = restart.
- **Gamepad:** Sağ tetik = gaz, sol tetik = fren, sol stick X = direksiyon, A/B =
  el freni. Analog direksiyon daha hassas hat.
- **Dokunmatik:** On-screen sol/sağ direksiyon + gaz/el freni butonları
  (Forge'da on-screen touch input mevcut). Opsiyonel: otomatik gaz + sadece
  yön/el freni (mobil-dostu erişilebilirlik modu).

> Varsayılan his: **manuel gaz** + direksiyon + el freni. Erişilebilirlik için
> "oto-gaz" seçeneği ayar olarak sunulur (açık soru, §13).

### 4.2 Kamera — kuşbakışı

- **Top-down takip:** Araç merkezde, kamera yukarıdan bakar; hafif eğik (tam
  90° değil, ~60–75° pitch) derinlik hissi için. Forge `followCamera` /
  `springArmCamera` bunun temeli.
- **Hız zoom'u:** Hız arttıkça kamera hafifçe geri çekilir (önü görmek için).
- **Look-ahead:** Direksiyon/drift yönüne küçük ofset; köşe öncesi pisti gösterir.
- **Sabit yön (varsayılan):** Kamera dünyaya hizalı (kuzey yukarı) — okuması
  kolay. Opsiyonel "araca dönük" mod (açık soru, §13).
- Ghost da aynı dünyada görünür (saydam araç), kamera daima oyuncuyu izler.

## 5. Araç fiziği (özel arcade drift çekirdek)

**Hedef:** Forge'un saf-çekirdek desenine (`src/game/collision.ts`,
`src/game/gameRules.ts`) uyan; Three.js/DOM/fizik-motoru bağımsız; deterministik;
headless test edilebilir bir araç modeli. Sabit timestep (örn. 120 Hz alt-adım)
→ **ghost/replay tekrar oynatılabilir**. Mini Golf'teki top fiziği çekirdeğiyle
aynı disiplin ([`MINI_GOLF_GDD.md`](./MINI_GOLF_GDD.md) §5).

### 5.1 Durum

```
CarState {
  pos: [x, z]            // top-down düzlem (y = pist yüksekliği, v1'de büyük ölçüde düz)
  heading: number        // aracın baktığı yön (yaw)
  vel: [vx, vz]          // dünya-uzayı hız
  angularVel: number     // dönüş hızı
  handbrake: bool
}
```

v1 büyük ölçüde **2B düzlem** (XZ); slant/rampa parçaları için yükseklik
türetilebilir ama dikey fizik (zıplama/uçma) v1.x.

### 5.2 Model — yarı-fiziksel arcade drift

Klasik arcade araç modeli: hızı **ileri (longitudinal)** ve **yanal (lateral)**
bileşenlere ayır; yanal bileşene **traksiyon (grip)** uygula. Grip yüksekken araç
yola yapışır; el freni grip'i düşürünce yanal hız korunur → **drift**.

| Kuvvet / kural | Model | Notlar |
| --- | --- | --- |
| **Gaz / fren** | İleri yönde ivme/yavaşlama; `maxSpeed` clamp | Eğri ivme haritası (düşük hızda tepki). |
| **Direksiyon** | `angularVel` hıza bağlı; düşük hızda kısıtlı | Çok düşük hızda dönmeyi sınırla (gerçekçi his). |
| **Yanal grip** | Yanal hız `* (1 - grip·dt)` ile sönümlenir | Grip yüksek = yapışır; düşük = kayar. |
| **El freni / drift** | Aktifken arka grip düşer → savrulma | Drift girişi; gazla toparlanır. |
| **Yuvarlanma sürtünmesi** | Hız `* (1 - k·dt)` | Yüzeye göre `k` (asfalt vs çim). |
| **Yüzey tipi** | Pist dışı (çim/toprak) `k` ve grip değişir | Off-track yavaşlatır, kontrolü zorlaştırır. |
| **Duvar/bariyer çarpışma** | Normal bileşeni sönümle + hız kaybı | Forge AABB collision deseninden; araç kutusu. |
| **Slipstream (stretch)** | Ghost/önündeki arkasında hız bonusu | v1.x, opsiyonel. |

Bu, "yarı-fiziksel ama tamamen ayarlanabilir" arcade his sağlar; hissin tamamı
birkaç katsayıyla (grip, handbrakeGrip, maxSpeed, steerRate, friction) tune edilir.

### 5.3 Çarpışma yüzeyleri

- **Bariyerler/duvarlar:** `road-*-barrier`, `construction-barrier`, `road-end-*`
  → aracın çarpıp hız kaybettiği yüzeyler.
- **Pist sınırı / yüzey:** Yol parçaları üstü = asfalt (yüksek grip); dışı = çim
  (düşük grip, yavaşlatır).
- **Statik propları:** `construction-cone`, `item-cone`, `tree` → küçük çarpışma
  veya sadece dekor (ayarlanabilir).
- Çarpışma verisi: parçalar GLB; Forge'da render mesh → collider + `*.collision.json`
  sidecar deseni mevcut. Araç fiziği bu collider'ları (veya basit kutu/duvar
  analitik şekillerini) okur.

### 5.4 Test edilebilirlik

Çekirdek saf fonksiyonlar → `npm run test:engine` altında deterministik birim
testleri: "tam gaz düz → t saniyede x mesafe", "el freni + direksiyon → drift
açısı", "çimde max hız düşüşü", "duvar çarpması sonrası hız". Aynı sabit-girdi →
aynı sonuç (ghost güvencesi).

## 6. Pist ve level tasarımı

### 6.1 İki yapı bloğu

- **`city-kit-roads` (düz zemin circuit — v1 ana yol):** drift için ideal düz,
  geniş asfalt. `road-straight`, `road-bend`, `road-curve`, `road-crossroad`,
  `road-roundabout`, `road-split`, `road-intersection`, slant rampaları
  (`road-slant*`), bariyer varyantları (`*-barrier`), tabelalar (`sign-highway*`),
  ışıklar, inşaat propları, zemin döşemeleri (`tile-low/high/slant`).
- **`toy-car-kit` (araçlar + yarış öğeleri):** araç gövdeleri, **start/finish
  kapıları** (`gate`, `gate-finish`), pickup/dekor (`item-coin-*`, `item-banana`,
  `item-cone`, `smoke`, `tree`), tekerlek modelleri. Ayrıca "Hot Wheels" tarzı
  yükseltilmiş pist seti (`track-narrow-*`, `track-road-narrow-*`: loop, ramp,
  hill, bend) → **stunt-track varyantı v1.x.**

### 6.2 Pist anatomisi

```
[START/FINISH gate] → düz → [viraj + checkpoint] → şikan → roundabout
                                                              ↓
[FINISH'e dönüş] ← çim kestirme tuzağı ← uzun düzlük ← [checkpoint]
```

- **Start/finish çizgisi:** `gate-finish`; tur zamanlaması tetikleyicisi.
- **Checkpoint'ler:** Sıralı tetikleyiciler; ters yön/kestirme tespiti.
- **Yüzey:** Asfalt (yol parçaları) vs çim (zemin/dış) grip farkı.
- **Engeller:** Bariyerler, koniler, inşaat propları; opsiyonel hareketli engel
  v1.x.
- **Pickup (opsiyonel):** Coin'ler (skor/kozmetik) veya hız boost; v1'de saf
  time-trial için kapalı, v1.x.

### 6.3 Üretim akışı

Pistler **Forge editöründe** kurulur: content browser'dan yol parçalarını
yerleştir, grid snapping ile bağla, start/finish + checkpoint tetikleyicilerini
işaretle. Her pist bir **layout JSON** → Forge'un "layout-driven levels"
modeline ve editörün güçlü yanına (placement + snapping) doğrudan oturur.

### 6.4 Gameplay metadata

- **Araç spawn** (start pozisyonu/yönü).
- **Start/finish tetikleyicisi** (tur zamanlama).
- **Sıralı checkpoint** (id + sıra; ters/kestirme tespiti).
- **Yüzey tipi** (asfalt/çim → grip/sürtünme katsayısı).
- **(opsiyonel) pickup/boost** parametreleri.

> Save-validator notu: pist için **yeni** placement/tetikleyici alanları
> eklenirse `tools/saveValidator.ts` allowlist'ine eklenmeli (CLAUDE.md
> "Save-validator allowlist gotcha"). Mümkünse mevcut alanlarla çözülmeli.

## 7. Kurallar, skorlama ve ghost

### 7.1 Skorlama (Game Rules katmanı)

Forge'un **Game Rules** katmanına (`src/game/gameRules.ts`: değişkenler, timer,
deklaratif sonuç, HUD alanları) eşlenir:

- **Tur süresi:** Stopwatch timer (`up`); start/finish geçişinde durur/sıfırlanır.
- **En iyi tur / en iyi toplam:** Yerel kayıt (best lap, best N-lap).
- **Tur sayısı:** Pist başına hedef (örn. 3 tur) veya serbest pratik.
- **Tur geçerliliği:** Tüm checkpoint'ler sırayla geçilmeli; yoksa tur geçersiz.
- **Sonuç:** Time-attack'te "kaybetme" yok; hedef rekoru geçmek. Opsiyonel hedef
  süre (madalya: bronz/gümüş/altın) — `item-coin-*` temasına uyar.

### 7.2 Ghost sistemi (tanımlayıcı özellik)

Deterministik çekirdek sayesinde ghost güvenilir. İki yaklaşım:

- **Transform-örnek ghost (önerilen, sağlam):** En iyi koşu boyunca sabit
  timestep'te araç transform'u (pos + heading) örneklenir, kompakt bir diziye
  kaydedilir. Replay'de saydam araç bu örnekleri (ara-değerli) izler. Fizik
  sürümünden bağımsız, basit.
- **Girdi-replay ghost (kompakt, opsiyonel):** Sadece girdi akışı + seed
  kaydedilir; aynı deterministik çekirdek aynı yolu üretir. Çok küçük dosya ama
  fizik sürümüne bağlı.

v1: transform-örnek ghost. Kayıt yerel saklanır (en iyi koşu). Ghost çarpışmasız
(yalnız görsel referans).

## 8. UI / HUD

- **Yarış HUD'u:** Anlık tur süresi, en iyi tur, delta (ghost'a/best'e göre
  ±sn, yeşil/kırmızı), tur sayacı (Lap 2/3), hız göstergesi (opsiyonel).
- **Geri sayım:** 3-2-1-GO! başlangıç.
- **Tur sonu:** "Lap 00:42.18 — New Best! / +0:01.3" pop-up.
- **Pist sonu:** Tur tur dökümü, en iyi tur, (madalya), restart/sonraki pist.
- **Restart ipucu (R), pause.**
- Asset: `ui-pack` / `game-icons` (Kenney). Forge HUD ViewModel store'a bağlanır.

## 9. Ses

- Motor sesi (hıza bağlı pitch), lastik cızırtısı (drift/grip kaybı), çarpışma,
  geri sayım bip + GO, tur/rekor jingle, UI tıklama.
- Kaynak: Kenney `interface-sounds`, `impact-sounds`, `music-jingles`
  (motor için uygun döngü sesi gerekirse ayrıca aranır).
- Forge spatial audio v1 (PannerNode + camera listener) mevcut → motor/çarpışma
  konumsal olabilir; top-down'da daha çok hıza bağlı pitch öne çıkar.

## 10. Kapsam ve faz planı

### Faz 0 — Dikey dilim (1 pist, time trial)
- [ ] Araç fiziği saf çekirdek (gaz/fren/direksiyon, yanal grip, el freni drift,
      sürtünme, duvar çarpışma) + birim testleri.
- [ ] Sürüş girdisi (klavye + gamepad) + top-down takip kamera.
- [ ] 1 elle kurulmuş pist layout'u (start/finish + checkpoint'ler, kapalı tur).
- [ ] Tur zamanlama + en iyi tur (Game Rules) + geri sayım + restart.
- **Kabul:** Tek pistte kapalı tur sürülür; tur süresi ölçülür; rekor tutulur.

### Faz 1 — Ghost + içerik
- [ ] Ghost kayıt + oynatma (transform-örnek) + delta HUD.
- [ ] 2–3 pist (artan zorluk: geniş → şikanlı → roundabout/teknik).
- [ ] Yüzey tipi (asfalt/çim grip), off-track yavaşlama.
- [ ] Tur geçerliliği (checkpoint sırası), ters-yön uyarısı.
- [ ] UI cila (delta, tur sonu kartı, madalya hedefleri), ses.
- **Kabul:** Ghost'a karşı yarış tek oturumda; rekor + ghost kalıcı; 2–3 pist.

### v1.x — Sonrası (kapsam dışı, backlog)
- Stunt-track varyantı (`toy-car-kit` yükseltilmiş loop/ramp pistleri, dikey fizik).
- Pickup/boost, coin toplama, banana tuzağı.
- AI rakipler (rota takibi) ve/veya yerel split-screen.
- Slipstream, lastik izleri/duman partikülleri, hasar.
- Araç seçimi/kozmetik (çok sayıda gövde: racer/speedster/suv/truck…).
- Online liderlik tablosu (ghost paylaşımı).

## 11. Forge platform uyumu (mevcut vs gereken)

Bu oyun Forge'un bir **klonunda** geliştirilecek (§12). "Gereken" maddelerden
bazıları **Forge platform işi**dir; Forge'da yapılıp klona akar.

**Mevcut (hazır):**
- Game Mode / pawn / possession iskeleti (`src/game/gameModes/*`).
- Game Rules katmanı (değişken/timer/sonuç, HUD alanları) → tur zamanlama/skor.
- Input: klavye + fare + gamepad + dokunmatik (on-screen).
- Kamera: `followCamera` / `springArmCamera` (top-down takip varyasyonu için temel).
- Collision: AABB planar çözüm; render mesh → collider + `*.collision.json` sidecar.
- Layout-driven levels + editör yerleştirme/snapping (pist üretimi).
- Spatial audio v1.

**Gereken (yeni iş):**
- **Araç fiziği çekirdeği** — oyun tarafı (`src/game/*`), saf + deterministik +
  test edilebilir.
- **Mini Racer Game Mode** — araç pawn'ı spawn, sürüş controller, top-down kamera
  oturumu.
- **Ghost kayıt/oynatma altyapısı** — sabit-timestep örnekleme + saydam replay
  aktörü. (Deterministik çekirdek + sabit timestep platform tarafında faydalı bir
  genel yetenek; mümkünse Forge'da yeniden kullanılabilir kurulur.)
- **Checkpoint / tur tetikleyici metadata** — mümkünse mevcut tetikleyici/overlap
  alanlarıyla; yeni alan gerekirse saveValidator allowlist (CLAUDE.md gotcha).
- **Yüzey-tipi sorgusu** (asfalt/çim grip) — placement metadata + fizik okuması.

## 12. Repo ve mimari sınır

- **Oyun ayrı bir repoda** (Forge'un git klonu) geliştirilir. Forge'da yapılan
  engine/editor değişiklikleri oyun projelerine **upstream** olarak çekilebilir;
  oyun projesindeki değişiklikler (pist layout'ları, mini racer game rules/UI,
  araç fiziği oyun kodu) Forge'a geri gitmez.
- Forge sınır kuralı korunur: gameplay kuralları `src/game/*` + sahne verisinde
  yaşar, `engine/` veya `editor/` içine girmez. Game Mode (`RuntimeSceneApp`)
  asla `editor/*` import etmez.
- Bu GDD Forge `docs/planned/` altında durur çünkü hem oyun planını hem de
  gerektirdiği **Forge platform işini** (§11) belgeler; oyun klonunda kendi
  kopyası tutulabilir. (Aynı yaklaşım [`MINI_GOLF_GDD.md`](./MINI_GOLF_GDD.md) §12.)

## 13. Riskler ve açık sorular

- **Drift hissi:** Grip/handbrake/steer katsayıları yoğun iterasyon ister; erken
  "oynanır his" testi kritik. → Faz 0 dikey dilimde önceliklendir.
- **Ghost senkronu:** Örnekleme oranı + ara-değerleme yumuşaklığı vs dosya boyutu
  dengesi. Çarpışmasız ghost basit; yine de delta hesabı tutarlı olmalı.
- **Kamera + dokunmatik:** Drift sırasında kuşbakışı okunabilirlik; on-screen
  buton yerleşimi parmakları araçtan uzak tutmalı.
- **Collider kalitesi:** Yol parçalarının (özellikle roundabout/curve/slant)
  collider'ı — basit duvar/kutu şekilleri mi, trimesh mi? → Faz 0'da düz/viraj/
  bariyer ile başla.
- **Açık soru:** Varsayılan kontrol **manuel gaz** mı, yoksa **oto-gaz** mı?
  (Öneri: manuel varsayılan + oto-gaz erişilebilirlik seçeneği.)
- **Açık soru:** Kamera **dünyaya sabit** mi (kuzey yukarı) yoksa **araca dönük**
  mü? (Öneri: dünyaya sabit varsayılan + opsiyon.)
- **Açık soru:** Pist döşemesi için ana kit **city-kit-roads** (düz drift
  circuit) onaylanıyor mu, yoksa **toy-car-kit yükseltilmiş track** v1'e mi
  alınsın? (Öneri: v1 düz city circuit; stunt-track v1.x.)

## 14. Kapsam dışı (v1)

- Online çok oyunculu / liderlik tablosu / ghost paylaşımı.
- AI rakipler ve split-screen (v1.x).
- Prosedürel pist üretimi.
- Hasar/araç deformasyonu, gerçekçi süspansiyon/lastik modeli.
- Stunt/loop yükseltilmiş pist + dikey fizik (v1.x).
- Mağaza / ilerleme / meta sistemleri.
