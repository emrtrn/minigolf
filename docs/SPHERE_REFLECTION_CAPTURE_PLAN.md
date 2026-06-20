# Sphere Reflection Capture Plan

> Amaç: `Add Actor -> Visual Effects` altına yerleştirilebilir **Sphere Reflection
> Capture** aktörü eklemek. Her probe kendi konumundan statik cubemap bake eder;
> sahnedeki PBR yüzeyler global `Reflection Environment` yerine en uygun local
> probe cubemap'ini kullanabilir. İlk hedef: probe başına CubeCamera bake +
> nearest-probe per-object `envMap`; ikinci hedef: local/parallax correction.

## Kısa Sonuç

Forge'da mevcut yansıma sistemi iki parçadan oluşuyor:

- **Reflection Environment**: singleton Sky Light karşılığı. Sky Atmosphere'ı
  PMREM'e bake edip `scene.environment` olarak asıyor. Bu global IBL'dir ve bütün
  `MeshStandardMaterial` yüzeyleri etkiler.
- **Reflection Plane**: placed actor. Three.js `Reflector` ile düzlemsel mirror
  üretir; kendi render target'ı ve transform'u vardır.

Sphere Reflection Capture, bu iki sistemden farklı bir üçüncü katman olmalı:

- `Reflection Environment` gibi global singleton değil.
- `Reflection Plane` gibi sahneyi her frame mirror kamera ile tekrar render eden
  pahalı bir sistem değil.
- Yerleştirilebilir statik probe aktörü; bake sonucu cache'lenmiş local cubemap.
- Render sırasında nesne/placement için en yakın/geçerli probe seçilir.

## Unreal Referansı

Unreal Engine'de Reflection Capture aktörleri statik local reflection verisi
sağlar. Seviye birçok noktadan capture edilir, sphere/box gibi basit şekillere
reproject edilir ve runtime'da düşük maliyetle kullanılır.

Kaynaklar:

- Epic: Reflections Captures in Unreal Engine  
  https://dev.epicgames.com/documentation/unreal-engine/reflections-captures-in-unreal-engine
- Epic: Reflections Environment in Unreal Engine  
  https://dev.epicgames.com/documentation/unreal-engine/reflections-environment-in-unreal-engine
- Epic: Planar Reflections in Unreal Engine  
  https://dev.epicgames.com/documentation/unreal-engine/planar-reflections-in-unreal-engine

Unreal'dan alınması gereken fikirler:

- Sphere/Box capture düşük maliyetli, statik local cubemap'tir.
- Capture aktörleri overlap edebilir; küçük/local capture büyük/global capture'ı
  refine eder.
- Parlak ve düz yüzeylerde cubemap projection hataları daha görünürdür.
- Planar Reflection ayrı bir kategoridir: daha doğru fakat sahneyi tekrar render
  ettiği için pahalıdır.

## Mevcut Forge Dayanakları

Kodda ilgili sahiplik noktaları:

- `engine/scene/reflection.ts`: `Reflection Environment` render-agnostic model ve
  defaults. Yorumlarda positional Sphere Reflection Capture'ın mevcut fazda kapsam
  dışı olduğu belirtiliyor.
- `engine/render-three/reflection.ts`: Sky Atmosphere -> PMREM -> `scene.environment`.
- `engine/scene/reflectionPlane.ts`: Planar reflection defaults.
- `engine/render-three/reflectionPlane.ts`: `Reflector` binding.
- `engine/scene/layout.ts`: `reflection?: LayoutReflection` ve
  `reflectionPlanes?: LayoutReflectionPlane[]` şeması.
- `tools/saveValidator.ts`: reflection ve reflection plane allowlist validator'ları.
- `src/editor/EditorUi.ts`: `Add Actor -> Visual Effects` butonları ve Details
  panel binding'leri.
- `src/scene/SceneApp.ts`: editor-side build, selection, undo/redo, recapture ve
  render object lifecycle.
- `src/scene/RuntimeSceneApp.ts`: Play tarafında instanced model/material override
  parity.

Önemli mevcut kısıt:

- Instanced static mesh yolu aynı GLTF material referansını paylaşır. Per-placement
  probe `envMap` için materyali doğrudan mutasyona uğratmak tüm instance'ları
  etkileyebilir. Çözüm olarak placement'ları probe bucket'larına ayırmak veya
  material override clone yoluna benzer ayrı render object üretmek gerekir.

## Önerilen Layout Modeli

Yeni alan:

```ts
reflectionCaptures?: LayoutSphereReflectionCapture[];
```

Önerilen aktör şeması:

```ts
export interface LayoutSphereReflectionCapture {
  id: string;
  name?: string;
  hidden?: boolean;
  locked?: boolean;
  scaleLocked?: boolean;
  groupId?: string;
  nodeId?: string;
  parentId?: string;
  position: Vec3;
  radius?: number;
  intensity?: number;
  resolution?: number;
  near?: number;
  far?: number;
  parallax?: boolean;
  priority?: number;
}
```

Başlangıç defaults:

- `name`: `"Sphere Reflection Capture"`
- `hidden`: `false`
- `radius`: `5`
- `intensity`: `1`
- `resolution`: `256`
- `near`: `0.1`
- `far`: `100`
- `parallax`: `false` ilk fazda false
- `priority`: `0`

## Önerilen Dosya Yapısı

Yeni render-agnostic model:

- `engine/scene/reflectionCapture.ts`
  - `ResolvedSphereReflectionCapture`
  - `SPHERE_REFLECTION_CAPTURE_DEFAULTS`
  - `resolveSphereReflectionCapture(...)`
  - `uniqueSphereReflectionCaptureId(...)`
  - `uniqueSphereReflectionCaptureName(...)`

Yeni Three binding:

- `engine/render-three/reflectionCapture.ts`
  - `SphereReflectionCaptureRenderItem`
  - `SphereReflectionCaptureObject`
  - `createSphereReflectionCaptureObject(...)`
  - `applySphereReflectionCaptureTransform(...)`
  - `bakeSphereReflectionCapture(...)`
  - `disposeSphereReflectionCaptureObject(...)`

Editor/runtime entegrasyon:

- `engine/scene/layout.ts`: yeni layout interface ve `RoomLayout` alanı.
- `tools/saveValidator.ts`: `validateSphereReflectionCapture(...)`.
- `editor/core/selection.ts`: `kind: "reflectionCapture"`.
- `editor/core/sceneObjects.ts`: outliner/details view-model.
- `editor/core/layoutSnapshots.ts`: clone helper.
- `editor/render-three/scenePicker.ts` ve `engine/render-three/picking.ts`: probe
  helper seçimi.
- `src/editor/EditorUi.ts`: Add Actor button + Details panel.
- `src/scene/SceneApp.ts`: build/add/remove/set/recapture lifecycle.
- `src/scene/RuntimeSceneApp.ts`: Play parity.
- `tools/engine-tests.ts`: resolver, validator, object lifecycle, nearest-probe
  selection testleri.

## Capture Bake Tasarımı

Her probe için:

1. `WebGLCubeRenderTarget(resolution)` oluştur.
2. `CubeCamera(near, far, target)` oluştur.
3. Probe helper/wire ve editor-only objeleri capture sırasında gizle.
4. `cubeCamera.position = probe.position`.
5. `cubeCamera.update(renderer, scene)` ile cubemap üret.
6. `PMREMGenerator.fromCubemap(cubeTarget.texture)` ile prefiltered environment
   target üret.
7. Eski PMREM/cube target'ları dispose et.
8. Probe cache'e `texture`, `position`, `radius`, `intensity`, `priority` yaz.

Capture statik olmalı:

- İlk load'da ve aktör eklendiğinde bake.
- Details panelde `Recapture` butonu.
- `Recapture All Reflection Captures` opsiyonel toplu komut.
- Transform/radius/resolution değişince otomatik yeniden bake opsiyonel; ilk fazda
  explicit `Recapture` daha güvenli.

## Probe Seçimi

Başlangıç algoritması:

```ts
score = distance(objectCenter, probe.position) / probe.radius
```

Kurallar:

- Hidden probe yok sayılır.
- `score <= 1` ise probe etki alanı içindedir.
- En düşük score kazanır.
- Eşitlikte yüksek `priority`, sonra küçük `radius`, sonra layout sırası.
- Probe bulunamazsa global `scene.environment` fallback olarak kalır.

Bu Unreal'ın multi-probe blend modelinin basit karşılığıdır. İlk faz için blend
yapmadan nearest-probe seçimi yeterli ve daha test edilebilir.

## Material / Instancing Stratejisi

Three.js `scene.environment` globaldir. Sphere Capture ise object/placement bazlı
envMap gerektirir.

İlk faz için uygulanabilir strateji:

- Her renderable object/placement için nearest probe hesapla.
- `MeshStandardMaterial` klonlarına `envMap = probe.pmrem.texture` ve
  `envMapIntensity = probe.intensity` ata.
- `MeshBasicMaterial` etkilenmez.
- Probe yoksa material envMap temizlenir ve global `scene.environment` devrede
  kalır.

Instanced mesh için iki seçenek:

1. **Probe bucket instancing (önerilen)**  
   Aynı asset placement'ları `probeKey` bazında gruplara ayrılır. Her bucket ayrı
   `InstancedMesh` ve ayrı cloned material set'i kullanır. Draw call artar ama
   instancing tamamen kaybolmaz.

2. **Clone fallback**  
   Material override yoluna benzer şekilde etkilenen placement'lar instanced mesh
   içinde gizlenir, ayrı cloned object olarak render edilir. Basit ama çok sayıda
   placement'ta pahalıdır.

Öneri: V1'de probe bucket instancing; clone fallback sadece karmaşık/özel material
override çakışmalarında.

## Parallax Correction

`MeshStandardMaterial.envMap` tek başına local parallax vermez; cubemap'i sonsuz
uzakta varsayar. Bu yüzden "parallax" hedefi ayrı faz olmalı.

V1:

- Probe başına cubemap bake.
- Nearest-probe per-object envMap.
- Parallax kapalı.

V2:

- `MeshStandardMaterial.onBeforeCompile` shader patch.
- Probe position/radius uniform'ları.
- Reflection vector sampling'i local sphere projection ile düzeltme.
- `customProgramCacheKey` ile shader cache ayrımı.

V3:

- Multi-probe blend.
- Box Reflection Capture / box projection.
- Roughness ve probe blending kalitesi için daha gelişmiş weighting.

## UI / UX

Add Actor:

- `Visual Effects`
  - `Reflection Environment`
  - `Reflection Plane`
  - `Sphere Reflection Capture`
  - `Post Process`

Details panel:

- Name
- Location
- Radius
- Resolution: `128 / 256 / 512 / 1024`
- Intensity
- Near / Far
- Priority
- Parallax: checkbox, V1'de disabled veya "planned" notlu
- `Recapture`

Viewport:

- Wire sphere helper.
- Küçük capture icon/marker.
- Seçilebilir ve taşınabilir placed actor.
- Hidden olduğunda helper ve etki devre dışı.

## Faz Planı

### Faz 1 - Şema ve Editor Aktörü

- [ ] `LayoutSphereReflectionCapture` ekle.
- [ ] Resolver/default/id/name helper dosyasını ekle.
- [ ] Validator ve layout round-trip testleri ekle.
- [ ] Selection/outliner/details modelini ekle.
- [ ] Add Actor button ve Details panelini ekle.
- [ ] SceneApp add/remove/set/undo/redo lifecycle ekle.
- [ ] Viewport wire sphere helper ve picking ekle.

Kabul:

- Aktör eklenir, seçilir, taşınır, kaydedilir, yüklenir.
- `npm run build:verify` geçer.

### Faz 2 - CubeCamera Bake Cache

- [ ] `engine/render-three/reflectionCapture.ts` binding ekle.
- [ ] Probe başına cube render target + PMREM cache üret.
- [ ] Recapture ve Recapture All komutları ekle.
- [ ] Capture sırasında helper/editor-only görünürlüğünü güvenli yönet.
- [ ] Dispose lifecycle testlerini ekle.

Kabul:

- Probe capture cache oluşur.
- Resolution değişimi eski target'ları dispose eder.
- Hidden probe envMap seçimine katılmaz.

### Faz 3 - Nearest-Probe EnvMap Assignment

- [ ] Renderable object world center hesaplama helper'ı ekle.
- [ ] Nearest-probe seçim algoritmasını test et.
- [ ] Non-instanced/override objects için material clone + envMap ata.
- [ ] Instanced placements için probe bucket instancing ekle.
- [ ] RuntimeSceneApp parity ekle.

Kabul:

- Probe radius içindeki parlak/metallic PBR yüzeyler local cubemap'i kullanır.
- Probe dışında global Reflection Environment fallback'i bozulmaz.
- Editor ve Play aynı sonucu verir.

### Faz 4 - Parallax

- [ ] `onBeforeCompile` shader patch prototipi.
- [ ] Probe uniform'ları: position, radius, intensity.
- [ ] `parallax` checkbox aktif et.
- [ ] Basit düz yüzey ve oda test layout'u ile görsel doğrulama.

Kabul:

- Parallax açıkken local capture, object konumuna göre daha doğru yönlenir.
- Parallax kapalıyken V3 öncesi stabil envMap davranışı korunur.

### Faz 5 - Kalite / Unreal Benzeri Refinement

- [ ] Overlap blend.
- [ ] Priority/small-probe override kuralını iyileştir.
- [ ] Box Reflection Capture için ayrı plan çıkar.
- [ ] Debug show flag: probe radius, selected probe, stale bake indicator.

## Riskler

- Material paylaşımı yanlış yönetilirse bir probe tüm asset instance'larını etkiler.
- Çok fazla probe ve yüksek resolution GPU memory kullanımını artırır.
- Her transform değişiminde auto-recature pahalı olabilir.
- Shader patch parallax, Three.js sürüm değişimlerine daha kırılgandır.
- Reflection Plane ile Sphere Capture aynı parlak yüzeyi etkilediğinde öncelik
  net tanımlanmalı: planar mirror kendi yüzeyi için daha özel/üstün kabul edilmeli.

## Önerilen Başlangıç Dilimi

İlk uygulanacak küçük dilim:

1. Şema + validator + resolver.
2. Add Actor + outliner/details + transform/picking.
3. `build:verify`.

Bu dilim render kalitesine dokunmadan aktör altyapısını güvenli kurar. Ardından
CubeCamera bake ve nearest-probe envMap ayrı, test edilebilir dilimler halinde
eklenmelidir.
