# Landscape Mode Research and Forge Plan

> Tarih: 2026-06-23
> Durum: Gelecek faz planı. Kod uygulanmadı.
> Amaç: Unreal Engine Landscape sistemini araştırmak, Forge'da **Landscape Mode**
> adlı ayrı bir ana editor mode olarak nasıl kurulacağını planlamak ve ilk fazın
> sınırlarını netleştirmek.

## Kaynaklar

Bu doküman resmi Unreal Engine dokümanlarına göre hazırlandı:

- Landscape Outdoor Terrain overview:
  https://dev.epicgames.com/documentation/unreal-engine/landscape-outdoor-terrain-in-unreal-engine
- Creating Landscapes:
  https://dev.epicgames.com/documentation/unreal-engine/creating-landscapes-in-unreal-engine
- Editing Landscapes:
  https://dev.epicgames.com/documentation/unreal-engine/editing-landscapes-in-unreal-engine
- Landscape Paint Mode:
  https://dev.epicgames.com/documentation/unreal-engine/landscape-paint-mode-in-unreal-engine
- Landscape Materials:
  https://dev.epicgames.com/documentation/unreal-engine/landscape-materials-in-unreal-engine
- Landscape Technical Guide:
  https://dev.epicgames.com/documentation/unreal-engine/landscape-technical-guide-in-unreal-engine
- Landscape Edit Layers:
  https://dev.epicgames.com/documentation/unreal-engine/landscape-edit-layers-in-unreal-engine
- Landscape Splines:
  https://dev.epicgames.com/documentation/unreal-engine/landscape-splines-in-unreal-engine
- Landscape Visibility Tool:
  https://dev.epicgames.com/documentation/unreal-engine/landscape-visibility-tool-in-unreal-engine

## Ana karar

Landscape, Forge'da Mesh Paint ve Foliage gibi ayrı bir **ana editor mode** olacak.
Material Editor veya Static Mesh Editor alt özelliği değildir.

- **Landscape Mode:** terrain oluşturma, sculpt ve landscape layer paint.
- **Mesh Paint Mode:** yerleştirilmiş mesh instance'larını vertex color / weight ile boyama.
- **Foliage Mode:** ayrıca ele alınacak bağımsız çalışma
  ([FOLIAGE_MODE_RESEARCH_AND_PLAN.md](./FOLIAGE_MODE_RESEARCH_AND_PLAN.md)).
  Bu dokümanda sadece landscape ile sınır ilişkisi not edilir; foliage sistemi planlanmaz.

İlk Landscape hedefi Unreal'ın tamamını kopyalamak değil, Forge'un mevcut
editor/runtime yapısına uygun bir heightfield terrain sistemi kurmaktır.

## Unreal'da Landscape ne içeriyor

Unreal Landscape bir plane mesh'ten fazlasıdır. Ana bileşenler:

| Unreal parçası | Ne yapar | Forge kararı |
| --- | --- | --- |
| Landscape Actor | Heightmap tabanlı terrain actor. | Al. Forge'da level-owned landscape actor olarak başlat. |
| Components / Sections | Büyük terrain'i render ve LOD için parçalara böler. | Al, ama sade chunk modeliyle. |
| Sculpt tools | Height verisini brush ile değiştirir. | Faz 1'e al: Raise/Lower, Smooth, Flatten. |
| Paint tools | Material layer weightmap boyar. | Faz 1'e al: 3-4 layer weight paint. |
| Landscape Materials | Layer blend, layer weight ve visibility mask okur. | Al, form tabanlı sade landscape material/preset ile. |
| Edit Layers | Non-destructive height/paint layer stack. | Ertele. İlk sürüm destructive save. |
| Splines | Yol/nehir gibi spline'lar terrain'i deforme eder ve çizgi boyunca mesh döşer. | Faz 6'ya al: Landscape Splines / Road Tool. |
| Visibility holes | Landscape'te delik açar. | Ertele. Cave/tunnel ihtiyacı gelince. |
| Foliage/Grass | Landscape layer'a bağlı mesh üretimi veya Foliage Mode. | Ayrı Foliage çalışmasına bırak. |
| Water | Landscape/spline ile çalışan water sistemi. | Ertele. Ayrı outdoor sistem. |
| World Partition | Büyük dünya streaming. | Kapsam dışı. |

## Forge mevcut durum

- Forge'da henüz Landscape Actor veya heightfield terrain veri modeli yok.
- `engine/scene/layout.ts` world/actor/placement yapısını taşıyor; landscape için
  yeni bir singleton veya array alanı eklenmesi gerekir.
- Static Mesh Editor tarafında sidecar deseni oturdu: `*.collision.json`,
  `*.materials.json`, `*.uvw.json`. Landscape verisi de aynı kayıt disiplinini izlemeli.
- Material Editor tarafında Material Layer Blend altyapısı var. Bu, landscape layer
  material karışımı için başlangıç noktası olabilir ama direkt N-layer landscape
  material değildir.
- Static collision tarafında render mesh'ten trimesh collider çıkarma altyapısı var.
  Landscape collision ilk sürümde statik heightfield/trimesh olarak düşünülmeli.
- Scene/Runtime tarafı `InstancedMesh`, model bounds, collision sidecar ve material
  asset loader desenlerine sahip; Landscape kendi render/collision yolunu gerektirir.

## Kapsam dışı sınırlar

Bu doküman Foliage Mode'u planlamaz. Kullanıcının kararı:

- Foliage Mode ayrı ana araç olarak ele alınacak
  ([FOLIAGE_MODE_RESEARCH_AND_PLAN.md](./FOLIAGE_MODE_RESEARCH_AND_PLAN.md)).
- Landscape dokümanı, layer paint verisinin ileride foliage tarafından okunabileceğini
  kabul eder ama foliage scatter/spawn kurallarını tasarlamaz.
- Landscape Paint'in Faz 1 amacı materyal layer weight boyamaktır; static mesh
  yerleşimi ayrı Foliage çalışmasının konusudur.

Bu bilinçli ayrım, Unreal'daki mode ayrımına da uygundur: Landscape ve Foliage ayrı
editor mode'lardır.

## Faz 1 hedefi

Faz 1 adı:

**Landscape Mode: Heightfield + Sculpt + Layer Paint**

Faz 1'de kullanıcı şunları yapabilmeli:

1. Level'a yeni Landscape eklemek.
2. Landscape boyutu ve çözünürlüğünü seçmek.
3. Raise/Lower, Smooth ve Flatten brush ile height sculpt yapmak.
4. Grass/Dirt/Rock/Snow gibi landscape material layer'larını boyamak.
5. Color/View mode ile height ve layer weight verisini görselleştirmek.
6. Save/Reload sonrası landscape height ve paint verisini korumak.
7. Play/runtime tarafında landscape'i görmek ve üzerinde yürüyebilmek.

## Veri modeli önerisi

İlk sürümde Landscape level-owned olmalı. Content Browser asset'i olarak başlatmak
gereksiz karmaşa yaratır. Daha sonra reusable landscape asset veya heightmap import
eklenebilir.

### Layout alanı

`engine/scene/layout.ts` içinde önerilen üst seviye alan:

```ts
interface RoomLayout {
  // mevcut alanlar...
  landscapes?: LayoutLandscape[];
}
```

Tek landscape ile başlamak mümkün olsa da array tutmak daha esnek olur.

```ts
interface LayoutLandscape {
  id: string;
  name?: string;
  hidden?: boolean;
  locked?: boolean;
  position: Vec3;
  rotation?: Vec3;
  scale?: number | Vec3;
  dataRef: string;       // public-root-relative .landscape.json veya .landscape.bin
  material?: string;     // landscape material asset id, opsiyonel
  collision?: boolean;   // absent = true
}
```

### Landscape data sidecar

Path önerisi:

```text
public/landscapes/<layout-or-landscape-id>.landscape.json
```

İlk sürüm JSON olabilir. Büyük terrain'e geçerken height/weight verisi binary veya
PNG tabanlı dosyalara ayrılabilir.

```ts
interface ForgeLandscapeData {
  schema: 1;
  type: "landscape";
  size: {
    verticesX: number;
    verticesZ: number;
    spacing: number;
    heightScale: number;
  };
  chunks: {
    quadsPerChunk: number;
  };
  heights: number[]; // verticesX * verticesZ, normalized or world units
  layers: Array<{
    id: string;          // "grass", "dirt", "rock", "snow"
    name: string;
    weights: number[];   // verticesX * verticesZ or lower-res weightmap
  }>;
}
```

### Boyut sınırları

Faz 1 için önerilen güvenli başlangıç:

| Preset | Vertex grid | Kullanım |
| --- | --- | --- |
| Small | 65 x 65 | Hızlı test, düşük maliyet |
| Medium | 129 x 129 | İlk gerçek hedef |
| Large | 257 x 257 | Faz 1 üst sınır adayı |

505+ vertex grid sonraki faza bırakılmalı. Chunk/LOD/streaming olmadan erken büyük
terrain performans ve save boyutu riskini artırır.

## Render mimarisi

Faz 1 için render yolu:

- Heightfield grid mesh üretilir.
- Terrain chunk'lara bölünür.
- Her chunk kendi `BufferGeometry` ve material instance'ına sahip olur.
- Sculpt sonrası sadece dirty chunk geometry update edilir.
- Normaller CPU'da yeniden hesaplanır.
- Shadow receive default açık, cast shadow kapalı veya opsiyonel olmalı.

Chunk modeli:

```ts
interface LandscapeChunk {
  chunkX: number;
  chunkZ: number;
  vertexRange: { x0: number; z0: number; x1: number; z1: number };
  mesh: Mesh;
  dirtyGeometry: boolean;
  dirtyWeights: boolean;
}
```

Faz 1'de LOD şart değil. LOD, 257+ üstünde veya outdoor sahneler büyüdüğünde ayrı
faz olarak ele alınmalı.

## Collision ve runtime

Landscape ilk sürümde statik olmalı:

- `collision: false` değilse runtime collider oluşturulur.
- Rapier tarafında ideal hedef heightfield collider olabilir; pratik ilk yol,
  chunk başına static trimesh collider olabilir.
- Mevcut complex/trimesh collision bilgisi yol gösterici ama landscape özel veri
  modeli gerekir.
- Dynamic physics landscape üzerinde yürüyebilir ama landscape kendisi simulate
  physics yapmaz.

Karakter hareketi:

- Runtime blocker/collision sistemi terrain üçgenlerini veya height sampler'ı
  kullanmalı.
- İlk faz kabulü için karakterin landscape üstünde düşmeden yürümesi yeterli.
- Slope limit / walkable angle sonraki CharacterMovement iyileştirmesi olabilir.

## Sculpt araçları

Faz 1 araçları:

| Tool | Davranış |
| --- | --- |
| Select | Landscape seçimi ve panel ayarı. |
| Sculpt Raise/Lower | Brush altında height artırır veya azaltır. |
| Smooth | Komşu height değerlerine doğru yumuşatır. |
| Flatten | İlk hit veya seçili target height'a doğru düzler. |
| Reset Region | Seçili brush alanını 0 height'a yaklaştırır. Opsiyonel. |

Brush ayarları:

- Size
- Strength
- Falloff
- Tool mode
- Target height (Flatten için)
- Ignore hidden/locked landscape

Brush algoritması:

```ts
distance = length(vertexWorldXZ - brushCenterXZ)
falloff = saturate(1 - distance / radius)
weight = pow(falloff, falloffExponent)
height += direction * strength * weight
```

Undo/Redo:

- İlk sürümde stroke başına affected height patch tutulmalı.
- Tüm landscape array'i undo state'e kopyalamak orta boyutta pahalı olabilir.

## Paint araçları

Landscape Paint, materyal layer weight boyar. Foliage spawn veya mesh yerleşimi bu
dokümanın kapsamı değildir.

Faz 1 layer modeli:

- En fazla 4 layer:
  - Grass
  - Dirt
  - Rock
  - Snow
- Weight-blended davranış:
  - Bir layer boyanınca aynı texelde diğer layer ağırlıkları normalize edilir.
  - Toplam ağırlık 1'e yakın tutulur.
- Erase:
  - Aktif layer ağırlığını düşürür, default/base layer'a ağırlık aktarır.

Paint araçları:

| Tool | Davranış |
| --- | --- |
| Paint | Aktif layer weight artırır. |
| Erase | Aktif layer weight azaltır. |
| Fill Layer | Tüm landscape'i seçili layer'a doldurur. |
| Smooth Weights | Komşu weight değerlerine göre yumuşatır. |

View modes:

- Lit
- Height
- Normal/Slope
- Layer Weight: Grass/Dirt/Rock/Snow

## Landscape Splines / Road Tool

Landscape Splines, Foliage Mode değildir. Bu sistem çizgisel terrain özellikleri
içindir: yol, patika, nehir yatağı, kanal, duvar, fence, kaldırım, boru hattı gibi
bir spline boyunca devam eden öğeler.

Unreal'da Landscape Splines üç işi birleştirir:

- Control point ve segmentlerden editable spline oluşturma.
- Spline koridoru boyunca terrain'i raise/lower/flatten ile deforme etme.
- Static mesh segmentlerini spline boyunca döşeme.

Forge'da bu kapsam ilk Landscape milestone'a girmemeli. Önce heightfield render,
sculpt, paint ve collision sağlam olmalı. Ancak Landscape sisteminin veri modeli
Spline'a yer bırakacak şekilde tasarlanmalı.

### Spline kullanım hedefleri

Faz 6 için hedef akış:

1. Kullanıcı Landscape Mode > Splines sekmesine geçer.
2. Ctrl/LMB veya toolbar aksiyonu ile control point ekler.
3. Point'ler segmentlerle bağlanır.
4. Segment width/falloff ayarlanır.
5. "Apply Deform" açıkken spline koridoru terrain'i yol yatağına dönüştürür.
6. "Paint Layer" açıkken koridor `Road`, `Dirt` veya `Path` layer'ına boyanır.
7. "Spline Mesh" açıkken seçili static mesh spline boyunca döşenir.

### Spline veri modeli önerisi

Landscape data içine `splines` alanı eklenebilir. Bu veriyi ayrı sidecar'a ayırmak
gerekirse sonraki fazda yapılır; ilk tasarımda landscape ile aynı data dosyasında
tutmak terrain deform/paint ile tutarlılığı kolaylaştırır.

```ts
interface ForgeLandscapeSpline {
  id: string;
  name?: string;
  hidden?: boolean;
  locked?: boolean;
  points: Array<{
    id: string;
    position: Vec3;
    arriveTangent?: Vec3;
    leaveTangent?: Vec3;
    width: number;
    falloff: number;
  }>;
  segments: Array<{
    id: string;
    startPointId: string;
    endPointId: string;
    deform?: {
      enabled: boolean;
      raiseTerrain: boolean;
      lowerTerrain: boolean;
      flatten: boolean;
      targetOffset?: number;
    };
    paint?: {
      enabled: boolean;
      layerId: string; // "road", "dirt", "path"
      strength: number;
    };
    mesh?: {
      enabled: boolean;
      assetId: string;
      spacing?: number;
      scale?: Vec3;
      offset?: Vec3;
      alignToTerrain?: boolean;
      collision?: boolean;
    };
  }>;
}
```

`ForgeLandscapeData` ileride şöyle genişler:

```ts
interface ForgeLandscapeData {
  // mevcut height/layer alanları...
  splines?: ForgeLandscapeSpline[];
}
```

### Terrain deform davranışı

Spline deform destructive veya non-destructive olabilir. Faz 6 için öneri:

- İlk sürümde spline apply işlemi heightmap'e destructive patch yazar.
- Spline point hareket ettikçe otomatik canlı non-destructive stack yapılmaz.
- Kullanıcı "Apply To Heightfield" ile terrain'i günceller.
- Sonraki fazda Edit Layers gelirse spline deform non-destructive layer olabilir.

Deform parametreleri:

- Width: yol yatağı genişliği.
- Falloff: kenar yumuşatma.
- Raise Terrain: spline seviyesi terrain üstündeyse terrain'i yukarı çeker.
- Lower Terrain: spline seviyesi terrain altındaysa terrain'i aşağı indirir.
- Flatten: spline merkez hattı boyunca terrain'i hedef profile yaklaştırır.
- Target Offset: yolu terrain üstünde/altında küçük offset ile tutar.

### Layer paint along spline

Spline sadece mesh döşememeli; terrain material layer'ını da yönetebilmeli.

Örnek:

- Asphalt road: `Road` layer'a boyar.
- Dirt path: `Dirt` layer'a boyar.
- River bed: `Mud/RiverBed` layer'a boyar.

Bu işlem Landscape Paint sisteminin weightmap verisini kullanır. Foliage sistemine
mesh spawn kuralı yazmaz; sadece terrain material görünümünü ve ağırlıklarını
değiştirir.

### Spline mesh davranışı

Spline mesh, Foliage'dan farklıdır:

- Foliage alan üzerine dağıtılır.
- Spline mesh çizgi boyunca kontrollü şekilde dizilir.

Faz 6 ilk sürümü deform edilmiş mesh bending yapmak zorunda değildir. Daha basit
başlangıç:

- Static mesh segmentleri spline boyunca belirli aralıklarla instanced olarak dizilir.
- Her instance spline tangent yönüne döner.
- İsteğe bağlı terrain normaline hizalanır.
- Offset/scale ayarları uygulanır.

Sonraki fazda gerçek spline mesh deformation eklenebilir; bu daha büyük shader /
geometry generation işidir.

### Road Tool sınırları

Faz 6'ya alınacaklar:

- Control point ekle/sil/taşı.
- Segment seçimi.
- Width/falloff ayarı.
- Apply terrain flatten/raise/lower.
- Apply layer paint.
- Static mesh segment/instance döşeme.
- Save/reload.

Faz 6'ya alınmayacaklar:

- Non-destructive Edit Layers stack.
- Gerçek curved mesh deformation.
- Water river simulation.
- Traffic/pathfinding.
- Intersection auto-generation.
- Procedural road markings.

## Material entegrasyonu

Landscape material, normal Material Editor'daki tek surface material'dan farklıdır.
Yine de full node graph kurulmaz; form tabanlı kalır.

Faz 1 için öneri:

```ts
interface ForgeLandscapeMaterialDef {
  schema: 1;
  type: "landscapeMaterial";
  name: string;
  layers: Array<{
    id: string;
    label: string;
    baseColorTexture?: string | null;
    normalTexture?: string | null;
    roughnessTexture?: string | null;
    metalnessTexture?: string | null;
    uvTiling?: { x: number; y: number };
  }>;
}
```

Shader davranışı:

- Chunk material weight texture veya vertex attribute üzerinden layer ağırlıklarını
  okur.
- İlk sürümde 4 layer'a kadar desteklenir.
- BaseColor/Normal/Roughness en önemli kanallardır.
- Height-blend, displacement, triplanar ve macro variation sonraki fazdır.

Mevcut Material Layer Blend sistemi 2-layer object material için kullanılmaya devam
eder. Landscape material ayrı bir surface tipi olarak düşünülmelidir.

## Editor UX önerisi

Landscape Mode paneli Unreal'a benzer ama daha sade olmalı:

Sekmeler:

- Manage
- Sculpt
- Paint
- Splines

Manage:

- Create Landscape
- Delete Landscape
- Resolution preset
- Spacing
- Height scale
- Recenter / Fit to origin

Sculpt:

- Tool seçimi
- Brush size / strength / falloff
- Flatten target height
- View mode

Paint:

- Layer listesi
- Aktif layer
- Brush size / strength / falloff
- Fill / Clear / Smooth
- Layer view mode

Splines:

- Add Point
- Delete Point / Segment
- Width / Falloff
- Raise Terrain / Lower Terrain / Flatten toggles
- Paint Layer seçimi
- Spline Mesh asset seçimi
- Apply To Heightfield
- Rebuild Spline Meshes

Outliner:

- Landscape tek actor olarak görünür.
- Chunk'lar Outliner'da ayrı object olarak görünmez.
- Landscape spline control point ve segmentleri Outliner'da ayrı object olarak
  görünmez; Landscape Mode içi selection overlay'i olarak kalır.

## Save ve dev endpoint planı

Yeni dev endpoint önerileri:

- `/__save-landscape`
- `/__content-new` içinde `landscape` veya `landscapeMaterial` asset tipi, sonraki faz.

İlk sürüm:

- Layout `landscapes[]` referansı taşır.
- Landscape data `public/landscapes/*.landscape.json` altında saklanır.
- Validator:
  - layout landscape referanslarını allowlist'e ekler
  - landscape data shape ve boyut limitlerini doğrular
  - height/layer array uzunluklarını kontrol eder

## Fazlar

### Faz 0 - Dokümantasyon ve karar

- [x] Unreal Landscape ana parçalarını araştır.
- [x] Forge'da Landscape'i ayrı ana editor mode olarak konumlandır.
- [x] Foliage Mode'u bu çalışmadan ayır.
- [ ] Kullanıcıyla Faz 1 sınırlarını onayla.

### Faz 1 - Landscape Actor + Render + Save

- [ ] `LayoutLandscape` veri modeli.
- [ ] Landscape data sidecar modeli.
- [ ] `/__save-landscape` endpoint.
- [ ] Scene Editor'da Manage > Create Landscape.
- [ ] Chunked heightfield render.
- [ ] Save/Reload doğrulaması.
- [ ] Engine tests: normalize/validate landscape data.

### Faz 2 - Sculpt

- [ ] Landscape Mode toolbar/panel.
- [ ] Brush cursor.
- [ ] Raise/Lower.
- [ ] Smooth.
- [ ] Flatten.
- [ ] Dirty chunk update.
- [ ] Stroke-level undo/redo.
- [ ] Save/Reload sonrası sculpt korunur.

### Faz 3 - Paint Layers + Landscape Material

- [ ] 4 layer weightmap modeli.
- [ ] Paint/Erase/Fill/Smooth Weights.
- [ ] Layer view modes.
- [ ] `ForgeLandscapeMaterialDef`.
- [ ] Runtime shader/material layer blend.
- [ ] Save/Reload sonrası paint korunur.

### Faz 4 - Runtime Collision

- [ ] Static landscape collider.
- [ ] Character/player movement landscape üstünde çalışır.
- [ ] Collision debug view.
- [ ] Chunk rebuild sonrası collider refresh.

### Faz 5 - Import/Export

- [ ] Heightmap PNG import.
- [ ] Heightmap export.
- [ ] Weightmap import/export.
- [ ] Resolution resample.

### Faz 6 - Landscape Splines / Road Tool

- [ ] `ForgeLandscapeSpline` veri modeli.
- [ ] Landscape data `splines[]` save/load.
- [ ] Landscape Mode > Splines sekmesi.
- [ ] Control point ekle/sil/taşı.
- [ ] Segment seçimi ve split/join temel akışı.
- [ ] Width/falloff ayarları.
- [ ] Terrain flatten/raise/lower apply.
- [ ] Spline boyunca layer paint apply.
- [ ] Static mesh segment/instance döşeme.
- [ ] Save/Reload sonrası spline, deform ve mesh sonuçları korunur.
- [ ] Engine tests: spline data normalize/validate.

### Sonraki Fazlar

- Edit Layers.
- Advanced Landscape Splines: gerçek spline mesh deformation, intersection tools.
- Visibility holes.
- LOD / chunk streaming.
- Water integration.
- Foliage Mode integration hooks.
- Triplanar / macro variation / height blend materials.

## Kabul kriterleri - Faz 1-3 birleşik milestone

- User Landscape Mode'a geçer.
- Medium preset ile bir landscape oluşturur.
- Sculpt Raise/Lower ile terrain formunu değiştirir.
- Smooth/Flatten kullanır.
- Grass/Dirt/Rock/Snow layer paint yapar.
- Layer view mode'da weight dağılımını görür.
- Lit mode'da landscape material layer blend görünür.
- Save eder, editor reload sonrası height ve paint korunur.
- Play/runtime'da landscape görünür.
- `npm run build:verify` geçer.

## Açık kararlar

Dokümana göre önerilen varsayılanlar:

- Landscape level-owned başlasın.
- İlk hedef Medium 129x129 vertex olsun.
- 4 layer paint sınırı olsun.
- Foliage bu dokümandan ayrı kalsın.
- Material graph yerine form tabanlı Landscape Material olsun.
- Collision statik olsun.

Kullanıcı onayı gerekenler:

1. İlk Landscape tek mi olsun, yoksa `landscapes[]` ile çoklu destek en baştan mı gelsin?
2. Faz 1 preset sınırı 129x129 mı, 257x257 mi?
3. İlk paint layer adları Grass/Dirt/Rock/Snow olarak sabit başlasın mı?
4. Landscape material ayrı asset tipi mi olsun, yoksa mevcut material asset içinde
   `materialType: "landscape"` olarak mı genişlesin?
5. Runtime collision Sculpt ile anlık mı güncellensin, yoksa Save/Play sırasında mı
   rebuild edilsin?
6. Landscape Splines Faz 6'da destructive apply mı olsun, yoksa ilk günden
   non-destructive spline layer mı tasarlansın?
7. Road layer ilk paint layer setine dahil edilsin mi (`Grass/Dirt/Rock/Snow/Road`),
   yoksa spline fazında ayrı mı eklensin?
8. Spline mesh ilk sürümde instanced segment dizilimi mi olsun, yoksa gerçek mesh
   deformation beklenmeli mi?

## Son karar önerisi

Forge için Landscape sistemi yapılmalı ve ana editor mode olarak konumlandırılmalı.
İlk sürümün hedefi küçük/orta ölçekli outdoor terrain üretimi olmalı:

1. Level-owned heightfield Landscape Actor.
2. Sculpt araçları.
3. Landscape paint layers.
4. Form tabanlı landscape material.
5. Static collision.
6. Sonraki fazda Landscape Splines / Road Tool.

Foliage, water, edit layers ve world streaming ayrı çalışmalar olarak planlanmalı.
Landscape Splines ise Landscape Mode içinde sonraki Road Tool fazı olarak kalmalı.
Bu ayrım sistemi uygulanabilir tutar ve Mesh Paint / Foliage gibi diğer ana
araçlarla sınırları temiz bırakır.
