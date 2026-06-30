# Mini Golf — Gerçek Fizik (Rapier) Araştırma & Plan

> Tarih: 2026-06-30
> Durum: 🚧 Uygulama başladı — Faz 1 motor köprüleri kodlandı; tam engine gate
> mevcut `asset-path-missing` manifest hataları nedeniyle bloke. **Kapsam
> kararları 2026-06-30'da kilitlendi** (bkz §11).
> Amaç: Topu, kendi 2.5B arcade çekirdeği yerine **gerçek 3B rigid-body**
> simülasyonuyla sürmek; topun **havalandığını görmek**, **çarpışmaları
> hissetmek** (sekme + geri bildirim), **spin/curve** ile oynamak, eğimde
> gerçekçe yuvarlanmak ve deliğe **fiziksel olarak düşmek**.
> Statü işaretleri: ✅ bitti · 🚧 devam · ⬜ yapılacak · ⚠️ karar/risk

---

## 0. Bu plan neyi değiştiriyor (önemli)

[`docs/GDD.md`](../GDD.md)'nin **2. tasarım sütunu** şu an net biçimde *"özel
arcade fizik; oyun build'i bir fizik motoruna (Rapier) bağlı değildir;
deterministik/replay"* diyor. Kullanıcı isteği bu kararı **geçersiz kılıyor**:
gerçek fizik, havalanma ve tokuşma hissi isteniyor.

- GDD sütun #2 güncellenecek (bu planın çıktısı stabilize olunca).
- "Saf, deterministik, headless test edilebilir çekirdek" garantisi **kısmen**
  kaybolur (bkz. §8 Test). Determinizm Rapier'in adımına ve WASM'a bağlanır.
- Replay/ghost özelliği (GDD'de geçiyordu) bu kararla riske girer; kapsam dışı
  bırakılması önerilir.

---

## 1. Hedef ve başarı ölçütü

"Gerçek fizik" somut olarak şu davranışlar demek:

1. **Havalanma:** Rampadan/tümsekten yeterli hızla geçen top yerden kalkar
   (`v.y > 0`), havada süzülür, parabol çizer ve düşer. (Mevcut model topu
   yüzeye "yapıştırır" — dikey hız hep 0.)
2. **Tokuşma hissi:** Duvara/engele çarpınca top fiziksel olarak seker; çarpma
   şiddetine göre **geri bildirim** tetiklenir (ses + kısa kamera sarsıntısı +
   opsiyonel partikül).
3. **Yuvarlanma + spin:** Top görsel olarak gerçek açısal hızla döner (Rapier
   tam quaternion verir) — kayma değil yuvarlanma. İleride backspin/yan dönüş.
4. **Eğim dinamiği:** Yamaçta yerçekimi + sürtünme + yuvarlanma ataleti doğal
   gelir; topun green'de "ölmesi" gerçekçi olur.
5. **Deliğe düşme:** Top kenardan teğet geçerse takılıp döner (lip-out), yeterli
   yavaşsa fincanın içine fiziksel olarak düşer.

**Kabul kriteri (vertical slice, Delik 1 + rampa/tümsek içeren bir delik):**
tek atışta rampadan havalanma gözlenebilir; duvar sekmesi ses+sarsıntı veriyor;
top eğimde gerçekçe yuvarlanıp duruyor; deliğe düşüş fiziksel; `npx tsc --noEmit`
ve mevcut saf testler (aim/skor/kurs-builder) geçmeye devam ediyor.

---

## 2. Anahtar bulgu — altyapı zaten var

Motor **şu an** tam bir Rapier entegrasyonuna sahip; mini golf onu atlıyor.

| Yetenek | Nerede | Durum |
|--------|--------|-------|
| Rapier dünyası, CCD'li dinamik cisimler, yerçekimi, damping, kütle, eksen kilidi | [`engine/physics/physicsSubsystem.ts`](../../engine/physics/physicsSubsystem.ts) | Mevcut, ragdoll için kullanılıyor |
| `simulatePhysics` / `massKg` / `restitution` / `friction` / `linear|angularDamping` / `enableGravity` collider alanları | [`engine/scene/components.ts:145`](../../engine/scene/components.ts#L145) (okuma `:551`) | Mevcut |
| `backend: "rapier"`, transform sink ile dinamik transformların render'a yazımı | [`RuntimeSceneApp.ts:305`](../../src/scene/RuntimeSceneApp.ts#L305), `:512` | Mevcut |
| `beforeEngineUpdate` kancası (fizik adımından **önce** input) | [`RuntimeSceneApp.ts:581`](../../src/scene/RuntimeSceneApp.ts#L581) | Mevcut |
| Sahne collision kutuları → Rapier statik collider (duvarlar/zemin) | `colliderDescsForBody` | Mevcut |
| Topta küre collider (devam eden commitsiz diff) | [`ball-red.collision.json`](../../public/assets/minigolf/models/ball-red.collision.json) | Yarım |

**Sonuç:** Topu `simulatePhysics:true` dinamik bir Rapier küresi yaparsak —
havalanma, sekme, spin, eğim, CCD ile tünelleme önleme **hazır gelir**. Asıl iş
yeni bir fizik motoru yazmak değil, **mini golf'ü mevcut motora bağlamak**.

---

## 3. Mimari karar

### Seçenek A (ÖNERİLEN) — Topu mevcut `PhysicsSubsystem` üzerinden dinamik cisim yap
- Top = `simulatePhysics:true` küre; vuruş = impuls; pozisyon/rotasyon sink'ten
  geri okunur; delik/hazard = sensor; OOB = sensor/AABB.
- **Artı:** Havalanma/spin/sekme/CCD bedava; motor zaten taşıyor; bundle maliyeti
  (~2 MB `vendor-physics` chunk) zaten ödeniyor (sahnede collider var, Rapier
  dinamik import ediliyor — [physicsSubsystem.ts:97](../../engine/physics/physicsSubsystem.ts#L97)).
- **Eksi:** Determinizm/headless test modeli değişir; yeni context köprüleri
  gerekir (§4); ayar (impuls↔güç) yeniden kalibre edilir.

### Seçenek B — Özel çekirdeği 3B'ye genişlet (dikey eksen + zıplama + spin elle)
- **Artı:** Determinizm + headless test korunur; sıfır bağımlılık.
- **Eksi:** Sürekli temas, sürtünme, dönme ataleti, CCD, kasa-köşe çarpışmaları
  elle yazılır — gerçek "his" elde etmek çok emek; tam istenen sonucu hand-tuning
  ile yakalamak zor.

### Seçenek C — Hibrit
- Düz zeminde özel çekirdek, rampa/havada Rapier. Karmaşık, iki model arası
  dikiş sorunları. **Önerilmez.**

> **Öneri: A.** Motor altyapısı buna hazır; istenen "gerçek his" en doğrudan
> A ile gelir. Bu plan A'yı varsayar.

---

## 4. Entegrasyon boşluğu — gereken motor köprüleri

Tek gerçek kod boşluğu: oyun modu **dinamik bir cismi süremiyor**. Eklenecekler:

### 4a. `PhysicsSubsystem` yeni public metotları
[`engine/physics/physicsSubsystem.ts`](../../engine/physics/physicsSubsystem.ts)
(ragdoll metotlarının yanına, `rapierBodies` üzerinden):

- `applyImpulse(entityId, impulse: Vec3, wake = true)` — vuruş kuvveti.
- `applyTorqueImpulse(entityId, torque: Vec3)` — (opsiyonel) backspin/yan dönüş.
- `linearVelocity(entityId): Vec3 | null` — rest/aim/HUD için.
- `setLinearVelocity(entityId, v: Vec3)` — durdurma/sıfırlama.
- `angularVelocity(entityId): Vec3 | null` — rest tespiti.
- `teleportBody(entityId, position: Vec3, opts?: { zeroVelocity?: boolean })` —
  tee yerleştirme + OOB reset (setTranslation + hızları sıfırla + wake).
- `isBodySleeping(entityId): boolean` — rest tespitini Rapier'e devret.
- (İleri) temas-impuls olayları: `update()`'te zaten temas toplanıyor; çarpma
  **şiddeti** (contact max impulse) eklenip session'a iletilirse "tokuşma hissi"
  geri bildirimi beslenir.

### 4b. `GameModeContext` yeni (opsiyonel, headless-güvenli) köprüleri
[`src/game/gameModes/types.ts:148`](../../src/game/gameModes/types.ts#L148) +
fabrika [`RuntimeSceneApp.ts:1508`](../../src/scene/RuntimeSceneApp.ts#L1508):

- `applyImpulse?`, `applyTorqueImpulse?`, `applyForce?`, `getLinearVelocity?`,
  `setLinearVelocity?`, `getAngularVelocity?`, `teleportBody?`,
  `isBodySleeping?`
- `onPhysicsContact?(entityId, handler)` — duvar/engel contact olayı
  (geri bildirim için; impuls şiddeti ayrı eklenecek).

> Hepsi `?:` opsiyonel → headless/test context'leri köprüleri vermeyebilir
> (ragdoll köprüleri gibi). Sözleşme [`types.ts`](../../src/game/gameModes/types.ts)
> JSDoc'una eklenir.

---

## 5. Veri akışının değişimi

**Şimdi:** `miniGolfGameMode.update` → `stepMiniGolfBall` (özel) →
`context.setEntityTransform` (oyun → render'a iter).

**Sonra:**
```
beforeEngineUpdate: bekleyen vuruş → context.applyImpulse(ballId, impulse)
        ↓ (motor) PhysicsSubsystem.update → rapierWorld.step()  // gerçek sim
        ↓ transformSink → top render objesi (pozisyon + quaternion = spin)
update: ball state'i fizikten OKU (velocity, sleeping, contacts)
        → rest? cup sensor? hazard sensor? OOB? → skor/HUD/akış
```
Top transform'unun **sahibi fizik** olur; oyun modu sadece impuls uygular ve
durumu okur.

---

## 6. Aşamalı uygulama planı

Her aşama `npx tsc --noEmit` + `npm run test:engine` geçecek şekilde küçük ve
build-passing (CLAUDE.md kuralı). Her adım ayrı commit.

### Faz 1 — Motor köprüleri 🚧
- ✅ `PhysicsSubsystem`: §4a metotları — impuls, hız get/set, açısal hız,
  teleport, sleeping, **`applyForce` (sürekli kuvvet — Magnus için, §6a)**.
- ✅ Temas olayı: `onPhysicsContact` aboneliği ve Rapier solid contact
  `maxImpulse` şiddeti eklendi.
- ✅ `GameModeContext` + fabrika: §4b opsiyonel köprüler.
- ✅ Birim testleri: köprü metotları için küçük Rapier harness (bkz §8) **ya da**
  saf imza/no-op testleri.
- ⚠️ Mevcut tüm testler + tsc yeşil. `npx tsc --noEmit` geçiyor; odaklı Rapier
  bridge harness geçiyor; `npm run test:engine` mevcut `asset-path-missing`
  manifest hatalarında erken duruyor.

### Faz 2 — Saf çekirdeği kaldır + topu dinamik cisim yap 🚧
- ⬜ **`game/minigolf/gameplay/miniGolfBallPhysics.ts` SİLİNİR** (karar). Tüm
  import'lar ve `MiniGolfCourse`/`MiniGolfSurface`/`stepMiniGolfBall`/
  `applyMiniGolfPutt`/`createMiniGolfBallState` kullanımları kaldırılır.
- ⬜ `buildMiniGolfCourse` **küçülür**: duvar/yüzey sentezi
  (`collectCourseCollisionBoxes`, `surfaceFromCourseBox`, `meshSurfacesFromBlockers`,
  `primitiveCourseBox` …) silinir — collision geometrisinin sahibi artık Rapier.
  Geriye sadece **oyun işaretçileri** kalır: tee, cup (pozisyon/yarıçap), hazard
  AABB'leri, OOB sınırları.
- 🚧 Top collider'ı `simulatePhysics:true`, `massKg`, `restitution`, `friction`,
  düşük `angularDamping` (yuvarlanma), düşük `linearDamping`; CCD zaten açık
  (`rigidBodyDescForBody` dinamik dalında). İlk pass: level top placement'ı
  `simulatePhysics:true`, `massKg`, damping ve sphere sidecar ile dinamik gövdeye
  dönüştü; restitution/friction yüzey ayarı sonraki kalibrasyon.
- 🚧 Spawn: `teleportBody(ballId, teePos)`; `createMiniGolfBallState` gider. Top
  fizikçe yere oturur.
- 🚧 Vuruş: `beforeEngineUpdate`'te yatay impuls. Güç→impuls kalibrasyonu
  (kütle × hedef hız), sahaya göre (8 m lane) ayarlanır. İlk pass vuruşu
  `applyImpulse` ile Rapier gövdesine veriyor.
- 🚧 Görsel: `syncBallVisual` kaldırılır; transform sink topu sürer → **spin
  bedava** (Rapier tam quaternion verir). Kamera fizik pozisyonunu takip eder.
  İlk pass runtime `getEntityTransform` cache'i üzerinden fizik pozisyonunu okuyor.
- 🚧 Rest tespiti: `isBodySleeping` veya `|v|<eps && |ω|<eps`.
- ⬜ **Çıktı:** Rampadan havalanma + duvardan gerçek sekme + dönen top gözlenir.

### Faz 3 — Delik (fiziksel) + hazard + OOB ⬜
- ⬜ **Cup fiziksel delik (karar):** delikli modeller (`hole-open`, gerekirse
  `hole-round`/`hole-square`) collision'ı `complexAsSimple` + **boş primitives**
  yapılır → gerçek delikli mesh trimesh collider olur, top içeri düşer.
  ⚠️ Mevcut [`hole-open.collision.json`](../../public/assets/minigolf/models/hole-open.collision.json)
  tüm fayrı kaplayan **tek dolu kutu** — bu kutu kaldırılmazsa delik oluşmaz.
- ⬜ Cup sensor: fincan hacminde küçük sensor; top içeride + durağan → "girdi".
  (Fiziksel huni + sensor birlikte → lip-out artık fizikçe gerçek olur.)
- ⬜ Hazard/su: `minigolf-gap` yerlerine sensor; overlap → ceza + reset.
- ⬜ OOB: `y < zeminEşiği` veya parkur-altı geniş sensor; `teleportBody(lastSafePos)`
  + ceza. `lastSafePos` her durağan/sınır-içi karede güncellenir (mevcut
  "tee'ye geri atma" hatası düzelir).
- ⬜ Skor/akış (`completeCurrentHole`, transition) fizik state'inden sürülür.
- ⚠️ Trimesh cup ince duvarlı → hızlı topta tünelleme riski; topta CCD + impuls
  üst sınırı; gerekirse cup ağzına fiziksel huni/rampa.

### Faz 4 — Spin & curve (v1, karar) ⬜ → teknik için §6a
- ⬜ Aim'e **spin girişi** (ör. vuruş sonrası ikinci sürükleme / tuş modifier /
  yan kaydırma) → topspin/backspin + yan spin miktarı.
- ⬜ Vuruşta `applyTorqueImpulse` ile açısal hız ver (yerde yuvarlanma/backspin).
- ⬜ **Magnus kuvveti** (hava eğrisi): top havadayken her fizik adımında
  `F = kMagnus · (ω × v)` uygula — Rapier bunu otomatik yapmaz.
- ⬜ Ayar: `kMagnus`, spin sönümü, yerde spin→sürtünme tepkisi.

### Faz 5 — Tokuşma hissi: ses + kamera sarsıntısı + partikül (birlikte, karar) ⬜
- ⬜ Temas-impuls eşiği aşılınca **üçü birden**, çarpma şiddetine ölçekli:
  - **ses** (audio backend `web-audio` mevcut — `RuntimeSceneApp.ts:316`),
  - kısa **kamera sarsıntısı**,
  - **partikül/iz**.
- ⬜ Havadan inişe ayrı "thud" varyantı.

### Faz 6 — Yüzey malzemeleri & global ayar ⬜
- ⬜ Yüzey başına fiziksel malzeme: green (orta sürtünme), rampa, hızlı/yavaş
  zemin → collider `friction`/`restitution` (asset collision JSON'larında).
- ⬜ Global ayar pass: kütle, restitution, damping, impuls ölçeği, yerçekimi,
  delik yakalama hızı, `kMagnus`; vertical slice playtest ile.
- ⬜ Duvar restitution'ı arcade hisse göre (langırt değil) ayarla.

### Faz 7 — Cila & dokümantasyon ⬜
- ⬜ GDD #2 sütununu güncelle (gerçek fizik, motora bağlı); bu doküman
  `docs/completed/`'a taşınır.
- ⬜ `build:verify` yeşil.

### 6a. Spin & curve — teknik not ⚠️
Rapier rigid-body **yerde** spin'i doğal taşır (açısal hız + temas sürtünmesi →
backspin frenler, topspin ileri sürükler, yan spin yerde hafif kıvrılma). Ama
**havadaki eğri (Magnus etkisi) rigid-body fizikte YOKTUR** — motor aerodinamik
hesaplamaz. Gerçek "curve shot" için topa havadayken her adımda elle kuvvet
eklenir: `F = kMagnus · (ω × v)`. Bu yüzden Faz 1'de `applyForce` köprüsü ve Faz
4'te per-tick Magnus gerekir. (Aksi halde spin yalnızca yerde hissedilir, top
havada düz uçar.)

---

## 7. Top fizik parametreleri (başlangıç değerleri, kalibre edilecek)

| Parametre | Başlangıç | Not |
|----------|-----------|-----|
| Yarıçap | ~0.035 m | mevcut `BALL_VISUAL_RADIUS` ile aynı; collider küresi 0.07 çap |
| Kütle | ~0.045 kg | gerçek golf topu ~0.046 kg; impuls ölçeği buna göre |
| restitution (top) | 0.4–0.5 | duvar collider restitution'ı ile birlikte sekme hissini belirler |
| friction (top) | 0.6–0.8 | yüzey friction ile çarpılır |
| linearDamping | 0.1–0.4 | düz green'de "ölme" hızı; çok yüksek = çabuk durur |
| angularDamping | 0.05–0.2 | düşük tut → yuvarlanma sürsün |
| Yerçekimi | sahne `gravity` `[0,-9.8,0]` | zaten ayarlı (`setGravity`) |
| Maks impuls (tam güç) | kalibre | hedef: tam güç ≈ 8 m lane + pay; aşırı zıplama yok |
| CCD | açık | dinamik dalda zaten (`setCcdEnabled(true)`) — ince geçit tünellemesini önler |

Güç→impuls: `impuls = kütle × hedefHız`, `hedefHız = maxSpeed × power^exp`.
`maxSpeed` ve `exp` mevcut nişan eğrisinden taşınır, sahaya göre düşürülür.

---

## 8. Test stratejisi (determinizm devri) ⚠️

Saf çekirdek **siliniyor** (karar — §11), dolayısıyla mevcut
[`tools/engine-tests.ts`](../../tools/engine-tests.ts) içindeki
`stepMiniGolfBall`/`applyMiniGolfPutt` davranış testleri de kaldırılır.

- **Korunur (Rapier'e bağlı değil):** `computeMiniGolfAim`, skor/par
  (`miniGolfScoreRelativeToPar`, `summarizeMiniGolfCourse`), sonuç adı/biçimleme
  (`miniGolfResultName`, `formatMiniGolfScore`), hazard metadata okuma. **Kalır.**
- **Kaldırılır:** 2.5B sentezini sınayan testler — "blocker→surface", "tall
  primitive→wall", "overlapping surfaces", "slope accelerates", "rolling
  friction", "AABB walls bounce", "cup captures", "out-of-bounds", "spawn surface
  sampling". (`buildMiniGolfCourse` artık duvar/yüzey üretmediği için konusuz
  kalırlar.)
- **Eklenir (opsiyonel, toleranslı):** Node'da `RAPIER.init()` ile küçük headless
  harness — atış→sekme, rampadan havalanma (`v.y > 0` gözlenir), deliğe düşme için
  *aralık/eğilim* iddiaları (kesin sayı değil; determinizm tam garanti değil).
- Köprü metotları (impuls/hız/teleport) için imza + küçük entegrasyon testleri.

---

## 9. Veri / asset değişiklikleri

- ⬜ [`ball-red.collision.json`](../../public/assets/minigolf/models/ball-red.collision.json):
  `simulatePhysics:true` + `massKg` + `restitution` + `friction` + damping.
  (Şu an sadece küre eklendi; fizik flag'leri yok.)
- ⬜ Yüzey/duvar collision JSON'ları: `friction`/`restitution` (yüzey malzemesi).
- ⬜ **Cup fiziksel delik:** `hole-open.collision.json` (ve gerekirse `hole-round`/
  `hole-square`) → `complexAsSimple` + **boş `primitives`**. Mevcut dolu kutu
  primitifi kaldırılır, yoksa delik oluşmaz. (`complexAsSimple` boş primitiflerle
  render mesh'ten trimesh türetir — [collision.ts:211](../../engine/scene/collision.ts#L211).)
- ⬜ Cup & hazard sensor: sensor collider (veya layout sensor placement).
- ⚠️ **Allowlist gotcha (CLAUDE.md):** collider fiziği alanları collision sidecar
  üzerinden geliyor; **collision editöründen kaydetme** yolunun bu alanları
  düşürmediği doğrulanmalı (`tools/saveValidator.ts` collision dalı + collision
  editör save). Yükleme tarafı (`readColliderComponent`) zaten destekliyor.
- ⬜ Layout sensor/hazard alanı eklenirse `LayoutPlacement` allowlist'i
  (`applyTransformFields`) güncellenir.

---

## 10. Riskler & azaltım

| Risk | Etki | Azaltım |
|------|------|---------|
| Determinizm/replay kaybı | GDD vaadi düşer | §0/§8'de açıkça kabul; replay kapsam dışı |
| Bundle (~2 MB Rapier) | İlk yük | Zaten dinamik import; sahnede collider var, maliyet hâlihazırda ödeniyor |
| Headless fizik testi zayıflar | Regresyon yakalama | Saf testleri koru + toleranslı Rapier harness |
| İnce geçit/elmas tünelleme | Top duvarı geçer | CCD açık; impuls üst sınırı; gerekirse substep |
| "His" ayarı uzun sürer | Çok playtest | Faz 5 ayrı; başlangıç tablosu §7; vertical slice'ta kalibre |
| Top fincana düşmeyip seker | Frustrasyon | Önce sensor-yakalama (güvenli), sonra fiziksel huni dener |
| Mevcut yarım collision diff'i | Çakışma | Faz 2 öncesi commitle/uyumla (top küre + start/end collision) |

---

## 11. Kapsam kararları (2026-06-30 — kilitlendi)

1. ✅ **Saf çekirdek kaldırılır.** `miniGolfBallPhysics.ts` silinir; `buildMiniGolfCourse`
   duvar/yüzey sentezi de kaldırılır (Rapier collision geometrisinin sahibi). (Faz 2)
2. ✅ **Spin/curve v1 kapsamında.** Yerde tork-tabanlı backspin/topspin + havada
   Magnus eğrisi (per-tick kuvvet). (Faz 4, §6a)
3. ✅ **Top deliğe fiziksel olarak girer.** Delikli modeller `complexAsSimple`
   (boş primitives → trimesh) collision kullanır; ağıza sensor düşüşü doğrular. (Faz 3)
4. ✅ **Geri bildirim seti = ses + kamera sarsıntısı + partikül (üçü birlikte).** (Faz 5)
5. ✅ **Replay/ghost kapsam dışı** (gerçek fizikle pratik değil; GDD'den düşülür).

---

## 12. İlerleme günlüğü

- 2026-06-30 — Plan oluşturuldu. Anahtar bulgu: motorda Rapier rigid-body
  altyapısı (`PhysicsSubsystem`) hazır; mini golf onu atlayıp özel 2.5B çekirdek
  kullanıyor. Yön: topu mevcut motor üzerinden dinamik cisim yap (Seçenek A).
- 2026-06-30 — Kapsam kararları kilitlendi (§11): saf çekirdek silinir; spin/curve
  v1 (Magnus dahil); top deliğe fiziksel girer (`complexAsSimple` trimesh);
  geri bildirim = ses+sarsıntı+partikül birlikte; replay kapsam dışı. Plan buna
  göre güncellendi (Faz 2-5, §6a, §8, §9).
- 2026-06-30 — Faz 1 başladı: `PhysicsSubsystem` için impuls/tork/kuvvet,
  hız okuma-yazma, teleport ve sleeping köprüleri eklendi; `GameModeContext` ve
  `RuntimeSceneApp` fabrika yüzeyi opsiyonel köprülerle güncellendi. `tsc` ve
  odaklı Rapier bridge harness geçti; tam `test:engine` mevcut
  `asset-path-missing` manifest hatalarında erken duruyor.
- 2026-06-30 — Faz 1 temas şiddeti tamamlandı: `PhysicsContact.maxImpulse`
  eklendi; Rapier solid contact manifold'larından maksimum normal impulse
  okunuyor. Odaklı düşen top harness'i pozitif impulse doğruladı.
- 2026-06-30 — Faz 2 ilk runtime bağı: `GameModeContext.getEntityTransform`
  eklendi, mini golf vuruşu `beforeEngineUpdate` içinde Rapier `applyImpulse`
  kullanmaya başladı, game mode top pozisyonunu physics transform cache'inden
  okuyor. `mini-golf-hole-01` top placement'ı `simulatePhysics:true` ve golf topu
  kütle/damping ayarlarıyla dinamik gövde oldu. `tsc` ve headless adapter
  kontrolü geçti; saf çekirdek/course-builder silme henüz yapılmadı.
