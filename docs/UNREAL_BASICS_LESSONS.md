# Forge - Unreal Basics Mimari Dersleri

> Tarih: 2026-06-16  
> Amaç: Unreal Engine Basics dokümantasyonundan Forge projesi için doğrudan uygulanabilir mimari dersler çıkarmak.  
> Kapsam: Projects & Templates, Content Browser, Actors & Components, Levels / World Settings, Playing & Simulating, Packaging.

> **Bu doküman aynı zamanda projenin kanonik yol haritasıdır.** İki irtifa
> taşır: en üstteki **"Aktif Yürütme Track'i"** yakın-dönem işi (şu an
> Gameplay/Runtime, G1–G6) küçük yeşil-gate'li parçalar + Progress Log olarak
> tutar; aşağıdaki **§1–§6 mimari dersleri** kuzey yıldızı + backlog'dur. Eski
> `docs/IMPROVEMENT_CHECKLIST.md` (5 cleanup maddesi) tamamlandı ve kaldırıldı;
> geçmişi git'te.

---

## Ana Sonuç

Forge, Unreal Engine'in özelliklerini birebir kopyalamamalı. Kopyalanması gereken şey Unreal'ın mimari ayrımlarıdır:

```text
Project ≠ Level
Asset ≠ Actor
Actor ≠ Component
Editor State ≠ Runtime State
Layout Data ≠ Save Game Data
Development Build ≠ Production Package
```

Forge için doğru yön:

```text
Forge
= reusable Three.js game template
+ built-in dev editor mode
+ project-local public data
+ manifest-driven assets
+ layout-driven levels
+ component-based scene objects
+ runtime-only production package
```

---

# Aktif Yürütme Track'i — Gameplay / Runtime

> Bu bölüm, aşağıdaki §1–§6 mimari derslerinin üstüne oturan **yakın-dönem
> yürütme listesidir**. §1–§6 "nereye gidiyoruz"u, bu bölüm "şimdi ne
> yapıyoruz"u tutar. Eski `IMPROVEMENT_CHECKLIST.md` ile aynı sözleşme formatı:
> her madde kendi kendine yeterli — problem, mevcut kanıt (`file:line`), plan,
> kabul kriteri, doğrulama.

## Hedef

Runtime'ı "düzlemde kayan ve temasta ses çıkaran bir karakter"den, template'in
değerini gösteren küçük ama gerçekten oynanabilir bir 3. şahıs örneğe çevirmek:
kameraya-göreli hareket, yerçekimi + zıplama, çarpışma yanıtı, takip kamerası,
harekete bağlı animasyon ve authored bir level.

## Durum Lejantı

- `[ ]` başlanmadı
- `[~]` devam ediyor (nerede durduğu Progress Log'da)
- `[x]` bitti ve doğrulandı

Her `[x]` öncesi değişmez gate:

```bash
npx tsc --noEmit        # temiz olmalı
npm run test:engine     # tüm check'ler (şu an 59) geçmeli
npm run build           # başarılı olmalı
# veya birleşik: npm run build:verify  (build + engine tests + strict dist scan)
```

Sınır kuralı (bkz. "En Kritik Kurallar"): gameplay kuralları `src/game/*` +
sahne verisinde yaşar, `engine/` veya `editor/` içine girmez. Game Mode
(`RuntimeSceneApp`) hiçbir zaman `editor/*` import etmez. Mümkün olduğunca saf,
headless-test edilebilir çekirdek çıkar (projenin yerleşik ritmi); Three.js/DOM
tutkalı shell'lerde ince kalır.

## Mevcut runtime taban çizgisi (kanıt)

- Davranışlar saf game kodu: `src/game/behaviors.ts` — `spin`, `input-move`
  (serbest XZ kayma, **normalize edilmemiş** diagonal, yön dönüşü yok),
  `collision-chime`.
- `BehaviorContext` (`engine/behavior/behaviorSubsystem.ts:24`) zaten `engine`
  (deltaSeconds), `actions` (ActionMap), `physics` (temas sorgusu), `audio`,
  `params` ve mutable `transform` veriyor — zengin hareket için iyi bir dikiş.
- Input bağlı: `RuntimeSceneApp.DEFAULT_INPUT_BINDINGS` WASD/ok → `move-*` ve
  **`Space` → `jump`**; ama `jump` şu an okunmuyor.
- Fizik (`engine/physics/physicsSubsystem.ts`) kinematik-position gövdelerle ve
  **dünya yerçekimi `(0,0,0)`** ile çalışır; sadece temas *raporlar* (Rapier ya
  da AABB fallback), behavior-sürücülü hareketi kısıtlamaz.
- Kamera **sabit** (`SceneRuntimeCore.SCENE_CAMERA_TARGET`); takip yok.
- Animasyon: yüklemede tek authored klip (`createSceneCharacterMixer`);
  harekete bağlı durum yok.

## Genel Bakış

| # | Madde | Bağımlılık | İlgili § | Durum |
|---|-------|-----------|----------|-------|
| G1 | Oyuncu hareket çekirdeği (normalize + yön) | — | §3 | `[x]` |
| G2 | Yerçekimi, zemin & zıplama | G1 | §3, §4 | `[ ]` |
| G3 | Çarpışma yanıtı (duvardan geçmeyi durdur) | G1 | §3 | `[ ]` |
| G4 | 3. şahıs takip kamerası + kameraya-göreli hareket | G1 | §5 | `[x]` |
| G5 | Harekete bağlı animasyon durumları | G1, G2 | §3 | `[ ]` |
| G6 | Authored oynanabilir örnek sahne | G1–G5 | §4, §5 | `[ ]` |

**Önerilen sıra:** G1 → G4 → (G1'i kameraya-göreli yap) → G2 → G3 → G5 → G6.
G1 ile başla: matematiği saf ve headless-test edilebilir, projenin
çıkar-ve-test ritmine uyar.

### G1 — Oyuncu hareket çekirdeği  `[x]`

**Problem.** `input-move` dünya-eksen pozisyon delta'sını doğrudan yazıyor:
diagonal ~1.41× fazla hızlı (normalize yok), karakter yöne dönmüyor, hız
yönetimi ad-hoc. Her gameplay maddesi bunun üstüne kurulur.

**Plan.**
1. `src/game/` içine saf hareket helper'ı (ör. `playerMovement.ts`):
   `planarMoveStep({ forward, back, left, right }, speed, dt) -> { dx, dz }`
   (diagonal normalize) ve `facingYawFromMove(dx, dz) -> yawDeg | null`
   (hareket yokken null → yön korunur).
2. `input-move` davranışını bununla yeniden yaz: dört `move-*` action'ı oku,
   `dx/dz`'yi `transform.position`'a uygula, `transform.rotation[1]`'i yöne
   çevir. `collision-chime` çağrısını koru.
3. (G4 sonrası) kamera yaw'ını besle → hareket kameraya-göreli olsun.

**Kabul.** Diagonal hız düz hıza eşit; karakter yönüne döner; `input-move`
dışında davranış değişmez. Headless testler normalize step + facing yaw'ı
(hareketsiz hold dahil) sabitler.

**Doğrulama.** `npm run build:verify` + manuel: `/` aç, WASD ile yürü.

### G2 — Yerçekimi, zemin & zıplama  `[ ]`

**Problem.** `jump` bağlı ama okunmuyor; dikey hareket/yerçekimi/zemin yok.
Dünya yerçekimi `(0,0,0)`.

**Plan.**
1. Saf dikey-durum helper'ı: `velocityY` izle, tick başına yerçekimi uygula,
   `actions.pressed("jump")` (edge, held değil) **ve** grounded iken jump impulse
   ekle, zemine clamp et (önce `y = floorY`, sonra ray/AABB probe). Yeni `y` +
   `grounded` döndür.
2. Davranışlar bugün stateless fonksiyonlar — dikey durumu `entityId` ile
   module-scope map'te tut (`collisionAudioPlayed` gibi) veya behavior instance
   state'i genişlet.
3. **Yerçekimi kaynağı (§4 düzeltmesi):** yerçekimini behavior'a gömme,
   layout `worldSettings`'ten oku. Mevcut `LayoutWorldSettings`
   (`engine/scene/layout.ts:108`) yalnızca gölge+arka plan taşıyor → **minimal
   additive** yaklaşım: düz `worldSettings`'e tek `gravity?: [x,y,z]` ekle (tam
   `world` şema-2 göçü değil — o §4/B4). Yeni alan **save-validator allowlist**'e
   (`tools/saveValidator.ts`) eklenmeli, yoksa kayıtta sessizce düşer
   (CLAUDE.md "allowlist gotcha").

**Kabul.** Zeminde grounded; Space ile yüksel-düş-yeniden grounded; havadayken
çift zıplama yok. Headless testler yerçekimi/zıplama/iniş state machine'ini
deterministik sabitler.

**Doğrulama.** `npm run build:verify` + `/` üzerinde manuel zıplama.

**Açık soru.** Zemin algısı: önce sabit `floorY` (basit/deterministik) vs.
fizik aşağı-ray (proplar üstünde doğru). G3 inerken karar ver.

### G3 — Çarpışma yanıtı (duvardan geçmeyi durdur)  `[ ]`

**Problem.** Hareket kısıtsız — oyuncu duvardan geçer; fizik yalnızca temas
raporlar (ses için kullanılıyor), hareketi engellemez.

**Plan (yaklaşım kararı — Açık Sorular).**
1. A Seçeneği (deterministik, test edilebilir): önerilen hareketi statik
   collider AABB'lerine karşı saf TS'te çöz (engellenen eksende kaydır), fiziğin
   zaten türettiği collider datasını kullan. Headless test ekle.
2. B Seçeneği: oyuncuyu Rapier kinematik karakter controller (KCC) ile sür —
   kapsül-vs-dünya kayması. Daha doğru, unit-test'i zor, Rapier'ı oyuncu
   path'ine sokar.
3. Hangisi olursa olsun: temas-sürücülü chime çalışmaya devam etsin.

**Kabul.** Oyuncu statik collider'lardan geçemez; duvar boyunca kayma akıcı;
chime hâlâ çalar.

**Doğrulama.** `npm run build:verify` + manuel: `/` üzerinde duvara yürü.

**Açık soru.** Saf AABB resolve (test/determinizm için önce bu) vs. Rapier KCC
(zengin, sonra). Önce A, gerekirse B.

### G4 — 3. şahıs takip kamerası + kameraya-göreli hareket  `[x]`

**Problem.** Kamera sabit; hareket dünya-eksen. Oynanabilir örnek için oyuncuyu
takip eden ve baktığı yöne göre hareket veren bir kamera gerekir.

**Plan.**
1. Saf kamera helper'ı: oyuncu pozisyonu + yaw/offset verince istenen kamera
   pozisyonu + look target hesapla (smoothing/lerp param olarak).
2. `RuntimeSceneApp` frame loop'una bağla (editör değil, runtime shell): her
   tick oyuncu entity'sini takip et. `SceneApp` (editör) kamerası dokunulmaz.
3. Kamera yaw'ını G1'e geri besle → `move-forward` "ekrana doğru" olsun.

**Kabul.** Kamera oyuncuyu akıcı takip eder; WASD kameraya-göreli; editör
viewport kamerası değişmez. Headless testler kamera-target matematiğini sabitler.

**Doğrulama.** `npm run build:verify` + `/` üzerinde manuel.

### G5 — Harekete bağlı animasyon durumları  `[ ]`

**Problem.** Yalnızca yüklemede tek klip oynuyor; karakter hareketle animasyon
değiştirmiyor (idle/walk/run/jump).

**Plan.**
1. Runtime durumunu (düzlem hız büyüklüğü, G2'den `grounded`) bir klibe eşle:
   idle ↔ walk ↔ run + jump/fall. Saf durum→klip seçici, test edilir.
2. Seçiciden `AnimationMixer`'ı crossfade ile sür (runtime shell). Karakter
   asset'inin gerekli klipleri taşımasına bağlı — demo karakterin
   `gltf.animations`'ını denetle, isimleri seç/authorla.

**Kabul.** Duruyor=idle, hareket=walk/run, havada=jump/fall, akıcı geçişlerle.
Seçici mantığı headless test edilir.

**Doğrulama.** `npm run build:verify` + `/` üzerinde manuel.

**Açık soru.** Demo karakterde walk/run/jump klipleri var mı? Yoksa uygun bir
asset'e geç ya da G5'i idle/walk ile sınırla.

### G6 — Authored oynanabilir örnek sahne  `[ ]`

**Problem.** Demo sahne (`public/layouts/render-test-room.json`) statik bir
vitrin, oynanabilir bir level değil.

**Plan.**
1. Küçük bir level authorla: bir **player start** (authored data, §5), statik
   collider'lı duvar/zemin, birkaç prop, ve bir goal trigger.
2. **Goal trigger = mevcut sensor-collider + behavior** kalıbı (`collision-chime`
   zaten bu) — §3'ün tam `InteractionComponent`'ini bu aşamada **getirme** (o B4).
3. Bunu proje default scene yap (ya da ikinci layout ekle) → Game Mode uçtan uca
   oynanabilir bir şey yüklesin. Yeni placement/light alanı eklersen
   save-validator allowlist'ine uy.
4. (Opsiyonel) minimal HUD/status ("hedefe ulaş").

**§5 guardrail'i:** Play sırasında oluşan hiçbir runtime state layout'a
**otomatik yazılmaz**. `RuntimeSceneApp` zaten kaydetmiyor → şu an uyumluyuz;
bunu açık kural olarak koru. ("Keep Runtime Changes" / "Play From Here" = B4.)

**Kabul.** `/` yüklenince oynanabilir döngü: yürü, zıpla, duvardan geçemez,
hedefe ulaş → geri bildirim. Tüm gate'ler yeşil.

**Doğrulama.** `npm run build:verify` + `/` üzerinde manuel oynanış.

## Backlog (zamanlanmadı)

Yürütme track'i bittikçe buradan çekilir; detaylar yukarıdaki ilgili §'de.

- **B1 — Asset katalog / Content Browser UI** → §2 checklist (thumbnail,
  arama/kategori, placement-rule affordance, health-check).
- **B2 — `home-makeover`'ı template kopyası olarak yeniden kur** → §1 checklist
  (+ ileride `tools/create-project.mjs`).
- **B3 — Performans & araçlar** → §6 (perf overlay zenginleştirme,
  `dist-report.json`, `tools/cook-assets.mjs`).
- **B4 — Mimari evrim:** tam component-model (§3 — Actor `components[]`,
  Add/Remove Component, Interaction/Particle), `worldSettings` şema-2 / iç içe
  `world` modeli (§4), PlaySession araçları / Play From Here / Simulate Mode
  (§5). Gameplay track'i bunları **gerektirmez**; G1–G6 minimal kalıplarla ilerler.

## Progress Log

Yeni kayıtları en üste ekle. Kaydet: tarih, madde #, ne değişti, nerede durdu,
alınan karar (sonraki oturum yeniden tartışmasın).

- *2026-06-16* — **G4 bitti (3. şahıs takip kamerası).** Yeni saf helper
  `src/game/followCamera.ts`: `desiredFollowPose(playerPos, {offset, lookHeight})`,
  `smoothingFactor(rate, dt)` (framerate-bağımsız `1-e^(-rate*dt)`, dejenere
  girişte 0), `lerpVec3` (t∈[0,1] clamp) ve `stepFollowCamera(prev, playerPos,
  config, t)` (prev null → ilk frame'de snap, sonra position+target ease).
  `RuntimeSceneApp` (runtime shell) frame loop'una bağlandı: `input-move`'lu ilk
  karakter = oyuncu, kamera her tick onu pürüzsüz takip eder (offset `[0,1.2,2.6]`,
  rate 8); editör `SceneApp` kamerası dokunulmadı (boundary). Kamera sabit
  yönelimli ve dünya eksenlerine hizalı (−z'ye bakar) → mevcut dünya-eksen WASD
  **kameraya-göreli** okunur (W = ekrana doğru); davranış kodu değişmedi.
  Headless testler eklendi (tools/engine-tests.ts: 65 → 69 check). `npm run
  build:verify` yeşil (build + 69 check + strict dist scan). **Karar:** bağımsız
  kamera yaw'ı (mouse-orbit) + yaw'ı G1'e geri besleme bilinçli olarak ertelendi;
  kamera dönmediği için şu an gerekmiyor. Orbit eklenince devreye girecek — bu,
  sıradaki **"(G1'i kameraya-göreli yap)"** adımı. Sonraki yürütme: **G2**
  (yerçekimi, zemin & zıplama).
- *2026-06-16* — **G1 bitti (oyuncu hareket çekirdeği).** Yeni saf helper
  `src/game/playerMovement.ts`: `planarMoveStep({forward,back,left,right}, speed,
  dt) -> {dx,dz}` (raw yön normalize edilip `speed*dt` ile ölçeklenir → diagonal
  artık düz hızla eşit; karşıt tuşlar iptal; dt/speed ≤ 0 → sıfır) ve
  `facingYawFromMove(dx,dz) -> yawDeg|null` (`atan2(-dx,-dz)` derece; hareketsizken
  null → yön korunur). `input-move` davranışı (`src/game/behaviors.ts`) bu
  helper'larla yeniden yazıldı: dört `move-*` action'ı okur, `dx/dz`'yi
  `position`'a, yaw'ı `rotation[1]`'e yazar; `playCollisionAudioOnce` korundu.
  Başka davranış değişmedi. Headless testler eklendi (tools/engine-tests.ts:
  59 → 65 check) — tek-eksen=speed*dt, diagonal-normalize, iptal/sıfır, kardinal
  yaw, idle-null hold, ve gerçek `input-move` entegrasyonu (diagonal+facing+idle
  hold). `npm run build:verify` yeşil (build + 65 check + strict dist scan).
  **Karar:** kamera-göreli yön G4'e bırakıldı (yön şimdilik dünya-eksen); G2
  bunun üstüne yerçekimi/zıplama ekler. Sıradaki: önerilen sıraya göre **G4**.
- *2026-06-16* — **Yol haritası birleştirildi.** Cleanup sonrası
  Gameplay/Runtime track'ine geçildi. Ayrı `docs/ROADMAP.md` taslağı bu dokümana
  katıldı (tek kaynak, `UNREAL_BASICS_LESSONS.md`); §1–§6 mimari dersleri
  kuzey-yıldızı/backlog, bu bölüm aktif yürütme oldu. Unreal-dersleri
  değerlendirmesinden iki düzeltme işlendi: G2 yerçekimini `worldSettings`'ten
  okuyacak (minimal-additive, şema-2 göçü değil; allowlist notu), G6 player-start
  authored + runtime-state asla layout'a yazılmaz guardrail'i (§5). Runtime taban
  çizgisi belgelendi; oynanabilir-örnek hedefi G1–G6'ya bölündü (sıra
  G1 → G4 → G2 → G3 → G5 → G6). Henüz gameplay kodu değişmedi; sıradaki aksiyon
  **G1 (oyuncu hareket çekirdeği)** — saf, headless-test edilebilir.

---

# 1. Projects & Templates

## Unreal'dan Alınan Ders

Unreal'da proje, oyunun içeriklerini, ayarlarını ve proje kimliğini taşıyan ana kaptır. Template ise yeni projeler için başlangıç noktasıdır.

Forge için bunun karşılığı:

```text
Unreal:
MyGame.uproject

Forge:
public/project.3dgame.json
```

## Forge Kararı

`project.3dgame.json`, Forge'un `.uproject` karşılığı kabul edilmeli.

Bu dosya şunları taşımalı:

```text
- proje adı
- proje tipi
- entry point
- publicDir
- default scene
- asset manifest yolu
- editor başlangıç ayarları
- build/package script referansları
- output/dist bilgisi
```

Ama şunları taşımamalı:

```text
- level içindeki actor listesi
- world lighting/fog/physics ayarları
- oyuncunun save-game ilerlemesi
- runtime spawned actor state'i
- editor panel state'i
```

## Template Modeli

Forge için en sağlam başlangıç modeli:

```text
Yeni oyun = Forge template repo kopyası
```

Örnek:

```text
ForgeTemplate/
  public/project.3dgame.json
  public/layouts/render-test-room.json
  public/assets/manifest.json
  src/
  engine/
  editor/
  game/
  builder/
  package.json

HomeMakeover/
  aynı kod tabanı
  farklı project.3dgame.json
  farklı assets/layouts
  farklı game rules/UI
```

## Project Browser / Launcher Kararı

Şimdilik Project Browser veya Launcher route'u geri getirilmemeli. Daha önce editor ve oyun projesini ayrı klasörlerde haberleştirme denemesi sorun çıkardı. Bu yüzden mevcut tek-codebase/kopya repo modeli korunmalı.

İleride düşük riskli araç:

```bash
node tools/create-project.mjs
```

Bu script:

```text
- template klasörünü kopyalar
- project.3dgame.json name alanını değiştirir
- package.json name alanını değiştirir
- örnek layout/assets temizleme seçeneği sunar
- npm install opsiyonu sunar
```

## Checklist

```md
# Projects & Templates Checklist

- [ ] `project.3dgame.json` dosyasını Forge'un resmi `.uproject` karşılığı kabul et.
- [ ] Yeni oyun oluşturma modelini "template repo kopyala + manifest değiştir" olarak koru.
- [ ] Şimdilik Project Browser / Launcher route'u geri getirme.
- [ ] İleride ayrı bir `tools/create-project.mjs` script'i yaz.
- [ ] Script şunları yapmalı:
  - template klasörünü kopyala
  - `project.3dgame.json.name` alanını değiştir
  - `package.json.name` alanını değiştir
  - örnek layout/assets temizleme seçeneği sun
- [ ] Content Browser'ı veritabanı gibi değil, `public/assets` ve `public/layouts` disk yapısının yansıması olarak geliştir.
- [ ] Template içine çalışan örnek sahne, minimum asset manifest ve paketlenebilir runtime bırak.
- [ ] Production build kuralını koru: editor UI, authoring middleware, GDD ve raw authoring dosyaları `dist/` içine girmemeli.
```

---

# 2. Content Browser

## Unreal'dan Alınan Ders

Unreal'da Content Browser sadece dosya gezgini değildir. Asset oluşturma, import etme, klasörleme, arama, filtreleme, koleksiyonlama, asset migration ve asset sağlık kontrolü gibi işlerin merkezidir.

Forge için karşılığı:

```text
Content Browser
= manifest tabanlı asset katalog arayüzü
+ public/assets dosya ağacı görünümü
+ arama/filtreleme
+ thumbnail/metadata gösterimi
+ viewport'a güvenli asset placement başlatma
+ asset sağlık uyarıları
```

## Ana Veri Kaynağı

Forge Content Browser'ın gerçek kaynağı:

```text
public/assets/manifest.json
```

Disk yapısı:

```text
public/assets/
  manifest.json
  metadata-schema.json
  models/
  textures/
  thumbnails/
  audio/
  prefabs/
  fx/
```

## Asset ID Kuralı

Layout dosyalarına absolute path yazılmamalı.

Yanlış:

```json
{
  "model": "C:/Users/emre/Desktop/game/public/assets/models/chair.glb"
}
```

Doğru:

```json
{
  "assetId": "props.chair_wood_01"
}
```

Runtime final dosya yolunu manifest üzerinden çözer.

## Üç Veri Katmanı

Content Browser şu üç katmanı karıştırmamalı:

```text
1. Dosya sistemi
   public/assets/models/chair.glb
   public/assets/textures/wood.webp

2. Asset manifest
   id, type, path, thumbnail, category, tags, placement rules

3. Editor görünümü
   seçili klasör, arama, filtre, thumbnail boyutu, favoriler
```

## Önerilen Manifest Entry

```json
{
  "id": "furniture.sofa_01",
  "name": "Sofa 01",
  "type": "model",
  "category": "furniture",
  "path": "assets/models/furniture/sofa_01.glb",
  "thumbnail": "assets/thumbnails/furniture/sofa_01.webp",
  "tags": ["sofa", "living-room", "seat"],
  "placeable": true,
  "placement": {
    "surface": "floor",
    "snap": true
  },
  "runtime": {
    "castShadow": true,
    "collision": true
  }
}
```

## Asset Placement Akışı

```text
Content Browser asset kartı
  ↓ drag/drop veya click-place
Viewport placement mode
  ↓
LayoutPlacement / Actor oluştur
  ↓
layout JSON içine assetId + transform yaz
  ↓
runtime loader assetId'yi manifest'ten çözer
```

## Import Sistemi Kararı

Editor içine hemen tam import sistemi eklenmemeli.

Daha doğru sıra:

```text
Aşama 1:
- Assetleri elle public/assets içine koy
- manifest.json elle veya script ile güncelle
- Content Browser manifest'ten okusun

Aşama 2:
- tools/import-asset.mjs script'i ekle
- GLB dosyasını assets/models içine kopyalasın
- thumbnail yolu oluştursun
- manifest entry eklesin

Aşama 3:
- Editor içinde Import butonu
- Dosya seçtir
- Dev middleware ile public/assets içine yaz
- Manifest'i güncelle
```

## Asset Health Check

Content Browser asset kartında şu uyarılar görünmeli:

```text
⚠ thumbnail missing
⚠ model path missing
⚠ too many triangles
⚠ no collision setting
⚠ texture too large
⚠ unsupported extension
⚠ asset in manifest but file missing
⚠ file exists but not in manifest
```

## Checklist

```md
# Content Browser Checklist

- [ ] `public/assets/manifest.json` dosyasını Content Browser'ın ana veri kaynağı yap.
- [ ] Layout dosyalarına absolute file path yazmayı yasakla; sadece `assetId` veya manifest referansı yaz.
- [ ] Asset manifest entry'lerini standartlaştır:
  - `id`
  - `name`
  - `type`
  - `category`
  - `path`
  - `thumbnail`
  - `tags`
  - `placeable`
  - `placement`
  - `runtime`
- [ ] Content Browser UI'ı dört ana parçaya böl:
  - Sources / folder tree
  - Search
  - Type/category filters
  - Asset cards / Asset View
- [ ] Asset kartlarında thumbnail + type + category + temel metadata göster.
- [ ] Asset drag-drop akışını `assetId -> Actor/LayoutPlacement -> runtime loader` şeklinde kur.
- [ ] `public/assets/metadata-schema.json` ile Details panel metadata alanlarını Content Browser metadata'sından ayrı ama uyumlu tut.
- [ ] Basit health-check uyarıları ekle:
  - manifest path missing
  - thumbnail missing
  - unsupported file type
  - texture too large
  - high poly model
  - missing placement rule
- [ ] Collections sistemini hemen yapma; önce Favorites / Recently Used gibi küçük bir ID listesiyle başla.
- [ ] Editor içi import sistemini ertele; önce `tools/import-asset.mjs` gibi script tabanlı import düşün.
```

---

# 3. Actors & Components

## Unreal'dan Alınan Ders

Unreal'da Actor, level içine yerleştirilebilen temel sahne nesnesidir. Actor kendi başına her şeyi yapmaz; render, collision, audio, light, particle, interaction gibi işler Component'ler üzerinden çalışır.

Forge için ana ders:

```text
Asset başka şeydir.
Actor / SceneObject başka şeydir.
Actor'ın davranışı Component'lerle taşınmalıdır.
```

## Forge Actor Karşılığı

Asset:

```json
{
  "id": "furniture.sofa_01",
  "path": "assets/models/sofa_01.glb"
}
```

Sahnedeki Actor / SceneObject:

```json
{
  "id": "actor_1042",
  "type": "actor",
  "components": [
    {
      "kind": "transform",
      "position": [2, 0, -4],
      "rotation": [0, 90, 0],
      "scale": [1, 1, 1]
    },
    {
      "kind": "render",
      "assetId": "furniture.sofa_01"
    }
  ]
}
```

## Three.js Object3D Kararı

Three.js `Object3D`, Actor modelinin kendisi yapılmamalı.

Doğru akış:

```text
Layout JSON
   ↓
Actor / Entity data
   ↓
Components
   ↓
Systems
   ↓
Three.js Object3D + physics body + audio node
```

Layout içinde runtime objesi saklanmaz.

## Resmi Component Listesi

Başlangıç için Forge component ailesi:

```ts
type ActorComponent =
  | TransformComponent
  | RenderComponent
  | LightComponent
  | ParticleEmitterComponent
  | ColliderComponent
  | AudioComponent
  | InteractionComponent
  | BehaviorComponent
  | MetadataComponent;
```

## Component Sorumlulukları

### TransformComponent

```text
- Her Actor'da zorunlu
- position
- rotation
- scale
- parent/child/pivot sistemi buna bağlanır
```

### RenderComponent

```text
- assetId
- visible
- castShadow
- receiveShadow
- materialOverride?
- lod?
```

### LightComponent

```text
- lightType: directional | point | spot | ambient
- color
- intensity
- range?
- angle?
- penumbra?
- castShadow
- shadowQuality?
```

Örnek:

```json
{
  "kind": "light",
  "lightType": "point",
  "color": "#ffd8a8",
  "intensity": 3,
  "range": 8,
  "castShadow": false
}
```

### ParticleEmitterComponent

```text
- effectId
- loop
- rate
- lifetime
- startSize
- endSize
- velocity
- spread
- materialMode
- worldSpace
- autoPlay
```

Örnek:

```json
{
  "kind": "particleEmitter",
  "effectId": "fx.smoke_soft_01",
  "loop": true,
  "rate": 12,
  "lifetime": 2.5,
  "startSize": 0.4,
  "endSize": 1.2,
  "velocity": [0, 1.2, 0],
  "spread": 0.35,
  "autoPlay": true
}
```

### ColliderComponent

```text
- enabled
- shape: box | sphere | capsule | mesh
- isTrigger
- layer
- size?
- offset?
```

### AudioComponent

```text
- eventId
- autoPlay
- loop
- volume
- spatial
- range?
```

### InteractionComponent

```text
- action
- prompt
- enabled
- requires?
- cooldown?
```

### BehaviorComponent

```text
- behaviorId
- params
- proje özel davranışı editor içine gömülmez
- runtime game code yorumlar
```

### MetadataComponent

```text
- schema-driven gameplay metadata ile uyumlu
- plain JSON
- runtime game rules tarafından yorumlanır
```

## Runtime System Listesi

```text
RenderSystem
  TransformComponent + RenderComponent okur

LightSystem
  TransformComponent + LightComponent okur

ParticleSystem / VFXSystem
  TransformComponent + ParticleEmitterComponent okur

PhysicsSystem
  TransformComponent + ColliderComponent okur

AudioSystem
  TransformComponent + AudioComponent okur

InteractionSystem
  InteractionComponent + ColliderComponent okur

BehaviorSystem
  BehaviorComponent + MetadataComponent okur
```

## Geçiş Planı

Mevcut `LayoutPlacement`, `LayoutCharacter`, `LayoutLightActor` tipleri hemen kırılmamalı.

Önce ortak base:

```ts
type SceneObjectBase = {
  id: string;
  name?: string;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  metadata?: Record<string, unknown>;
};
```

Sonra optional component alanı:

```ts
type SceneObjectBase = {
  id: string;
  name?: string;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  metadata?: Record<string, unknown>;
  components?: ActorComponent[];
};
```

Adapter:

```text
assetId             → RenderComponent
LayoutLightActor    → LightComponent
collision           → ColliderComponent
metadata            → MetadataComponent
```

## Checklist

```md
# Actors & Components Checklist

- [ ] `Asset` ile `Actor / SceneObject` ayrımını resmi mimari kural yap.
- [ ] Three.js `Object3D` nesnesini Actor modelinin kendisi yapma.
- [ ] Layout dosyalarının sadece stable ID, transform, component datası ve asset referansı tutmasını sağla.
- [ ] Editor-only state'i Actor/Component datasına karıştırma.
- [ ] İlk resmi component listesini tanımla:
  - TransformComponent
  - RenderComponent
  - LightComponent
  - ParticleEmitterComponent
  - ColliderComponent
  - AudioComponent
  - InteractionComponent
  - BehaviorComponent
  - MetadataComponent
- [ ] Light Actor'ları uzun vadede `TransformComponent + LightComponent` olarak temsil et.
- [ ] Particle efektleri `ParticleEmitterComponent` üzerinden modelle.
- [ ] `ParticleEmitterComponent.effectId` alanını manifest'teki particle/fx asset'e bağla.
- [ ] Outliner Actor/SceneObject listelemeli; Component'ler ana outliner nesnesi gibi davranmamalı.
- [ ] Details panel Component editor'a dönüşmeli.
- [ ] Add Component / Remove Component sistemi ekle.
- [ ] Zorunlu `TransformComponent` silinemez olsun.
- [ ] Component değişiklikleri undo/redo command üzerinden çalışsın.
- [ ] Runtime tarafında component'leri class inheritance yerine sistemler yorumlasın.
- [ ] Mevcut `LayoutPlacement`, `LayoutCharacter`, `LayoutLightActor` tiplerini hemen kırma.
- [ ] Önce ortak `SceneObjectBase`, sonra optional `components?: ActorComponent[]` ekle.
- [ ] Yeni layout alanları eklenirse save validator allowlist'ini güncelle.
```

---

# 4. Levels / World Settings

## Unreal'dan Alınan Ders

Unreal'da Level, Actor'ların yerleştirildiği sahnedir. World Settings ise o Level'a özel environment, gameplay ve runtime ayarlarını taşır.

Forge için ana ayrım:

```text
Level = layout dosyası
World Settings = layout'un çalışma ortamı ayarları
Project Manifest = proje kimliği ve başlangıç config'i
```

## Forge Level Karşılığı

```text
Unreal:
Content/Maps/Main.umap

Forge:
public/layouts/main.json
```

Level / Layout şunları temsil eder:

```text
- sahnedeki Actor / SceneObject instance'ları
- transformlar
- assetId referansları
- light actor'lar
- trigger/volume gibi authored object'ler
- per-level world settings
```

Şunları temsil etmez:

```text
- proje kimliği
- build ayarları
- npm scriptleri
- oyuncunun kayıtlı ilerlemesi
- runtime'da spawn edilmiş geçici objeler
- editor panel state'i
```

## World Settings Layout'a Ait Olmalı

Örnek:

```json
{
  "schema": 2,
  "id": "level.main_house",
  "name": "Main House",
  "world": {
    "gameMode": "homeMakeover.default",
    "background": {
      "type": "color",
      "color": "#b8d7ff"
    },
    "ambient": {
      "color": "#ffffff",
      "intensity": 0.7
    },
    "physics": {
      "gravity": [0, -9.81, 0]
    },
    "navigation": {
      "enabled": false
    }
  },
  "actors": []
}
```

## Üç Ayrı Dosya Sorumluluğu

```text
project.3dgame.json
  → hangi level açılacak?
  → asset manifest nerede?
  → build output nerede?

layouts/main.json
  → bu level'da ne var?
  → dünya nasıl davranıyor?

save/slot_01.json
  → oyuncu bu level'da ne yaptı?
```

## World Settings Veri Modeli

Başlangıç önerisi:

```ts
type ForgeWorldSettings = {
  gameMode?: string;

  background?: {
    type: "color" | "skybox" | "texture";
    color?: string;
    assetId?: string;
  };

  ambient?: {
    color: string;
    intensity: number;
  };

  fog?: {
    enabled: boolean;
    color?: string;
    near?: number;
    far?: number;
    density?: number;
  };

  physics?: {
    enabled?: boolean;
    gravity?: [number, number, number];
  };

  navigation?: {
    enabled: boolean;
    agentRadius?: number;
    agentHeight?: number;
  };

  bounds?: {
    enabled: boolean;
    min?: [number, number, number];
    max?: [number, number, number];
    killZ?: number;
  };

  lighting?: {
    defaultSun?: boolean;
    shadowQuality?: "off" | "low" | "medium" | "high";
  };

  audio?: {
    ambientEventId?: string;
    reverbPreset?: string;
  };
};
```

## Level Data ≠ Save Game Data

Yanlış:

```json
{
  "actorId": "door_01",
  "openedByPlayer": true,
  "playerLooted": true
}
```

Bu layout dosyasına yazılmamalı.

Doğru ayrım:

```text
layout/main.json
- door_01 var
- interaction component var
- default locked/open state var

save/slot_01.json
- door_01 oyuncu tarafından açıldı
- chest_03 lootlandı
- mission_02 tamamlandı
```

## Checklist

```md
# Levels / World Settings Checklist

- [ ] `public/layouts/<name>.json` dosyasını Forge'un resmi Level karşılığı olarak tanımla.
- [ ] `project.3dgame.json` dosyasını Level dosyası gibi kullanma; proje kimliği ve editor/runtime başlangıç config'i olarak tut.
- [ ] Layout JSON içine `world` veya `worldSettings` alanı eklemeyi planla.
- [ ] World Settings'i per-level yap:
  - background
  - ambient
  - fog
  - physics gravity
  - bounds / killZ
  - navigation
  - lighting defaults
  - audio ambience
  - gameMode override
- [ ] Grid/snap gibi editor authoring tercihlerini World Settings ile karıştırma.
- [ ] Scene Outliner'ın aktif layout actor ağacını gösterdiğini netleştir.
- [ ] Runtime spawned actor'ların debug'da görünebileceğini ama layout'a otomatik kaydedilmemesi gerektiğini kural yap.
- [ ] `defaultScene`, `startupScene`, `activeScene` kavramlarını ileride ayırmaya hazır ol.
- [ ] Level Streaming/Sublevels sistemini şimdilik ertele; ama layout formatını ileride sublevel referansı alabilecek şekilde tasarla.
- [ ] Game Mode referansını World Settings altında düşün:
  - `world.gameMode`
  - `world.ruleset`
  - `world.spawnProfile`
- [ ] Game Mode davranışını editor core'a gömme; runtime game code yorumlasın.
- [ ] Level/Layout data ile Save Game data ayrımını resmi kural yap.
- [ ] Yeni layout alanları eklenirse save validator allowlist'ini güncelle.
- [ ] World Settings değişikliklerini undo/redo command veya açık autosave politikasıyla yönet.
```

---

# 5. Playing & Simulating

## Unreal'dan Alınan Ders

Unreal'da Play In Editor, oyunu editör içinden oyuncu gibi test etmeyi sağlar. Simulate In Editor ise oyuncu kontrolüne geçmeden physics/gameplay sistemlerini editör araçları açıkken çalıştırmayı sağlar.

Forge için ana ders:

```text
Play/Test sistemi sadece oyunu başlat butonu değildir.
Editördeki authored layout ile runtime session state arasına güvenli sınır koyan mimari katmandır.
```

## Mevcut Forge Play Modeli

```text
Editor Mode
  ↓ Save current layout
public/layouts/main.json
  ↓ Open /
Game Mode
  ↓ RuntimeSceneApp loads layout
Play Session starts
```

Bu doğru yöndür.

## Resmi Kavram: PlaySession

```text
PlaySession
= kaydedilmiş layout'un Game Mode'da çalıştırılan geçici runtime kopyası
```

Play sırasında oluşan değişiklikler otomatik olarak layout'a yazılmamalı:

```text
- oyuncu kapıyı açtı
- düşman spawn oldu
- particle patladı
- fizik objesi devrildi
- mission tamamlandı
```

Bunlar Play Session State'tir.

## Üç State Ayrımı

```text
Authoring State
= layout dosyasında kalıcı olan tasarım verisi

Play Session State
= oyun route'unda geçici çalışan runtime veri

Simulation State
= editor viewport içinde geçici çalışan runtime veri
```

## Keep Runtime Changes

İleride eklenebilecek bilinçli özellik:

```text
Keep Runtime Changes
= runtime'da değişen authored actor property'lerini seçerek layout'a aktarma
```

Kurallar:

```text
- Sadece authored actor'lara uygulanır.
- Runtime spawned actor'lar layout'a otomatik alınmaz.
- Sadece allowlisted alanlar alınır.
- Değişiklik undo/redo command olarak uygulanır.
- Save ayrıca yapılır.
```

## Simulate Mode Kararı

Simulate Mode hemen yapılmamalı.

Daha doğru sıra:

```text
1. Play Session: / route'ta temiz runtime test
2. Runtime debug overlay
3. Pause / resume / restart session
4. Play From Here
5. Keep Runtime Changes
6. Simulate Mode: editor viewport içinde kontrollü simulation
```

## Play From Here

Düşük maliyetli, yüksek değerli özellik:

```text
Right click viewport → Play From Here
```

Bu layout'a yazılmamalı. Geçici session override olmalı.

Örnek:

```json
{
  "playOverride": {
    "spawnPosition": [4, 0, -2],
    "spawnRotation": [0, 180, 0]
  }
}
```

## Runtime Debug Controls

İleride:

```text
- Play
- Pause
- Resume
- Step Frame
- Restart
- Stop
```

Önerilen API:

```ts
type RuntimeSessionControls = {
  pause(): void;
  resume(): void;
  stepFrame(delta?: number): void;
  restart(): void;
  stop(): void;
};
```

## Checklist

```md
# Playing & Simulating Checklist

- [ ] Forge'da resmi kavram olarak `PlaySession` tanımla.
  - Kaynak: saved layout
  - Çalıştırıcı: RuntimeSceneApp
  - State: geçici runtime state

- [ ] Play akışını koru:
  - Editor current layout'u kaydeder.
  - Game route `/` açılır.
  - RuntimeSceneApp aynı layout'u yükler.
  - Editor code Game Mode'a import edilmez.

- [ ] Play sırasında oluşan runtime değişiklikleri layout'a otomatik yazma.
  - Physics sonuçları
  - Spawn edilen actor'lar
  - Mission/save progress
  - Particle/audio runtime state

- [ ] `Keep Runtime Changes` özelliğini ileride ayrı ve bilinçli komut olarak tasarla.
  - Sadece authored actor'lar.
  - Sadece allowlisted component/property alanları.
  - Runtime spawned actor'lar otomatik alınmaz.
  - Undo/redo command üzerinden uygulanır.

- [ ] `PlaySessionConfig` modeli düşün:
  - `openMode`: `newTab | sameTab | popup`
  - `saveBeforePlay`
  - `startLocation`: `defaultPlayerStart | editorCamera | custom`
  - `debugOverlay`
  - `playFromHere?`

- [ ] `Play From Here` özelliğini planla.
  - Viewport sağ tık noktasından başlat.
  - Layout'a yazma.
  - Sadece geçici session override kullan.

- [ ] Runtime debug kontrolleri eklemeyi planla:
  - Pause
  - Resume
  - Step Frame
  - Restart
  - Stop

- [ ] `Simulate Mode` kavramını şimdilik ertele ama mimari olarak hazır tut.
  - Editor viewport içinde runtime systems çalışır.
  - Editor araçları açık kalır.
  - Authoring state ve simulation state ayrılır.

- [ ] Possess / Eject kavramlarını TPS/FPS aşaması için not et.
  - Possess: player controller'a bağlan.
  - Eject: player'dan çık, debug/editor camera ile gözlemle.

- [ ] Multiplayer/network Play ayarlarını şimdilik kapsam dışı tut.
- [ ] Game Mode ve Editor Mode sınırını testlerle koru.
  - `npm run build:verify`
  - dist içinde editor UI/authoring middleware bulunmamalı.
```

---

# 6. Packaging

## Unreal'dan Alınan Ders

Unreal'da packaging; cooking, packaging, deploy ve run gibi ayrı aşamalardan oluşur. Amaç, hedef platform için sadece gerekli runtime çıktısını üretmektir.

Forge için ana ders:

```text
Packaging = build aldım, dist oluştu değildir.
Packaging = oyuncuya sadece runtime oyunu vermek, editörü ve geliştirme artıklarını kesin olarak dışarıda bırakmaktır.
```

## Forge Karşılığı

```text
Unreal:
File > Package Project > Platform

Forge:
npm run build
```

Ama yayın öncesi gerçek gate:

```bash
npm run build:verify
```

## Dist Kuralı

`dist/` sadece runtime dosyaları içermeli:

```text
- index.html
- bundled runtime JS/CSS
- runtime assets
- runtime manifest/layout data
```

`dist/` içinde şunlar bulunmamalı:

```text
- editor panels
- gizmo code
- outliner/details/content-browser UI
- /__save-layout server behavior
- /__project-dir server behavior
- docs/
- GDD
- raw blender/psd/krita files
- dev scripts
- source-only authoring assets
```

## Cook Karşılığı

Forge'da Unreal Cook karşılığı asset hazırlama pipeline'ıdır.

```text
GLB optimize
- Draco / Meshopt kararları
- texture resize
- texture compression / WebP / KTX2
- unused node/material temizliği
- thumbnail üretimi
- manifest doğrulama
- triangle/material uyarıları
```

İleride:

```json
{
  "scripts": {
    "cook": "node tools/cook-assets.mjs",
    "build": "tsc --noEmit && vite build",
    "package": "npm run cook && npm run build",
    "build:verify": "npm run package && npm run test:engine && npm run verify:dist -- --strict"
  }
}
```

## Public Klasörü Disiplini

`public/` içine sadece runtime'da gitmesinde sakınca olmayan dosyalar konmalı.

Doğru:

```text
public/assets/models/chair.glb
public/assets/textures/wall.webp
public/layouts/main.json
```

Yanlış:

```text
public/assets/source/chair.blend
public/assets/raw/concept.psd
public/internal/gdd.md
```

Raw kaynaklar ayrı yerde durmalı:

```text
authoring/
  blender/
  krita/
  psd/
  prompts/
  references/

public/
  assets/
  layouts/
  project.3dgame.json
```

## Verify Dist

Packaging gate şunları kontrol etmeli:

```text
dist içinde bulunmamalı:
- EditorUi
- editor-shell
- ScenePicker
- EditorCameraController
- outliner/details/content-browser CSS tokenları
- /__save-layout
- /__project-dir
```

## Dist Report

İleride `dist-report.json` üretmek faydalı olur:

```text
- total size
- JS chunks
- CSS size
- asset size by type
- top 20 largest files
- unused public files
- missing manifest refs
- editor leak scan result
```

## Checklist

```md
# Packaging Checklist

- [ ] `npm run build` komutunu Forge'un temel web package karşılığı olarak kabul et.
- [ ] Yayın öncesi asıl gate olarak `npm run build:verify` kullan.
- [ ] `dist/` çıktısının sadece runtime dosyaları içermesini kural yap:
  - `index.html`
  - runtime JS/CSS
  - runtime assetler
  - runtime layout/manifest data

- [ ] `dist/` içinde şunların bulunmasını yasakla:
  - editor UI
  - outliner/details/content-browser/gizmo UI
  - authoring middleware
  - GDD/internal docs
  - raw authoring assets
  - local dev scripts

- [ ] `public/` içine sadece runtime'da gitmesinde sakınca olmayan dosyalar koy.
- [ ] Raw kaynakları ayrı klasörde tut:
  - `authoring/blender`
  - `authoring/krita`
  - `authoring/psd`
  - `authoring/prompts`
  - `authoring/references`

- [ ] Asset cooking pipeline'ını ileride `tools/cook-assets.mjs` olarak planla.
  - GLB optimize
  - texture resize/compress
  - thumbnail üretimi
  - manifest doğrulama
  - unused asset raporu

- [ ] `verify-dist` kontrolünü genişlet:
  - editor token scan
  - dev endpoint scan
  - docs/raw file scan
  - asset size report
  - missing manifest reference check

- [ ] `dist-report.json` üretmeyi planla:
  - total size
  - chunk sizes
  - asset sizes by type
  - largest files
  - unused public files
  - editor leak result

- [ ] `project.3dgame.json.output.distDir` alanını koru.
- [ ] Packaging ayarlarını manifest'e gereksiz yere erken ekleme.
- [ ] Deploy aşamasını package aşamasından ayrı düşün.
- [ ] Local final test için `npm run preview` kullan.
```

---

# Birleşik Mimari Yol Haritası

Bu altı başlık birlikte Forge için şu mimari rotayı verir:

```text
1. Project / Template
   Forge kopyalanabilir bir game-template repo'su olur.

2. Content Browser
   Assetler manifest tabanlı güvenli katalog üzerinden yönetilir.

3. Actors & Components
   Sahnedeki nesneler asset instance'ı değil, component taşıyan Actor'lardır.

4. Levels / World Settings
   Layout dosyaları Level'dır; World Settings per-level yaşar.

5. Playing & Simulating
   Authoring state ile Play Session state ayrılır.

6. Packaging
   Final dist sadece runtime oyunu içerir; editor ve authoring artıkları dışarıda kalır.
```

## En Kritik Kurallar

```text
- Forge editor generic kalmalı; project-specific game rules runtime game code/data tarafında yaşamalı.
- Layout dosyalarına Three.js, Rapier, audio node, particle buffer gibi canlı runtime objeleri yazılmamalı.
- Layout dosyalarına editor-only state yazılmamalı.
- Content Browser layout'a path değil assetId yazdırmalı.
- Light ve particle sistemleri Actor + Component mimarisinin doğal parçası olmalı.
- World Settings project manifest'e değil layout'a ait olmalı.
- Play sırasında runtime state layout'a otomatik yazılmamalı.
- Production build editor kodu, editor CSS'i, dev middleware'i ve raw authoring dosyalarını içermemeli.
```

---

# Önerilen Belge / Dosya Yapısı

```text
docs/
  ARCHITECTURE.md
  LAUNCH_WORKFLOW.md
  UNREAL_BASICS_LESSONS.md
  ACTORS_COMPONENTS_CHECKLIST.md
  PACKAGING_CHECKLIST.md

public/
  project.3dgame.json
  assets/
    manifest.json
    metadata-schema.json
    models/
    textures/
    thumbnails/
    fx/
  layouts/
    main.json

authoring/
  blender/
  krita/
  psd/
  prompts/
  references/

tools/
  create-project.mjs
  import-asset.mjs
  cook-assets.mjs
  verify-dist.mjs
```

---

# Kısa Sonuç

Forge'un hedefi “Unreal gibi her şeyi yapan dev bir motor” olmak değil. Daha doğru hedef:

```text
Web-first, Three.js tabanlı, reusable game-template mimarisi
```

Bu mimaride Unreal'dan alınacak asıl değer şudur:

```text
- proje kimliği ayrı
- level ayrı
- asset ayrı
- actor ayrı
- component ayrı
- runtime state ayrı
- package ayrı
```

Bu ayrımlar korunursa Forge, sadece bir Three.js editörü değil, gerçek oyun üretim akışı olan bir web game framework'e dönüşür.
