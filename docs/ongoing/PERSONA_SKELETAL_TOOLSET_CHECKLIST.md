# Persona — Skeletal Mesh / Animation / Physics Toolset Checklist

> Tarih: 2026-06-22
> Amaç: Unreal'daki **Persona** takımına (Skeleton Editor, Skeletal Mesh Editor,
> Animation Editor, Physics Editor/PhAT) karşılık gelen bir karakter araç
> setini Forge'a kazandırmak. Forge'da bu **3 ayrı uygulama değil**, tek bir
> editör kabuğu (`SkeletalMeshEditor`) içinde geçiş yapılan **modlar** olarak
> kurulur — Unreal'in gerçek mimarisi de budur (modlar ortak viewport, preview
> sahnesi ve skeleton tree'yi paylaşır).
>
> Content Browser'dan bir `skeletalMesh` asset'ine çift tıklayınca açılır;
> `StaticMeshEditor` deseninin (overlay doküman + viewport + toolbar + details +
> `*.json` sidecar) skeletal karşılığıdır.
>
> Bu doküman önce Unreal Persona modelini özetler, Forge'un mevcut durumuyla
> eşler, kapsam ve mimari kararını verir, ardından fazlı checklist'i sunar.

## Kaynaklar (incelenen Unreal dokümantasyonu)

- [Skeletal Mesh Editor](https://dev.epicgames.com/documentation/unreal-engine/skeletal-mesh-editor-in-unreal-engine)
- [Skeleton Editor](https://dev.epicgames.com/documentation/unreal-engine/skeleton-editor-in-unreal-engine)
- [Animation Editors (Persona overview)](https://dev.epicgames.com/documentation/unreal-engine/animation-editors-in-unreal-engine)
- [Physics Asset Editor (PhAT)](https://dev.epicgames.com/documentation/unreal-engine/physics-asset-editor-in-unreal-engine)
- [Skeletal Mesh Sockets](https://dev.epicgames.com/documentation/unreal-engine/skeletal-mesh-sockets-in-unreal-engine)
- [Morph Target Previewer](https://dev.epicgames.com/documentation/unreal-engine/morph-target-previewer-in-unreal-engine)

---

## Bölüm A — Unreal Persona Modeli (özet)

Persona, dört kavramsal editörü tek çerçevede toplayan karakter araç setidir.
Hepsi aynı **Preview Scene**, **Viewport** ve **Skeleton Tree** altyapısını
paylaşır; üstteki mod/asset anahtarıyla geçiş yapılır.

### A.1 Skeleton Editor Mode

- **Skeleton Tree**: kemik hiyerarşisi ağacı; kemik seç, ara, filtrele.
- **Sockets**: bir kemiğe bağlı, offset transform'lu attach noktası (silah,
  prop, efekt). Socket'e preview asset takılıp viewport'ta konumlandırılır.
- **Bone retargeting** ayarları (translation retargeting modları).
- **Animation Notifies** için bildirim altyapısı (Anim editöründe kullanılır).
- **Virtual bones**, kemik bazlı blend profilleri (ileri seviye).

### A.2 Skeletal Mesh Editor Mode

- **Materials & Sections**: section başına materyal ataması (per-LOD).
- **LODs**: LOD seviyeleri, ekran boyutu eşikleri, **Skeletal Mesh Reduction**
  (üçgen/vertex azaltma, kemik öncelikleri).
- **Morph Target Previewer**: blendshape influence'larını slider'la önizleme.
- **Physics Asset** referansı + per-poly collision ayarı.
- **Cloth Paint**: bez simülasyonu boyama.
- **Make Static Mesh** / **Reimport Base Mesh**.

### A.3 Animation Editor Mode

- **Asset Browser**: skeleton'a ait animasyon asset'leri (sequence/montage/blend
  space) listesi.
- **Timeline / Notifies paneli**: klip oynatma, scrub, play-rate, loop;
  **Anim Notifies** (ayak sesi, hasar penceresi gibi event işaretleri).
- **Blend Space**, **Montage**, **Anim Blueprint** kurguları (ileri seviye).
- **Curve / Additive** önizleme.

### A.4 Physics Editor Mode (PhAT)

- Kemiklere bağlı **bodies** (kapsül/küre/kutu) ve **constraints** (eklem
  limitleri) ile **ragdoll** kurma.
- Simülasyonu canlı önizleme, çarpışma profili atama.

---

## Bölüm B — Forge Mevcut Durum

- **Runtime animasyon altyapısı hazır:**
  - [`CrossfadeAnimator`](../../engine/render-three/characterAnimator.ts) — bir
    `AnimationMixer`'ı sarar, klipler arası isimle crossfade yapar.
  - [`AnimationSubsystem`](../../engine/render-three/animationSubsystem.ts) —
    mixer'ları tick başına ilerletir.
  - [`createSceneCharacterMixer`](../../src/scene/SceneRuntimeCore.ts) (≈satır 274)
    — `gltf.animations` içinden **tek bir isimli klibi** oynatır.
  - [`createCharacterSceneObject`](../../engine/render-three/models.ts) (≈satır 168)
    — `gltf.scene`'i klonlar, transform uygular (`ensureVertexNormals`).
- **Animasyon mantığı zaten saf kod (Anim BP'nin işlevi):**
  [`locomotionAnimation.ts`](../../src/game/locomotionAnimation.ts) — iki katman:
  `classifyLocomotion` (kinematik → idle/walk/run/jump/fall state machine) +
  `resolveLocomotionClip` (state → klip ismi, fallback zinciriyle). Bu, bir Unreal
  **Animation Blueprint**'inin state-machine + klip-eşleme işlevidir; blend'i
  `CrossfadeAnimator` yapar. Yani Anim BP'nin *işlevi* var, *görsel node-graph
  editörü* yok — ve bu Forge'un "oyun kuralları game runtime'da" ilkesiyle uyumlu.
- **Asset tipleri zaten var:** [`manifest.ts`](../../engine/assets/manifest.ts)
  `skeletalMesh` ve `animation` tiplerini tanımlar (satır 1-9).
- **Routing boşluğu:** `isModelAssetType` (manifest.ts:153) hem `staticMesh` hem
  `skeletalMesh` için `true` döndüğü için, [`EditorUi.ts`](../../src/editor/EditorUi.ts)
  (createAssetCard dblclick ≈1331, `assetEditorOpener` ≈1395) skeletal asset'i
  de **StaticMeshEditor**'a yönlendirir — iskeletten/klipten habersiz editör.
- **Layout şeması dar:** [`LayoutCharacter`](../../engine/scene/layout.ts) yalnızca
  tek `animation?: string` taşır (satır 239). Socket, anim-set rol eşlemesi,
  notify yok.
- **StaticMeshEditor deseni hazır** ([`StaticMeshEditor.ts`](../../src/editor/StaticMeshEditor.ts)):
  overlay doküman, tek aktif instance, kendi `WebGLRenderer`/`Scene`/kamera/
  `GLTFLoader`'ı, üst toolbar + Details, `TransformControls` gizmo, sidecar
  persistans (`*.collision.json`/`*.uvw.json`/`*.materialslots.json`), dinamik
  `?editor` importu. Sidecar store'lar `src/editor/asset*Store.ts`.
- **Three.js skeletal yetenekleri (GLTF'ten hazır gelir):** `SkinnedMesh`,
  `Skeleton` (`.bones`), `Bone` hiyerarşisi, `SkeletonHelper`, `AnimationClip[]`,
  `AnimationAction` (`time` scrub / `timeScale` / `weight` / `loop`),
  `morphTargetInfluences` + `morphTargetDictionary`. Hazır gelmeyenler: ragdoll
  fizik, cloth, LOD üretimi, iskeletler arası retargeting.
- **Save validator gotcha:** allowlist'e (`tools/saveValidator.ts`,
  `applyTransformFields`) eklenmeyen her yeni `LayoutCharacter` alanı kayıtta
  **sessizce düşer** (CLAUDE.md).

---

## Bölüm C — Eşleme & Kapsam Kararı

Forge web-first ve hafif; Persona'nın tamamı (cloth, LOD reduction, ragdoll,
retargeting) aşırı. Faithful ama sadeleştirilmiş, fazlı bir model:

### C.1 Persona editör modları / mesh özellikleri

| Unreal kavramı | Forge karşılığı | Karar |
| --- | --- | --- |
| Skeleton Tree + kemik görselleştirme | bone traverse ağacı + `SkeletonHelper` | **Al (Faz 1)** |
| Animation preview + timeline scrub | `AnimationMixer` + `action.time` | **Al (Faz 1)** |
| Materials & Sections | mevcut materyal pipeline (StaticMesh'ten devşir) | **Al (Faz 1)** |
| Mesh stats (vertex/bone/clip sayısı) | traverse readout | **Al (Faz 1)** |
| Sockets (kemiğe attach noktası) | bone'a göre offset transform + gizmo | **Al (Faz 2)** |
| Anim-set rol eşlemesi (idle/walk/run…) | klip ismi → semantik rol haritası | **Al (Faz 2)** — locomotion'ı besler |
| Morph Target Previewer | influence slider'ları | **Al (Faz 2)** |
| Animation Notifies | klip üstünde event işaretleri | **Ertele (Faz 3)** |
| Physics Asset / ragdoll (PhAT) | bodies + constraints, Rapier ragdoll | **Ertele (Faz 4)** |
| LOD reduction / generation | ağır mesh işleme | **Atla** (DCC'de yapılır) |
| Cloth Paint | bez simülasyonu | **Atla** |
| Skeleton retargeting | iskeletler arası remap | **Atla** (gerekirse çok sonra) |
| Make Static Mesh / Reimport | (web import akışı farklı) | **Atla / opsiyonel** |

### C.2 Animasyon asset tipleri (Unreal "Animation" oluştur menüsü)

Unreal'in 10 animasyon asset tipi AAA motora özgü zenginlik. Forge anim mantığını
zaten `src/game`'de saf kod olarak tuttuğu için (bkz. Bölüm B), bunların çoğu ya
gereksiz ya da data ile çözülür. **Yeni bir editör türü (Anim Blueprint vb.)
gerekmiyor.**

| Unreal asset | Ne işe yarar | Forge'daki durum/karşılık | Karar |
| --- | --- | --- | --- |
| **Animation Blueprint** | State machine + blend graph; hangi anim ne zaman | `locomotionAnimation.ts` + `CrossfadeAnimator` zaten yapıyor | **İşlevi var; görsel editör KURMA.** Gerekirse data state machine'e evril |
| **Blend Space** | İki eksende (hız/yön) sürekli poz harmanı | Yok — tek aktif klip, eşikte walk→run *sıçrar* | **Gerçek aday ihtiyaç — Faz 2 (data)** |
| **Animation Montage** | Tek-atış aksiyon + section + notify, base üstüne katman | Yok — sadece locomotion crossfade | **Sadeleştirilmiş gerek — Faz 3 (montage-lite)** |
| **Animation Composite** | Klipleri tek timeline'a ardışık dizme | İhtiyaç olursa data'da diziyle | **Ertele** (montage-lite büyük ölçüde kapsar) |
| **Aim Offset** | Nişan yönüne (pitch/yaw) additive poz harmanı | Nişan alan oyun türüne özel | **Ertele / Atla** (gerekirse Blend Space üstüne) |
| **Pose Asset** | İsimli pozlar; yüz ifadesi / curve-driven additive | Morph previewer (Faz 2) kısmen örtüşür | **Ertele** (yüz animasyonu netleşince) |
| **Mirror Data Table** | Sol/sağ animasyonu kemik eşlemesiyle aynalama | Az sayıda klipte gereksiz optimizasyon | **Atla** |
| **Animation Layer Interface** | Modüler / linked anim blueprint arayüzü | Görsel Anim BP kurulmadığı için anlamsız | **Atla** |
| **Animation Bank** | Kalabalık/instanced için anim→texture bake (Mass) | İleri AAA optimizasyonu, web'de yok | **Atla** |
| **Variable Frame Stripping** | Platform başına frame sıyırma/sıkıştırma | Web import pipeline'ında karşılığı yok | **Atla** |

---

## Bölüm D — Mimari Kararlar

- **Tek kabuk + modlar (Persona):** Tek `src/editor/SkeletalMeshEditor.ts`
  overlay'i, üst barda **mod anahtarı**: `Skeleton` · `Animation` · (sonra)
  `Physics`. Mod değişimi toolbar + Details içeriğini ve aktif overlay'leri
  değiştirir; viewport/kamera/skeleton-tree paylaşılır. **3 ayrı editör sınıfı
  yazılmaz.**
- **Ortak viewport base (refactor fırsatı):** `StaticMeshEditor` ile paylaşılan
  kamera (orbit/pan/dolly), keyboard, grid/ışık, GLTF yükleme ve sidecar
  plumbing'i `src/editor/AssetEditorViewport` (veya benzeri) base'ine çıkarılır;
  hem Static hem Skeletal editör onu paylaşır. (StaticMeshEditor'ı bozmadan,
  küçük adımlarla.)
- **Routing:** `assetType === "skeletalMesh"` → SkeletalMeshEditor; `staticMesh`
  → StaticMeshEditor. İçe aktarımda (import classification) `SkinnedMesh` /
  `gltf.animations` içeren GLB otomatik `skeletalMesh` sınıflanır. Static editör
  bir iskelet algılarsa "Open in Skeletal Mesh Editor" ipucu gösterir.
- **Persistans:** StaticMesh sidecar desenine paralel **`*.skeleton.json`**
  sidecar'ı: `sockets[]`, `animationSet` (rol→klip eşlemesi), `notifies[]`
  (Faz 3), preview tercihleri. Yeni store `src/editor/assetSkeletonStore.ts` +
  dev endpoint `/__save-skeleton`.
- **Layout şeması:** `LayoutCharacter` zamanla tek `animation` alanından
  `animationSet` referansına evrilir; socket-attach alanları eklenir. **Her yeni
  alan `tools/saveValidator.ts` allowlist'ine eklenir** yoksa kayıtta düşer.
- **Editor generic kalır:** skeletal araç seti engine-generic'tir; proje-özel
  hangi rolün hangi state'te çalacağı game runtime/data'da yaşar (locomotion
  seçici zaten `src/game`'de).
- **Anim mantığı kod/data'da, node-graph editörü YOK:** Unreal'in Animation
  Blueprint'ine karşılık görsel bir grafik editörü **kurulmaz** — mantık
  `src/game`'de saf, test edilebilir kod kalır; kod seçicisini aşarsak
  **data-driven state machine** (`*.animgraph.json`) olarak ifade ederiz, editöre
  değil oyun verisine ait. **Blend Space** ve **Montage** de node-graph değil,
  **data + `AnimationMixer`** (ağırlıklar / section'lar) üzerine kurulur. Persona'nın
  Animation modu mantığı değil, yalnızca **önizleme + metadata authoring**
  (anim-set, blend points, sockets, notifies) yapar.
- **Bundle ayrımı:** SkeletalMeshEditor `src/editor/` altında, dinamik `?editor`
  importunun arkasında; game build'e girmez.

---

## Checklist

Durum: `[ ]` yapılmadı · `[~]` kısmi · `[x]` tamam

### Faz 0 — Araştırma & Karar (bu doküman)

- [x] Unreal Persona dokümanlarını incele ve özetle (Bölüm A)
- [x] Forge mevcut durumu çıkar (Bölüm B)
- [x] Kapsam/eşleme (Bölüm C) ve mimari karar (Bölüm D) — tek kabuk + modlar
- [x] Faz sıralamasını kullanıcıyla onayla (2026-06-22)
- [x] Unreal animasyon asset menüsünü analiz et → kapsam (Bölüm C.2 + D)

### Faz 1 — Persona Kabuğu + Skeleton/Mesh Görüntüleme (en yüksek değer)

- [ ] (refactor) Ortak viewport base'i çıkar: kamera/keyboard/grid/ışık/GLTF
      yükleme/sidecar plumbing (`StaticMeshEditor`'dan, onu bozmadan)
- [x] `src/editor/SkeletalMeshEditor.ts` overlay kabuğu (tek aktif instance,
      başlık = asset adı, Esc ile kapanır, dinamik import)
- [x] Üst barda **mod anahtarı**: `Skeleton` · `Animation` (Physics gri/pasif)
- [x] Routing: `skeletalMesh` çift tıklama → SkeletalMeshEditor (EditorUi
      `createAssetCard` + `assetEditorOpener`); `staticMesh` StaticMeshEditor'da kalır
- [x] GLTF yükle, ortala/çerçevele; `SkinnedMesh` / `Skeleton` tespiti
- [x] **Skeleton Tree** paneli: kemik hiyerarşisi ağacı + viewport'ta
      `SkeletonHelper`; kemik seçince highlight
- [x] **Mesh Details**: materyaller/section'lar (StaticMesh'ten devşir),
      wireframe / bind-pose / normal toggle, vertex/bone/clip sayısı readout
- [x] Import classification: skinned/animation içeren GLB → `skeletalMesh`

### Faz 2 — Animation Mode + Sockets + Morph (authoring)

- [x] **Animation mode**: `gltf.animations` klip listesi (Asset Browser benzeri)
- [x] Oynat / duraklat / **timeline scrub** (`action.time`), play-rate, loop toggle
- [x] `CrossfadeAnimator` ile klipler arası geçiş önizlemesi
- [x] **Anim-set rol eşlemesi**: klip ismi → semantik rol (idle/walk/run/jump…);
      `animationSet` olarak sidecar'a yaz → locomotion seçicisini besler
- [x] **Sockets**: kemik seç → offset transform'lu socket ekle, viewport gizmo
      ile düzenle, `sockets[]` sidecar'a yaz
- [x] Socket'e preview asset takıp konumlandırma (silah/prop attach önizlemesi)
- [x] **Morph Target Previewer**: `morphTargetInfluences` slider'ları
- [ ] **Blend Space (data)**: 1D/2D blend noktaları tanımla (örn. hız →
      idle↔walk↔run sürekli harman) + viewport önizleme; runtime'da `AnimationMixer`
      ağırlıklarıyla harman. `blendSpaces` sidecar'a yazılır. (CrossfadeAnimator'ın
      "tek aktif klip" modelini çok-klip ağırlıklı harmana yükseltmenin authoring ucu;
      node-graph değil, saf data.)

### Faz 3 — Animation Notifies + Montage-lite (ertelenmiş)

- [ ] Klip timeline'ında **notify** işaretleri ekle/düzenle (ayak sesi, hasar
      penceresi, efekt tetikleyici)
- [ ] `notifies[]` sidecar formatı + runtime'da notify yayını (event akışı)
- [ ] **Montage-lite**: tek-atış aksiyon — bir klibi (veya section dizisini) bir
      kez oynat, base locomotion'a blend-in/out, ortasında notify yay
      (saldırı / zıplama / reload). `montages[]` sidecar formatı + runtime tetikleme API'si
- [ ] (opsiyonel) Montage section'ları / basit branching — Animation Composite
      ihtiyacını da büyük ölçüde karşılar

### Faz 4 — Physics Mode / PhAT-lite (ertelenmiş, opsiyonel)

- [ ] Mod anahtarında `Physics` modunu aktifleştir
- [ ] Kemiklere **bodies** (kapsül/küre/kutu) ata + viewport gizmo
- [ ] **Constraints** (eklem limitleri) kur
- [ ] Rapier ragdoll önizleme/simülasyon; collision profili
- [ ] `physicsAsset` sidecar formatı

### Faz 5 — Persistans & Save Validator

- [x] `src/editor/assetSkeletonStore.ts` + `*.skeleton.json` formatı
      (`sockets`, `animationSet`, `blendSpaces`, `notifies`, `montages`, preview prefs)
- [x] Dev endpoint `/__save-skeleton` (yazma) + `loadAssetSkeleton` (okuma,
      eksik/bozuk → güvenli default)
- [ ] `LayoutCharacter` yeni alanlarını `tools/saveValidator.ts` allowlist'ine ekle
- [ ] CLAUDE.md "save-validator allowlist gotcha" notunu güncelle

### Faz 6 — Test & Doküman

- [~] `tools/engine-tests.ts`: skeleton sidecar okuma/yazma + anim-set çözümleme
- [ ] Save round-trip testi (yeni alanlar düşmüyor)
- [ ] `npx tsc --noEmit` temiz
- [ ] `docs/architecture/UNREAL_BASICS_LESSONS.md` Progress Log'a giriş
- [ ] Kullanıcı akışı: Content → çift tık → SkeletalMeshEditor → klip önizle /
      socket ekle / morph → kaydet → runtime'da yansıma

---

## Açık Sorular / Kararlar

1. **Faz sıralaması:** Faz 1 (görüntüleme) tek başına büyük değer — yazar bir
   karakterin hangi kliplere/kemiklere sahip olduğunu görsel doğrular; bu, şu an
   locomotion config yazarken en büyük kör nokta. Önce Faz 1.
2. **Ortak viewport base refactor'ı Faz 1 içinde mi, sonra mı?** Öneri: Faz 1'de
   küçük bir base çıkarıp iki editörün paylaşması (kod tekrarını baştan önler).
3. **Physics mode (PhAT) gerçekten gerekli mi?** Ragdoll ihtiyacı netleşene kadar
   ertelenmiş; mod anahtarında yer tutucu olarak durur.
4. **Unreal animasyon asset menüsü** (Anim BP / Blend Space / Montage / Aim Offset /
   Composite / Pose / Mirror / Layer Interface / Bank / Frame Stripping): analiz
   edildi (Bölüm C.2). Yeni editör türü gerekmiyor. Karakter sistemi için gerçek
   genişleme yalnızca **Blend Space (Faz 2, data)** ve **Montage-lite (Faz 3)** —
   ikisi de node-graph değil, data + `AnimationMixer`. Görsel Anim Blueprint editörü
   bilinçli olarak kapsam dışı (Bölüm D). Kalan asset'ler ertelendi/atlandı.
