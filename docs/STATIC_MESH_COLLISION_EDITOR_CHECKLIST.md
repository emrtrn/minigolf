# Static Mesh Editor & Collision Checklist

> Tarih: 2026-06-17
> Amaç: Unreal'daki **Static Mesh Editor**'a karşılık gelen, Content Browser'dan
> bir 3D asset'e çift tıklanınca yeni bir sekmede açılan asset editörü kurmak;
> bu editörde collision kurulumu (basit collider primitifleri, K-DOP, convex,
> collision preset / complexity), materyal ve detay panelini sağlamak. Ayrıca
> sahnede seçili objenin Details panelinde Collision başlığı altında ilgili
> alt kümeyi göstermek.
>
> Bu doküman önce Unreal collision modelini özetler, Forge'un mevcut durumuyla
> eşler, kapsam kararını verir, ardından fazlı checklist'i sunar.

## Kaynaklar (incelenen Unreal dokümantasyonu)

- [Collision in Unreal Engine](https://dev.epicgames.com/documentation/unreal-engine/collision-in-unreal-engine)
- [Collision Response Reference](https://dev.epicgames.com/documentation/unreal-engine/collision-response-reference-in-unreal-engine)
- [Setting Up Collisions With Static Meshes](https://dev.epicgames.com/documentation/unreal-engine/setting-up-collisions-with-static-meshes-in-unreal-engine)
- [Add a K-DOP Collision Hull to a Static Mesh](https://dev.epicgames.com/documentation/unreal-engine/add-a-k-dop-collision-hull-to-a-static-mesh-in-unreal-engine)
- [Configuring Collision for a Static Mesh (UEFN)](https://dev.epicgames.com/documentation/en-us/fortnite/configuring-collision-for-a-static-mesh-in-unreal-editor-for-fortnite)
- [What is the difference between query and physics collision (forum)](https://forums.unrealengine.com/t/what-is-the-difference-between-query-collision-and-physic-collision/482840)

---

## Bölüm A — Unreal Collision Modeli (özet)

Unreal'da collision üç ana kavram etrafında döner: **Collision Enabled** (ne tür
collision çalışır), **Object Type / Channels** (filtreleme kimliği) ve
**Responses** (her kanala karşı Block/Overlap/Ignore).

### A.1 Collision Enabled (collision tipi)

Her primitive component'in dört durumu vardır:

| Durum | Query (trace/overlap/sweep) | Physics (rigid body) |
| --- | --- | --- |
| **No Collision** | ✗ | ✗ |
| **Query Only** | ✓ | ✗ |
| **Physics Only** | ✗ | ✓ |
| **Query and Physics** | ✓ | ✓ |

- *Query collision*: raycast, overlap testi, karakter hareketi sweep'i.
- *Physics collision*: rigid body simülasyonu, çarpışmadan itme.

### A.2 Collision Presets / Profiles

İsimli paketler; her preset = Collision Enabled + Object Type + kanal yanıtları
demeti. Yerleşik örnekler: `NoCollision`, `BlockAll`, `OverlapAll`,
`BlockAllDynamic`, `OverlapAllDynamic`, `Pawn`, `PhysicsActor`, `Trigger`,
`Ragdoll`, `Vehicle`, `UI`, `Custom...`. `Custom...` seçilince yanıt matrisi
elle düzenlenebilir.

### A.3 Object Types / Channels ve Responses

- **Object Type (Object Channel)**: bu objenin collision kimliği. Yerleşik:
  `WorldStatic`, `WorldDynamic`, `Pawn`, `PhysicsBody`, `Vehicle`,
  `Destructible` + özel kanallar.
- **Trace Channels**: `Visibility`, `Camera` + özel trace kanalları.
- **Responses**: her kanala karşı `Ignore` / `Overlap` / `Block`.
  - **Block etkileşimi karşılıklıdır**: iki obje birbirini durdurması için
    *ikisi de* karşı kanala `Block` demeli.
  - **Overlap event** için en az biri `Overlap`, diğeri `Ignore` olmamalı.
  - Bir tarafta `Ignore` varsa etkileşim tamamen yok sayılır.

### A.4 Event bayrakları

- **Generate Overlap Events**: Begin/End Overlap olaylarının üretilmesi.
- **Simulation Generates Hit Events**: fizik simülasyonunda Hit olayları.

### A.5 Collision Complexity (Static Mesh asset düzeyi)

| Seçenek | Anlamı |
| --- | --- |
| **Project Default** | Proje ayarını kullan |
| **Simple And Complex** | Query+physics için simple, karmaşık trace için complex (per-poly) |
| **Use Simple Collision As Complex** | Karmaşık trace'lerde bile basit şekiller (ucuz) |
| **Use Complex Collision As Simple** | Render mesh'i per-poly collision olarak kullan; **dinamik simülasyon yapılamaz** |

- **Simple collision** = elle eklenen ilkel şekiller (sphere/box/capsule/convex).
- **Complex collision** = render üçgenlerinden türetilen per-poly collision
  (yalnızca statik query için; dynamic body olamaz).

### A.6 Simple Collision şekilleri (Static Mesh Editor → Collision menüsü)

- Add **Sphere** / **Capsule** / **Box** Simplified Collision
- **K-DOP** kabukları (eksen hizalı düzlemlerle sıkıştırılmış convex):
  `10DOP-X`, `10DOP-Y`, `10DOP-Z`, `18DOP`, `26DOP` (K büyüdükçe daha hassas,
  daha pahalı)
- **Auto Convex Collision** (V-HACD): Hull Count / Max Hull Verts / Hull
  Precision parametreleriyle convex parçalara ayırma
- **Convert Boxes to Convex**
- **Remove Collision**, **Delete / Duplicate / Copy / Paste Selected Collision**
- **Copy Collision from Selected Static Mesh**

### A.7 Static Mesh Details — Collision başlığı (görsellerdeki alanlar)

- Primitives (eklenen simple collision listesi)
- Double Sided Geometry
- Never Needs Cooked Collision Data
- Simple Collision Physical Material
- Collision Presets (örn. BlockAll)
- Collision Complexity (Project Default)
- Customized Collision (bool)
- Complex Collision Mesh (referans)

### A.8 Component (sahne objesi) — Collision başlığı (görsellerdeki alanlar)

- Simulation Generates Hit Events
- Phys Material Override
- Generate Overlap Events
- Can Character Step Up On (Yes / No / Owner)
- Collision Presets (Default / Custom...)
- Generate Overlap Events During Level Streaming
- Update Overlaps Method During Level Streaming
- Default Update Overlaps Method

### A.9 Physical Material

Yüzey özellikleri: friction, restitution, density + Surface Type (ayak sesi /
decal / gameplay tepkileri). Mesh'te "Simple Collision Physical Material",
component'te "Phys Material Override".

---

## Bölüm B — Forge Mevcut Durum

- **`ColliderComponent`** (`engine/scene/components.ts`): `shape`
  (`box`/`sphere`/`capsule`), `size`, `center`, `isStatic`, `isSensor`,
  `simulatePhysics`, `massKg`, damping, `enableGravity`, axis lock'lar. Preset,
  channel, complexity, convex/trimesh **yok**.
- **`LayoutPlacement`** (`engine/scene/layout.ts`): `collision?` (bool),
  `sensor?` (bool), `simulatePhysics?` (bool), `physics?` (LayoutPhysics). Tek
  obje = tek implicit kutu/kapsül collider.
- **Physics backend**: Rapier (`engine/physics/physicsSubsystem.ts`).
  `ball` / `capsule` / `cuboid` şekilleri var; convex/trimesh, collision group,
  phys material (friction 0.8 / restitution 0 sabit) **yok**.
- **ThumbnailRenderer** (`src/editor/ThumbnailRenderer.ts`): modeli grid
  üzerinde, ışıklarla render ediyor → Static Mesh Editor viewport'unun temeli.
- **Content Browser** (`src/editor/EditorUi.ts`, `createAssetCard`): asset
  kartında **çift tıklama yok**; tek tık `beginAssetPlacement`. Çift tıklama
  handler'ı eklenmeli.
- **Sekme/doküman sistemi yok**: editör tek viewport + sabit panel düzeni
  (`InspectorTab = "details" | "world"` yalnızca inspector pane toggle'ı).
  Static Mesh Editor net yeni bir doküman/sekme kabuğu gerektirir.
- **Details paneli** (`renderDetails`): zaten bir `Collision` boolean toggle'ı
  ve bir Physics bölümü var. Unreal tarzı Collision başlığı buraya eklenecek.
- **Save validator** (`tools/saveValidator.ts`, `applyTransformFields`):
  allowlist'e eklenmeyen her yeni `LayoutPlacement` alanı kayıtta **sessizce
  düşer**. (CLAUDE.md bunu `vite.config.ts` olarak anar; gerçek modül
  `tools/saveValidator.ts` ve vite config onu import eder.)

---

## Bölüm C — Eşleme & Kapsam Kararı

Forge web-first ve hafif; Unreal'ın tam kanal matrisi şu an aşırı. Faithful ama
sadeleştirilmiş bir model öneriyoruz.

| Unreal kavramı | Forge karşılığı | Karar |
| --- | --- | --- |
| Collision Enabled (4 durum) | `collisionEnabled: "none" \| "query" \| "physics" \| "queryAndPhysics"` enum'u | **Al** (mevcut collision/sensor/simulate'ı bu enum'a sar) |
| Collision Presets | Küçük yerleşik set + `Custom` | **Al (sadeleştir)** |
| Object Type / Object Channels | Azaltılmış kanal seti → Rapier collision groups | **Al (sadeleştir)** |
| Trace Channels (Visibility/Camera) | `Visibility` + `Camera` trace kanalları | **Sadeleştir** |
| Block / Overlap / Ignore matrisi | Custom preset'te per-kanal yanıt | **Al (sadeleştir)** |
| Collision Complexity | enum: ProjectDefault / SimpleAndComplex / SimpleAsComplex / ComplexAsSimple | **Al** (önce Simple tam, Complex/trimesh sonraki faz) |
| Simple shapes: Sphere/Box/Capsule | Mevcut shape'lerle birebir | **Al (öncelik)** |
| K-DOP (10/18/26-DOP) | Convex hull üretimi | **Ertele (Faz 3b)** |
| Auto Convex (V-HACD) | Convex decomposition | **Ertele (Faz 7+)** |
| Convert Boxes to Convex | — | **Ertele** |
| Generate Overlap Events | bool | **Al** |
| Simulation Generates Hit Events | bool | **Al** |
| Physical Material | friction/restitution/density preset'i | **Al (sadeleştir)** |
| Double Sided Geometry | complex collision çift yüz | **Ertele** (complex ile birlikte) |
| Can Character Step Up On | karakter step-up ipucu | **Ertele** |
| Never Needs Cooked Collision Data | (cook kavramı web'de yok) | **Atla** |
| Update Overlaps Method / Level Streaming | (level streaming yok) | **Atla** |

---

## Bölüm D — Mimari Kararlar

- **Veri sahipliği (Unreal gibi iki katman):**
  - **Asset düzeyi (default):** collision kurulumu asset'e ait; tüm
    yerleşimler için varsayılan. Saklama: asset catalog/manifest yanında bir
    `*.collision.json` sidecar veya catalog kaydı (Content Browser `public/`
    kapsamında kalır).
  - **Placement düzeyi (override):** `LayoutPlacement` üzerinde isteğe bağlı
    override alanları (mevcut `collision`/`sensor`/`simulatePhysics` korunur,
    yenileri eklenir).
- **Editor core generic kalır:** collision engine-generic'tir, sorun yok.
  Proje-özel kurallar (hangi kanal neyi durdurur) game runtime/data'da yaşar.
- **Bundle ayrımı:** Static Mesh Editor `src/editor/` altında, dinamik `?editor`
  importunun arkasında kalır; game build'e girmez.
- **Sekme kabuğu:** editöre hafif bir "document host" eklenir: Level (mevcut
  viewport) + Static Mesh Editor sekmeleri. İlk sürümde overlay/tam-ekran
  doküman görünümü de kabul edilebilir, ama sekme şeridi hedef.
- **Viewport yeniden kullanımı:** ThumbnailRenderer'ın sahne/ışık/grid kurulumu
  ile EditorCameraController orbit mantığı SM Editor viewport'una pay edilir.
- **Save validator gotcha:** her yeni placement alanı `applyTransformFields`'e
  eklenir; aksi halde kayıtta düşer.

---

## Checklist

Durum: `[ ]` yapılmadı · `[~]` kısmi · `[x]` tamam

### Faz 0 — Araştırma & Karar (bu doküman)

- [x] Unreal collision dokümanlarını incele ve özetle (Bölüm A)
- [x] Forge mevcut durumu çıkar (Bölüm B)
- [x] Kapsam/eşleme kararı (Bölüm C) ve mimari karar (Bölüm D)
- [ ] Açık soruları kullanıcıyla netleştir (aşağıdaki "Açık Sorular")

### Faz 1 — Veri Modeli (engine)

- [ ] `CollisionEnabled` enum'u ekle: `none | query | physics | queryAndPhysics`
- [ ] `CollisionComplexity` enum'u ekle: `projectDefault | simpleAndComplex | simpleAsComplex | complexAsSimple`
- [ ] Yerleşik `CollisionPreset` kataloğu + `Custom`
- [ ] Azaltılmış kanal seti tanımla (örn. `WorldStatic`, `WorldDynamic`, `Pawn`, `PhysicsBody`, `Trigger` + trace: `Visibility`, `Camera`)
- [ ] `CollisionResponse` (`ignore | overlap | block`) ve per-kanal yanıt haritası tipi
- [ ] **Asset-düzeyi** collision tanımı tipi: simple collider listesi (`primitives[]`), complexity, preset, phys material, double-sided
- [ ] `ColliderComponent`'i çok-primitifli destekleyecek şekilde genişlet (tek implicit collider → `primitives[]`), geriye dönük uyumlu
- [ ] `LayoutPlacement` override alanları: `collisionPreset?`, `collisionEnabled?`, `objectType?`, `responses?` (mevcut `collision`/`sensor`/`simulatePhysics` korunur)
- [ ] `readColliderComponent` / okuyucuları yeni alanlara genişlet + birim testleri (`tools/engine-tests.ts`)

### Faz 2 — Static Mesh Editor Kabuğu (overlay + viewport)

- [~] Editöre overlay doküman ekle (`src/editor/StaticMeshEditor.ts`); gerçek sekme şeridi sonraki faz
- [x] Content Browser asset kartına `dblclick` ekle → model asset ise SM Editor aç (`createAssetCard` → `openStaticMeshEditor`)
- [x] SM Editor viewport: grid + ışık + arkaplan
- [x] Orbit/pan/dolly kamera (minimal inline controller)
- [x] Seçili asset modelini GLTF ile yükle ve ortala/çerçevele
- [x] Başlık = asset adı, kapatılabilir (Esc); aynı anda tek editör
- [x] Dinamik import ile lazy yükleme (editor entry'yi şişirmez); production'da DEV-gate ile elenir

### Faz 3 — Collision Toolbar (üst bar "Collision" menüsü)

- [x] Üst barda `Collision` açılır menüsü
- [x] Add **Sphere** / **Capsule** / **Box** Simplified Collision (model bounds'tan otomatik boyut)
- [x] Seçili collision primitifi: **Delete / Duplicate** (Copy/Paste sonra)
- [x] **Remove Collision** (hepsini temizle)
- [ ] (3b, ertelenebilir) **K-DOP**: 10DOP-X/Y/Z, 18DOP, 26DOP convex hull üretimi (menüde grey placeholder var)
- [ ] (3b, ertelenebilir) **Convert Boxes to Convex**, **Auto Convex Collision** (V-HACD parametreleri)
- [ ] (opsiyonel) **Copy Collision from Selected Static Mesh**

### Faz 4 — Viewport'ta Collision Düzenleme & Görselleştirme

- [x] Eklenen collision primitiflerini wireframe overlay olarak çiz
- [x] Primitif seçimi (details listesi **veya** viewport'ta tıkla/raycast) + seçili vurgusu
- [x] **Move/Rotate/Scale** transform gizmo (three TransformControls), üst barda Select/Move/Rotate/Scale (Q/W/E/R)
- [x] Birden fazla primitif ekleyip her birini ayrı düzenleme (gizmo seçili olana bağlanır)
- [ ] "Show Simple/Complex Collision" görünürlük toggle'ı
- [ ] Sahne viewport'unda da collider görselleştirme tutarlılığı (mevcut `getShowCollision` ile uyum)

### Faz 5 — SM Editor Details Paneli (Collision başlığı)

- [x] Collision bölümü: **Collision Presets** (dropdown)
- [x] **Collision Complexity** (dropdown)
- [ ] **Customized Collision** (bool) — preset=custom ile örtüşüyor; ayrı toggle sonra
- [x] **Simple Collision Physical Material** (text referans)
- [ ] **Complex Collision Mesh** (referans, complex fazında aktif)
- [x] **Double Sided Geometry** (bool)
- [x] **Primitives** listesi (eklenen simple collider'lar; sayı + tip + sil)
- [x] Değişiklikleri asset-düzeyi collision tanımına yaz (explicit Save / Ctrl+S)

### Faz 6 — Sahne Objesi Details (Collision başlığı alt kümesi)

- [x] Seçili objenin Details'ında `Collision` başlığı (toggle bölüme yükseltildi)
- [x] **Collision Presets** override dropdown (Inherit = asset default / preset id)
- [x] Override yokken "Inherit (asset default)" gösterimi; undo/redo destekli
- [x] Placement-düzeyi `collisionPreset` alanı + save validator allowlist
- [ ] **Collision Enabled** durumu (none/query/physics/queryAndPhysics) — sonra
- [ ] **Generate Overlap Events** / **Simulation Generates Hit Events** (bool) — sonra
- [ ] **Phys Material Override** (referans) — sonra
- [ ] Custom seçilince per-kanal yanıt matrisi (Block/Overlap/Ignore) — sonra

### Faz 7 — Runtime Bağlama (Rapier)

- [x] Placement `collisionPreset` → runtime collider eşlemesi (`legacyRoomLayoutAdapter`): `none`=collider yok, `query`=sensor, `physics/queryAndPhysics`=solid
- [ ] Asset-düzeyi collision primitiflerini runtime'a yükle (async sidecar plumbing — sonraki adım)
- [ ] Çok-primitifli collider derleme (şu an tek box)
- [ ] Kanal yanıtları → Rapier **collision groups** (membership/filter bitmask)
- [ ] Convex hull (Rapier `convexHull`) ve (ertele) trimesh complex collision
- [ ] Phys material → collider friction/restitution/density (sabit 0.8/0 yerine)
- [ ] Overlap/Hit event bayraklarını mevcut contact/intersection akışına bağla

### Faz 8 — Persistans & Save Validator

- [x] Asset-düzeyi collision tanımı için saklama formatı (`*.collision.json` sidecar) + `/__save-collision` yazma yolu (`vite.config.ts`)
- [ ] `applyTransformFields`'e yeni placement override alanlarını ekle (`tools/saveValidator.ts`) — Faz 6 ile
- [x] Asset collision tanımı için validator (`validateAssetCollisionDef`) + normalizer (`normalizeAssetCollisionDef`)
- [x] Geriye dönük uyum: eksik/bozuk sidecar güvenli default'a düşer (`loadAssetCollision`)
- [ ] CLAUDE.md "save-validator allowlist gotcha" notunu yeni alanlarla güncelle — Faz 6 ile

### Faz 9 — Test & Doküman

- [ ] `tools/engine-tests.ts`: collision model okuma/yazma + complexity/preset çözümleme testleri
- [ ] Save round-trip testi (yeni alanlar düşmüyor)
- [ ] `npx tsc --noEmit` temiz
- [ ] `docs/UNREAL_BASICS_LESSONS.md` Progress Log'a giriş
- [ ] Kullanıcı akışı doğrulaması: Content → çift tık → SM Editor → collision ekle → kaydet → sahnede yansıma

---

## Kararlar (2026-06-17 netleşti)

1. **Kanal matrisi:** Sabit küçük yerleşik set — `WorldStatic`, `WorldDynamic`,
   `Pawn`, `PhysicsBody`, `Trigger` object kanalları + `Visibility`, `Camera`
   trace kanalları. Kullanıcı kanal ekleyemez; `Custom` preset'te per-kanal
   Block/Overlap/Ignore seçilebilir. Rapier collision groups'a eşlenir.
2. **Asset collision saklama:** Asset başına **sidecar `*.collision.json`**
   (`public/` kapsamında, model dosyasının yanında).
3. **Editör kabuğu:** İlk sürüm **tam-ekran overlay doküman**; sonraki fazda
   gerçek sekme şeridine yükseltilir.
4. **Complex collision:** **Ertelendi** — önce Simple (Sphere/Box/Capsule) +
   preset + complexity enum'u tam. Convex/K-DOP/trimesh sonraki faz.
