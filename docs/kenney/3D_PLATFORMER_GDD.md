# 3B Platformer (Crash-vari) — Oyun Tasarım Dokümanı (GDD)

> Tarih: 2026-06-26
> Durum: Tasarım / v1 planı. Kod uygulanmadı.
> Amaç: Forge platformu üzerine kurulacak 3B Platformer'ın vizyonunu, oynanışını,
> hareket/savaş modelini, kapsamını ve gereken Forge platform işini tanımlamak.
> Bu tür, Forge'un **aktif yürütme track'i (G1–G6: kameraya-göreli hareket,
> yerçekimi+zıplama, çarpışma yanıtı, takip kamera, locomotion animasyon, authored
> level)** üstüne en doğrudan oturan oyundur.
> Kaynak: Fikir havuzu [`KENNEY_GAME_IDEAS.md`](./KENNEY_GAME_IDEAS.md) (#7, ilk
> oyun adayı 🟡). Asset: `kenney_platformer-kit` (154 model) + karakter için
> `kenney_mini-characters` / `kenney_blocky-characters` (rig'li + animasyonlu).
> Paket kataloğu: [`docs/kenney/KENNEY_CATALOG.md`](../kenney/KENNEY_CATALOG.md).
> Kardeş dokümanlar: [`MINI_GOLF_GDD.md`](./MINI_GOLF_GDD.md),
> [`TOP_DOWN_MINI_RACER_GDD.md`](./TOP_DOWN_MINI_RACER_GDD.md) (aynı format + ortak
> repo/sınır kararları).

## Temel kararlar (bu GDD'nin sütunları)

Bu doküman aşağıdaki üç karara göre yazıldı:

1. **Kamera/Yapı:** **Lineer "Crash-vari"** — arkadan takip kamerası, büyük ölçüde
   lineer koridor/patika seviyeler (ekrana-doğru koşu + yanal bölümler).
2. **Controller/Fizik:** **Mevcut Forge kinematik karakter controller'ını
   genişlet** — G1–G6'da kurulan hareketi (yerçekimi, zıplama, AABB çarpışma/kayma,
   takip kamera, locomotion anim) yeniden kullan; platformer ekstralarını ekle.
   Saf, deterministik, headless test edilebilir çekirdek korunur. Sıfırdan icat
   **yok** — diğer iki oyunun "yeni saf çekirdek" yaklaşımından farkı budur.
3. **v1 kapsam (mekanik):** Koş/zıpla/topla + can & checkpoint **+ düşman &
   saldırı** (zıpla-ez/stomp + dönüş saldırısı + kırılabilir sandıklar). Önce **1
   seviye** cilalanır (dikey dilim), sonra birkaç seviyeye genişler.

---

## 1. Yüksek konsept

> Renkli, lineer bir 3B dünyada koş, zıpla, sandıkları parçala ve düşmanları ez.
> Kamera arkanda; uçurumlar, hareketli platformlar, testereler ve dikenler
> arasından sıçra, mücevherleri topla ve bayrağa ulaş. Klasik Crash-vari ritim:
> öğrenilmesi kolay, ustalaşması seviye seviye derinleşen zıplama ve zamanlama.

Tür: 3B aksiyon-platformer. Oturum: seviye başına 3–8 dk. Tek oyuncu, yerel.
Web-first (masaüstü + dokunmatik).

## 2. Tasarım sütunları

1. **Tatmin edici zıplama.** Hareketin temeli okunur, affedici ve "hisli"
   zıplama (coyote time, değişken yükseklik, net iniş). Her şey buna hizmet eder.
2. **Yönlendirilmiş tempo.** Lineer seviyeler ritim tasarlar: gerilim → rahatlama,
   tehlike → ödül. Crash gibi "koridoru oku ve uygula".
3. **Net tehdit & ödül okuması.** Tehlike (diken/testere/uçurum), düşman ve
   koleksiyon bir bakışta anlaşılır; "haksız" ölüm yok, checkpoint cömert.
4. **Forge'u sergiler & yeniden kullanır.** Mevcut karakter controller + animasyon
   + level pipeline'ını genişletir; sıfırdan motor yazmaz.

## 3. Çekirdek oynanış döngüsü

```
Seviyeye başla (spawn / son checkpoint)
   ↓
Koş + zıpla (çift zıplama) → boşluk/engel/hareketli platform aş
   ↓
Düşman?  ── Evet ──→ zıpla-ez (stomp) veya dönüş saldırısı → yok et
   │ Hayır
   ↓
Sandık/koleksiyon → parçala/topla (coin/jewel/star, heart=can)
   ↓
Checkpoint (flag) → ilerleme kaydedilir
   ↓
Hasar/düşme?  ── Evet ──→ can -1, son checkpoint'e dön (can biterse seviye restart)
   ↓
Seviye sonu bayrağı → seviye tamam (skor: koleksiyon + süre)
```

## 4. Kontroller ve kamera

### 4.1 Girdi

Forge input zaten klavye + fare + gamepad + dokunmatik destekliyor; mevcut
`defaultInputBindings` + `playerController` temel alınır.

- **Klavye:** WASD/ok = hareket (kameraya-göreli), Space = zıplama (basılı tut =
  yüksek; tekrar = çift zıplama), Shift = koş/sprint, J/Ctrl = saldırı (dönüş),
  E = etkileşim.
- **Gamepad:** Sol stick = hareket, A = zıplama, X = saldırı, RT = sprint.
- **Dokunmatik:** On-screen joystick + zıplama/saldırı butonları (Forge on-screen
  touch input mevcut).

### 4.2 Hareket fiili seti (v1)

- Koşma (kameraya-göreli, ivmeli).
- Zıplama + **çift zıplama**; **coyote time** (kenardan düşerken kısa zıplama
  toleransı); **jump buffer** (inişten hemen önce basılan zıplamayı yakala);
  **değişken yükseklik** (tuş bırakınca kısalır).
- Hareketli platform **taşıma** (platform hızını oyuncuya aktar).
- **Spring/zıplama pedi** (yüksek sıçrama), eğim kayma, ladder/pipe (stretch).

### 4.3 Kamera — arkadan takip (Crash-vari)

- **Behind-the-back follow:** Kamera oyuncunun arkasında; Forge `followCamera` /
  `springArmCamera` ve mevcut `tpsCharacterGameMode` (3. şahıs) bunun temeli.
- **Yönlendirilmiş framing:** Lineer seviyede kamera çoğunlukla yola hizalı;
  bölüm bölüm yaw/mesafe authored ipuçlarıyla ayarlanabilir (koridor → açılım).
- **Yumuşak yaslama:** Spring-arm ile çarpışma/iç-içe geçme önleme; iniş/zıplamada
  yumuşak pitch.
- **Tehlike okuması:** Boşluk/diken öncesi kamera ileriyi gösterecek şekilde
  hafif geri/yukarı; "kör zıplama" minimum.

## 5. Hareket ve savaş (mevcut controller'ı genişlet)

**Hedef:** Forge'un mevcut **kinematik karakter controller'ını** (G1–G6) yeniden
kullanıp platformer ekstralarını saf, deterministik, headless-test edilebilir
biçimde **eklemek** — yeni motor yazmadan. İlgili mevcut parçalar:
`src/game/characterMovementSystem.ts`, `verticalMotion.ts`, `collision.ts`
(AABB planar slide), `followCamera.ts` / `springArmCamera.ts`,
`locomotionAnimation.ts`, `playerController.ts`, `gameModes/tpsCharacterGameMode.ts`,
`animationNotifies.ts` + montajlar, `ragdollDriver.ts`.

### 5.1 Mevcut (yeniden kullanılan)

| Sistem | Forge'da var | Platformer'da rolü |
| --- | --- | --- |
| Yerçekimi + zıplama | `verticalMotion.ts` | Temel zıplama/düşme. |
| Yatay hareket + slide | `collision.ts` (AABB) | Duvar/platform çarpışma, kayma. |
| Kameraya-göreli hareket | char movement + control yaw | Koşma yönü. |
| Takip kamera | `followCamera`/`springArmCamera` | Crash-vari arkadan kamera. |
| Locomotion animasyon | `locomotionAnimation.ts` | Idle/koş/zıpla blend. |
| 3. şahıs game mode | `gameModes/tpsCharacterGameMode.ts` | Platformer game mode tabanı. |
| Notify/montage | `animationNotifies.ts`, montajlar | Saldırı vuruş penceresi. |
| Ragdoll | `ragdollDriver.ts` | Ölüm/komik düşüş (opsiyonel). |

### 5.2 Eklenecek (yeni platformer çekirdeği — saf + test edilebilir)

| Ekstra | Model | Notlar |
| --- | --- | --- |
| **Çift zıplama** | Havada 1 ek zıplama; inişte resetlenir | Sayaç state. |
| **Coyote time** | Kenardan düştükten sonra `t` ms zıplama izni | Affedicilik. |
| **Jump buffer** | İnişten önce basılan zıplamayı kuyrukla | His. |
| **Değişken yükseklik** | Tuş bırakınca yukarı hızı kırp | Kısa/uzun zıplama. |
| **Hareketli platform taşıma** | Platform delta'sını oyuncuya ekle | Üzerinde dururken. |
| **Spring/bounce** | Temas → büyük dikey impuls | `spring` asset. |
| **Stomp (zıpla-ez)** | Düşerken düşman üstüne → düşmanı yok et + zıpla | Üstten temas tespiti. |
| **Dönüş saldırısı (spin)** | Kısa süreli hitbox; notify ile vuruş penceresi | Sandık kır + düşman it/yok. |
| **Hasar/can** | Temasla can -1, kısa dokunulmazlık + knockback | `heart` doldurur. |

Bu ekstralar pür mantık olarak yazılır → `npm run test:engine` altında
deterministik birim testleri ("coyote penceresi", "çift zıplama reset", "stomp
yalnız üstten", "spin hitbox süresi"). Forge'un mevcut headless test disiplini.

### 5.3 Düşmanlar (v1)

- Basit davranışlar: devriye (ileri-geri), oyuncuya temasla hasar; stomp veya
  spin ile yok edilir. Forge `behaviors.ts` / actor script (`*.actor.json`)
  desenine oturur; karmaşık AI yok.
- Asset: `mini-characters` / `blocky-characters` (rig'li) düşman olarak; veya
  platformer-kit basit proplar (`barrel`, `bomb`) hareketli tehlike olarak.

### 5.4 Kırılabilir sandıklar

- `crate`, `crate-item` (içinden coin/heart), `crate-strong` (çok vuruş),
  `crate-item-strong`. Spin/stomp ile kırılır → koleksiyon düşürür. Crash imzası.

## 6. Seviye ve level tasarımı

### 6.1 Yapı blokları (platformer-kit)

- **Zemin/platform blokları (grass + snow temaları):** `block-grass-*` /
  `block-snow-*` — düz, köşe, kavis, kenar, overhang, hexagon, eğim
  (`-slope`, `-slope-steep`), low/large/long/narrow/tall. Modüler, grid'e oturur.
- **Dinamik platformlar:** `block-moving`, `block-moving-large`,
  `conveyor-belt`, `platform`, `platform-ramp`, `platform-overhang`,
  `platform-fortified`.
- **Tehlikeler:** `spike-block(-wide)`, `trap-spikes(-large)`, `saw`, `bomb`,
  + boşluk/uçurum (void düşme).
- **Sıçrama/yardım:** `spring` (zıplama pedi), `ladder(-long/-broken)`, `pipe`.
- **Koleksiyon:** `coin-bronze/silver/gold`, `jewel`, `star` (seviye macguffin?),
  `heart` (can), `key` + `lock`/`door*` (geçit, v1.x), `chest`.
- **Mekanizma:** `button-round/square`, `lever` (v1.x bulmaca için).
- **İşaret/dekor:** `flag` (checkpoint/hedef), `arrow(s)`/`sign`, `fence*`,
  `hedge*`, `barrel`, `brick`, ağaçlar (grass+snow), `flowers`, `grass`,
  `mushrooms`, `rocks`, `stones`, `plant`, `poles`.

### 6.2 Karakter asseti

- **Önerilen:** `mini-characters` veya `blocky-characters` — rig'li + animasyonlu
  (idle/koş/zıpla için locomotion). Forge'un mevcut skeletal/animasyon pipeline'ı
  (Skeletal Mesh Editor, `*.skeleton.json`, blend space, montage) bunlara uyar.
- **Alternatif (basit stil):** platformer-kit `character-oo*i` (5 maskot) —
  stil uyumu yüksek; rig/animasyon durumuna göre statik/basit kullanılır.
- Saldırı için **montage** + **notify** (vuruş penceresi) zaten Forge'da var.

### 6.3 Seviye anatomisi (lineer)

```
[SPAWN] → koşu+zıplama bölümü → [checkpoint] → hareketli platform dizisi
                                                        ↓
[seviye sonu bayrağı] ← düşman+sandık arenası ← testere/diken geçidi ← [checkpoint]
```

Tempo: kolay giriş → mekanik tanıtımı → varyasyon → küçük doruk → bayrak. Her
yeni mekanik güvenli bir alanda tanıtılır, sonra tehlikeyle birleştirilir.

### 6.4 Üretim akışı & metadata

Seviyeler **Forge editöründe** kurulur: blokları yerleştir, grid snapping ile
hizala; spawn, checkpoint, hareketli-platform yolu, düşman devriye, koleksiyon ve
tehlike tetikleyicilerini işaretle. Her seviye bir **layout JSON** →
"layout-driven levels".

Gameplay metadata: oyuncu spawn; checkpoint (flag) tetikleyici; hareketli platform
yol/hız; düşman devriye noktaları + hasar; tehlike (hasar/ölüm) bölgeleri;
koleksiyon tipi/değeri; spring impuls; void/kill-plane.

> Save-validator notu: yeni placement/tetikleyici alanları eklenirse
> `tools/saveValidator.ts` allowlist'ine eklenmeli (CLAUDE.md "Save-validator
> allowlist gotcha"). Mümkünse mevcut alanlarla (overlap events, objectType,
> responses…) çözülmeli.

## 7. Kurallar, skorlama ve ilerleme

Forge **Game Rules** katmanına (`src/game/gameRules.ts`: değişkenler, objektifler,
timer, deklaratif win/lose, HUD alanları) eşlenir:

- **Can (lives):** Named variable; hasar/düşmede -1; `heart` ile +1; 0 → seviye
  restart (veya game over → seviye başı).
- **Sağlık (opsiyonel):** Crash'te tek-vuruş yaygın; v1'de ya tek-vuruş + can, ya
  da küçük sağlık çubuğu. (Açık soru, §13.)
- **Koleksiyon:** coin/jewel sayacı (skor/kozmetik); `star` = seviye tamamlama
  hedefi veya gizli toplama.
- **Checkpoint:** Son aktif checkpoint runtime state (layout'a yazılmaz).
- **Seviye tamamlama:** Bayrağa ulaş → `win`; skor = koleksiyon + (opsiyonel süre).
- **Kaybetme:** Can biterse seviye restart.
- **Timer (opsiyonel):** Stopwatch (`up`) speedrun/skor için.

## 8. UI / HUD

- **Oyun HUD'u:** Can (kalp ikonları), koleksiyon sayaçları (coin/jewel/star),
  (opsiyonel sağlık), checkpoint bildirimi.
- **Seviye geçiş:** "Seviye Tamam — 3/5 jewel, 00:42" özet kartı.
- **Game over / restart, pause.**
- **İpucu/işaret:** `arrow(s)`/`sign` dünya-içi yönlendirme.
- Asset: `ui-pack` / `game-icons` (Kenney). Forge HUD ViewModel store'a bağlanır.

## 9. Ses

- Zıplama, çift zıplama, iniş, koşu adımı (notify ile), spring, sandık kırma,
  coin/jewel topla, stomp/spin saldırı, hasar al, checkpoint, seviye tamam jingle.
- Kaynak: Kenney `interface-sounds`, `impact-sounds`, `music-jingles`.
- Forge spatial audio v1 (PannerNode + camera listener) mevcut → düşman/tehlike
  sesleri konumsal; footstep notify zaten desteklenir.

## 10. Kapsam ve faz planı

### Faz 0 — Dikey dilim (1 seviye, çekirdek hareket)
- [ ] Mevcut controller'ı genişlet: çift zıplama, coyote time, jump buffer,
      değişken yükseklik, hareketli platform taşıma + birim testleri.
- [ ] Crash-vari arkadan takip kamera (tpsCharacterGameMode varyasyonu).
- [ ] 1 elle kurulmuş lineer seviye (spawn → checkpoint → bayrak), tehlike +
      hareketli platform + spring.
- [ ] Can + checkpoint + seviye tamamlama (Game Rules), locomotion anim.
- **Kabul:** Tek seviye baştan sona oynanır; zıplama hissi sağlam; ölüm/checkpoint
  çalışır; bayrakta biter.

### Faz 1 — Savaş + içerik
- [ ] Stomp + dönüş saldırısı (montage + notify hitbox) + kırılabilir sandıklar.
- [ ] Basit düşmanlar (devriye + temas hasar; stomp/spin ile yok).
- [ ] 2–3 seviye (artan zorluk + grass/snow tema), koleksiyon ekonomisi.
- [ ] UI cila (can, koleksiyon, seviye sonu), ses, ölüm (opsiyonel ragdoll).
- **Kabul:** Düşman ve sandıkla dolu 2–3 seviye tek oturumda oynanır; can/skor
  tutulur.

### v1.x — Sonrası (kapsam dışı, backlog)
- Bulmaca & yetenekler: key/lock/door, button/lever, kutu itme, ladder/pipe
  tırmanma, duvar zıplama.
- Boss seviyesi, daha fazla düşman tipi/davranış.
- Gizli toplama (star/jewel), zaman saldırısı, kozmetik karakter seçimi.
- Hub dünya veya seviye seçim haritası.
- Daha zengin kamera senaryoları (authored kamera bölgeleri).

## 11. Forge platform uyumu (mevcut vs gereken)

Bu oyun Forge'un bir **klonunda** geliştirilecek (§12). 3B platformer, Forge'un
**aktif G1–G6 track'i**ne en yakın türdür; "gereken" işin çoğu mevcut sistemlerin
**genişletilmesi**dir, sıfırdan yeni motor değil.

**Mevcut (hazır / doğrudan kullanılır):**
- Kinematik karakter hareketi: yerçekimi+zıplama (`verticalMotion`), AABB
  çarpışma/slide (`collision`), kameraya-göreli kontrol.
- 3. şahıs game mode (`gameModes/tpsCharacterGameMode`) + takip/spring-arm kamera.
- Locomotion animasyon (`locomotionAnimation`), skeletal pipeline, montage +
  animation notify (saldırı penceresi), ragdoll (ölüm).
- Game Rules (can/koleksiyon/objektif/win-lose, HUD alanları).
- Input (klavye/fare/gamepad/dokunmatik), layout-driven levels + editör
  yerleştirme/snapping, spatial audio v1.

**Gereken (yeni iş — çoğunlukla genişletme):**
- **Platformer hareket ekstraları** (çift zıplama, coyote time, jump buffer,
  değişken yükseklik, platform taşıma, spring) — oyun tarafı (`src/game/*`),
  saf + test edilebilir, mevcut controller'a eklenir.
- **Savaş:** stomp tespiti + dönüş saldırısı hitbox (montage/notify ile),
  kırılabilir sandık + koleksiyon düşürme.
- **Basit düşman davranışı** (devriye + temas hasar) — `behaviors.ts` / actor
  script üstüne.
- **Hareketli platform / spring / tehlike / checkpoint tetikleyici metadata** —
  mümkünse mevcut alanlarla; yeni alan gerekirse saveValidator allowlist (gotcha).
- **(Platform, opsiyonel)** Hareketli platform taşıma ve "kill-plane/void"
  yardımcıları Forge'da genel olarak faydalı olabilir.

## 12. Repo ve mimari sınır

- **Oyun ayrı bir repoda** (Forge'un git klonu) geliştirilir. Forge'da yapılan
  engine/editor değişiklikleri oyun projelerine **upstream** olarak çekilebilir;
  oyun projesindeki değişiklikler (seviye layout'ları, platformer game rules/UI,
  hareket/savaş oyun kodu) Forge'a geri gitmez. (Önemli istisna: bu türde bazı
  hareket ekstraları genel platform değeri taşırsa, **Forge'da** yapılıp klona
  akması tercih edilir — §11.)
- Forge sınır kuralı korunur: gameplay kuralları `src/game/*` + sahne verisinde
  yaşar, `engine/` veya `editor/` içine girmez. Game Mode (`RuntimeSceneApp`)
  asla `editor/*` import etmez.
- Bu GDD Forge `docs/planned/` altında durur çünkü hem oyun planını hem de
  gerektirdiği Forge platform işini (§11) belgeler; oyun klonunda kendi kopyası
  tutulabilir. (Aynı yaklaşım kardeş GDD'lerde.)

## 13. Riskler ve açık sorular

- **Zıplama hissi:** Coyote/jump-buffer/değişken yükseklik katsayıları yoğun
  iterasyon ister; "hisli zıplama" Faz 0'ın 1 numaralı kabul kriteri olmalı.
- **Kamera + lineer framing:** Arkadan kamera ile kör zıplamayı önlemek için
  authored framing ipuçları gerekebilir; çarpışma/iç-içe geçme (spring-arm) test.
- **Hareketli platform taşıma:** Kinematik controller'da platform delta aktarımı
  + kenar tutunma köşe durumları (titreme/kayma) dikkatli test ister.
- **Savaş okunabilirliği:** Stomp "yalnız üstten" ve spin hitbox süresi adil
  olmalı; notify pencere zamanlaması.
- **Açık soru:** Sağlık modeli **tek-vuruş + can** mı, yoksa **küçük sağlık
  çubuğu + can** mı? (Öneri: tek-vuruş + can, klasik Crash hissi; cömert
  checkpoint.)
- **Açık soru:** Karakter asseti **mini/blocky-characters** (rig'li, animasyonlu)
  mı, yoksa platformer-kit **character-oo*i** (stil uyumu) mu? (Öneri:
  mini/blocky-characters — locomotion + saldırı animasyonu için.)
- **Açık soru:** v1 tema **tek tema** (grass) mı, yoksa grass+snow karışık mı?
  (Öneri: Faz 0 grass; snow Faz 1'de ikinci seviye teması.)

## 14. Kapsam dışı (v1)

- Açık dünya / hub / serbest kamera keşif (lineer Crash-vari seçildi).
- Bulmaca yetenek ağacı, anahtar-kapı zincirleri, kutu-itme bulmacaları (v1.x).
- Boss savaşları, karmaşık düşman AI / sürü.
- Online/çok oyunculu, liderlik tablosu.
- Prosedürel seviye üretimi.
- Mağaza / ilerleme / meta sistemleri.
