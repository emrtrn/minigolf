# Foliage Mode Araştırması ve Forge Planı

> Tarih: 2026-06-23
> Durum: Gelecek faz planı. Kod uygulanmadı.
> Amaç: Unreal Engine Foliage sistemini araştırmak, Forge'da **Foliage Mode**
> adlı ayrı bir ana editor mode olarak nasıl kurulacağını planlamak ve Landscape /
> Mesh Paint / normal Placement sistemlerinden sınırlarını ayırmak.

## Kaynaklar

Bu doküman resmi Unreal Engine dokümanlarına göre hazırlandı:

- Foliage Mode:
  https://dev.epicgames.com/documentation/unreal-engine/foliage-mode-in-unreal-engine
- Procedural Foliage Tool:
  https://dev.epicgames.com/documentation/unreal-engine/procedural-foliage-tool-in-unreal-engine
- Grass Quick Start:
  https://dev.epicgames.com/documentation/unreal-engine/grass-quick-start-in-unreal-engine
- Open World Tools Property Reference:
  https://dev.epicgames.com/documentation/unreal-engine/open-world-tools-property-reference-in-unreal-engine
- Instanced Static Mesh Component:
  https://dev.epicgames.com/documentation/unreal-engine/instanced-static-mesh-component-in-unreal-engine

## Ana karar

Foliage, Forge'da Landscape ve Mesh Paint gibi ayrı bir **ana editor mode** olacak.
Normal object placement veya Landscape Paint alt özelliği değildir.

- **Landscape Mode:** terrain oluşturma, sculpt ve landscape layer paint.
- **Mesh Paint Mode:** yerleştirilmiş mesh instance'larını vertex color / weight ile boyama.
- **Foliage Mode:** yüzeylere yüksek sayıda static mesh foliage instance boyama,
  silme ve düzenleme.

Foliage instance'ları normal `layout.instances[].placements[]` listesine tek tek
yazılmamalı. Çimen, taş, çalı ve ağaç yoğunluğu hızla binlerce instance'a çıkabilir;
bu nedenle foliage verisi ayrı bir sidecar/veri modeliyle saklanmalı ve render'da
`InstancedMesh` gruplarıyla çizilmelidir.

## Unreal'da Foliage ne içeriyor

Unreal Foliage Mode, filter-enabled yüzeylere static mesh veya actor foliage
boyamak için kullanılır. Temel parçalar:

| Unreal parçası | Ne yapar | Forge kararı |
| --- | --- | --- |
| Static Mesh Foliage | Mesh instancing ile yoğun foliage render eder. | Faz 1'e al. Ana hedef. |
| Actor Foliage | Blueprint/native actor instance yerleştirir. | Ertele. Yüksek yoğunlukta pahalı. |
| Foliage Type | Mesh, density, radius, scale, alignment, culling gibi ayarları taşır. | Faz 1'e al, sade schema ile. |
| Paint / Erase / Single | Brush ile foliage ekleme/silme veya tek instance koyma. | Faz 1'e al. |
| Select / Lasso / Remove | Foliage instance seçimi ve silme. | Faz 1 sade seçim, Lasso Faz 2. |
| Reapply | Mevcut instance'lara değişen type ayarlarını uygular. | Faz 2. |
| Fill | Seçili hedef yüzeyi foliage ile doldurur. | Faz 2. |
| Filters | Landscape, Static Mesh, Foliage, BSP, translucent hedefleri sınırlar. | Faz 1: Landscape + Static Mesh. Diğerleri sonra. |
| Culling / Scalability | Mesafeye göre gizleme ve density scale. | Faz 1 basit cull, scalability sonra. |
| Procedural Foliage | Orman simülasyonu / seed spread. | Faz 4. |
| Landscape Grass | Landscape material/layer bağlantılı otomatik grass üretimi. | Faz 3, Landscape entegrasyonu. |

## Forge mevcut durum

- Forge statik meshleri zaten `InstancedMesh` ile render ediyor. Bu, Foliage için
  doğru render temelidir.
- Scene Editor ve Runtime Scene tarafı manifest asset loader, model cache ve
  material/collision sidecar desenlerine sahip.
- Landscape henüz plan aşamasında; Foliage Faz 1 yine de Static Mesh yüzeylerine
  paint ederek başlayabilir.
- Landscape geldiğinde Foliage target olarak Landscape'i de kullanmalı.
- Normal placement sistemi seçilebilir, transform edilebilir object'ler içindir;
  Foliage instance'ları bu sistemden ayrı tutulmalıdır.
- `public/assets` içinde çimen/zemin texture ve starter material örnekleri var ama
  foliage mesh library ayrıca hazırlanmalıdır.

## Sistem ayrımı

### Foliage Mode vs Landscape Mode

Landscape Paint, terrain material layer weight boyar. Foliage Mode ise yüzeylere
static mesh instance yerleştirir.

- Landscape layer paint: Grass/Dirt/Rock/Snow gibi weightmap verisi.
- Foliage paint: çimen, ağaç, taş, çalı mesh instance'ları.
- Landscape layer'ları ileride Foliage spawn maskesi olarak kullanılabilir, ama bu
  Faz 3 entegrasyonudur.

### Foliage Mode vs Mesh Paint

Mesh Paint, seçili mesh instance'ın vertex/color/weight verisini değiştirir.
Foliage Mode, yüzey üzerine yeni foliage instance'ları üretir.

### Foliage Mode vs Normal Placement

Normal placement:

- Outliner'da tek tek görünür.
- Gizmo ile taşınır.
- Layout placement listesine yazılır.

Foliage instance:

- Outliner'da tek tek görünmez.
- Foliage Mode içinde seçilir/silinir.
- Foliage data sidecar'ına yazılır.
- Render'da asset/type bazlı `InstancedMesh` gruplarıyla çizilir.

## Faz 1 hedefi

Faz 1 adı:

**Foliage Mode: Manual Static Mesh Foliage Paint**

Faz 1'de kullanıcı şunları yapabilmeli:

1. Foliage Mode'a geçmek.
2. Content Browser'dan static mesh'i Foliage Type listesine eklemek.
3. Landscape veya Static Mesh yüzeyine brush ile foliage paint yapmak.
4. Shift veya Erase tool ile foliage silmek.
5. Single tool ile tek foliage instance yerleştirmek.
6. Select/Remove ile seçili foliage instance'larını kaldırmak.
7. Save/Reload sonrası foliage instance'larını korumak.
8. Play/runtime tarafında foliage'ı görmek.

## Veri modeli önerisi

Foliage verisi iki parçaya ayrılmalı:

1. Foliage Type asset: Mesh ve placement ayarları.
2. Level foliage data: Boyanmış instance'lar.

### Foliage Type asset

Path önerisi:

```text
public/assets/.../<Name>.foliage.json
```

Öneri:

```ts
interface ForgeFoliageTypeDef {
  schema: 1;
  type: "foliageType";
  name: string;
  meshAssetId: string;
  radius: number;
  density: number;
  scaleMin: Vec3;
  scaleMax: Vec3;
  randomYaw: boolean;
  alignToNormal: boolean;
  zOffsetMin?: number;
  zOffsetMax?: number;
  slopeMin?: number;
  slopeMax?: number;
  heightMin?: number;
  heightMax?: number;
  castShadow?: boolean;
  receiveShadow?: boolean;
  collision?: boolean;
  cullStart?: number;
  cullEnd?: number;
}
```

Faz 1 varsayılanları:

- `radius`: 0.5
- `density`: 1
- `scaleMin`: `[1, 1, 1]`
- `scaleMax`: `[1, 1, 1]`
- `randomYaw`: true
- `alignToNormal`: true
- `collision`: false

Collision default false olmalı. Çimen/çiçek/küçük taşlar collision üretmemeli.
Büyük kaya/ağaç gibi tipler collision açabilir, ama bu draw/collider maliyeti
nedeniyle bilinçli bir seçim olmalı.

### Level foliage sidecar

Path önerisi:

```text
public/layouts/<layout-id>.foliage.json
```

Öneri:

```ts
interface LayoutFoliageData {
  schema: 1;
  type: "foliage";
  groups: Array<{
    id: string;
    foliageTypeId: string;
    target: {
      kind: "landscape" | "staticMesh";
      id: string;
    };
    instances: Array<{
      position: Vec3;
      rotation: Vec3;
      scale: Vec3;
      normal?: Vec3;
      seed?: number;
    }>;
  }>;
}
```

Not: Static mesh target için `id`, assetId veya placement key olabilir. Landscape
target için landscape id yeterlidir. Bu karar Landscape veri modeli kesinleştiğinde
netleştirilmeli.

## Paint algoritması

Faz 1 CPU tabanlı olabilir.

1. Pointer raycast ile hedef yüzey bulunur.
2. Filter ayarlarına göre hedef kabul edilir veya reddedilir.
3. Brush radius içinde random sample noktaları üretilir.
4. Her sample için yüzey raycast / barycentric hit alınır.
5. Foliage Type kuralları uygulanır:
   - radius overlap testi
   - slope min/max
   - height min/max
   - random scale
   - random yaw
   - align to normal
   - z offset
6. Geçerli sample instance listesine eklenir.
7. Dirty foliage group render `InstancedMesh` olarak rebuild edilir.

Erase:

- Brush radius içindeki aktif foliage type instance'ları hedeflenir.
- Erase density > 0 ise hepsi silinmez, kalan yoğunluk korunabilir.
- Faz 1'de basit davranış: radius içindeki matching type instance'larını sil.

Single:

- Hit noktasına bir instance yerleştirir.
- "All selected" veya "cycle selected" davranışı Faz 2'ye bırakılabilir.

## Editor UX önerisi

Foliage Mode paneli Unreal'a benzer ama daha sade olmalı.

Panel bölümleri:

- Tools
- Brush Options
- Filters
- Foliage Types
- Type Details
- Selection / Resource Usage

Tools:

- Select
- Paint
- Erase
- Single
- Remove

Faz 2 araçları:

- Lasso
- Fill
- Reapply
- Invalid
- Deselect All

Brush Options:

- Brush Size
- Paint Density
- Erase Density
- Random Seed

Filters:

- Landscape
- Static Mesh
- Foliage

Faz 1'de Landscape ve Static Mesh yeterli. Foliage üzerine foliage boyama sonraki
faz olabilir.

Type Details:

- Mesh Asset
- Radius
- Density
- Scale Min/Max
- Random Yaw
- Align to Normal
- Z Offset Min/Max
- Slope Min/Max
- Height Min/Max
- Cast Shadow / Receive Shadow
- Collision
- Cull Start / End

Outliner:

- Foliage groups tek satır olarak görünmeli.
- Her instance Outliner'da görünmemeli.
- Foliage Mode selection overlay'i instance seçimini göstermeli.

## Render mimarisi

Faz 1 render yolu:

- Foliage instances `foliageTypeId + meshAssetId + material variant` bazında batch edilir.
- Her batch bir veya birkaç `InstancedMesh` kullanır.
- Instance matrix'leri sidecar verisinden oluşturulur.
- Type ayarı değişince ilgili batch rebuild edilir.
- Foliage Mode'da selected instance overlay ayrı çizilir.

Cull:

- Three.js `InstancedMesh` built-in frustum culling sınırlıdır; Faz 1'de basit
  batch-level culling yeterli.
- `cullStart/cullEnd` için shader fade sonraki faz.
- Faz 2 veya Faz 3'te chunk/grid bazlı foliage batches gerekir.

Chunk önerisi:

```ts
interface FoliageRenderChunk {
  groupId: string;
  chunkX: number;
  chunkZ: number;
  mesh: InstancedMesh;
}
```

İlk sürümde chunking şart değil, ama 5k+ instance hedefleniyorsa erken eklenmeli.

## Collision ve runtime

Foliage collision pahalıdır; default kapalı olmalı.

Faz 1:

- `collision: false` default.
- Collision açık olan foliage type'lar için sadece basit collider kullanılmalı.
- Çimen/ufak bitkiler collision üretmemeli.
- Büyük ağaç/kaya için collision açık olabilir.

Runtime:

- Play tarafı foliage sidecar'ı yükler.
- Static Mesh Foliage render edilir.
- Collision açık type'lar runtime scene document'a collider olarak aktarılır veya
  doğrudan physics subsystem'e batch/simple collider olarak verilir.
- Binlerce collider'a izin verilmemeli; type-level limit veya warning gerekir.

## Landscape entegrasyonu

Landscape olmadan da Foliage Mode Static Mesh yüzeylerine paint edebilir. Landscape
geldiğinde şu entegrasyonlar eklenir:

- Landscape target filter.
- Terrain raycast / height sampler.
- Align to landscape normal.
- Landscape layer mask filter:
  - sadece `Grass` layer üstüne boya
  - `Rock` layer üstüne taş boya
  - `Road` layer üstüne foliage engelle
- Landscape sculpt sonrası reattach/snap:
  - seçili foliage instance'ları yeniden terrain yüzeyine oturtulur.

Bu entegrasyon elle Foliage Mode paint için kullanılacak. Landscape Grass /
layer-driven otomatik scatter ise Faz 3'tür.

## Landscape Grass / layer-driven scatter

Unreal Grass sistemi, Landscape material'daki `Landscape Layer Sample` ve
`Landscape Grass Output` ile belirli layer boyandığında grass type spawn eder.
Forge'da bunun karşılığı Foliage Mode'un üstüne kurulmalı, ama Faz 1'e alınmamalı.

Faz 3 önerisi:

```ts
interface LandscapeFoliageRule {
  id: string;
  landscapeId: string;
  layerId: string;
  foliageTypeId: string;
  density: number;
  minWeight: number;
  seed: number;
}
```

Davranış:

- Landscape layer weightmap spawn maskesi olarak kullanılır.
- Sonuç deterministic olur.
- Generated instances tek tek save edilmez; rule + seed + landscape data'dan
  yeniden üretilir.
- Manual Foliage paint ile generated foliage ayrı tutulur.

Bu sistem Foliage Mode dokümanında planlanır, Landscape dokümanında sadece
integration hook olarak kalır.

## Procedural Foliage

Unreal Procedural Foliage Tool orman benzeri alanlar için seed/simulation tabanlıdır.
Forge için Faz 4 veya sonrası olmalı.

Alınacak fikirler:

- Random seed
- Tile size
- Foliage type listesi
- Blocking volumes
- Density/age/spread benzeri kurallar

İlk sürüme alınmayacaklar:

- Yıllara göre büyüme simülasyonu.
- Büyük forest ecology.
- World Partition grid.
- Complex overlap/ecosystem competition.

## Kontrol listesi

### Faz 0 - Dokümantasyon ve karar

- [x] Unreal Foliage Mode ana parçalarını araştır.
- [x] Forge'da Foliage'i ayrı ana editor mode olarak konumlandır.
- [x] Landscape/Mesh Paint/Placement sınırlarını ayır.
- [ ] Kullanıcıyla Faz 1 sınırlarını onayla.

### Faz 1 - Manual Static Mesh Foliage Paint

- [ ] `ForgeFoliageTypeDef` schema + normalize/validate.
- [ ] `LayoutFoliageData` sidecar schema + normalize/validate.
- [ ] `/__save-foliage` endpoint.
- [ ] Content Browser'dan mesh'i Foliage Type listesine ekleme.
- [ ] Foliage Mode paneli.
- [ ] Paint / Erase / Single / Select / Remove tools.
- [ ] Static Mesh target raycast.
- [ ] Landscape target raycast, Landscape sistemi varsa.
- [ ] InstancedMesh foliage render batches.
- [ ] Save/Reload.
- [ ] Runtime Play render.
- [ ] Engine tests.

### Faz 2 - Editing ve Quality Tools

- [ ] Lasso select.
- [ ] Fill.
- [ ] Reapply.
- [ ] Invalid selection.
- [ ] Deselect all.
- [ ] Reattach / snap to ground.
- [ ] Foliage group resource usage.
- [ ] Cull start/end fade.
- [ ] Chunk/grid render batches.

### Faz 3 - Landscape Grass / Layer-driven Scatter

- [ ] Landscape layer mask filter.
- [ ] Landscape foliage rule modeli.
- [ ] Deterministic generated foliage.
- [ ] Manual vs generated foliage ayrımı.
- [ ] Dirty landscape chunk rebuild.
- [ ] Rule save/load.

### Faz 4 - Procedural Foliage Spawner

- [ ] Procedural spawner actor/data.
- [ ] Seed + tile area.
- [ ] Foliage type listesi.
- [ ] Blocking volume veya exclusion shapes.
- [ ] Simulate/regenerate.
- [ ] Generated foliage cache.

### Faz 5 - Actor Foliage

- [ ] Actor class foliage type.
- [ ] Low-density actor spawn.
- [ ] Selection/edit integration.
- [ ] Runtime behavior warningleri.

## Kabul kriterleri - Faz 1

- User Foliage Mode'a geçer.
- Static mesh asset'i Foliage Type olarak ekler.
- Brush ile Static Mesh veya Landscape yüzeyine foliage paint eder.
- Erase ile foliage siler.
- Single ile tek instance yerleştirir.
- Select/Remove ile instance kaldırır.
- Save eder, editor reload sonrası foliage korunur.
- Play/runtime'da foliage görünür.
- Normal Outliner yüzlerce instance ile dolmaz.
- `npm run build:verify` geçer.

## Açık kararlar

Dokümana göre önerilen varsayılanlar:

- Foliage ayrı ana editor mode olsun.
- Faz 1 sadece Static Mesh Foliage olsun.
- Actor Foliage ertelensin.
- Foliage instance'ları normal placement listesine yazılmasın.
- Collision default false olsun.
- Landscape Grass / layer-driven scatter Faz 3'e kalsın.
- Procedural Foliage Faz 4'e kalsın.

Kullanıcı onayı gerekenler:

1. Foliage Type ayrı asset (`*.foliage.json`) mi olsun, yoksa level-local type listesi
   ile mi başlasın?
2. İlk Faz 1 target'ları Static Mesh + Landscape mi, yoksa Landscape hazır değilse
   sadece Static Mesh ile mi başlasın?
3. Foliage sidecar layout bazlı mı olsun (`layouts/<layout>.foliage.json`), yoksa
   level asset klasöründe mi saklansın?
4. İlk render batching chunk'sız mı başlasın, yoksa en baştan grid/chunk batching mi gelsin?
5. Collision açık foliage için üst instance limiti ne olsun?
6. Landscape Grass generated foliage, manual foliage ile aynı panelde mi yönetilsin
   yoksa ayrı "Generated" sekmesi mi olsun?

## Son karar önerisi

Forge için Foliage Mode yapılmalı ve ana editor mode olarak konumlandırılmalı.
İlk sürüm manuel Static Mesh Foliage paint'e odaklanmalı:

1. Foliage Type listesi.
2. Paint/Erase/Single/Select/Remove.
3. Static Mesh ve Landscape yüzey target'ları.
4. Ayrı foliage sidecar.
5. InstancedMesh render batches.
6. Runtime görünürlük.

Landscape Grass, Procedural Foliage ve Actor Foliage sonraki fazlara ayrılmalı.
Bu sıra sistemi uygulanabilir tutar ve Landscape / Mesh Paint / normal Placement
sınırlarını temiz bırakır.
