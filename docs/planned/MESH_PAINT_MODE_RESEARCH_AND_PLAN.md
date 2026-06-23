# Mesh Paint Mode Research and Forge Plan

> Tarih: 2026-06-23
> Durum: Gelecek faz planı. Kod uygulanmadı.
> Amaç: Unreal Engine Mesh Paint Mode'un kapsamını araştırmak, Forge'da **level
> viewport üzerinden mesh paint authoring** sistemini planlamak ve materyallerin
> bu boyanmış veriyi nasıl destekleyeceğini netleştirmek. Boyama aracı Material
> Editor'da değil, Scene/Level Editor içinde olacaktır.

## Kaynaklar

Bu doküman resmi Unreal Engine 5.8 dokümanlarına göre hazırlandı:

- Mesh Paint Mode overview:
  https://dev.epicgames.com/documentation/unreal-engine/mesh-paint-mode-in-unreal-engine
- Activating and Using Mesh Paint Mode:
  https://dev.epicgames.com/documentation/unreal-engine/activating-and-using-mesh-paint-mode-in-unreal-engine
- Mesh Paint Tool Reference:
  https://dev.epicgames.com/documentation/unreal-engine/mesh-paint-tool-reference-in-unreal-engine
- Setting Up a Vertex Color Material:
  https://dev.epicgames.com/documentation/unreal-engine/setting-up-a-vertex-color-material-for-mesh-painting-in-unreal-engine
- Setting Up a Texture Blended Material for Vertex Weights:
  https://dev.epicgames.com/documentation/unreal-engine/setting-up-a-texture-blended-material-for-vertex-weights-painting-in-unreal-engine
- Texture Color Painting:
  https://dev.epicgames.com/documentation/unreal-engine/getting-started-with-mesh-texture-color-painting-in-unreal-engine
- Sharing Vertex Color and Texture Color Data:
  https://dev.epicgames.com/documentation/unreal-engine/how-to-share-vertex-color-data-between-instances-in-unreal-engine
- Vertex Color Matching / Fix:
  https://dev.epicgames.com/documentation/unreal-engine/vertex-color-matching-in-unreal-engine
- Paint Vertex Colors modeling tool:
  https://dev.epicgames.com/documentation/unreal-engine/paint-vertex-colors-tool-in-unreal-engine

## Unreal'da sistemin özeti

Unreal Mesh Paint Mode, level viewport içinde çalışan bir boyama modu. Panelde dört
ana paint method var:

| Unreal method | Ne yapar | Forge yorumu |
| --- | --- | --- |
| Vertex Color | Mesh vertex RGBA verisini boyar. Mesh Paint Mode'da instance'a özgü olabilir. | İlk Forge hedefi olmalı. Layer Blend driver'ı için doğrudan gerekli. |
| Vertex Weights | Vertex color kanallarını layer ağırlığı olarak kullanır. Materyalde Lerp/VertexColor gerekir. | Material Layer Blend sistemimizin doğal devamı. İlk sürümde 2-layer yeterli. |
| Texture Color | Instance'a özel Mesh Paint Texture üretir ve onu materyalde örnekler. Unreal'da virtual texture kullanır. | Forge için ikinci faz. Vertex yoğunluğünden bağımsız maske çözünürlüğü sağlar ama UV ve texture persistence ister. |
| Textures | Doğrudan atanmış texture asset üstüne paint eder. | Şimdilik kapsam dışı. Asset texture authoring, undo ve import/export maliyeti yüksek. |

Unreal'da Vertex Color / Texture Color / Textures araçları Paint Color, Erase
Color ve kanal seçimi paylaşır. Vertex Weights tarafında ise Texture Weight Type
seçilir: Alpha iki texture, RGB üç texture, ARGB dört texture, ARGB - 1 beş
texture blend eder. Materyal bu ağırlık düzenine uygun kurulmak zorundadır.

## Forge mevcut durum

- `docs/completed/MATERIAL_EDITOR_ENHANCEMENTS_CHECKLIST.md` içinde `vertexColor`
  driver'ı bilinçli olarak "sonraki kademe" bırakıldı.
- `engine/assets/material.ts` şu an sadece `constant`, `slope`, `worldHeight`,
  `maskTexture` layer blend driver'larını kabul ediyor.
- `engine/render-three/materials.ts` Layer Blend'i `MeshStandardMaterial` +
  `onBeforeCompile` ile patch'liyor. Bu, vertex color driver eklemek için doğru
  nokta.
- Static mesh'ler sahnede çoğunlukla `InstancedMesh` ile render ediliyor; override
  material veya reflection probe gerektiğinde instance clone yolu kullanılıyor.
- Mevcut `public/assets` taramasında 151 `glb/gltf` içinde `COLOR_0` attribute'u
  taşıyan asset bulunmadı. Bu yüzden Mesh Paint sistemi gelmeden `vertexColor`
  driver pratikte kullanılabilir içerik bulamayacak.
- Static Mesh Editor'da UVW Map ve material slot sidecar'ları var; vertex color
  sidecar ve paint authoring henüz yok.

## Forge'a alınacak kapsam

### Temel sınır kararı

Mesh paint authoring **Material Editor işi değildir**. Material Editor sadece
paint verisini okuyacak materyal davranışını tanımlar:

- `Vertex Color` veya `Vertex Weight` paint verisi Scene/Level Editor'da boyanır.
- Material Editor'da yalnızca "bu materyal boyanmış R/G/B/A kanalını Layer Blend
  driver olarak kullansın" gibi destek ayarları bulunur.
- Brush, Fill, Save, Color View Mode, Copy/Paste, Remove gibi araçlar Scene Editor
  Mesh Paint Mode panelindedir.
- Static Mesh Editor sadece asset-level inspect/default işlemlerine yardımcı olur;
  ana hedef level'daki yerleştirilmiş mesh instance'ları boyamaktır.

### Alınacak - Faz 1

Faz 1 hedefi: Unreal Mesh Paint'in basit, web-first Vertex Color / Vertex Weights
karşılığı.

- Scene/Level Editor içine bir **Mesh Paint Mode** ekle.
- Panel sekmeleri ilk sürümde iki tane olsun:
  - **Vertex Color**
  - **Vertex Weights**
- Select / Paint / Fill / Save / Remove araçlarını destekle.
- Paint Color, Erase Color, kanal maskesi (R/G/B/A), brush size, strength, falloff,
  brush flow, ignore back-facing ayarlarını ekle.
- Color View Mode ekle:
  - Off
  - RGB
  - Alpha
  - Red
  - Green
  - Blue
- Materyal desteği olarak Layer Blend driver listesine `vertexColor` ekle. Bu,
  Material Editor içinde paint yapmak anlamına gelmez; sadece level'da boyanan
  verinin shader tarafından okunmasını sağlar.
- İlk material desteği:
  - `layerBlend.driver = "vertexColor"`
  - `vertexColorChannel = "r" | "g" | "b" | "a"`
  - 2-layer blend için `vColor[channel]` blend factor olsun.
- Painted data önce **placement/instance sidecar** olarak saklansın; source mesh
  dosyası değiştirilmesin.

### Alınacak - Faz 2

Faz 2 hedefi: Unreal'daki "To Mesh", "Copy/Paste", "Import" ve LOD/asset tarafına
yaklaşmak.

- Copy / Paste: seçili placement'ın paint verisini başka placement'lara taşı.
- To Mesh: instance paint'i asset-level default vertex color sidecar'a aktar.
- To Instances: asset-level default'u seçili instance'lara uygula.
- Import / Export: PNG veya JSON tabanlı kanal maskesi aktarımı.
- Fix: source mesh vertex count / topology değiştiğinde barycentric veya nearest
  point transfer ile eski paint verisini yeni mesh'e yaklaştır.
- Static Mesh Editor'a vertex color inspect paneli ekle.

### Alınacak - Faz 3

Faz 3 hedefi: Texture Color'a Forge karşılığı.

- Mesh Paint Texture sidecar'ı:
  - asset veya placement bazlı PNG/WebP maske texture
  - çözünürlük ayarı
  - UV channel seçimi
  - seam dilation
- Material Editor'da `paintTexture` driver veya `paintTexture` source desteği.
- Texture Color <-> Vertex Color dönüştürme.

### Şimdilik alınmayacak

- Unreal'ın tam `Textures` mode'u: doğrudan texture asset üstüne boyama.
- Virtual Texture sistemi.
- Beş katmanlı ARGB - 1 material blending.
- Skeletal mesh paint.
- Nanite özel davranışları. Forge'da Nanite karşılığı yok.
- Full material graph. Forge'un mevcut form tabanlı Material Editor sınırı korunur.

## Veri modeli önerisi

Paint verisini GLB içine yazmak yerine sidecar ile tutmak Forge için daha güvenli.
Bu, mevcut `*.collision.json`, `*.materials.json`, `*.uvw.json` desenine uyar.

### Asset-level vertex color sidecar

Path önerisi:

```text
public/assets/.../MeshName.vertexcolors.json
```

Öneri:

```ts
interface AssetVertexColorsDef {
  schema: 1;
  type: "vertexColors";
  target: "asset";
  meshes: Array<{
    meshName: string;
    primitiveIndex: number;
    vertexCount: number;
    colors: number[]; // RGBA, 0..1 float veya 0..255 packed alternatifi
  }>;
}
```

### Placement-level paint sidecar

Path önerisi:

```text
public/layouts/<layout-id>.meshpaint.json
```

Öneri:

```ts
interface LayoutMeshPaintDef {
  schema: 1;
  type: "meshPaint";
  placements: Array<{
    target: {
      assetId: string;
      placementIndex: number;
      meshName: string;
      primitiveIndex: number;
    };
    vertexCount: number;
    colors: number[]; // RGBA per vertex
  }>;
}
```

Not: Placement index kaygan bir anahtar olabilir. Daha sağlam sürümde placement
id eklemek gerekir. Bugünkü layout modelinde placement'lar index ile referanslandığı
için ilk prototip index ile başlayabilir, ama uzun vadede kalıcı `placement.id`
eklemek daha doğru olur.

## Material modeli önerisi

`ForgeMaterialLayerBlendDriver` listesine `vertexColor` eklensin.

```ts
type ForgeMaterialLayerBlendDriver =
  | "constant"
  | "slope"
  | "worldHeight"
  | "maskTexture"
  | "vertexColor";

interface ForgeMaterialLayerBlend {
  // mevcut alanlar...
  driver: ForgeMaterialLayerBlendDriver;
  vertexColorChannel?: "r" | "g" | "b" | "a";
  invertVertexColor?: boolean;
}
```

Başlangıç davranışı:

- `vertexColorChannel` default `r`.
- `invertVertexColor` default `false`.
- `contrast`, `min`, `max` mevcut driver'larla aynı şekilde uygulanabilir.
- Eğer mesh'te color attribute yoksa shader 0 yerine güvenli varsayılan
  kullanmalı. Öneri: Layer 0 kalsın, kullanıcıya editor warning gösterilsin.

Shader notu:

- Three.js vertex color kullanımı için material tarafında `vertexColors = true`
  açılmalı.
- Layer Blend shader patch'i `vColor` kapsamına dikkat etmeli. Daha önce mask
  driver'da `vUv` erken scope'ta kullanıldığı için compile hatası oluşmuştu; aynı
  risk `vColor` için de geçerli. Blend fonksiyonu erken tanımlanabilir ama
  vertex color sample, `vColor` scope'ta olduktan sonra parametre olarak verilmelidir.
- Reflection capture clone yolu `defines`, `onBeforeCompile` ve
  `customProgramCacheKey` zincirini korumaya devam etmeli.

## Paint algoritması önerisi

Faz 1 CPU tarafında çalışabilir; GPU paint gerekmez.

1. Mesh Paint Mode açıkken pointer raycast ile mesh triangle bulunur.
2. Hit noktasının local/world pozisyonu alınır.
3. Aynı mesh primitive içindeki vertex'ler brush radius'a göre taranır.
4. Falloff:

```ts
weight = saturate(1 - distance / radius)
weight = pow(weight, falloffCurve)
paintAmount = strength * weight * deltaOrStroke
```

5. Kanal maskesine göre RGBA karıştırılır.
6. `Shift + LMB` veya Erase tool, Erase Color'a doğru boyar. Unreal'daki gibi bu
   gerçek silme değil, ikinci renkle boyamadır.
7. Mesh geometry `color` attribute'u güncellenir ve `needsUpdate = true` yapılır.
8. Save, sidecar'a yazar.

Brush UX:

- Brush circle viewport üstünde surface normaline hizalı çizilsin.
- Back-face ignore açıkken kamera yönüne ters normalde paint uygulanmasın.
- Flow kapalıysa stroke hareket ettikçe uygulanır; flow açıksa pointer dururken de
  frame başına uygulanır.
- Fill, seçili mesh/placement için aktif kanalları tek renge doldurur.

## Editor entegrasyonu

### Scene Editor

Mesh Paint Mode, Scene/Level Editor'da ayrı bir mode olarak açılmalı. Ana authoring
yüzeyi burasıdır. Bu mod açıkken:

- Normal translate/rotate/scale gizmo pasif olabilir.
- Kamera ve selection çalışmaya devam eder.
- Sol panel Unreal benzeri yoğun bir tool paneli olabilir.
- Paint data resource usage gösterilir:
  - instance vertex color size
  - ileride mesh paint texture resource size

### Static Mesh Editor

Static Mesh Editor ana paint yüzeyi değildir. Şu yardımcı işleri üstlenebilir:

- Asset-level vertex color görüntüleme.
- Asset-level vertex color remove/fill.
- `To Mesh` ile gelen default color verisini gösterme.
- İleride UV channel suitability / unique UV uyarısı.

### Material Editor

Material Editor paint aracı içermez. Sadece Mesh Paint ile uyumlu materyali açıkça
göstermeli:

- Layer Blend driver dropdown'a `Vertex Color` eklenir.
- Channel dropdown: R/G/B/A.
- Eksik vertex color attribute warning'i:
  - "Bu materyal vertex color bekliyor; seçili mesh'te COLOR_0 yok."
- Preview için normal sphere yeterli değil. Vertex Color driver seçiliyken
  preview mesh'i procedural vertex color gradient taşımalı veya preview mode
  `constant` fallback göstermeli.
- Brush, Fill, Remove, Save, Copy/Paste ve Color View Mode burada bulunmaz.

## Kabul kriterleri

Faz 1 kabulü:

- Bir static mesh placement seçilir.
- Mesh Paint Mode > Vertex Color ile R kanalına brush stroke atılır.
- Color View Mode > Red Channel stroke'u gösterir.
- Aynı placement'a Layer Blend driver `vertexColor/r` olan materyal atanır.
- Stroke olan bölgede Layer 1 görünür, stroke olmayan bölgede Layer 0 kalır.
- Save / reload sonrası paint verisi korunur.
- Aynı asset'in başka placement'ı, kopyalanmadığı sürece paint'i paylaşmaz.
- `npm run build:verify` geçer.

## Riskler

- Vertex paint çözünürlüğü mesh yoğunluğüne bağlıdır. Düşük poly mesh'te sonuç
  kaba görünür. Bu, Texture Color fazını ileride gerekli kılabilir.
- Placement index'e bağlı sidecar, layout reorder edilirse kayabilir. Kalıcı
  placement id tasarımı ertelenmemeli.
- InstancedMesh performansı: her unique paint verisi ayrı clone veya ayrı geometry
  gerektirebilir. Çok sayıda unique-painted placement draw call sayısını artırır.
- Geometry clone ve disposal dikkatli yapılmalı; paint mode aç/kapat ve rebuild
  akışında GPU buffer sızıntısı olmamalı.
- Imported GLB vertex order değişirse paint verisi birebir eşleşmez. Fix tool
  olmadan yeniden import risklidir.
- Color attribute yoksa shader ve UI sessiz başarısız olmamalı.

## Önerilen uygulama sırası

1. `vertexColor` material driver planını uygulama:
   - schema
   - validator
   - Material Editor UI
   - shader patch
   - engine tests
2. Scene Editor Mesh Paint Mode kabuğu:
   - mode switch
   - select/paint toolbar
   - brush cursor
   - Color View Mode
3. CPU vertex paint prototype:
   - selected placement clone geometry
   - RGBA color attribute oluşturma/güncelleme
   - fill/remove
4. Sidecar persistence:
   - `*.meshpaint.json`
   - save validator allowlist
   - layout reload
5. Copy/Paste/To Mesh:
   - asset-level `*.vertexcolors.json`
   - selected placement copy buffer
6. Texture Color research implementation:
   - UV channel
   - mesh paint texture
   - material fallback

## Son karar

Forge için Mesh Paint sistemi yapılmalı, ama ilk hedef Unreal'ın tamamını kopyalamak
olmamalı. En değerli ve mevcut Material Layer Blend sistemiyle en uyumlu başlangıç:

1. Vertex Color paint authoring
2. Vertex Weights gibi kullanılan 2-layer material blend
3. Instance-level persistence
4. Color View Mode

Texture Color ve doğrudan texture painting daha sonra gelmeli. Bu sıra, bugün açık
kalan `vertexColor` material driver maddesini gerçek bir authoring sistemiyle
anlamlı hale getirir.
