# Material Editor Enhancements Checklist

> Tarih: 2026-06-22
> Amaç: Tamamlanmış `docs/completed/MATERIAL_EDITOR_CHECKLIST.md` (form tabanlı PBR
> Material Editor) üzerine, görsel kaliteyi artıran **üç bağımsız genişleme**
> getirmek:
>
> 1. **Texture kalite & UV kontrolü** — anisotropy, ortak texture-config helper,
>    UV tiling/repeat. (Ayrı bir Unreal-tarzı Texture Asset Editor **kurulmaz**.)
> 2. **Roughness / Metalness (+ AO) doku haritaları** — şu an sadece 0..1 skaler;
>    siyah-beyaz gri haritaları kullanmak istiyoruz.
> 3. **Material Layer Blend / "Lerp"** — iki dokunun (örn. taş + kar) farklı
>    BC / N / R / M dokularıyla harmanlanması; Details'te bir anahtar açılınca
>    `BC_1–BC_2`, `N_1–N_2`, `R_1–R_2` slotlarının belirmesi.
>
> Üçü de bağımsız sevk edilebilir; sıralama: **A → B → C** (A ve B düşük riskli,
> C gerçek yeni iş ve önceki "custom shader yok" sınırının bilinçli istisnası).

## Bölüm 0 — Mevcut durum (kanıt)

Texture'lar three.js `TextureLoader.loadAsync()` ile yükleniyor:
[`materialAssets.ts:44`](../../src/scene/materialAssets.ts#L44),
[`MaterialEditor.ts:381`](../../src/editor/MaterialEditor.ts#L381). Bu yolla üretilen
her `Texture`'ın varsayılanı `generateMipmaps = true` ve
`minFilter = LinearMipmapLinearFilter`.

- **Mipmap ZATEN aktif** (otomatik trilinear). WebGL2 hedeflediğimiz için
  non-power-of-two doku + `RepeatWrapping` bile sorunsuz.
- **`texture.anisotropy` hiçbir yerde set edilmiyor** → değer `1`. Sığ açıyla
  bakılan zemin/yol/duvarların uzakta bulanıklaşmasının ana sebebi. En büyük
  görsel kazanç burada (tek satır).
- Doku parametreleri **iki yerde elle kopyalı**:
  [`materials.ts:70-80`](../../engine/render-three/materials.ts#L70-L80) (runtime) ve
  [`MaterialEditor.ts:382-383`](../../src/editor/MaterialEditor.ts#L382-L383) (preview).
  Sadece `colorSpace` + `wrapS/wrapT` ayarlanıyor.
- [`ForgeMaterialDef`](../../engine/assets/material.ts#L20) **UV tiling/repeat alanı
  taşımıyor**; doku döşeme ölçeği ayarlanamıyor.
- `ForgeMaterialTextureMaps` yalnız `baseColorTexture` + `normalTexture` taşıyor;
  `createThreeMaterialFromForgeDef` sadece `map` + `normalMap` set ediyor — **yok:**
  `roughnessMap`, `metalnessMap`, `aoMap`.
- **`maskTexture` yarım bağlı:** schema'da var
  ([material.ts:28](../../engine/assets/material.ts#L28)), editörde picker'ı var
  ([MaterialEditor.ts:234](../../src/editor/MaterialEditor.ts#L234)), validator
  geçiriyor ([saveValidator.ts:1541](../../tools/saveValidator.ts#L1541)); ama
  `materialAssets.ts` runtime'da **okumuyor**. ORM için doğal aday.
- **colorSpace doğru:** sadece baseColor `SRGBColorSpace`; normal map linear
  (default) kalıyor. Roughness/Metalness/AO map'leri de **linear** kalmalı (sRGB
  set ETME).

### Karar: Ayrı Texture Asset Editor kurulmaz

Unreal'ın Texture Asset Editor'ı (compression format, mip-gen, LOD bias, sRGB
toggle, streaming) web/WebGL için aşırı ağır ve çoğunun karşılığı yok. İhtiyaç
duyulan az sayıda kontrol (anisotropy, tiling, filter, sRGB/wrap) **mevcut
Material Editor formuna** küçük alanlar olarak eklenir. Bu, tamamlanmış checklist'in
"node/shader graph yok, hafif web-first" kararıyla uyumludur.

---

## Bölüm A — Texture kalite & UV kontrolü (düşük risk)

### A.1 Hedef

- Tek noktadan uygulanan **ortak texture-config helper'ı** (anisotropy + wrap +
  colorSpace + tiling), runtime ve preview'in aynı kodu kullanması.
- **Anisotropy**: `renderer.capabilities.getMaxAnisotropy()` (clamp'li bir varsayılan,
  örn. min(8, max)).
- **UV tiling/repeat**: materyal başına `uvTiling: {x, y}` → tüm map'lere `repeat`.

### A.2 Mimari notlar

- Yeni helper: `engine/render-three/textureConfig.ts` →
  `configureForgeTexture(texture, { srgb, repeat, anisotropy, maxAnisotropy })`.
  `materials.ts` ve `MaterialEditor.ts` ikisi de bunu çağırır (kopya bitsin).
- Anisotropy değeri renderer-bağımlı olduğu için helper'a `maxAnisotropy`
  parametre olarak geçilir (engine katmanı `WebGLRenderer`'a doğrudan bağlanmaz).
- `uvTiling` `ForgeMaterialDef`'e opsiyonel alan; varsayılan `{x:1, y:1}`. `repeat`
  tüm aktif map'lere (map/normal/roughness/metalness/ao) uygulanır.

### A.3 Checklist

Durum: `[ ]` yapılmadı · `[~]` kısmi · `[x]` tamam

- [x] `engine/render-three/textureConfig.ts` + `configureForgeTexture()` helper'ı
- [x] `materials.ts` doku kurulumunu helper'a taşı (kopya kodu kaldır)
- [x] `MaterialEditor.ts` preview `loadTexture`'ı helper'a taşı
- [x] Anisotropy uygula (clamp'li `getMaxAnisotropy`); runtime + preview
- [x] `ForgeMaterialDef.uvTiling?: {x,y}` alanı + `defaultForgeMaterialDef`
- [x] `normalizeForgeMaterialDef` `uvTiling` oku/normalize et
- [x] `validateForgeMaterialDef`'e `uvTiling` ekle (0'dan büyük, makul üst sınır)
- [x] Material Editor formuna **UV Tiling X / Y** sayı kutuları + canlı preview
- [x] Thumbnail render'ı tiling/anisotropy ile tutarlı
- [x] `engine-tests.ts`: tiling normalize + validator round-trip

**Kabul:** Zemin/yol materyali uzakta gözle görülür netleşir (anisotropy);
tiling değiştirince preview ve sahne aynı döşemeyi gösterir.

---

## Bölüm B — Roughness / Metalness / AO doku haritaları

### B.1 Hedef

Şu an `roughness` ve `metalness` yalnız 0..1 skaler. Gri (siyah-beyaz) haritalarla
yüzeyin yer yer mat/parlak, paslı/temiz olması görsel kaliteyi belirgin artırır.
İki giriş biçimini destekle:

1. **Ayrı gri haritalar:** `roughnessTexture`, `metalnessTexture`,
   (opsiyonel) `aoTexture`.
2. **Paketli ORM/mask:** tek doku, three.js kanal okuması:
   - **R → AO** (`aoMap`)
   - **G → roughness** (`roughnessMap`)
   - **B → metalness** (`metalnessMap`)
   Aynı `Texture` nesnesi `aoMap` + `roughnessMap` + `metalnessMap`'e atanır;
   three uygun kanalı okur. Bu, mevcut yarım-bağlı `maskTexture`'ın hedeflediği şey.

### B.2 Mimari notlar / dikkat

- three.js'te skaler `roughness`/`metalness` **map'in çarpanıdır**. Haritayı tek
  sürücü yapmak için ilgili skaleri `1` bırak (yoksa karartır). Editörde harita
  atanınca slider'ı 1'e çekmeyi öner / bilgilendir.
- **Roughness/Metalness/AO map'leri LINEAR** olmalı — `SRGBColorSpace` **set etme**
  (Bölüm A helper'ında `srgb:false` ile).
- `aoMap` ikinci UV seti (`uv2`) ister; çoğu asset'te yoksa `uv`'a düşülür. AO'yu
  v1'de opsiyonel/ikincil tut.
- ORM yolu daha verimli (tek doku, tek sampler). Hem ayrı hem paketli destekle ama
  editörde **mod seçici** koy: `Ayrı haritalar` / `Paketli (ORM)`. Karışıklık olmasın.
- `ForgeMaterialTextureMaps` ve `createThreeMaterialFromForgeDef` yeni map'leri
  alacak şekilde genişler; `materialAssets.loadForgeMaterial` yeni id'leri yükler.

### B.3 Schema (öneri)

```ts
interface ForgeMaterialDef {
  // ...mevcut alanlar...
  roughnessTexture?: string | null;   // ayrı gri harita (linear)
  metalnessTexture?: string | null;   // ayrı gri harita (linear)
  aoTexture?: string | null;          // opsiyonel, ikincil UV
  ormTexture?: string | null;         // paketli R=AO G=rough B=metal (maskTexture'ı resmîleştirir)
  aoIntensity?: number;               // 0..1, varsayılan 1
}
```

`maskTexture` → `ormTexture` olarak adlandır (geriye dönük: loader `maskTexture`'ı
da kabul edip ORM gibi davransın, yeni kayıt `ormTexture` yazsın).

### B.4 Checklist

- [x] Schema: `roughnessTexture` / `metalnessTexture` / `aoTexture` / `ormTexture`
      / `aoIntensity` (+ `defaultForgeMaterialDef`, `normalizeForgeMaterialDef`)
- [x] `validateForgeMaterialDef`'e yeni texture ref + `aoIntensity` ekle
      **(CLAUDE.md save-validator allowlist gotcha — eklenmezse kayıtta düşer)**
- [x] `ForgeMaterialTextureMaps`'i genişlet; loader yeni id'leri yükler
- [x] `createThreeMaterialFromForgeDef`: `roughnessMap`/`metalnessMap`/`aoMap`
      bağla; ORM yolunda aynı texture'ı üç slota ata; linear colorSpace
- [x] Material Editor: **Ayrı / Paketli (ORM)** mod seçici + picker'lar +
      `aoIntensity`; harita atanınca skaler=1 ipucu
- [x] Preview + Thumbnail yeni map'leri gösterir
- [x] `engine-tests.ts`: ORM kanal eşleme + ayrı-harita yolu + validator round-trip

**Kabul:** Gri roughness haritası atanan yüzeyde yer yer mat/parlak geçişler
görünür; ORM dokusu tek atamayla rough+metal+AO'yu sürer.

---

## Bölüm C — Material Layer Blend / "Lerp" (taş + kar)

### C.1 Hedef

İki katmanın (Layer 0 ve Layer 1) her birinin kendi BC / N / R (+ M) dokusu olsun;
bir **blend faktörüyle** harmanlansınlar. Details'te bir anahtar (örn. **Layer Blend**)
açılınca ikinci katman slotları (`BC_2`, `N_2`, `R_2`, `M_2`) ve **blend sürücüsü**
belirsin.

Unreal'daki karşılığı: bir **Lerp (LinearInterpolate)** düğümü ya da Landscape
**Layer Blend**. Kullanıcının istediği "lerp" tam olarak budur.

### C.2 Kapsam kararı (önemli)

Bu özellik, tamamlanmış Material Editor checklist'inin **"custom GLSL/node graph
yok"** sınırını aşar. Bilinçli ve sınırlı bir istisna olarak yapılır:

- **Node graph DEĞİL.** Sabit, iki-katmanlı bir harman; yazar sadece dokuları ve
  sürücüyü seçer.
- **Sıfırdan shader DEĞİL.** `MeshStandardMaterial` + **`onBeforeCompile`** ile
  yamalanır → ışıklar, gölgeler, fog, tone mapping korunur. (Aynı desen projede
  zaten var: `cloudLayer.ts`, `reflectiveSurface.ts` vb. `onBeforeCompile`/shader
  kullanıyor.)
- `customProgramCacheKey` ile blend varyantı ayrı derlenir; blend yoksa standart
  yol hiç değişmez (sıfır regresyon riski).

### C.3 Blend sürücüleri (driver)

İkinci katmanın ağırlığı `f ∈ [0,1]` şöyle gelebilir:

| Driver | Anlam | Taş+Kar için |
| --- | --- | --- |
| `constant` | Details slider'ı (uniform) | Test/ön kademe (v1) |
| `slope` | Yüzey eğimi: `normal·up` eşiği | **Düz yüzeyde kar, dik yüzeyde taş** ✓ |
| `worldHeight` | Dünya-Y `min..max` arası | **Yüksekte kar, alçakta taş** ✓ |
| `vertexColor` | Mesh vertex color R kanalı | Elle boyalı geçiş (geometri color attr. ister) |
| `maskTexture` | Ayrı gri maske (R), kendi UV'si | Sanatçı maskesi |

v1: `constant` + `slope` + `worldHeight` (taş/kar'ın doğal sürücüleri) ve
`maskTexture` (siyah-beyaz sanatçı maskesi). `vertexColor` sonraki kademe.
Sürücülerde `contrast`/`bias` (geçiş sertliği) + `min/max` parametreleri.
`maskTexture` lineer/skaler maske bekler; normal map veya base-color dokusu bu slota
bağlanırsa Material Editor Unreal'daki sampler/semantic hatasına benzer bir uyarı verir.

### C.4 onBeforeCompile yama planı

- Ekstra uniform/sampler: `map2`, `normalMap2`, `roughnessMap2`, `metalnessMap2`,
  `uBlend*` (driver parametreleri), `uTiling2`.
- Vertex shader: `worldHeight`/`slope` için world pozisyon + world normal varying;
  `vertexColor` için color varying.
- Fragment shader, three chunk'larından **sonra** karıştır:
  - `diffuseColor.rgb = mix(layer0, layer1, f)` (map sample sonrası)
  - `roughnessFactor = mix(r0, r1, f)`, `metalnessFactor = mix(m0, m1, f)`
  - normal: iki tanjant-uzayı normalini `mix` + yeniden normalize (her iki normal
    map + tangent gerekir; tangent yoksa normal blend'i atla)
- `f` hesabı: driver'a göre `smoothstep(min, max, x)` + contrast.

### C.5 Veri modeli (öneri)

```ts
interface ForgeMaterialLayer {
  baseColor: string;
  baseColorTexture?: string | null;
  normalTexture?: string | null;
  roughnessTexture?: string | null;
  metalnessTexture?: string | null;
  roughness: number;
  metalness: number;
  uvTiling?: { x: number; y: number };
}

interface ForgeMaterialLayerBlend {
  layer1: ForgeMaterialLayer;            // ikinci katman (layer0 = ana def alanları)
  driver: "constant" | "slope" | "worldHeight" | "vertexColor" | "maskTexture";
  amount?: number;                       // constant
  min?: number; max?: number;            // slope/worldHeight aralığı
  contrast?: number;                     // geçiş sertliği
  maskTexture?: string | null;           // driver = maskTexture
}

interface ForgeMaterialDef {
  // ...
  layerBlend?: ForgeMaterialLayerBlend;  // yoksa standart tek-katman yol
}
```

Layer 0 = mevcut def alanları (mantıklı, geriye dönük). `layerBlend` varsa runtime
onBeforeCompile yolunu seçer.

### C.6 Editör UX

- Details'te **Layer Blend** toggle. Açıkken:
  - **Layer 1** bölümü: BC₂ / N₂ / R₂ / M₂ picker'ları + roughness/metalness
    skalerleri + UV tiling.
  - **Blend Driver** seçici + parametreleri (slider/min-max/contrast).
- Preview küresi/düzlemi blend'i göstermeli; `constant` için slider, `slope`/
  `worldHeight` için preview mesh'inde doğal görünür.

### C.7 Checklist

- [x] Schema: `ForgeMaterialLayer` + `ForgeMaterialLayerBlend` + `def.layerBlend`
      (default'lar + normalize)
- [x] `validateForgeMaterialDef`: `layerBlend` derin doğrulama (driver enum, texture
      ref'ler, sayı aralıkları) **(allowlist gotcha)**
- [x] Runtime: `layerBlend` varsa `onBeforeCompile` + `customProgramCacheKey` ile
      iki-katman harman shader'ı (`constant` + `slope` + `worldHeight` v1)
- [x] map/roughness/metalness blend; normal blend (tangent varsa)
- [x] Loader: layer1 dokularını yükler; her iki katmana tiling/anisotropy uygular
- [x] Material Editor: Layer Blend toggle + Layer 1 slotları + driver paneli + preview
- [x] `maskTexture` sürücüsü (siyah-beyaz blend maskesi)
- [ ] `vertexColor` sürücüsü (sonraki kademe)
- [x] Thumbnail blend'i temsil eder (constant=0.5 veya sürücü default)
- [x] `engine-tests.ts`: layerBlend normalize/validate round-trip; shader cache key
      ayrışması (blend var/yok ayrı program)
- [x] Details UI sadeleştirme: slider yerine Constant kutuları; Base Material,
      Layer Blend ve Layer Settings grupları.
- [x] Base Material `Opacity Map` + `Emissive Map` gerçek schema/runtime/preview/
      thumbnail desteği.
- [x] `Layer O Map` schema/runtime/preview/thumbnail desteği. Layer opacity
      dokusu Three.js `alphaMap` ile uyumlu olarak lineer `.g` kanalından okunur.
- [x] `Layer E Map` schema/runtime/preview/thumbnail desteği. Layer emissive
      dokusu sRGB okunur; color picker ve Constant intensity ile blend edilir.
- [x] `Layer AO Map` schema/runtime/preview/thumbnail desteği. Layer AO dokusu
      lineer okunur; Constant değeri AO intensity olarak uygulanır.
- [ ] **Deferred bug:** `maskTexture`/Blend Mask atanırken preview/runtime davranışı
      kullanıcı testinde halen beklenen sonucu vermiyor. Shader/schema tarafındaki
      önceki sertleştirmelere rağmen problem çözülmüş sayılmayacak; ayrı oturumda
      sahne üstü repro ile incelenecek.

### C.8 Concrete Tile slope driver inceleme notu

Kullanıcı testi: `ConcrateTile.material.json` materyali `slope` driver ile blend
edildiğinde Material Editor preview içinde görülebiliyor, ancak Scene Editor ve
Play görünümünde beklenen fark görünmüyor.

İlk inceleme bulguları:

- Materyal asset'i gerçekten `layerBlend.driver = "slope"` içeriyor; yani mevcut
  dosya için sorun "blend hiç kaydedilmemiş" değil.
- Material Editor materyali `cache: "no-cache"` ile okuyor, fakat runtime/editor
  sahne material loader yolu `loadForgeMaterial()` içinde material JSON'u normal
  `fetch(projectFileUrl(...))` ile okuyor. Bu, Material Editor'ın güncel JSON'u
  göstermesine karşın Scene/Play tarafının browser cache'ten eski JSON'u kullanması
  ihtimalini güçlendiriyor.
- Editor Scene, Material Editor save callback'inde `refreshMaterialAsset(...)`
  çağırıyor; Play runtime ise materyalleri başlangıçta `loadSceneMaterials()` ile
  preload ediyor. Açık Play penceresi sonradan kaydedilen materyali hot-refresh
  etmiyor olabilir.
- Details'ten yeni material slot atanırken `applyMaterialSlot()` load'u başlatıp
  aynı anda instance grubunu rebuild ediyor. Material cache henüz dolmadan yapılan
  ilk rebuild base material ile kalabilir; sonraki async rebuild yolu ayrıca
  doğrulanmalı.
- Shader tarafı slope driver'ı world normal `dot(normal, up)` ile hesaplayıp
  `diffuseColor.rgb` üzerinde blend uyguluyor. Bu nedenle güncel materyal doğru
  yüklenirse Scene/Play tarafında da görünmesi beklenir.
- Concrete tile layer ayarı görsel olarak düşük kontrastlı olabilir: layer1'de
  `baseColorTexture` yok, beyaz sabit renk ve normal map var. Bu testte sadece
  normal/roughness farkı belirgin olmayabilir; cache/load problemi ayrıştırılırken
  layer1'e geçici belirgin bir base color veya texture atanarak test edilmeli.

Önerilen çözüm sırası:

1. `src/scene/materialAssets.ts` içindeki material JSON fetch'ine `cache: "no-cache"`
   ekle.
2. Scene Editor'da `applyMaterialSlot()` için material load tamamlanmadan yapılan
   rebuild yarışını test et; gerekirse load tamamlanınca kesin rebuild garantisi ver.
3. Play tarafında açık runtime'ın materyal hot-refresh yapmadığını kabul et veya
   ileride editor-save sonrası runtime reload/refresh mekanizması tasarla.
4. Repro testi: Material Editor Save -> Scene Editor refresh -> Play'i yeniden aç;
   layer1'e geçici belirgin renk/texture atanarak slope etkisi görsel olarak
   ayrıştırılsın.

**Kabul:** Taş ve kar dokuları tek materyalde; eğim/yükseklik sürücüsüyle dik
yüzeyde taş, düz/yüksek yüzeyde kar görünür; blend yokken standart materyal birebir
aynı render eder (regresyon yok).

---

## Bölüm D — Sıra & Bağımlılıklar

- **A** ve **B** bağımsız; ikisi de C'den önce gelmeli çünkü C, A'nın ortak texture
  helper'ını (tiling/anisotropy/linear) ve B'nin roughness/metalness map mantığını
  per-layer yeniden kullanır.
- Önerilen sevkiyat: **A → B → C**. A hızlı görsel kazanç (anisotropy), B orta,
  C en büyük iş + tek shader istisnası.
- Her fazda: `npx tsc --noEmit` temiz + `engine-tests` yeşil + yeni alanlar
  `tools/saveValidator.ts` allowlist'inde (yoksa kayıtta sessizce düşer — CLAUDE.md).

## Bölüm E — Sonraki fazlara bırakılanlar

- İkiden fazla katman (N-layer landscape blend).
- Height-blend (displacement/height map ile keskin geçiş — kar birikme efekti).
- Detail/macro variation (uzak-yakın doku karışımı, tiling tekrarını gizleme).
- `displacementMap` / `bumpMap` / parallax.
- Triplanar projeksiyon (UV'siz dünya-uzayı doku).
- Texture import ayarları sidecar'ı (sRGB/linear, wrap, filter override) —
  gerekirse, yine ayrı editör değil.
- Normal `Constant3Vector` authoring. Details UI şimdilik alanı pasif gösterir;
  normal map yoksa mevcut mesh normal yolu korunur.

## İlk başlanacak iş

Kullanıcı komutu geldiğinde ilk teknik adım **Bölüm A.3** (ortak texture-config
helper + anisotropy) olmalıdır: hem anında görsel kazanç verir hem de B ve C'nin
üstüne kurulacağı tek-nokta texture kurulum altyapısını hazırlar.
