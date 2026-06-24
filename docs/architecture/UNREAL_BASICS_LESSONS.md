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

Çalışma akışı kuralı: rutin/küçük işler için otomatik branch açma, commit
atma veya push yapma. İşi bitir, gerekli gate'i çalıştır ve kullanıcıya hazır
olduğunu bildir; commit/push kullanıcıda kalır. Sadece açıkça istenirse branch,
commit veya push yap.

Sınır kuralı (bkz. "En Kritik Kurallar"): gameplay kuralları `src/game/*` +
sahne verisinde yaşar, `engine/` veya `editor/` içine girmez. Game Mode
(`RuntimeSceneApp`) hiçbir zaman `editor/*` import etmez. Mümkün olduğunca saf,
headless-test edilebilir çekirdek çıkar (projenin yerleşik ritmi); Three.js/DOM
tutkalı shell'lerde ince kalır.

## Kalici Mimari Kararlar

- *2026-06-19* — **Material Instance karari.** Forge simdilik Unreal'daki tam
  Material Instance sistemini kopyalamayacak. Mevcut Material Editor form tabanli
  canonical `.material.json` uzerinden ilerler; node/material graph ve Material
  Function kapsam disidir. Ileride ihtiyac dogarsa hedef **Material Instance Lite
  / Material Variant**: parent canonical material + `type: "materialInstance"` +
  `parentMaterial` + yalnizca degisen alanlari tutan `overrides`. Runtime bu
  parent + overrides sonucunu normal Three.js material olarak resolve eder.

- *2026-06-22* — **Material texture kalite karari.** Material Editor hafif/form
  tabanli kalir; ayri Unreal tarzı Texture Asset Editor kurulmaz. Texture kalite
  ve UV kontrolu canonical `.material.json` ustunden ilerler: `uvTiling` alanı,
  ortak `configureForgeTexture()` helper'i, renderer limitine gore clamp'lenen
  anisotropy, roughness/metalness/AO icin ayri gri haritalar veya paketli ORM
  texture, runtime/editor preview/thumbnail icin ayni texture ayari. Iki katmanli
  Material Layer Blend ise node graph degil; sinirli bir `MeshStandardMaterial`
  `onBeforeCompile` istisnasi olarak `constant`, `slope`, `worldHeight` ve siyah-beyaz
  `maskTexture` driver'lariyla uygulanir. `maskTexture` lineer/skaler maske bekler;
  Material Editor normal/base-color dokularini bu slota baglama durumunda uyarir ve
  preview shader compile hatasinda onceki materyali korur. Takip dokumani:
  `docs/completed/MATERIAL_EDITOR_ENHANCEMENTS_CHECKLIST.md`.

- *2026-06-23* - **Sound Cue Lite arastirma/plani.** Forge, Unreal Sound Cue
  editorunu birebir kopyalamak yerine Web Audio tabanli dar bir `soundCue`
  asset/editing katmani hedeflemeli: raw `sound` dosyalari ayri kalir, cue
  grafi Source/Output/Mixer/Random/Modulator/Loop/Delay ile baslar, spatial,
  bus/submix, modulation, occlusion ve MetaSound-benzeri procedural graph daha
  sonraki fazlara ertelenir. Takip dokumani:
  `docs/planned/SOUND_CUE_EDITOR_RESEARCH_AND_PLAN.md`.

- *2026-06-23* - **Dialogue/Voice kapsam karari.** Unreal'daki Dialogue Voice
  ve Dialogue Wave modeli, Sound Cue Lite'in alt ozelligi degil; speaker/listener
  context, subtitle, localization, voice actor direction ve conversation flow
  nedeniyle ayri bir Dialogue/Voice feature alani olmali. Sound Cue Lite ile
  yalnizca playback katmaninda kesisir; live voice chat / microphone capture ise
  daha ayri bir multiplayer/media kapsamidir. Takip dokumani:
  `docs/planned/DIALOGUE_AND_VOICE_RESEARCH_AND_PLAN.md`.

- *2026-06-23* - **User Interface / UMG-Slate kapsam karari.** Forge, Unreal'in
  UI ayrimlarini alacak ama araclari birebir kopyalamayacak: oyun HUD/menu
  tarafi `.ui.json` + `RuntimeUiSubsystem` + HTML/CSS overlay tabanli **UMG Lite**,
  editor/arac tarafi mevcut dev-only `EditorUi` cizgisi, state tarafi MVVM-lite
  store, input tarafi Common UI benzeri screen stack/focus/back routing olacak.
  World-space UI, screen UI oturduktan sonra `WidgetComponentLite` fazina
  birakilmali. Takip dokumani:
  `docs/planned/USER_INTERFACE_UMG_SLATE_RESEARCH_AND_PLAN.md`.

- *2026-06-20* — **Script Communication System kararı.** Forge, Unreal Blueprint
  Communication modelini görsel node VM olarak kopyalamayacak. Actor Script verisi
  iletişim sözleşmesini taşır; behavior mantığı `src/game/` TypeScript kodunda
  yaşar; aktörler arası haberleşme direct reference, interface/capability,
  dispatcher/message binding ve BehaviorContext API'i üzerinden kurulacaktır.
  Takip dokümanı: `docs/completed/SCRIPT_COMMUNICATION_SYSTEM_CHECKLIST.md`.

- *2026-06-21* — **Player Character / Character Movement karari.** `Player.Actor`
  icin skeletal mesh tek basina yeterli degil. Forge, Unreal'in Character
  ayrimini alacak: possess edilebilen Pawn + skeletal mesh + capsule collider +
  birinci sinif `CharacterMovement` component'i + GameMode/PlayerController
  possession akisi. Takip dokumani:
  `docs/completed/PLAYER_CHARACTER_REQUIREMENTS_CHECKLIST.md`.

- *2026-06-21* — **CharacterMovement dikey kesiti.** Actor Script schema'sina
  `CharacterMovement` component'i eklendi; `parentClass:"character"` yeni
  class'lari Transform + Capsule Collider + MeshRenderer + CharacterMovement ile
  seed eder. ActorScriptEditor bu component icin Details formu ve compile
  uyarilari sunar. Runtime'da yeni `CharacterMovementSubsystem`, sadece
  possessed pawn'u mevcut `playerMovement` / `verticalMotion` / `collision`
  saf helper'lariyla hareket ettirir; Actor Script character instance'lari TPS
  GameMode possession adaylarina girer. `Player.Actor`, capsule + movement
  tasiyacak sekilde guncellendi. Gate: `npx tsc --noEmit` temiz, engine
  testleri **240 check**.

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
| G2 | Yerçekimi, zemin & zıplama | G1 | §3, §4 | `[x]` |
| G3 | Çarpışma yanıtı (duvardan geçmeyi durdur) | G1 | §3 | `[x]` |
| G4 | 3. şahıs takip kamerası + kameraya-göreli hareket | G1 | §5 | `[x]` |
| G5 | Harekete bağlı animasyon durumları | G1, G2 | §3 | `[x]` |
| G6 | Authored oynanabilir örnek sahne | G1–G5 | §4, §5 | `[x]` |

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

### G2 — Yerçekimi, zemin & zıplama  `[x]`

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

### G3 — Çarpışma yanıtı (duvardan geçmeyi durdur)  `[x]`

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

### G5 — Harekete bağlı animasyon durumları  `[x]`

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

### G6 — Authored oynanabilir örnek sahne  `[x]`

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
- **B2 — Yeni proje bootstrap** → §1 checklist: template'i kopyalayıp yeni bir
  proje üretme akışı (+ ileride `tools/create-project.mjs`).
- **B3 — Performans & araçlar** → §6 (perf overlay zenginleştirme,
  `dist-report.json`, `tools/cook-assets.mjs`).
- **B4 — Mimari evrim:** tam component-model (§3 — Actor `components[]`,
  Add/Remove Component, Interaction/Particle), `worldSettings` şema-2 / iç içe
  `world` modeli (§4), PlaySession araçları / Play From Here / Simulate Mode
  (§5). Gameplay track'i bunları **gerektirmez**; G1–G6 minimal kalıplarla ilerler.

## Progress Log

Yeni kayıtları en üste ekle. Kaydet: tarih, madde #, ne değişti, nerede durdu,
alınan karar (sonraki oturum yeniden tartışmasın).

- *2026-06-24* - **Ragdoll cone/twist açısal limiti (floppy → stiff).** Ragdoll joint'leri artık açısal
  limitli. Sorun: rapier3d-compat 0.19 typed `SphericalImpulseJoint`'te limit API yok. Çözüm: spherical
  joint kurulduktan sonra **raw** `world.impulseJoints.raw.jointSetLimits(handle, axis, min, max)` ile
  AngX/AngZ=swing, AngY=twist eksenleri kısıtlanır (uzuvlar Y boyunca kapsül → AngY twist). `RawJointAxis`
  exported değil → enum sayıları (AngX=3/AngY=4/AngZ=5) `jointSetLimits`'e yapısal cast ile geçilir
  (feature-detected; raw setter yoksa no-op=floppy, sürüm bump'ı çökertmez). **Kritik güvenlik:** 0.19
  spherical joint'in rest-frame'i yok → limitler identity'den ölçülür; büyük rest-açılı eklemler (hip/
  shoulder) tight limitle spawn'da ihlal edip patlardı. Saf `ragdollJointAngularLimits` (engine/physics/
  ragdoll.ts) limiti body'lerin **rest relative açısına** (`2·acos(|qRel.w|)`) genişletir + ~5° margin →
  küçük-rest eklem authored limiti korur, büyük-rest eklem gevşer ama **asla ihlal etmez** (provably:
  limit ≥ restAngle ≥ her eksen bileşeni). Gate: tsc temiz, test:engine **316** (+1: rest-widen/authored-
  keep/generous), vite build temiz (oyun bundle +0.6kB, Rapier hâlâ lazy). **Sınır:** approximation
  (identity-ref, per-axis box, gerçek anatomik cone değil); el ile Play doğrulaması kullanıcıda. Gerçek
  cone-twist için daha yeni Rapier (dedicated cone API) veya joint-frame ile rest-ref gerekir.
- *2026-06-24* - **Ragdoll Aşama 3 KAPANDI: editör "Simulate" önizleme (3d).** Runtime ragdoll (3b+3a+3c)
  kullanıcı tarafından Play'de doğrulandıktan sonra son faz 3d eklendi. `SkeletalMeshEditor` Physics
  modunda **Simulate** toggle: editör-içi `new PhysicsSubsystem({backend:"rapier"})` + modelin ayak
  hizasına `Box3` ile yerleşen statik ground entity, sonra **runtime `createRagdollDriver`'ı AYNEN yeniden
  kullanır** (DRY — editör kendi fizik/sürme kodunu yazmaz). Driver modelin gerçek bone node'larını sürer
  → wireframe body overlay'leri + constraint çizgileri canlı takip eder (PhAT-style önizleme). Başlamadan
  `snapshotModelPose` (tüm node local TRS), Stop'ta `restoreModelPose` + overlay rebuild. Simüle ederken
  authoring UI gizli (salt-önizleme). Yaşam döngüsü: mod değişimi + `close()` simülasyonu durdurup Rapier
  `dispose` eder (sızıntı yok). Gate: tsc temiz, test:engine **315** (yeni saf mantık yok, hepsi 3b/3a/3c'de),
  vite build temiz — **oyun bundle'ı byte-aynı (194.49 kB), Rapier hâlâ lazy `vendor-physics` chunk**
  (editör PhysicsSubsystem import'u oyun chunk'ına sızmadı). Sınır: cone/twist limitsiz → önizleme floppy;
  uniform-scale. **Aşama 3 tamamen bitti.** Sıradaki opsiyonel yönler: gerçek ölüm/hasar tetiği (R yerine),
  cone-twist limiti (daha yeni Rapier), demo `character-a`'ya body author'lama, get-up geri-blend.
- *2026-06-24* - **Runtime ragdoll (Persona Faz 4 / Aşama 3: 3b+3a+3c tamam).** Karakter kinematik
  animasyondan dinamik fizik ragdoll'una geçiyor. **3b (saf):** `src/game/ragdollSpec.ts`
  `buildRagdollSpec(bodies, constraints, resolveBoneWorld)` → world-yerleşik body'ler (`boneWorld ∘
  bodyLocal`, mass = shape hacmi × 1000, floor 0.1kg) + cone-twist joint'ler (anchor = child body origin,
  derece→radyan); bone world enjekte (Three'siz testlenebilir). **3a (engine):** `engine/physics/ragdoll.ts`
  tipler + saf `worldAnchorToBodyLocal` + `boneWorldFromBodyPose` (driver'ın bone-sürme tersi) +
  `RAGDOLL_COLLISION_GROUPS`; `physicsSubsystem`'e `spawnRagdoll`/`sampleRagdoll`/`despawnRagdoll` —
  spec'ten dinamik Rapier body (CCD+angular damping) + **spherical** impulse joint, canlı dünyaya
  bırakır (statik level collider'larıyla çarpışır, kendiyle değil), `detachEntityId` ile player kapsülünü
  ragdoll grubuna alır. **3c (runtime glue):** `src/game/ragdollDriver.ts` aktivasyonda canlı bone world'leri
  örnekler (uniform world-scale ölçekleme → küçültülmüş karakter), spawn eder; her tick `sampleRagdoll` →
  `boneWorldFromBodyPose` → parent-inverse decompose ile bone'ları sürer (shallow-first; bodysiz bone'lar
  donuk pozda parent'a biner). Mikser'ler `timeScale=0` ile donar; driver `session.update`'te (engineApp.update
  fizik step'inden SONRA) ezer. Context köprüsü opsiyonel (`types.ts`/`RuntimeSceneApp`); tetik debug
  `KeyR`→`ragdoll` action (terminal/tek-yön), `tpsCharacterGameMode.activateRagdoll` (authored body +
  canlı bridge gerekir → yoksa no-op, demo bozulmaz), kamera ragdoll ana gövdesini takip eder. Gate: tsc
  temiz, test:engine **315** (yeni: ragdoll spec compose/mass/joint/atlama, world→local anchor, group desc
  lowering, boneWorldFromBodyPose round-trip). **Karar/sınır:** rapier3d-compat 0.19 `SphericalImpulseJoint`'te
  cone/twist limiti YOK → swing/twist taşınır ama henüz zorlanmaz (angular damping ile floppy ama kararlı;
  gerçek cone-twist daha yeni Rapier veya raw generic-limit API). Uniform-scale varsayımı. **3d (ops. editör
  Simulate önizleme) ERTELENDİ** — çalışan editörün WebGL/dispose döngüsüne dokunur, dev server'sız
  doğrulanamaz; çalışmadı. **El ile Play doğrulaması kullanıcıda:** demo `character-a`'ya henüz physicsBody
  authored DEĞİL → editörde gövde/eklem ekle, Play'de R'ye bas. Sıradaki: 3d veya runtime düşman/ölüm-eventi
  ile ragdoll tetiği (R yerine gerçek oyun mantığı). Spec: `PERSONA_SKELETAL_TOOLSET_CHECKLIST.md` SONRAKİ
  OTURUM 3d bloğu.
- *2026-06-23* - **Upper Body slot + Layered Blend Per Bone (data) - bacaklar yururken ust govde ates eder.**
  Unreal Anim BP'deki `Slot 'UpperBody'` + `Layered blend per bone` (+ `Blend Poses by bool: Is Aiming`)
  grafiginin **node-graph'siz, veri** karsiligi kuruldu (kullanici BP gorseli paylasti).
  Mekanik = **kemik-maskeli klipler**: three.js'te "Layered Blend Per Bone" yok, ama bir
  klibin track'lerini hedef node'a gore alt/ust olarak filtreleyip iki kanalda (iki mixer,
  ayni root) calistirinca maskeler ayrik oldugu icin temiz katmanlanir. Demo `character-a`
  RIGID rig (Skins:0, node-TRS animasyonu) — hiyerarsi root→{leg-left,leg-right,torso→{arm-left,arm-right,head}};
  maske koku **torso**. Hazir klipler tam uygun: `holding-both`(aim), `holding-both-shoot`(fire).
  Sema: `*.skeleton.json` `montages[]` ({name,clip,slot,loop,blendIn/Out}) + `upperBodyBone`
  (normalize+validate+store). Engine: `bodyMask.splitClipsByUpperBody` (PropertyBinding.parseTrackName
  ile node adina gore ayirir), `LayeredCharacterAnimator` (alt=locomotion CrossfadeAnimator,
  ust="UpperBody slot": normalde locomotion'i yansitir; `setAim` held poz, `playMontage` tek-atis
  + `update(dt)` zamanlayici ile aim/passthrough'a doner; maske eslesmezse `hasUpperBody=false` →
  cagiran duz animator'a duser). Input: `PointerButtonSource` (Mouse0=fire, Mouse2=aim; ana dongude
  engineApp.update→session.update sirasi pressed-edge'i guvenli kilar). `tpsCharacterGameMode`:
  upperBodyBone varsa layered, RMB→aim pozu, LMB→fire montage; bacaklar locomotion'a devam. Gate:
  tsc temiz, test:engine 296 (yeni: bodyMask split + LayeredCharacterAnimator state makinesi +
  montage/upperBodyBone normalize/validate round-trip), vite build temiz (game bundle editorsuz).
  Karar/sinir: kemik-basina yumusak blend (Unreal "Blend Depth") native degil → sert ayrim (v1 yeterli);
  aim "orient-to-camera" hareket tarafinda ayri (bu dilim yalnizca animasyon katmanlama); editor
  authoring (maske koku secimi + montage UI) ve notify yayini Faz 3'te pending. Calismadi: el ile Play
  dogrulamasi bana ait degil (kullanici test edecek).
- *2026-06-23* - **Authored anim-set runtime'a baglandi (clip fallback).** Tek-klip
  locomotion secicisi artik karakterin authored `animationSet`'ini (rol→klip,
  `*.skeleton.json`) onurlandiriyor; onceden yalnizca sabit `CLIP_FALLBACKS` klip-ismi
  sozlugunu kullaniyordu (Kenney "idle/walk/sprint" vokabuleri), keyfi isimli klipleri
  goremiyordu. `resolveLocomotionClip(state, available, animationSet?)` once `ROLE_FALLBACKS`
  semantik zinciriyle (run→walk→idle, fall→jump→idle) authored rolu cozer, sonra eski
  klip-ismi heuristigi, sonra herhangi bir klip — yani anim-set yoksa davranis aynen
  korunur (geriye donuk uyumlu). Iki sidecar-turevli girdi tek `LocomotionAssetConfig`
  (blendSpace + animationSet) altinda toplandi; `locomotionConfigForSkeleton(skeleton)`
  possess'te bir kez kurar; `resolveLocomotionAnimation`'in 3. parametresi blendSpace
  yerine config oldu. Demo `character-a` anim-set'i jump/fall→"walk" maplediginden artik
  ziplarken idle yerine walk oynar (authored niyet; istenirse editorde degistirilir).
  Gate: build temiz, test:engine 294 check (yeni: anim-set override + role-fallback +
  config builder). Karar: anim-set blend space'ten BAGIMSIZ — grounded'da blend space
  varsa o kazanir, anim-set yalnizca tek-klip fallback (airborne / blend-yok) yolunu besler.
- *2026-06-23* - **Blend Space runtime tuketimi - locomotion'a baglandi.** Editorde
  authoring'i biten blend space artik Play'de locomotion'i suruyor (onceki kayitta
  "authoring-only" diye ertelenmisti). Engine: `CrossfadeAnimator.playBlend(weights)`
  — faz-senkron agirlikli oynatma (her klip blend-agirlikli ortak referans sureyle bir
  dongu tamamlar, walk<->run ayak temasi hizali; yeni katilan klip mevcut faza
  alinir), tek-klip `play()` ile karsilikli dislayan (biri digerinin action'larini
  durdurur). Saf `src/game/locomotionAnimation.ts`: `pickLocomotionBlendSpace`
  (1D, ad "Locomotion" ya da ilk kullanilabilir 1D) + `resolveLocomotionAnimation`
  (grounded+blend space → agirlik; airborne/blend-space-yok/klip-bulunamaz → tek-klip
  fallback). `RuntimeSceneApp.loadCharacterSkeletons` sahne yuklenirken `*.skeleton.json`
  sidecar'larini (deduped) `RuntimeCharacterRef.skeleton`'a iliştirir; possess
  oncesinde. `tpsCharacterGameMode.updateAnimation` karara gore `playBlend`/`play`.
  Demo `character-a.skeleton.json` bos "BlendSpace" yerine idle@0/walk@3/sprint@6
  "Locomotion" (axis 0..6, pawn speed 3 / sprint x2'ye gore) — boylece walk<->sprint
  artik sicrama yerine harmanlaniyor. Gate: build (tsc + vite) temiz, test:engine 292
  check (yeni: playBlend mod gecisi + pickLocomotionBlendSpace + resolveLocomotionAnimation).
  Karar: blend space referansi konvansiyon (ad/ilk-1D) — sidecar'a explicit "locomotion
  blend space" alani EKLENMEDI; gerekirse sonra. Calismadi: el ile Play dogrulamasi
  (dev server demo layout'u autosave ettiginden baslatilmadi); davranis unit testlerle
  kapsandi.
- *2026-06-23* - **Persona Blend Space (data) - Faz 2 tamam.** Skeletal mesh
  editorune Unreal Blend Space'in *data* karsiligi eklendi (node-graph YOK; karar
  PERSONA_SKELETAL_TOOLSET_CHECKLIST Bolum D'de sabit). Veri modeli + saf
  cozumleyici `src/scene/assetSkeletonLoader.ts`: `AssetSkeletonBlendSpaceDef`
  (1d/2d, axisX[/axisY], samples[]) ve `resolveBlendSpaceWeights` — 1D parcali-dogrusal
  (idle<->walk<->run), 2D normalize ters-mesafe (Shepard, tam-ornek kisa devre);
  cakisan klipler birlesir, agirliklar 1'e normalize. `normalizeAssetSkeleton`
  blendSpaces'i artik ayikliyor (bos/yinelenen ad, alan-disi/NaN kirpma).
  `SkeletalMeshEditor.ts` Animation modunda authoring ve viewport onizleme: blend
  space ekle/sil/sec, ad/tip/eksen+min/max, ornek (klip+koordinat) ekle/sil; "Preview
  Blend" ile eksen slider'lari `AnimationMixer` action agirliklarini canli
  (faz-senkron) suruyor, yuzde okumasi gosterir. Save validator `validateBlendSpaces`
  (2D'de y zorunlu, yinelenen ad
  reddi). Gate: tsc temiz, test:engine 289 check (yeni: normalize + 1D/2D resolver +
  save round-trip). Sidecar persistans (`*.skeleton.json` blendSpaces) ve `/__save-skeleton`
  zaten vardi; sadece passthrough yerine gercek dogrulama. Karar/erteleme: runtime
  tuketimi (locomotion'i blend space ile besleme) bu maddenin disinda — animationSet
  gibi su an authoring-only; viewport-base refactor (Faz 1, opsiyonel) ve Montage-lite
  (Faz 3) hala acik.
- *2026-06-22* - **complexAsSimple - oyuncu hareketi + kritik clone fix.** Kullanici
  L formlu wallCorner'da test etti: Show>Collision kutu gosteriyor, Play'de L
  bosluguna girilemiyor. Iki kok neden bulundu: (1) `physicsSubsystem.clonePrimitive`
  trimesh `vertices`/`indices`'i kopyalamiyordu → `setEntities` klonunda veri dusuyor,
  hem Rapier collider'i hem blocker'lar box'a fallback ediyordu (onceki oturum
  `primitiveColliderDesc`/`readColliderPrimitives`'e trimesh ekledi ama clone'u
  unuttu). (2) Oyuncu hareketi Rapier degil AABB-tabanli (`src/game/collision.ts`
  `resolvePlanarMovement` + `staticBlockerAabbs`), govde basina TEK AABB
  uretiyordu → trimesh'in tum bounding box'i. Cozum: `staticBlockerAabbs` artik
  compound'u primitive-basina, trimesh'i **ucgen-basina AABB**'ye acar (cache'li,
  rotasyon yok sayilir - AABB modeliyle tutarli); boylece L'nin ic kosesine
  girilebiliyor. `collisionWireboxes` + SceneApp overlay complexAsSimple icin gercek
  mesh wireframe cizer. Gate: tsc temiz, test:engine 283 check (yeni: per-triangle
  blocker testi). Not: AABB hareket modeli rotasyonu yok sayar - donduruimus
  complexAsSimple geometri icin yaklasiktir (level geometrisi tipik eksen-hizali).
- *2026-06-22* - **Static Mesh Collision Editor - complexAsSimple (Faz 7,
  tamam).** "Use Complex Collision As Simple" artik uctan uca calisiyor: render
  mesh ucgenleri `computeComplexCollisionMeshes` ile cikariliyor (yalnizca
  complexAsSimple asset'leri icin filtrelenmis), `bakeTrimeshPrimitive` placement
  scale'i bake edip AABB cikariyor, Rapier compound `trimesh` collider'a derleniyor
  (`physicsSubsystem`). Trimesh Rapier'da **dinamik** olamadigi icin complexAsSimple
  **statik-only**: adapter (`legacyRoomLayoutAdapter.colliderComponent`) placement
  Simulate Physics flag'ini gecersiz kilip sabit body uretir; `EditorUi` Physics
  bolumunde Simulate Physics toggle'i complexAsSimple asset'lerde devre disi +
  uyari; `StaticMeshEditor` complexity = complexAsSimple secilince statik-only ipucu
  gosterir. Bos `primitives` ile complexAsSimple sidecar `assetCollisionDefHasCollider`
  ile korunur (SceneApp.refreshCollisionDefs + RuntimeSceneApp.loadCollisionDefs;
  eskiden auto-box'a dusuyordu). Gate: `npx tsc --noEmit` temiz, `npm run test:engine`
  282 check (3 yeni: helper, statik trimesh + simulate-override, mesh yoksa box
  fallback). Kalan: "Simple And Complex" per-poly trace, K-DOP/V-HACD, manuel UI
  akis dogrulamasi.
- *2026-06-22* - **Static Mesh Collision Editor - Faz 6 placement override'lari
  (tamam).** Scene Details > Collision artik asset default'unu miras alan
  placement-level override'lari tasir: Collision Enabled, Object Type, Phys
  Material Override, Generate Overlap Events, Simulation Generates Hit Events ve
  Custom response matrisi. Alanlar `LayoutPlacement` / `LayoutCharacter`,
  `EditorSceneController` undo/redo, `EditorUi`, `tools/saveValidator.ts` ve
  `legacyRoomLayoutAdapter` akisana baglandi; placement override asset sidecar
  default'unun ustune yazilir. Gate: `npx tsc --noEmit` temiz, `npm run
  test:engine` 278 check gecti. Devaminda SM Editor Show Simple/Complex
  collision gorunurluk toggle'i ve K-DOP 10DOP-X/Y/Z, 18DOP, 26DOP uretimi
  eklendi. Kalan: complex trimesh, V-HACD/Convert Boxes ve editor UI manuel
  akisi.

- *2026-06-22* - **Player Controller Faz 9 - Sprint FOV + camera shake
  (tamam -> Faz 9 kapandi).** `PlayerCameraManager` artik view target'in ustune
  transient gameplay efektleri bindiriyor: `setGameplayEffects` hedef FOV offset,
  shake amplitude ve shake frequency alir; manager bu degerleri exponential
  blend ile uygular, FOV'u base projection'a offset olarak ekler ve poz/target'a
  ayni deterministic shake offset'ini basar (orientation korunur, layout'a state
  yazilmaz). `TpsCharacterSession`, possessed pawn'in locomotion snapshot'ini
  `classifyLocomotion` ile okur; state `run` oldugunda sprint FOV + hafif shake
  ister, aksi halde efektleri sifira blend eder. Authored Camera component yoksa
  bile base projection `cameraProjectionFromComponent(undefined)` ile saglanir,
  yani FOV offset birikmez. **Test:** yeni engine testi FOV/shake blendini kapsar;
  Actor Script sprint locomotion testi artik takip pozunun ustundeki kucuk shake'i
  toleransla dogrular. **Gate:** `npx.cmd tsc --noEmit` temiz; engine **274**
  check. **Durum:** `docs/completed/PLAYER_CONTROLLER_CHECKLIST.md` Faz 7-9 tum maddeler
  `[x]`; bir sonraki kamera isi yeni checklist/faz olarak acilmali.

- *2026-06-22* - **Player Controller Faz 9 - PlayerCameraManager view target/blend
  (tamam).** `src/game/playerCameraManager.ts` eklendi: runtime camera view target
  (`source`, pose, projection) tutar, ayni kaynakta per-frame takip pozunu anlik
  uygular, kaynak degisince position/target/FOV/near/far icin smoothstep blend
  yapar. `RuntimePlayerController` artik `cameraManager` sahibi; TPS session
  SpringArm/fallback takip pozunu dogrudan `PerspectiveCamera`'ya yazmak yerine
  controller'in camera manager'ina view target olarak verir. Bu, SpringArm
  component'li authored kamera ile fallback follow config arasinda blend edilecek
  tek runtime kapisini acti; Default Camera modu kendi flythrough kontrolunu
  koruyor. **Test:** yeni engine testi PlayerCameraManager'in ayni-source takip
  guncellemesini ve kaynaklar arasi blend/projection interpolasyonunu kapsar.
  **Gate:** `npx.cmd tsc --noEmit` temiz; engine **273** check. **Kalan Faz 9:**
  sonraki kayitta kapatildi.

- *2026-06-22* - **Player Controller Faz 9 - Stateful runtime PlayerController
  (tamam).** `docs/completed/PLAYER_CONTROLLER_CHECKLIST.md` Faz 9'un ilk maddesi kapandi.
  Yeni `src/game/playerController.ts` DOM'suz runtime controller katmani oldu:
  `PlayerControllerDefinition` + `GameModeContext` uzerinden input mode,
  pointer-look mode, cursor policy, possess/unpossess state ve controller-owned
  `controlRotation` yonetiliyor. `TpsCharacterSession` artik control yaw/pitch'i
  kendi alaninda tutmuyor; `RuntimePlayerController` kullaniyor ve
  `controlYawForEntity`/debug readout'u oradan okuyor. Default camera mode da live
  camera pawn possession'ini ayni controller ile yapiyor (`pawnEntityId: null`,
  `possessed: true`). Project GameMode, TPS session'ini yeniden kullanirken
  `TPS_PLAYER_CONTROLLER` varsayilanlarini kendi controller id'siyle devralir; bu
  sayede pointer-lock/look-axis davranisi ortuk static TPS referansina bagli
  kalmadi. **Test:** yeni engine testleri runtime controller possession/input
  policy ve mapping-context look input davranisini kapsar. **Gate:** `npx.cmd tsc
  --noEmit` temiz; engine **272** check. **Kalan Faz 9:** sonraki kayitlarda
  kapatildi.

- *2026-06-22* — **Player Character Faz 6 — Runtime debug paneli (tamam → tüm
  checklist kapandı).** `docs/completed/PLAYER_CHARACTER_REQUIREMENTS_CHECKLIST.md`'in son
  açık maddesi kapandı; Faz 0–6 hepsi `[x]`. `?debug` overlay'ine "game mode"
  bloğu eklendi: active GameMode, possessed pawn, movement mode, grounded,
  velocity (y + planar). **Veri:** yeni `RuntimeSceneApp.getGameModeDebugSnapshot`
  → `activeGameMode.displayName` + `gameModeSession.playerState.pawnEntityId` +
  possessed pawn'in `locomotionReports` kaydından grounded/velocityY/planarSpeed +
  actor pawn ise `readCharacterMovementComponent().movementMode`
  (`possessedMovementMode` helper). `RuntimeStatsApp`'e **opsiyonel**
  `getGameModeDebugSnapshot?()` eklendi — editor `SceneApp` bu metodu taşımıyor
  (editörde canlı possession yok), overlay yalnızca metod varsa render eder, yani
  editor `?debug` değişmedi. **Render:** `debugStats.ts` saf `formatGameModeDebug`
  (DOM'suz, test edilebilir) + `gameModeDebugText` glue. **Gate:** tsc temiz ·
  engine **258** check (yeni 2: possessed + unpossessed formatter) · build:verify.
  **Not:** snapshot canlı görsel teyit `?debug` ile yapılır (headless test sadece
  saf formatter'ı kapsar). **Karar:** dynamic walking/falling yerine authored
  movementMode + ayrı grounded gösteriliyor (subsystem dinamik mode'u expose
  etmiyor; grounded zaten walking/airborne ayrımını veriyor).

- *2026-06-22* — **Player Character Faz 5 — Camera & animation (tamam).**
  `docs/completed/PLAYER_CHARACTER_REQUIREMENTS_CHECKLIST.md` Faz 5'in 4 maddesi kapandı.
  **Bulgu:** locomotion animation bridge + TPS takip kamerası zaten generic
  `RuntimeCharacterRef` üzerinden çalışıyordu; `addActorCharacterRef` Actor Script
  character instance'larını (`actor:<i>`) bu ref akışına kendi gltf'i + object'i +
  `hasCharacterMovement` ile ekliyor, `CharacterMovementSubsystem` possessed
  actor'ın locomotion'unu `reportLocomotion` ile yazıyor, `TpsCharacterSession`
  possess'te `CrossfadeAnimator`'ı actor'un kendi clip'lerinden kuruyor ve her
  tick `selectLocomotionClip` ile geçiş yapıyor. Yeni kod değil; **doğrulama testi**
  eklendi (item 1–3): "tps mode animates + follows a possessed Actor Script
  character" (mixer kuruldu + follow camera actor object'ini izliyor) ve
  "locomotion bridge selects an Actor Script character's run clip" (public
  CrossfadeAnimator API ile updateAnimation kompozisyonu). **Item 4 — SpringArm/
  Camera taslağı:** `engine/scene/components.ts`'e `CameraComponent`
  (fieldOfView/near/far/ortho; default'lar runtime kamerasıyla aynı: 44/0.1/100) +
  `SpringArmComponent` (targetArmLength/socketOffset/targetOffset/lag/collision) ve
  read helper'ları; `ACTOR_COMPONENT_KINDS`'e `SpringArm`+`Camera` eklendi —
  `normalizeActorScriptDef` artık bu node'ları korur, yoksa `/__save-actor`'da
  sessizce düşerlerdi. ActorScriptEditor: ikon, default props, typed Details form
  (`springArmFields`/`cameraFields` + `bindSpringArmDetails`/`bindCameraDetails`/
  generic `bindNumberProps`). **Karar:** runtime kamerası hâlâ GameMode follow
  camera; SpringArm/Camera değerleri yalnızca authored+persist — sonraki faz
  bunları follow camera'ya mapler (boom→camera zinciri Unreal'deki gibi). **Gate:**
  tsc temiz · engine **256** check (yeni 6: animate+follow, locomotion-clip,
  readCamera, readSpringArm, normalize survive-save) · `npm run build:verify`.
  **Sıradaki:** Faz 6 runtime debug paneli (active GameMode, possessed pawn,
  movement mode, grounded, velocity) — Faz 5/6'daki tek açık madde.

- *2026-06-22* — **Player Character Faz 4 — Project GameMode asset entegrasyonu (tamam).**
  `docs/completed/PLAYER_CHARACTER_REQUIREMENTS_CHECKLIST.md` Faz 4'ün 4 maddesi kapandı.
  Artık `worldSettings.gameMode` built-in id (`forge.*`) **veya** bir
  `parentClass: "gameMode"` Actor Script'in classRef'i (`*.actor.json`) olabilir.
  **Catalog:** `isGameModeClassRef` + `normalizeGameModeId` classRef'i geçirir
  (built-in fallback korunur). **Veri:** GameMode `defaultPawnClassRef`'ini authored
  bir Details variable'ında taşır → saf `readGameModeDefaultPawnClassRef`
  (`engine/scene/actorScript.ts`), şema/validator değişmeden. **Runtime:**
  `RuntimeSceneApp.resolveActiveGameMode` classRef'i yükleyip
  `createProjectGameMode` (yeni `src/game/gameModes/projectGameMode.ts`) ile
  TPS session'ını **yeniden kullanan** bir `GameModeDefinition` üretir;
  `applyPlayerStartSpawn` artık herhangi bir character-pawn modu için genel —
  authored player yoksa `spawnDefaultPawnActor` Player Start'a sentetik bir actor
  instance (Player.actor.json) ekler, mevcut actor-character possession +
  CharacterMovement subsystem devralır. **Editor:** World Settings dropdown'u
  `refreshProjectGameModes` ile sahnenin `*.actor.json`'larını tarayıp gameMode
  olanları classRef olarak built-in'lerin yanına ekler; seçili-ama-keşfedilmemiş
  classRef de listede tutulur (sessizce default'a düşmez). `MyGameMode.actor.json`
  `defaultPawnClassRef → Player.actor.json` ile güncellendi. **Gate:** tsc temiz ·
  engine **249** check (yeni 5: classRef/normalize/defaultPawn reader + project
  mode possession + pawnClassRef yokluğu) · `npm run build:verify` yeşil.
  **Karar:** project GameMode davranışça TPS'tir, tek farkı spawn edilen default
  pawn'ın bir actor *class*'ı olması; registry built-in'leri değişmez, opt-in
  kalır. **Sıradaki:** Faz 5 (Actor Script player için locomotion/animation +
  TPS takip kamerası zaten actor-character'ı kapsıyor; SpringArm/Camera component
  taslağı) ve Faz 6 runtime debug paneli (possessed pawn/movement mode/velocity).
  **Kullanıcı geri bildirimi (aynı oturum, 2 düzeltme):** (1) Actor Script
  içinde MeshRenderer node'una yazılan `props.scale` Play'de yansımıyordu —
  `MeshRendererComponent`'e `scale` eklendi (`engine/scene/components.ts`),
  `entityCharacterItem` artık placement scale × mesh scale uygular
  (`engine/render-three/models.ts`). **Headed-browser doğrulamasında yakalandı:**
  bu tek başına yetmedi — `RuntimeSceneApp.applyEntityTransformToRender` her
  frame host scale'ini entity Transform'tan (placement, mesh scale'siz) yeniden
  yazıp override ediyordu; `actorMeshScales` map'i eklendi ve transform sync
  combined scale (placement × mesh) uyguluyor. Artık "küçük karakter" sınıfı
  runtime'da doğru render olur (0.5↔1.0 A/B ekran görüntüsüyle teyit; legacy
  karakterler etkilenmez). (2) GameMode'un `defaultPawnClassRef`'i artık ham metin değil: ActorScriptEditor
  Class Defaults'ta **"Default Pawn Class"** seçici (sadece `gameMode` parent) →
  projedeki `character`/`pawn` Actor Script'lerini listeler, seçimi
  `defaultPawnClassRef` variable'ına yazar (EditorUi `refreshProjectActorClasses`
  tek taramayı game-mode + pawn picker için paylaşır). **Gate:** tsc temiz ·
  engine **251** check · build:verify yeşil. **Not (tuning):** mesh scale ile
  CharacterMovement capsule (capsuleRadius/HalfHeight) ayrı ayarlar; görsel küçük
  ama collision büyük kalabilir — kullanıcı capsule'ı da küçültmeli.

- *2026-06-20* — **Script Communication System checklist'i açıldı.** Actor
  Script'lerin büyük projelerde hardcoded `RuntimeSceneApp` aksiyonları yerine
  message/interface/dispatcher sözleşmesiyle haberleşmesi için ayrı takip
  dokümanı oluşturuldu: `docs/completed/SCRIPT_COMMUNICATION_SYSTEM_CHECKLIST.md`.
  **Karar:** lamba testindeki özel `toggle-actor-light` akışı küçük test için
  kabul edilebilir; kalıcı model, AI tarafından yazılan `src/game/` behavior
  kodunun `BehaviorContext` içindeki `messages/world/state` API'lerini kullanması
  olacak. **Durum:** Faz 0 dokümantasyon başladı; kod implementasyonu henüz yok.

- *2026-06-20* — **Actor Script — yerleştirilmiş actor'ın Light component'i sahneyi
  aydınlatmıyordu (düzeltme).** Bir Actor Script sınıfına Light component'i eklenip
  level'a yerleştirildiğinde ışık sahneye hiç yansımıyordu: hem editör (`SceneApp`)
  hem runtime (`RuntimeSceneApp`) actor render yolu yalnızca **MeshRenderer**'ı
  işliyordu; entity'deki Light component'i hiçbir Three.js ışığına dönüşmüyordu.
  **Çözüm:** saf engine helper `attachActorLight(host, entity)`
  (`engine/render-three/lights.ts`) — actor entity'sinde Light component'i varsa,
  host objenin **local origin**'ine bir Three ışığı (+ directional/spot için target)
  iliştirir; host instance world transform'unu taşıdığı için ışık actor'la birlikte
  hareket eder (gizmo/behavior). `createLightObject`'e `gizmo:false` opt-out'u eklendi
  (icon billboard `document`/canvas gerektiriyordu → headless-safe + yerleştirilmiş
  actor ışığı wireframe/icon göstermez, host zaten pickable). `SceneApp.buildActorObject`
  her actor objesine ışığı iliştirir; `RuntimeSceneApp` artık **light-only** actor için
  (mesh yok) boş bir host Group oluşturur (logic-only actor'lar hâlâ objesiz). Işık
  tipi (directional/point/spot) `entityLightItem` ile entity'den okunur → editör Light
  Details formundaki tip seçici sahneye birebir yansır. **Gate:** tsc temiz · engine
  **191** check (yeni: `attachActorLight` headless testi) · build başarılı. **Sınır
  (v1):** flat-collapse gereği actor başına tek Light (ilk node kazanır); ışık host'un
  local origin'inde durur (component-ağacındaki local offset'i değil).

- *2026-06-20* — **Actor Script Faz 6 + Faz 8 — Browse/Play toolbar + AI behavior stub (tamam).**
  Checklist'in deferred-olmayan kalan maddeleri kapatıldı
  (`docs/completed/ACTOR_SCRIPT_SYSTEM_CHECKLIST.md` Faz 6 + Faz 8). **Toolbar Browse:**
  `onBrowse` artık `EditorUi.revealContentAsset` — drawer'ı açar, asset'in
  klasörüne gider (ataları açar, tip/arama filtresini temizler), kartı seçer ve
  `flashContentCard` ile kısa süre vurgular (`is-revealed` CSS animasyonu); tek
  otoriter refresh (drawer-open refresh'i `applyContentDrawerState`'e ayrıldı) →
  flash yarış koşulu yok. **Toolbar Play:** `onPlay` → `playTest`; editör önce
  `save()` eder, kayıt hatası launch'ı iptal eder, runtime'da yerleştirilmiş
  instance'lar spawn olur. **New Behavior stub (Faz 8):** Event Binding
  Details'ında **"✎ New Behavior stub"** butonu → `scriptId`'den
  `src/game/scripts/<slug>.ts`'i imzalı (`BehaviorUpdate` + registry kayıt yorumu)
  üretir. Saf üretici `resolveBehaviorStub`/`behaviorStubSource`
  (`tools/saveValidator.ts`, headless test); editör yolu
  `src/editor/behaviorStubStore.ts` → localhost-only `/__new-behavior` endpoint
  (`vite.config.ts`, `src/game/scripts/`'e fence'li, var olanı ezmez, 409). "AI
  ile behavior yazma" akışı checklist Bölüm E olarak yazıldı. **Gate:** tsc temiz ·
  engine **190** check · build başarılı. **Karar:** behavior **mantığı** koddur
  (AI yazar), editör yalnızca veri + imzalı stub üretir; sözleşme
  `BehaviorContext → void` değişmez. **Kalan (ertelenmiş):** per-instance override
  authoring (Faz 7), Add-menü kategorileri (Faz 4), Component sınıfı (Faz 2),
  Construction Script (Faz 5).

- *2026-06-20* — **Actor Script Faz 10.7 — Mesh seçici + viewport transform gizmo'ları (tamam).**
  Kullanıcı geri bildirimi ("Content'teki modeli MeshRenderer'a nasıl alacağım?
  viewport'ta transform aracı yok") üzerine iki UX boşluğu kapatıldı (checklist:
  `docs/completed/ACTOR_SCRIPT_SYSTEM_CHECKLIST.md` Faz 4 + Slice 10.7). **Mesh seçici:**
  MeshRenderer Details formuna model varlıklarını isimleriyle listeleyen **Mesh**
  açılır listesi (`modelAssets()` → `isModelAssetType` süzme); seçim `props.assetId`'ye
  yazılır, viewport gerçek mesh'i gösterir; elle yazılmış/bilinmeyen id `... (unknown)`
  olarak korunur. Ham props artık katlanır "Advanced" `<details>` altında.
  **Transform alanları:** her component için Position/Rotation°/Scale X/Y/Z sayısal
  kutuları (`vec3Row`/`readVec3Prop`/`setVec3Prop`; identity değerler dosyaya yazılmaz),
  yazarken viewport canlı. **Gizmo'lar:** `ActorScriptViewport`'a `TransformControls`
  + köşe toolbar (Select/Move/Rotate/Scale; Select varsayılan → read-only his korunur);
  seçili node'un `Group`'una bağlanır, sürükleme grubun local transform'unu
  `onTransformNode(nodeId, {position, rotation°, scale})` ile editöre canlı yazar →
  `applyNodeTransform` props + Details inputs + ham JSON'ı senkron tutar ve build
  imzasını ilerleterek **drag sırasında rebuild jank'ını** önler. Gizmo-handle/drag
  sırasında kamera orbit/pan bastırılır (`transformControls.axis` + `gizmoDragging`);
  rebuild'de detach, dispose'da `transformControls.dispose()`. **Plumbing:**
  `EditorUi`/`ActorScriptEditor` `assets` option'ı artık `name` de taşıyor.
  **Gate:** tsc temiz · engine **189** check · build başarılı. **Karar:** Faz 10'un
  "read-only viewport" kararı, gizmo'lar **opt-in** (Select default) olacak şekilde
  genişletildi. **Kalan:** per-instance override, Play modu, behavior stub (Faz 8).

- *2026-06-19* — **Actor Script Faz 10 — editör 3D viewport (tamam).**
  `ActorScriptEditor`'ın placeholder kartı, sınıfın component-ağacını canlı render
  eden gerçek bir 3D viewport ile değiştirildi (checklist:
  `docs/completed/ACTOR_SCRIPT_SYSTEM_CHECKLIST.md` Faz 10). **Mimari:** saf, three.js'siz,
  test edilebilir `engine/scene/actorPreview.ts` (`actorPreviewNodes(def)` → tüm
  ağacı koruyan flat preview-node listesi; runtime `actorInstanceToEntity`'nin
  flat-collapse'inin aksine **çoklu node + parent-child** korunur). Render tarafı
  editör-only ayrı modül `src/editor/ActorScriptViewport.ts` (StaticMeshEditor
  viewport deseni: kendi `WebGLRenderer`/`PerspectiveCamera`/`Scene`/grid/2 dir-ışık;
  spherical orbit/pan/dolly; `ResizeObserver`; RAF). **Derleme:** her preview node
  bir `Group` (local TRS props'tan), `parent` ile three sahne grafiğine bağlanır →
  world transform otomatik compose. MeshRenderer → kendi `GLTFLoader`+`MeshoptDecoder`,
  path-cache'li yükleme + clone, gelene kadar placeholder kutu; Collider → shape
  wireframe (sensor farklı renk); Light → engine `lights` helper'ları
  (`createLightObject`/gizmo); Audio/Particle/Interaction/Behavior/Metadata → glyph
  sprite marker. **Seçim senkronu:** node id → `Group` map + `BoxHelper`
  (her kare `update()`); ağaç seçimi viewport'u vurgular, viewport tıklaması
  (`userData.nodeId` raycast) ağacı seçer; Details prop edit'i debounce'lu rebuild
  ile canlı yansır. **Perf/lifecycle:** component-ağacı imzası değişmedikçe rebuild
  atlanır (seçim-only render rebuild etmez); build kaynakları (geom/mat/texture/
  light-gizmo) her rebuild'de + dispose'da temizlenir, clone'lar paylaşımlı → cache
  teardown'da bir kez dispose. **Plumbing:** `EditorUi.openActorScriptEditor` artık
  `assets` (id/type/path) geçiyor → editör model path'lerini çözüyor; viewport CSS
  (canvas %100 + hint rozeti). **Gate:** tsc temiz · engine 185 → **188**
  (`actorPreviewNodes` testleri) · build başarılı. **Kalan:** per-instance override
  authoring, behavior stub üretimi (Faz 8). Kapsam dışı: skeletal anim, gerçek
  malzeme/UVW, gölge kalitesi.

- *2026-06-19* — **Actor Script Faz 7 Slice 3 — editör-içi yerleştirme (tamam).**
  Placed Actor Script class instance'ları artık editörde birinci-sınıf nesne
  (checklist: `docs/completed/ACTOR_SCRIPT_SYSTEM_CHECKLIST.md` Faz 7 Slice 3). **Kullanıcı
  kararları:** kapsam = **tam** (sürükle-bırak + seç + gizmo + sil + undo/redo);
  edit-mode görsel = **gerçek mesh (WYSIWYG)**; per-instance override = **ertele**.
  **Kimlik/seçim:** `editor/core/selection.ts`'e `actor` union üyesi (index-bazlı,
  `character` desenini izler) + clone/id/parse/equal + compareActor\*; `picking.ts`
  `findParentActor` (`userData.actorIndex`); `scenePicker` pick + self-hit. **Okuma
  modeli:** `sceneObjects.ts` outliner satırları + Details view-model;
  `metadataSchema` actor target'ı per-instance şema taşımaz (sınıfta yaşar).
  **Render (SceneApp):** RuntimeSceneApp'in classRef çözme/mesh yükleme mantığı
  edit sahnesine taşındı — `resolveActorClass` (cache) + `loadActorMeshModels` +
  `buildActorObject` (`createCharacterSceneObject` ile gerçek mesh; mesh'siz logic/
  trigger actor'lar için placeholder marker). `getMutableTransform`/captureTransform/
  refreshSelectionObject/applyName/applyVisibility/getAllSelections/getSelectionLabel/
  hasSelection/getSelectionWorldBox/createSelectionOutlineTarget + pickable
  supplier'ları `actor`'ı işler. **Yerleştirme:** `bindings.onActorClassDrop`
  (`application/x-forge-actor-class`) → `SceneApp.addActorAt` (çöz + mesh yükle +
  undoable yerleştir + seç); `*.actor.json` Content kartları sürüklenebilir
  (classRef = public-relative yol); `EditorSceneController` actor sil + tekli/çoklu
  duplicate (host `insert/removeActorPlacement`). Details actor'da transform-only
  (collision/physics/components/metadata bastırıldı — override ertelendi).
  **Save:** `saveLayout` `this.layout`'u (actors[] dahil) gönderir; validator zaten
  allowlist'liyor. **Gate:** tsc temiz · engine 179 → **181** (actor id-sync +
  cloneActorInstance round-trip) · build başarılı. **Kalan:** editör viewport'unda
  3D component önizleme, per-instance override authoring, behavior stub üretimi (Faz 8).

- *2026-06-19* — **Actor Script Faz 7 — Instance/Spawn katmanı (runtime yarısı).**
  Placed Actor Script class → runtime spawn dikey kesiti kuruldu (checklist:
  `docs/completed/ACTOR_SCRIPT_SYSTEM_CHECKLIST.md` Faz 7). **Veri modeli:**
  `LayoutActorInstance { classRef, transform, hierarchy/flags }` +
  `RoomLayout.actors?` (`engine/scene/layout.ts`); `overrides` ertelendi (Sınıf ≠
  Instance korunur). **Saf spawn çekirdeği:** yeni `engine/scene/actorInstance.ts`
  — `actorInstanceToEntity(def, instance, index)` sınıf component-ağacı + instance
  transform'unu **tek** entity'ye çöker (headless test), `actor:<i>` id
  helper'ları. **v1 collapse (dokümante):** düz entity = tip başına tek component
  → her türden ilk node kazanır; instance transform otoriter (root Transform node
  yok sayılır); event binding'ler tek Behavior'a çöker (ilk binding, yoksa Behavior
  node). **Runtime:** `RuntimeSceneApp` classRef'leri çözer (cache'li, hatada boş
  `actor` sınıfına düşer — sahne kurulmasını bozmaz), actor mesh asset'lerini
  manifest'e karşı guard'lı yükler, tek-Object3D (character) render yolunu yeniden
  kullanır, entity'leri sahne dokümanına ekleyip `physics`/`behavior.setEntities`
  ile bağlar; `actor:<i>` transform-sync render yoluna eklendi (behavior-sürücülü
  hareket/spin objeyi günceller). **Save:** `validateActorInstance` + `validateLayout`
  `actors[]` allowlist (`tools/saveValidator.ts`) → `/__save-layout` actor'ları
  korur. **Gate:** tsc temiz · engine 175 → **179** · build başarılı (game bundle
  79.2→84.0 kB, editör sızıntısı yok). **Nerede durdu / karar:** Slice 3 = editör-içi
  yerleştirme (content'ten sürükle-bırak + seç + gizmo + outliner) **bir sonraki
  oturuma bırakıldı**; kapsam (tam birinci-sınıf nesne vs. minimal "Place in Level")
  açık. Drop pipeline: `editor/input/bindings.ts:onAssetDrop` desenini izle, yeni
  `application/x-forge-actor-class` payload'ı + editör seçim union'ına (`editor/core/
  selection.ts`) `actor` türü ekle. Kullanıcı başka bilgisayardan devam edecek.

- *2026-06-19* — **Actor Script (Blueprint) sistemi — authoring dikey kesiti.**
  Unreal Actor Blueprint'in Forge'a uygun, **veri-odaklı** versiyonu kuruldu
  (rapor + checklist: `docs/completed/ACTOR_SCRIPT_SYSTEM_CHECKLIST.md`). **Karar:** görsel
  node grafiği **yok** — event = `scriptId + params`, mantık TS'te (`src/game/`),
  AI yazar; editör sadece parametreleri yüzeye çıkarır. **Veri modeli:**
  `engine/scene/actorScript.ts` (`ParentClass`, `ComponentTemplateNode`,
  `EventBinding`, `ActorScriptDef` + defensive `normalizeActorScriptDef`; eski
  `type:"script"` stub'ı boş `actor` sınıfına düşer). **Authoring:** sağ tık →
  **Script** artık **Pick Parent Class** modalı (Actor/Pawn/Character/Player
  Controller/Game Mode Base) açıp `<name>.actor.json` yaratıyor (parent class
  seed'li); Content Browser'da çift tık → **ActorScriptEditor** overlay (dinamik
  import, editor-only): Components ağacı + My Blueprint Variables (sol), Viewport
  placeholder + Event Graph bindings (orta), Details (sağ), Compile/Save/Browse/
  Play toolbar. Compile = yapısal validate (benzersiz id, parent ref, döngü,
  benzersiz key, boş scriptId) + kayıtsız script uyarısı. Yeni `/__save-actor`
  endpoint + `validateSaveActorPayload`; `BEHAVIOR_SCRIPT_IDS` export'u öneriler
  için. tsc temiz · build yeşil · 175 engine check. **Nerede durdu / sıradaki:**
  3D viewport önizleme; **instance/spawn katmanı** (`classRef` ile level'a
  yerleştir + runtime spawn — Faz 7); behavior stub üretimi (Faz 8).

- *2026-06-19* — **§3 Particle: efekt-asset dropdown + autoPlay + VFX renderer
  (effectId→manifest fx + ilk renderer).** Kullanıcı doğru itirazı: component
  eklemek inline bir parçacık sistemi *authorlamak* gibiydi; doğrusu **önceden
  oluşturulmuş bir efekti seçmek**. Starter content'te 4 hazır efekt zaten var:
  `public/assets/starter-content/Effects/FX_*.effect.json` (schema-1: rate/
  lifetime/start+endSize/velocity/spread/materialMode/color/loop), manifest'te
  `starter-fx-*` id'leriyle. **P1 authoring:** EditorUi Particle kartı artık
  `effectId` için `.effect.json` asset'lerinin **dropdown'ı** (assetPath suffix
  ile filtre) + **Auto Play** toggle; inline emitter param alanları (rate/
  lifetime/size/velocity/material/loop/worldSpace) **kaldırıldı** (asset = tek
  kaynak); "Add Particle" default'u ilk efekt + autoPlay:true; eski inline alanlar
  commit'te korunur ama düzenlenmez. (autoPlay/component zaten Track A'da vardı —
  motor değişmedi.) **P2 renderer:** yeni `engine/render-three/particleEffect.ts`
  — saf `parseEffectDefinition` (schema-1 doğrula, headless test) + `ParticleEffect`
  sınıfı: `THREE.Points` + ShaderMaterial (yumuşak yuvarlak nokta, color tint,
  additive/alpha blend), CPU sim (rate ile spawn, age→lifetime, startSize→endSize,
  velocity+spread, fade), kapasite ≈ rate*lifetime; loop=false bir lifetime
  penceresi yayıp biter. `RuntimeSceneApp`: `effectUrlById` (manifest .effect.json
  → URL), `playAutoPlayParticles(sceneDocument)` autoPlay parçacıkları entity
  pozisyonunda spawn eder (effectId→URL→fetch+parse, cache), frame loop
  `updateParticleEffects(dt)` ile ilerletir, biten one-shot'ları sahnedan kaldırıp
  dispose eder. **Test:** engine-tests 164 → **165** (parseEffectDefinition valid+
  reddetme+fallback); renderer Three.js'e özgü (headless edilmez, diğer
  render-three gibi). **Sınır/karar:** texture yok (renkli yumuşak nokta);
  3B konumsal değil ama parçacıklar zaten entity konumundan dünya-uzayında
  yayılıyor; gl_PointSize perspektif ölçeği yaklaşık. Starter efektlerin hepsi
  loop:false (kısa puff) → görmek için loop:true efekt author'lanmalı (.effect.json).
  **Gate:** particle kodu tip-temiz + engine 165 yeşil; full `build:verify` hâlâ
  kullanıcının `SceneApp.ts` material-slot WIP'i (9 tsc hatası) yüzünden kırmızı,
  particle ile ilgisiz. **Kalan:** editör-içi efekt authoring (şu an .effect.json
  elle); texture'lı parçacık; gerçek 3B spatial.
- *2026-06-19* — **§3 Audio component: manifest sound dropdown + autoPlay +
  dosya çalma.** Kullanıcı isteği: Audio component'te `clipId` serbest metin
  yerine **açılır liste** olsun (manifest'teki `sound` asset'leri), seçilen ses
  Play'de çalsın. Kararlar: **Play'de otomatik (autoPlay) + global 2B** (3B
  spatial ertelendi; `spatial` alanı veride duruyor ama global çalınıyor).
  **Authoring:** `LayoutAudio`/`AudioComponent`'e `autoPlay?` (adapter +
  save-validator allowlist `validateAudio`); `EditorUi` Audio kartında `clipId`
  artık `this.editableAssets`'ten `assetType==="sound"` filtreli bir `<select>`
  (id→displayName; mevcut değer listede yoksa korunur, ör. ton `collision-chime`),
  bir de "Auto Play" toggle; "Add Audio" default'u **ilk sound asset +
  autoPlay:true** (eklenince hemen duyulabilir). **Playback:** `AudioSubsystem`
  artık ton-dışı clipId'leri enjekte edilen `resolveClipUrl(clipId)` ile bir dosya
  URL'ine çözer → `fetch`+`decodeAudioData` (URL bazlı promise-cache) →
  `AudioBufferSource` + gain(volume), loop; `resumeContext()` eklendi.
  `RuntimeSceneApp`:
  `soundUrlById` (manifest `sound` → `projectFileUrl(assetPath)`) AudioSubsystem'e
  resolver olarak verilir; sahne kurulunca `playAutoPlayAudio(sceneDocument)` her
  `autoPlay` audio'yu çalar; tarayıcı autoplay politikası için ilk
  pointer/keydown'da `resumeContext` (one-shot). **Tarayıcı kısıtı:** ambient ses,
  autoplay politikası nedeniyle ilk kullanıcı tıklaması/tuşuna kadar başlamayabilir
  → ilk gesture'da resume edilir. **Test:** engine-tests 163 → **164** (audio
  autoPlay adapter round-trip + validator allowlist); dosya çalma yolu web-audio'ya
  özgü, headless test edilmez (ton yolu gibi). **Mevcut clipId="collision-chime"
  (ton, temasla) bozulmadan çalışır** — resolver önce ton manifestini dener.
  **Gate durumu:** audio kodu tip-temiz + engine 164 yeşil; ama `npm run
  build:verify` şu an **kullanıcının paralel material-slot WIP'i** (`SceneApp.ts`
  `applyMaterialSlot`/`isMaterialAsset` eksik, 9 tsc hatası) yüzünden kırmızı —
  audio değişiklikleriyle ilgisiz, o iş bitince yeşile döner. **Kalan:** 3B
  konumsal ses; gerçek ses-dosyası import UI'si (şu an dosyalar manifeste elle/
  script'le giriyor).
- *2026-06-18* — **§3 Track B — Slice B-3: headless test kapsamı.** B-1/B-2'yi
  kilitleyen testler (tools/engine-tests.ts: 162 → **163 check**): (1) mevcut
  "EditorSceneController applies Details edits to the multi-selection" testi
  Interaction/Audio/Behavior/Particle için **set + undo** (multi-select, generic
  `setSelectionOptionalComponent` üzerinden) ile genişletildi; (2) yeni
  `clonePlacement`/`cloneCharacter` testi component alanlarının **korunduğunu ve
  derin kopyalandığını** sabitler (B-2'de düzeltilen duplicate/paste
  regression'ı — params/velocity mutasyonu kaynağı etkilemez). `npm run
  build:verify` yeşil. **Polish (B-4, bitti):** particle `velocity` artık Details'te
  düzenlenebilir vec3 satırı (`.detail-vector` yapısı, üç eksen boşken velocity
  temizlenir, boş eksen 0 okunur) — particle editöründe artık "edit in JSON"
  kalan tek alan behavior `params`. **Kalan (opsiyonel polish):** Collision/
  Physics/Metadata'yı kart çatısına alma. **Kalan §3 (büyük):** Track C
  (`SceneObjectBase`+`components[]` saved-format göçü, B4) + particle
  `effectId`→manifest fx.
- *2026-06-18* — **§3 Track B — Slice B-2: birleşik "Add Component" menüsü +
  Audio/Behavior/Particle component'leri.** Details panel artık tam bir
  optional-component editörü: seçili objede **Audio / Behavior / Particle /
  Interaction** her biri Remove'lu bir kart, ve absent olanlar tek bir **"Add
  Component"** menüsünde. **Add/Remove/edit'in hepsi tek undo/redo command.**
  Controller'da B-1'in tekrarını DRY'lamak için generic
  `setSelectionOptionalComponent<T>({read,write,clone,equals,label}, value)`
  eklendi; dört ince public metod (`setSelectionInteraction/Audio/Behavior/
  Particle`) bunu çağırır (B-1'in `applyInteraction`'ı kaldırıldı). Clone'lar tek
  kaynağa toplandı: `cloneBehavior`/`cloneParticle` `editor/core/layoutSnapshots`'a
  eklendi ve **`clonePlacement`/`cloneCharacter` artık behavior/particle/
  interaction'ı da kopyalıyor** — önceki gap: duplicate/paste bu component'leri
  düşürüyordu (audio kopyalanıyordu, diğerleri değil). Üç alanı
  `MutableHierarchyTransform`, `EditableSelection` ve `buildEditableSelection`
  (instance+character) taşır; `SceneApp` üç delegator; `EditorUi` render+bind+commit
  (`renderComponentsSection`/`componentCard`/`render*Fields`/`commit*Input`/
  `addComponent`/`removeComponent`). **Karar/sınır:** Particle UI scalar/bool/
  select alanları açar; `velocity` (vec3) ve behavior `params` UI'da düzenlenmez
  ama **korunur** (commit `this.selected`'tan türetir) + "edit in layout JSON"
  ipucu. Add default'ları: audio=`collision-chime`, behavior=`spin`,
  particle=`fx.smoke_soft_01`, interaction=`interact` (hepsi save-validator'ı
  geçen non-empty zorunlu alanlar). `npx tsc --noEmit` temiz, `npm run
  build:verify` yeşil (build, 162 check, strict dist scan PASS). §3 checklist'te
  Track B'nin 4 maddesi (Details=component editor, Add/Remove Component,
  Transform silinemez, undo/redo) [x]. **Sıradaki (opsiyonel):** Collision/
  Physics/Metadata'yı da kart çatısına almak; particle velocity için vec3 satırı;
  kalan §3 = Track C (`SceneObjectBase`+`components[]` saved-format göçü, B4) +
  particle `effectId`→manifest fx.
- *2026-06-18* — **§3 Track B başladı — Slice B-1: Interaction component'i
  Details panel'de (Add/Remove/edit + undo).** Component-editör UX'inin ilk
  dikey dilimi: seçili obje artık Details'te bir **Interaction** bölümü taşıyor —
  yoksa "Add Interaction" butonu, varsa action/prompt/enabled/cooldown alanları +
  "Remove". **Add/Remove/edit'in üçü de tek undo/redo command** (mevcut
  `setSelectionCollisionPreset` kalıbı birebir yeniden kullanıldı). Dikey 5
  dosya: `EditableSelection.interaction?` (`editor/core/editableScene.ts`),
  `buildEditableSelection` instance+character için kopyalar
  (`editor/core/sceneObjects.ts`), `EditorSceneController.setSelectionInteraction`
  (+ `applyInteraction`/`interactionsEqual`/`cloneInteraction`,
  `MutableHierarchyTransform.interaction?`), `SceneApp` delegator, `EditorUi`
  render+bind (`renderInteractionSection`/`bindInteractionInputs`/
  `commitInteractionInput`) + `.detail-component-title` CSS. **Karar/yaklaşım:**
  saved format hâlâ legacy düz alanlar; "component" = bir opsiyonel alan-grubunun
  varlığı (Track C `components[]` göçü gerekmedi). Zorunlu **Transform**'un
  remove'u yok (silinemez kuralı bu component için yerinde). `npx tsc --noEmit`
  temiz, `npm run build:verify` yeşil (build, 162 check, strict dist scan PASS;
  editör dinamik import → game bundle'a sızmıyor). **Test notu:** controller
  komutu için headless test eklenmedi — mevcut benzer komutlar (collisionPreset/
  metadata) da unit-test edilmiyor (controller host mock'u yok); veri yolu
  (validator round-trip + adapter + runtime) Steps 1–3'te zaten kaplı.
  **Sıradaki (Track B devamı):** aynı kalıpla Audio/Behavior/Particle
  component'leri + birleşik "Add Component" menüsü + mevcut Collision/Physics/
  Metadata bölümlerini component-editör çatısı altına alma. §3 checklist'te
  Track B maddeleri kısmî → henüz [ ] (B-1 tek component).
- *2026-06-18* — **§3 Actors & Components — Track A (veri modeli) tamam +
  Interaction runtime.** Eksik iki component eklendi → **resmi component
  listesi (9/9) artık engine'de tanımlı**: `ParticleEmitterComponent` ve
  `InteractionComponent` (`engine/scene/components.ts`, reader'larla;
  `ParticleMaterialMode` layout'ta tek kaynak, components import eder → dairesel
  bağımlılık yok). **Authoring path uçtan uca**: `LayoutPlacement/Character`'a
  `particle?` + `interaction?` alanları (`engine/scene/layout.ts`), adapter
  eşlemesi (`legacyRoomLayoutAdapter` → `particleEmitterComponent`/
  `interactionComponent` helper'ları + `toData` union genişledi), **save-validator
  allowlist** (`tools/saveValidator.ts`: `validateParticleEmitter`/
  `validateInteraction` → `applyTransformFields`; CLAUDE.md gotcha'sına uyuldu).
  **Interaction runtime** (kullanıcı kararı: önce bu, sensor/goal kalıbı yeniden
  kullanılarak): saf çekirdek `src/game/interaction.ts` (`stepInteractionTrigger`
  — edge-tetikleme `overlapping && !wasOverlapping` + dt-tabanlı cooldown, held
  overlap re-fire etmez, disabled hiç fire etmez); `interact` behavior
  (`src/game/behaviors.ts`) goal-reached'in sensor+contact kalıbını kullanır,
  `context.interactionComponent` okur, ilk temasta `playAudioCue` + `onInteraction(
  entityId, action)` tetikler (cooldown sonrası re-enter'da tekrar fire eder).
  `BehaviorContext`'e `interactionComponent?` eklendi (audioComponent gibi
  okunur/iliştirilir). `RuntimeSceneApp` `onInteraction`'ı `console.info`'a bağlar
  — **HUD yok (G6 kararı: ses + log)**. Authoring sözleşmesi (goal-reached gibi):
  `interaction:{action,...}` + `sensor:true` + `behavior:{script:"interact"}`.
  Headless testler (tools/engine-tests.ts: 153 → **162 check**): particle/
  interaction reader (full + reddetme), adapter eşleme round-trip, validator
  allowlist round-trip, `stepInteractionTrigger` (fresh-enter/held/re-enter +
  disabled/cooldown), gerçek `interact` behavior entegrasyonu (sensor enter →
  fire+cue, held re-fire etmez). `npm run build:verify` yeşil (build, 162 check,
  strict dist scan PASS). **Bilinçli ertelendi (B4):** tam Three.js particle/
  VFX renderer + `effectId`→manifest fx asset bağlama (fx asset tipi henüz yok;
  kullanıcı "Burada dur" yerine Interaction runtime'ı seçti). **Checklist:**
  "component listesini tanımla" + "particle'ı component üzerinden modelle" [x];
  "effectId manifest'e bağla" ile Track B (Details=component editor, Add/Remove
  Component, undo/redo) ve Track C (`SceneObjectBase`+`components[]` saved-format
  göçü) hâlâ [ ]. Sıradaki §3 işi Track B veya kalan particle bağlama.
- *2026-06-16* — **G6 bitti — Gameplay/Runtime track'i (G1–G6) tamam.** Authored
  oynanabilir örnek sahne: yeni `public/layouts/playground.json` (player start,
  6×6 zemin, yön değiştirten bir duvar + kanepe engel, ve kuzeyde **sensor** goal
  plant); manifest `defaultScene` buna çevrildi (render-test-room test sahnesi
  olarak kaldı). **Sensor-collider authoring** eklendi (G3'ün varsaydığı ama
  eksik olan parça): `LayoutPlacement/Character.sensor?: boolean`
  (`engine/scene/layout.ts`) → adapter `colliderComponent` isSensor'a çevirir;
  save-validator allowlist'e işlendi (`tools/saveValidator.ts` applyTransformFields).
  Sensor collider G3'te zaten blocker dışı (staticBlockerAabbs sensörleri atlar),
  yani goal engellemez, içine girilir. Yeni **`goal-reached`** behavior'u
  (`src/game/behaviors.ts`): statik sensöre tek temas edebilen kinematik oyuncu
  ilk temasta ses cue'su (chime, once) + enjekte `onGoalReached` callback'i bir
  kez tetikler (collision-chime'ın temas+once kalıbını yeniden kullanır; reachedGoals
  registry-closure). `RuntimeSceneApp` onGoalReached'i console.info ile bağlar —
  **HUD yok (kullanıcı kararı: ses + log)**. Headless testler (tools/engine-tests.ts:
  88 → 92 check): sensor→non-blocking collider, sensor allowlist, goal-reached
  once+cue+sinyal+blocker-değil, playground validate+idempotent+goal taşıyor.
  `npm run build:verify` yeşil. **Sınırlama (G3'ten devam):** collider'lar hâlâ
  birim-küp `[1,1,1]*scale`; engel/goal sınırları görsel mesh'le birebir hizalı
  değil — mesh-bounds collider + decor `collision:false` ayrı içerik işi. **§5
  guardrail korundu:** runtime state layout'a yazılmaz (RuntimeSceneApp kaydetmez).
  Track tamamlandı; sıradaki iş Backlog'dan (B1–B4) seçilir.
- *2026-06-16* — **G5 bitti (harekete bağlı animasyon durumları).** Yeni saf
  seçici `src/game/locomotionAnimation.ts`: iki katman — `classifyLocomotion(
  {planarSpeed, grounded, velocityY}, thresholds)` semantik durum (idle/walk/run/
  jump/fall) üretir (havadayken planar hızı **ezer**: yükseliş=jump, iniş=fall;
  zeminde walk/run eşik ile) ve `resolveLocomotionClip(state, available)` durumu
  **fallback zinciriyle** asset'te gerçekten var olan bir klibe çevirir (run→
  sprint, jump/fall→idle gibi → asset eksik klipte T-pose'a düşmez, idle'a
  zarifçe iner). `selectLocomotionClip` ikisini birleştirir. Üçü de saf, headless.
  Üç.js tutkalı generic: `engine/render-three/characterAnimator.ts` —
  `CrossfadeAnimator` bir `AnimationMixer`'ı tüm kliplerle sarar, `play(name,
  duration)` ile isimle crossfade eder (ilk oynatış/duration≤0 snap); mixer'ı
  `AnimationSubsystem` tickler. `input-move` davranışı (`src/game/behaviors.ts`)
  her tick **niyet** planar hızını + grounded + velocityY'yi yeni opsiyonel
  `reportLocomotion(entityId, snapshot)` sink'i ile raporlar (niyet hızı →
  duvara bastırınca idle'a donmaz, yürür/koşar). **Sprint:** `Shift` →`sprint`
  action'ı eklendi; `input-move` sprint tutulunca `speed*sprintMultiplier`
  (default 2) uygular → run durumuna erişilir. `RuntimeSceneApp` (runtime shell)
  oyuncuya `CrossfadeAnimator` kurar (authored idle'a snap), sink'i player
  entity'sine bağlar, her frame `updateCharacterAnimation` ile seçilen klibi
  crossfade'ler; oyuncu-olmayan karakterler tek authored klipte kalır. Headless
  testler eklendi (tools/engine-tests.ts: 82 → 88 check) — classify (eşik +
  airborne öncelik), resolve fallback zinciri (zengin/seyrek/boş set), select
  uçtan uca, CrossfadeAnimator clip/current defteri, gerçek `input-move`
  rapor+sprint entegrasyonu. `npm run build:verify` yeşil (build + 88 check +
  strict dist scan). **Karar/Açık soru kapandı:** demo karakter (Kenney Blocky)
  `idle/walk/sprint` taşıyor ama `jump/fall` **taşımıyor** → airborne fallback
  ile idle'a iner (G5'i idle/walk'a sınırlamak gerekmedi; run sprint-key ile
  gerçek). Layout değişmedi (karakter zaten `animation:"idle"` + `input-move`).
  Sıradaki: **G6** (authored oynanabilir örnek sahne).
- *2026-06-16* — **G3 bitti (çarpışma yanıtı — A Seçeneği, saf AABB).** Yeni saf
  helper `src/game/collision.ts`: `resolvePlanarMovement(position, {dx,dz}, half,
  blockers)` — önerilen XZ hareketini statik collider AABB'lerine karşı çözer;
  X ve Z **ayrı** çözülür → duvar boyunca **kayma**; düşey span **gate**'i (kısa
  engeli atlama); ve **yalnızca yeni penetrasyon** çözülür (başlangıçta zaten
  örtüşen blocker bırakılır → oyuncunun üstünde durduğu zemin/halı hareketi
  dondurmaz, ön-örtüşmeden snap yok). `PhysicsQuery` (engine) iki generic sorgu
  ile genişletildi: `staticBlockerAabbs()` (statik, non-sensor) ve
  `colliderHalfExtents(id)`; `PhysicsSubsystem` `bodyAabb`/size*scale'den
  uygular (placeholder+rapier her ikisinde `this.bodies`'ten). `input-move`
  planar adımı uygulamadan önce blocker'lara karşı çözer, yön çözülmüş harekete
  bakar; chime korunur; fizik/collider yoksa ham harekete döner. Headless
  testler eklendi (tools/engine-tests.ts: 75 → 82 check) — no-blocker, head-on
  block + diagonal slide, düşey gate, zemin (ön-örtüşme), çoklu blocker, fizik
  sorgu metodları, gerçek `input-move` duvar entegrasyonu. `npm run build:verify`
  yeşil. **Karar:** A Seçeneği (saf AABB) seçildi; Rapier KCC (B) gerekmedi.
  **Sınırlama (bilinçli, G3 dışı):** collider'lar hâlâ `size [1,1,1]*scale`
  birim-küp yaklaşımı (adapter default'u) — görsel mesh sınırlarıyla birebir
  örtüşmez; mobilya/duvar engeller ama kenarlar görselle tam hizalı değil. Mesh
  bounds'tan collider boyutlandırma + decor için `collision:false` ayrı içerik/
  takip işi. Sıradaki: önerilen sıraya göre **G5** (harekete bağlı animasyon).
- *2026-06-16* — **G2 bitti (yerçekimi, zemin & zıplama).** Yeni saf helper
  `src/game/verticalMotion.ts`: `stepVerticalMotion(prev, {gravityY, jumpSpeed,
  floorY, dt, jump})` + `groundedAt(y)`. Jump impulse yalnızca **zeminde + basış
  edge'inde** (`actions.pressed("jump")`, held değil) → havada çift zıplama yok;
  yerçekimi hızı entegre eder; zemini geçince `floorY`'ye clamp + grounded.
  `input-move` davranışı (`src/game/behaviors.ts`) düşey hareketle genişletildi:
  düşey durum **registry instance closure'ında** tutulur (modül-global değil →
  sahne yeniden yüklemede taze, sızıntı yok), ilk tick authored y'yi floor olarak
  yakalar. **Yerçekimi kaynağı (§4 düzeltmesi):** behavior'a gömülmedi —
  `LayoutWorldSettings`'e minimal-additive `gravity?: Vec3` eklendi
  (`engine/scene/layout.ts`), save-validator allowlist'ine işlendi
  (`tools/saveValidator.ts` `validateWorldSettings`), `resolveSceneWorldSettings`
  default `[0,-9.81,0]` ile çözüyor, `RuntimeSceneApp` çözülmüş gravity'yi
  behavior registry'ye `getGravityY` provider'ı ile veriyor. jumpSpeed gameplay
  param'ı (default 4). Headless testler eklendi (tools/engine-tests.ts: 69 → 75
  check) — rest/jump/arc/no-double-jump/paused + gerçek `input-move` jump
  entegrasyonu + gravity allowlist + resolve override. `npm run build:verify`
  yeşil. **Karar:** zemin algısı = sabit `floorY` (authored y); prop-üstü
  ray/AABB probe G3'e ertelendi (G2 açık sorusu kapandı). Demo layout'a gravity
  authored EKLENMEDİ — default uygulanıyor; alan ileride author'lanabilir.
  Sıradaki: **G3** (çarpışma yanıtı — duvardan geçmeyi durdur).
- *2026-06-16* — **Fix (G1 yön): karakter yüzü tersti.** Manuel testte hareket
  yönleri doğruydu ama karakter hareketin tam tersine bakıyordu (180°). Sebep:
  demo karakter mesh'i yerel **`+z`** yönüne bakacak şekilde modellenmiş (Three
  varsayılanı `-z` değil). `facingYawFromMove` `atan2(-dx,-dz)` → `atan2(dx,dz)`
  olarak düzeltildi (kardinaller: forward→180°, back→0°, right→90°, left→−90°).
  Sadece bu fonksiyon + ilgili testler değişti; `build:verify` yeşil (69 check).
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

MyGame/
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

- [x] `project.3dgame.json` dosyasını Forge'un resmi `.uproject` karşılığı kabul et.
- [x] Yeni oyun oluşturma modelini "template repo kopyala + manifest değiştir" olarak koru.
- [x] Şimdilik Project Browser / Launcher route'u geri getirme.
- [ ] İleride ayrı bir `tools/create-project.mjs` script'i yaz.
- [ ] Script şunları yapmalı:
  - template klasörünü kopyala
  - `project.3dgame.json.name` alanını değiştir
  - `package.json.name` alanını değiştir
  - örnek layout/assets temizleme seçeneği sun
- [x] Content Browser'ı veritabanı gibi değil, `public/assets` ve `public/layouts` disk yapısının yansıması olarak geliştir.
- [x] Template içine çalışan örnek sahne, minimum asset manifest ve paketlenebilir runtime bırak.
- [x] Production build kuralını koru: editor UI, authoring middleware, GDD ve raw authoring dosyaları `dist/` içine girmemeli.
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
   id, assetType, path, thumbnail, category, tags, placement rules

3. Editor görünümü
   seçili klasör, arama, filtre, thumbnail boyutu, favoriler
```

## Önerilen Manifest Entry

```json
{
  "id": "furniture.sofa_01",
  "name": "Sofa 01",
  "assetType": "staticMesh",
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
⚠ model path missing
⚠ no collision setting
⚠ unsupported extension
⚠ asset in manifest but file missing
⚠ file exists but not in manifest
```

Not: too many triangles ve texture too large kontrolleri suresiz ertelendi; bu kontroller gercek asset analizoru gerektirir.

## Checklist

```md
# Content Browser Checklist

- [x] `public/assets/manifest.json` dosyasını Content Browser'ın ana veri kaynağı yap.
- [x] Layout dosyalarına absolute file path yazmayı yasakla; sadece `assetId` veya manifest referansı yaz.
- [x] Asset manifest entry'lerini standartlaştır:
  - `id`
  - `name`
  - `assetType`
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
  - Type filters
  - Asset cards / Asset View
- [x] Asset kartlarında thumbnail + assetType + temel metadata göster.
- [x] Asset drag-drop akışını `assetId -> Actor/LayoutPlacement -> runtime loader` şeklinde kur.
- [ ] `public/assets/metadata-schema.json` ile Details panel metadata alanlarını Content Browser metadata'sından ayrı ama uyumlu tut.
- [x] Basit health-check uyarıları ekle:
  - manifest path missing
  - unsupported file type
  - missing placement rule
  - no collision setting
- [ ] Collections sistemini hemen yapma; önce Favorites / Recently Used gibi küçük bir ID listesiyle başla.
- [x] Editor içi import sistemini ertele; önce `tools/import-asset.mjs` gibi script tabanlı import düşün.
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

- [x] `Asset` ile `Actor / SceneObject` ayrımını resmi mimari kural yap.
- [x] Three.js `Object3D` nesnesini Actor modelinin kendisi yapma.
- [ ] Layout dosyalarının sadece stable ID, transform, component datası ve asset referansı tutmasını sağla.
- [x] Editor-only state'i Actor/Component datasına karıştırma.
- [x] İlk resmi component listesini tanımla:
  - TransformComponent
  - RenderComponent (engine: `MeshRenderer`)
  - LightComponent
  - ParticleEmitterComponent
  - ColliderComponent
  - AudioComponent
  - InteractionComponent
  - BehaviorComponent
  - MetadataComponent
- [x] Light Actor'ları uzun vadede `TransformComponent + LightComponent` olarak temsil et.
- [x] Particle efektleri `ParticleEmitterComponent` üzerinden modelle. (veri modeli +
  authoring tamam; runtime VFX renderer B4'e ertelendi)
- [ ] `ParticleEmitterComponent.effectId` alanını manifest'teki particle/fx asset'e bağla.
  (ertelendi — fx asset tipi + resolver; bkz. Progress Log 2026-06-18)
- [x] Outliner Actor/SceneObject listelemeli; Component'ler ana outliner nesnesi gibi davranmamalı.
- [x] Details panel Component editor'a dönüşmeli. (optional component'ler —
  Audio/Behavior/Particle/Interaction — kart + Add/Remove; Collision/Physics/
  Metadata hâlâ kendi bölümlerinde, kart çatısına alınması ileri polish)
- [x] Add Component / Remove Component sistemi ekle. (birleşik "Add Component"
  menüsü + her kartta Remove; 4 optional component)
- [x] Zorunlu `TransformComponent` silinemez olsun. (Transform Add/Remove
  listesinde değil; her objede kalıcı)
- [x] Component değişiklikleri undo/redo command üzerinden çalışsın. (add/remove/
  edit tek `setSelection*` command → tek undo/redo adımı)
- [x] Runtime tarafında component'leri class inheritance yerine sistemler yorumlasın.
- [x] Mevcut `LayoutPlacement`, `LayoutCharacter`, `LayoutLightActor` tiplerini hemen kırma.
- [ ] Önce ortak `SceneObjectBase`, sonra optional `components?: ActorComponent[]` ekle.
- [x] Yeni layout alanları eklenirse save validator allowlist'ini güncelle.
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
  "id": "level.main",
  "name": "Main Level",
  "world": {
    "gameMode": "myGame.default",
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

- [x] `public/layouts/<name>.json` dosyasını Forge'un resmi Level karşılığı olarak tanımla.
- [x] `project.3dgame.json` dosyasını Level dosyası gibi kullanma; proje kimliği ve editor/runtime başlangıç config'i olarak tut.
- [x] Layout JSON içine `world` veya `worldSettings` alanı eklemeyi planla.
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
- [x] Grid/snap gibi editor authoring tercihlerini World Settings ile karıştırma.
- [x] Scene Outliner'ın aktif layout actor ağacını gösterdiğini netleştir.
- [x] Runtime spawned actor'ların debug'da görünebileceğini ama layout'a otomatik kaydedilmemesi gerektiğini kural yap.
- [ ] `defaultScene`, `startupScene`, `activeScene` kavramlarını ileride ayırmaya hazır ol.
- [ ] Level Streaming/Sublevels sistemini şimdilik ertele; ama layout formatını ileride sublevel referansı alabilecek şekilde tasarla.
- [x] Game Mode referansını World Settings altında düşün:
  - `world.gameMode`
  - `world.ruleset`
  - `world.spawnProfile`
- [x] Game Mode davranışını editor core'a gömme; runtime game code yorumlasın.
- [x] Level/Layout data ile Save Game data ayrımını resmi kural yap.
- [x] Yeni layout alanları eklenirse save validator allowlist'ini güncelle.
- [x] World Settings değişikliklerini undo/redo command veya açık autosave politikasıyla yönet.
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

- [x] Forge'da resmi kavram olarak `PlaySession` tanımla.
      (gerçeklendi: `GameModeSession` + runtime-only `PlayerState`/`GameState`,
      `src/game/gameModes/types.ts`)
  - Kaynak: saved layout
  - Çalıştırıcı: RuntimeSceneApp
  - State: geçici runtime state

- [x] Play akışını koru:
  - Editor current layout'u kaydeder.
  - Game route `/` açılır.
  - RuntimeSceneApp aynı layout'u yükler.
  - Editor code Game Mode'a import edilmez.

- [x] Play sırasında oluşan runtime değişiklikleri layout'a otomatik yazma.
      (guardrail korundu: session'lar layout'a yazmaz; `types.ts` sözleşmesi
      bunu açıkça not eder; save-validator runtime alanlarını düşürür)
  - Physics sonuçları
  - Spawn edilen actor'lar
  - Mission/save progress
  - Particle/audio runtime state

- [ ] `Keep Runtime Changes` özelliğini ileride ayrı ve bilinçli komut olarak tasarla.
      (YAPILMADI — bilinçli ertelendi, Backlog B4. Guardrail yerinde: runtime
      state hiç yazılmıyor, ama "seçerek geri aktarma" komutu yok.)
  - Sadece authored actor'lar.
  - Sadece allowlisted component/property alanları.
  - Runtime spawned actor'lar otomatik alınmaz.
  - Undo/redo command üzerinden uygulanır.

- [ ] `PlaySessionConfig` modeli düşün:
      (YAPILMADI — kısmi örtüşme var: `defaultPawn` + `playerController`
      sözleşmeleri mevcut; ama `openMode`/`saveBeforePlay`/`startLocation`/
      `debugOverlay`/`playFromHere` modellenmedi. `?debug` overlay ayrı mekanizma.)
  - `openMode`: `newTab | sameTab | popup`
  - `saveBeforePlay`
  - `startLocation`: `defaultPlayerStart | editorCamera | custom`
  - `debugOverlay`
  - `playFromHere?`

- [ ] `Play From Here` özelliğini planla.
      (YAPILMADI — bilinçli ertelendi, Backlog B4. `playOverride` yalnızca
      dokümanda; viewport sağ-tık / session override kodu yok.)
  - Viewport sağ tık noktasından başlat.
  - Layout'a yazma.
  - Sadece geçici session override kullan.

- [ ] Runtime debug kontrolleri eklemeyi planla:
      (YAPILMADI — Backlog B4. `RuntimeSessionControls` (pause/resume/stepFrame/
      restart/stop) kodda yok; `GameModeSession` lifecycle bu hook'lara hazır zemin.)
  - Pause
  - Resume
  - Step Frame
  - Restart
  - Stop

- [x] `Simulate Mode` kavramını şimdilik ertele ama mimari olarak hazır tut.
      (bilinçli ertelendi — "Preview / Simulate / Game ayrımı yapılmayacak"
      kararı; mimari hazır: `GameModeSession` lifecycle + runtime-only state
      yüzeyleri Simulate'i ileride yutabilir.)
  - Editor viewport içinde runtime systems çalışır.
  - Editor araçları açık kalır.
  - Authoring state ve simulation state ayrılır.

- [ ] Possess / Eject kavramlarını TPS/FPS aşaması için not et.
      (KISMİ — Possess yalnızca not edilmedi, **uygulandı**: `GameModeSession.possess`
      + `PlayerControllerDefinition.possess` sözleşmesi. Eject henüz yok.)
  - [x] Possess: player controller'a bağlan.  (uygulandı)
  - [ ] Eject: player'dan çık, debug/editor camera ile gözlemle.  (yok)

- [x] Multiplayer/network Play ayarlarını şimdilik kapsam dışı tut.
      (eklenmedi — kapsam dışı korundu)
- [x] Game Mode ve Editor Mode sınırını testlerle koru.
  - `npm run build:verify`  (geçiyor — 112 check)
  - dist içinde editor UI/authoring middleware bulunmamalı.  (strict dist scan PASS)
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
  completed/SCRIPT_COMMUNICATION_SYSTEM_CHECKLIST.md
  completed/PLAYER_CHARACTER_REQUIREMENTS_CHECKLIST.md
  GAMEPLAY_FRAMEWORK_CHECKLIST.md
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
