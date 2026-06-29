# Mini Golf — Oyun Tasarım Dokümanı (GDD)

> Tarih: 2026-06-26
> Durum: Faz 0 uygulamada. Top fiziği saf çekirdeği eklendi; runtime dikey dilimi devam ediyor.
> Amaç: Forge platformu üzerine kurulacak **ilk oyun** olan Mini Golf'ün
> vizyonunu, oynanışını, fizik modelini, kapsamını ve Forge uyum sınırlarını
> tanımlamak.
> Kaynak: Fikir havuzu [`KENNEY_GAME_IDEAS.md`](planned/KENNEY_GAME_IDEAS.md) (#31, ilk
> oyun adayı 🟢). Asset: `kenney_minigolf-kit` (127 model). Paket kataloğu:
> [`docs/kenney/KENNEY_CATALOG.md`](kenney/KENNEY_CATALOG.md).

## Temel kararlar (bu GDD'nin sütunları)

Bu doküman aşağıdaki üç karara göre yazıldı:

1. **Kontrol/Kamera:** Sürükle-güç + topun etrafında yörünge (orbit) kamera.
   Topu geri sürükleyerek yön + kuvvet aynı anda ayarlanır, bırakınca vurulur.
2. **Fizik:** Özel **arcade top fiziği** — hafif, deterministik, headless test
   edilebilir saf çekirdek. Oyun build'i bir fizik motoruna (Rapier) bağlı
   değildir. Replay/ghost mümkün.
3. **v1 kapsam:** Tek oyuncu. Önce **1 delik** cilalanır (dikey dilim), sonra
   **9-delikli tek kursa** genişler. Par/vuruş skoru, tüm delikler bitince
   kazanma.

---

## 1. Yüksek konsept

> Renkli, modüler bir minyatür golf parkurunda topu en az vuruşla deliğe sok.
> Topu geri çekip bırak — güç ve yön parmağının/farenin ucunda. Rampalar,
> tümsekler, yel değirmenleri ve dar geçitlerle dolu 9 delik; her delikte bir
> "par" hedefi ve tatmin edici, öngörülebilir bir top fiziği.

Tür: Arcade / casual fizik bulmaca. Oturum: 5–15 dk (kurs başına). Tek oyuncu,
yerel. Web-first (masaüstü + dokunmatik).

## 2. Tasarım sütunları

1. **Tek girdi, derin his.** Tek bir "geri çek-bırak" jesti yön ve gücü birlikte
   taşır. Öğrenmesi 5 saniye, ustalaşması delikler boyunca sürer.
2. **Öngörülebilir fizik.** Top deterministik davranır; aynı vuruş aynı sonucu
   verir. Şans değil, okuma ve dozaj ödüllendirilir.
3. **Okunur parkur.** Her delik bir bakışta anlaşılır; engel ve eğimler net
   sinyal verir. "Haksız" ölüm yok — sadece su/out-of-bounds cezası.
4. **Modüler üretim.** Parkurlar Kenney kitinin grid'e oturan parçalarından,
   Forge editöründe (snapping + placement) kurulur. Yeni delik = yeni layout.

## 3. Çekirdek oynanış döngüsü

```
Deliğe başla (tee'de top)
   ↓
Kamerayı çevir / parkuru oku
   ↓
Geri sürükle → yön + güç göstergesi (yörünge çizgisi/ok)
   ↓
Bırak → top vurulur, fizik simülasyonu başlar
   ↓
Top durur (rest) → vuruş +1
   ↓
Top delikte mi?  ── Hayır ──┐
   │ Evet                    └─→ döngü (sonraki vuruş)
   ↓
Delik tamam (skor: vuruş vs par)
   ↓
Sonraki delik / kurs sonu skor tablosu
```

Yan durumlar:
- **Out of bounds / su:** +1 ceza vuruşu, top son güvenli pozisyona döner.
- **Lip-out:** Top deliğin kenarından hızlıca geçerse girmez (delik yakalama
  fizik kuralı, bkz. §5).
- **Maksimum vuruş (opsiyonel):** Bir delikte üst sınır (örn. par + 6) → "pick
  up", o delik max skorla kapanır (oyuncu sıkışmasını önler).

## 4. Kontroller ve kamera

### 4.1 Vuruş girdisi — sürükle-güç

Tek jest hem yönü hem gücü taşır (Forge input zaten klavye + fare + gamepad +
dokunmatik kaynaklarını destekliyor):

- **Fare / dokunmatik:** Top üzerinde bas-tut → geri sürükle. Sürükleme
  **vektörü** atış yönünün tersidir (sapan/slingshot mantığı), uzunluğu gücü
  belirler (0 → `maxPower` arası, clamp'li). Bırak → vur.
- **İptal:** Sürükleme sırasında belirli bir "iptal bölgesine" (örn. tekrar
  topun üstüne) gel ve bırak → atış iptal.
- **İnce ayar (gamepad/klavye):** Sol stick / ok tuşları yön; ayrı bir tuş
  basılı tutma süresi (veya tetik analogu) güç. Aynı `maxPower` clamp'i.

Görsel geri bildirim (sürükleme sırasında):
- Yön oku / kesik yörünge çizgisi (ilk segment; tam tahmin **yok** — beceri
  korunur).
- Güç çubuğu (0–100%) + renk geçişi (yeşil→sarı→kırmızı).

### 4.2 Kamera — yörünge

- Top etrafında **orbit** (yaw/pitch) + sınırlı dolly (zoom). Forge'da
  `springArmCamera` / `followCamera` mevcut; mini golf kamerası bunların bir
  varyasyonu olarak kurulabilir.
- **Serbest okuma modu:** Vuruş öncesi oyuncu kamerayı bağımsız çevirip parkuru
  inceleyebilir.
- **Takip:** Top hareket ederken kamera yumuşakça topu izler; durunca atış
  okuma pozisyonuna geri yumuşar.
- **Pitch limiti:** Tepeden-yakın açıdan alçak yatay açıya; topun altına geçmez.
- Dokunmatikte tek parmak = sürükle-güç (top üstündeyken), iki parmak / boş alan
  = kamera orbit + pinch zoom.

## 5. Top fiziği (özel arcade çekirdek)

**Hedef:** Forge'un saf-çekirdek desenine (`src/game/collision.ts`,
`src/game/gameRules.ts` gibi) uyan, Three.js/DOM/fizik-motoru bağımsız,
deterministik, headless test edilebilir bir top yuvarlayıcı. Sabit timestep
(örn. 120 Hz alt-adım) → tekrar oynatılabilir (replay/ghost).

### 5.1 Durum

```
BallState {
  pos: [x, y, z]        // y = yüzey yüksekliği (rampalar için)
  vel: [vx, vy, vz]
  resting: bool         // hız eşiğin altında → durdu
}
```

v1 büyük ölçüde **2.5B**: yatayda (XZ) tam simülasyon, dikey (Y) yüzey
yüksekliğinden ve rampalardan türetilir; serbest sıçrama (havada uçma) v1.x'e
ertelenebilir.

### 5.2 Kuvvetler ve kurallar

| Kuvvet / kural | Model | Notlar |
| --- | --- | --- |
| **Putt impulse** | Bırakma anında `vel += dir * power` | `power` clamp'li; eğri bir güç haritası (kolay düşük güç dozajı). |
| **Yuvarlanma sürtünmesi** | Her adım `vel *= (1 - k·dt)` veya sabit yavaşlama | Yüzeye göre `k` (green vs rough). |
| **Eğim ivmesi** | Yüzey gradyanından `vel += g·slope·dt` | Rampa/tümsek/tepe parçalarından gelir. |
| **Duvar sekmesi** | Çarpışmada normal bileşeni `* -restitution` | `restitution < 1` (enerji kaybı). Forge AABB collision deseninden faydalanır ama topa özel. |
| **Durağanlık (rest)** | `|vel| < epsilon` → `resting = true` | Sıradaki vuruşa izin verir. |
| **Delik yakalama** | Top delik yarıçapında **ve** `|vel| < captureSpeed` → düşer | Hızlıysa **lip-out** (kenardan geçer). Yarıçap + hız eşiği ayarlanabilir. |
| **Out of bounds / su** | Tanımlı bölge dışına/su tetikleyicisine girince | +1 ceza, son güvenli pozisyona reset. |

### 5.3 Çarpışma yüzeyleri

- **Duvarlar/borderlar:** Kit'in `wall-*`, `block-borders`, `side` parçaları →
  topun sektiği dikey yüzeyler.
- **Zemin/yükseklik:** `straight`, `corner`, `ramp-*`, `bump-*`, `hill-*` →
  yüzey yüksekliği ve eğim alanları.
- **Engeller:** `obstacle-block/diamond/triangle` → statik sektiren bloklar.
- **Hareketli engel (stretch):** `windmill` / `structure-windmill` kanadı →
  kinematik blocker (zamanla dönen). v1.x.

Çarpışma verisi: parkur parçaları GLB; Forge'da render mesh'ten collider çıkarma
ve `*.collision.json` sidecar deseni mevcut. Top fiziği bu collider AABB'lerini
(veya basit analitik şekilleri) okur — karakterdeki gibi.

### 5.4 Test edilebilirlik

Çekirdek saf fonksiyonlar olarak yazılır → `npm run test:engine` altında
deterministik birim testleri: "şu güç + yön → top şu hücrede durur", "lip-out
eşiği", "eğimde yuvarlanma yönü", "duvar sekme açısı". Forge'un mevcut
headless test disiplinini izler.

## 6. Parkur ve delik tasarımı

### 6.1 Delik anatomisi

```
[TEE] → zemin segmentleri (düz/köşe/rampa) + duvarlar → [DELİK + bayrak]
         ↑ engeller, tümsekler, dar geçit, tünel, yel değirmeni
```

- **Tee (başlangıç):** `start` / `split-start`. Topun ilk konumu.
- **Yol:** `straight`, `corner`, `side`, `open`, `narrow-*`, `split`, `split-t`,
  `gap`, `crest`, `skew-corner`, `inner-corner`, `round-corner-*`.
- **Yükseklik:** `ramp-low/medium/high/sharp/large/side/square`, `bump`,
  `bump-down`, `hill-round/square/corner`, ayaklar için `support(s)-*`.
- **Engeller:** `obstacle-block/diamond/triangle`, `structure-gate(s)`,
  `windmill` (stretch: hareketli), `castle`, `tunnel-narrow/wide/double`.
- **Bitiş:** `hole-open/round/square` + `end`, `flag-*` (bayrak görseli).
- **Spline parça seti:** `spline-default-*` / `spline-concave-*` (looping, hill,
  bend, skew, bump…) — sürekli/akışkan parkur parçaları. v1'de modüler grid
  parçaları yeterli; spline seti daha organik parkurlar için v1.x.

### 6.2 Üretim akışı

Parkurlar **Forge editöründe** kurulur: content browser'dan kit parçalarını
yerleştir, grid snapping ile hizala, delik/tee/tetik aktörlerini işaretle. Her
delik (veya kurs) bir **layout JSON**. Bu, Forge'un "layout-driven levels"
modeline doğrudan oturur ve editörün güçlü yanını (yerleştirme + snapping)
sergiler.

### 6.3 Gameplay metadata

Parkura özel anlamlar, placement metadata + tetikleyici aktörlerle işaretlenir:
- **Tee işareti** (topun spawn olacağı yer/yön).
- **Delik (cup) tetikleyicisi** (yakalama bölgesi + yarıçap/hız eşiği).
- **Su / out-of-bounds bölgesi** (ceza + reset).
- **Yüzey tipi** (green/rough → sürtünme katsayısı), opsiyonel.
- **Hareketli engel** parametreleri (dönüş hızı), stretch.

> Save-validator notu: parkur için **yeni** `LayoutPlacement` / tetikleyici
> alanları eklenirse, `tools/saveValidator.ts` allowlist'ine eklenmeli (CLAUDE.md
> "Save-validator allowlist gotcha"). Mümkünse mevcut alanlarla (objectType,
> responses, generateOverlapEvents…) çözülmeli.

## 7. Kurallar, skorlama ve kazanma

Forge'un **Game Rules** katmanına (`src/game/gameRules.ts`: değişkenler,
objektifler, timer, deklaratif win/lose, HUD alanları) eşlenir:

- **Vuruş sayacı (stroke):** Delik başına named variable; her atışta +1, ceza +1.
- **Par:** Delik metadata'sında hedef vuruş. Skor = vuruş − par (birdie/bogey
  terminolojisi UI'da).
- **Delik tamamlama:** "reach N" objektifi yerine delik-yakalama olayı → deliği
  kapat, sıradakine geç.
- **Kurs skoru:** Tüm deliklerin toplamı; kurs sonunda skor tablosu.
- **Kazanma koşulu:** 9 deliğin tamamı tamamlanınca `win` → skor özeti.
- **Kaybetme:** v1'de yok (casual). Opsiyonel "max stroke per hole" pick-up
  mekaniği sıkışmayı önler, kaybettirmez.
- **Timer (opsiyonel):** Stopwatch (`up`) toplam süre rekoru için; zorunlu değil.

Bu katman zaten data-driven ve headless; mini golf kuralları bir
`GameRulesConfig` olarak yazılır, motor/editör değişmez.

## 8. UI / HUD

- **Atış HUD'u:** Güç çubuğu, yön oku/yörünge ipucu (sürükleme sırasında).
- **Skor HUD'u:** Delik no, par, bu delik vuruş, toplam skor (par'a göre ±).
- **Delik geçiş kartı:** "Delik 3 tamam — 2 vuruş (Birdie!)".
- **Kurs sonu:** Delik delik skor tablosu, toplam, en iyi (yerel kayıt).
- **Pause / yeniden başlat / sonraki delik.**
- Asset: `ui-pack` / `game-icons` (Kenney). Forge HUD ViewModel store'a bağlanır.

## 9. Ses

- Vuruş (club hit), top yuvarlanma (yüzeye göre), duvar sekme, deliğe düşme
  (cup), su/out-of-bounds, UI tıklama, birdie/par jingle.
- Kaynak: Kenney `interface-sounds`, `impact-sounds`, `music-jingles`.
- Forge'da spatial audio v1 (PannerNode + camera listener) mevcut → top sesi
  konumsal olabilir.

## 10. Kapsam ve faz planı

### Faz 0 — Dikey dilim (1 delik)
- [x] Top fiziği saf çekirdek (sürtünme, eğim, duvar sekme, rest, delik
      yakalama) + birim testleri. `2026-06-29`: `src/game/miniGolfBallPhysics.ts`
      eklendi; engine testleri eklendi. Not: tam `npm run test:engine` koşusu mevcut
      asset manifest eksikleri nedeniyle erken duruyor.
- [ ] Sürükle-güç girdisi + güç/yön HUD.
- [ ] Yörünge kamera (orbit + takip).
- [ ] 1 elle kurulmuş delik layout'u (tee → yol → delik, birkaç engel).
- [ ] Vuruş sayacı + delik tamamlama (Game Rules).
- **Kabul:** Tek delik baştan sona oynanır; vuruş sayılır; delik biter.

### Faz 1 — Kurs (9 delik)
- [ ] 9 delik layout (artan zorluk: düz → köşe → rampa → engel → yel değirmeni).
- [ ] Par/skorlama, kurs sonu skor tablosu, yerel en iyi.
- [ ] Out-of-bounds / su cezası + reset.
- [ ] UI cila (geçiş kartı, birdie/par dili), ses.
- **Kabul:** 9 delik tek oturumda oynanır; toplam skor + rekor.

### v1.x — Sonrası (kapsam dışı, backlog)
- Hareketli engeller (yel değirmeni kanadı, dönen parçalar).
- Spline parça seti ile organik parkurlar.
- Ghost/replay (deterministik fizik bunu mümkün kılar).
- Tema/kozmetik (top renkleri: `ball-blue/green/red`; sopa renkleri).
- Yerel sıra-tabanlı çok oyunculu (hotseat).
- Kurs editörü cilası (oyun-içi delik kurma).

## 11. Forge platform uyumu (mevcut vs gereken)

Bu oyun Forge'un bir **klonunda** geliştirilecek (aşağı bkz. §12). Aşağıdaki
"gereken" maddelerden bazıları aslında **Forge platform işi**dir; bunlar Forge
reposunda yapılıp klona akar.

**Mevcut (hazır):**
- Game Mode / pawn / possession iskeleti (`src/game/gameModes/*`).
- Game Rules katmanı (skor/objektif/timer/win-lose, HUD alanları).
- Input: klavye + fare + gamepad + dokunmatik (`defaultInputBindings`, on-screen
  touch).
- Kamera: `springArmCamera` / `followCamera` (orbit/takip varyasyonu için temel).
- Collision: AABB planar çözüm deseni; render mesh → collider + `*.collision.json`
  sidecar.
- Layout-driven levels + editör yerleştirme/snapping (parkur üretimi).
- Spatial audio v1.

**Gereken (yeni iş):**
- **Top fiziği çekirdeği** — oyun tarafı (`src/game/*`), saf + test edilebilir.
- **Mini golf Game Mode** — top pawn'ı spawn, sürükle-güç controller, yörünge
  kamera oturumu.
- **Sürükle-güç girdi haritası** + HUD widget'ları (güç/yön).
- **Delik/tee/su tetikleyici metadata** — mümkünse mevcut placement alanlarıyla;
  yeni alan gerekirse saveValidator allowlist (CLAUDE.md gotcha).
- **(Platform, opsiyonel)** Topun yuvarlanması için karaktere-özgü olmayan,
  küre tabanlı yüzey/eğim sorgusu — Forge collision yardımcılarının küçük bir
  genellemesi olabilir.

## 12. Repo ve mimari sınır

- **Oyun ayrı bir repoda** (Forge'un git klonu) geliştirilir. Forge'da yapılan
  engine/editor değişiklikleri oyun projelerine **upstream** olarak çekilebilir;
  oyun projesindeki değişiklikler (parkur layout'ları, mini golf game rules/UI,
  top fiziği oyun kodu) Forge'a geri gitmez.
- Forge sınır kuralı korunur: gameplay kuralları `src/game/*` + sahne verisinde
  yaşar, `engine/` veya `editor/` içine girmez. Game Mode (`RuntimeSceneApp`)
  asla `editor/*` import etmez.
- Bu GDD artık minigolf oyun reposunun ana tasarım dokümanıdır:
  `docs/GDD.md`. Oyun projesindeki parkur layout'ları, mini golf game rules/UI,
  top fiziği ve oyun asset/data değişiklikleri bu repoda kalır; genel
  engine/editor işleri Forge upstream reposunda yapılır ve buraya merge edilir.

## 13. Riskler ve açık sorular

- **Fizik hissi:** Arcade dozaj eğrisi (güç haritası) iterasyon ister; erken
  "oynanır his" testi kritik. → Faz 0 dikey dilimde önceliklendir.
- **Delik yakalama dengesi:** Lip-out eşiği fazla katı → sinir bozucu, fazla
  gevşek → tatminsiz. Ayarlanabilir parametre + test.
- **Kamera + dokunmatik çakışması:** Top-üstü sürükle vs kamera-orbit jest
  ayrımı net olmalı (tek parmak/iki parmak kuralı).
- **Collider üretimi:** Kit parçalarının (özellikle rampalar/eğri köşeler)
  collider kalitesi — basit analitik şekiller mi, trimesh mi? → Faz 0'da
  düz/köşe/duvar ile başla, rampaları sonra.
- **Açık soru:** v1'de serbest dikey sıçrama (rampadan havalanma) olacak mı,
  yoksa 2.5B yüzey-kilitli mi? (Öneri: 2.5B başla, sıçramayı v1.x'e bırak.)
- **Açık soru:** Par değerleri elle mi, yoksa parkur uzunluğundan türetilerek mi
  atanacak?

## 14. Kapsam dışı (v1)

- Online çok oyunculu / matchmaking.
- Prosedürel parkur üretimi.
- Karakter avatarları / sopa salınım animasyonu (sürükle-güç şeması seçildi).
- Gerçekçi rüzgâr/hava, ileri fizik (spin/backspin) — v1'de düz arcade.
- Mağaza / ilerleme / meta sistemleri.
