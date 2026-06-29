# Static Cloud Layer Checklist

> Tarih: 2026-06-20
> Amaç: `Add Actor → Visual Effects` listesine Sky Atmosphere ve Exponential
> Height Fog'un yanına bir **Cloud Layer** aktörü eklemek. Unreal'daki
> **Volumetric Clouds**'un aksine bu sistem **static (volumetric değil)**:
> raymarching yok, texture yok — kameraya bağlı tek bir kubbe backdrop'a
> prosedürel fBm-noise shader'ı ile bulut çizilir.
>
> Aktör, Sky/Fog ile aynı kalıpta bir **layout singleton "environment actor"**:
> transform'suz, sahnede tek, `category: "visual-effects"`, undo/redo'lu, kendi
> Details paneli olan ve menüden tıkla-ekle ile gelen bir aktör.

## Karar (kullanıcı onayı, 2026-06-20)

1. **Render yöntemi:** Prosedürel bulut kubbesi — Sky kubbesinin üstünde,
   kameraya bağlı, depth-test'li bir backdrop küresi (BackSide). fBm noise ile
   coverage/density/softness/scale parametrik. **Texture/asset yok.**
2. **Hareket:** `speed` (wind) parametresi; **varsayılan 0 = tamamen statik.**
   Sıfırdan büyük değerlerde noise yavaşça kayar (gentle drift).
3. **Volumetric KAPSAM DIŞI:** Unreal-style raymarched volumetric clouds bu
   çalışmada yapılmayacak.

## Şablon (taklit edilen mevcut Forge deseni)

Sky Atmosphere + Height Fog, cloud'un birebir izlediği "layout singleton
environment actor" şablonudur:

| Katman | Referans |
| --- | --- |
| Render-agnostik model | `engine/scene/cloudLayer.ts` (`ResolvedCloudLayer`, defaults, `resolveCloudLayer`) |
| Render bağlama (shader) | `engine/render-three/cloudLayer.ts` (`createCloudObject` / `applyCloudUniforms` / `followCameraWithClouds` / `advanceCloudTime`) |
| Layout tipi | `engine/scene/layout.ts` `LayoutCloudLayer`, `RoomLayout.cloudLayer?` |
| Save validator | `tools/saveValidator.ts` `validateCloudLayer` (+ `vite.config.ts` import eder) |
| Seçim tipi | `editor/core/selection.ts` `kind: "cloud"` (+ `CloudSelection`) |
| Outliner/Details VM | `editor/core/sceneObjects.ts` `buildCloudEditableSelection` + `CLOUD_LAYER_ASSET_ID` |
| Editable VM tipi | `editor/core/editableScene.ts` `EditableCloud` + `cloud?` |
| SceneApp orkestrasyon | `src/scene/SceneApp.ts` `applyCloudLayer` + `add/set/removeCloudLayer` + `commitCloud` |
| Runtime bağlama | `src/scene/RuntimeSceneApp.ts` `applyRuntimeClouds` |
| Editör Details paneli | `src/editor/EditorUi.ts` `renderCloudDetails` |
| Add Actor menüsü | `src/editor/EditorUi.ts` "Visual Effects" başlığı (`data-add-cloud-layer`) |

---

## Render mimarisi (static cloud dome)

- **Geometri:** `SphereGeometry(90, 32, 16)`, `BackSide` — kamera kürenin içinden
  bakar. Kübbe her kare kameraya merkezlenir (`followCameraWithClouds`), böylece
  küçük (~100u) frustum'u her zaman doldurur.
- **Depth davranışı:** `transparent: true`, `depthWrite: false`, **`depthTest:
  true`**. Sky backdrop'u depth yazmadığından açık gökyüzünde bulut görünür;
  90u'dan yakın opak sahne geometrisi depth buffer ile bulutu doğal olarak
  perdeler (backdrop hissi). Bu yüzden Sky'ın saf `depthTest:false` deseninden
  ayrılır.
- **Shader:** value-noise tabanlı 5-oktav fBm. Ufukta aşırı gerilmeyi azaltmak
  için `dir.y` üzerinde yumuşatılmış bir sky-plane remap kullanılır; bulutlar
  hala ufka doğru uzar ama alt kenar "aşağı düşüyor" gibi görünmez. Ufuk altı
  `discard`. `coverage` eşiği düşürür (daha çok kaplama), `softness` geçiş
  bandını genişletir, `density` genel opaklık, `scale` öbek boyutu.
- **Drift:** `advanceCloudTime` her kare `uTime`'ı artırır; `uWind = sabit yön ×
  speed`. `speed = 0` → sıfır vektör → görünür hareket yok (statik). Time
  koşulsuz ilerler; maliyeti ihmal edilebilir.
- **Not (Faz 1):** Cloud rengi tone-mapping/colorspace zincirinden geçmez (ham
  ShaderMaterial). Beyazımsı düz renk için kabul edilebilir; gerekirse ileride
  `<tonemapping_fragment>`/`<colorspace_fragment>` eklenebilir.

---

## Checklist

Durum: `[ ]` yapılmadı · `[~]` kısmi · `[x]` tamam

### Model & render
- [x] `engine/scene/cloudLayer.ts`: `ResolvedCloudLayer` (`name`, `hidden`,
      `color`, `coverage`, `density`, `softness`, `scale`, `speed`) +
      `CLOUD_LAYER_DEFAULTS` + `resolveCloudLayer`
- [x] `engine/render-three/cloudLayer.ts`: prosedürel kubbe ShaderMaterial,
      `createCloudObject` / `applyCloudUniforms` / `followCameraWithClouds` /
      `advanceCloudTime` + model re-export

### Layout & persistans
- [x] `engine/scene/layout.ts`: `LayoutCloudLayer` + `RoomLayout.cloudLayer?`
- [x] `tools/saveValidator.ts`: `validateCloudLayer` (allowlist, aralık reddi,
      placed-cloud her zaman round-trip) + `validateLayout`'a bağlandı
- [x] CLAUDE.md "save-validator allowlist gotcha" notuna cloud eklendi

### Seçim & VM
- [x] `editor/core/selection.ts`: `kind: "cloud"` (+ `CloudSelection`, clone /
      selectionId / parseSelectionId / selectionsEqual)
- [x] `editor/core/editableScene.ts`: `EditableCloud` + `cloud?`
- [x] `editor/core/sceneObjects.ts`: `CLOUD_LAYER_ASSET_ID`,
      `buildCloudEditableSelection`, liste + tek-seçim çözümü

### SceneApp / Runtime orkestrasyon
- [x] `SceneApp`: `applyCloudLayer` + `add/remove/setCloudLayer` + `commitCloud`,
      render-loop follow + time, init çağrısı
- [x] `SceneApp`: rename / setHidden / delete / refresh / visibility / label /
      hasSelection / outline / gizmo / mutableTransform singleton dalları `cloud`
- [x] `editor/scene/EditorSceneController.ts` + `editor/render-three/scenePicker.ts`
      singleton dalları `cloud`
- [x] `RuntimeSceneApp`: `applyRuntimeClouds` + render-loop follow + time + init

### Editör UI
- [x] "Visual Effects" başlığına `<button data-add-cloud-layer>Cloud Layer</button>`
- [x] Tıkla-ekle bağlaması (`addCloudLayer`) — drag yok
- [x] `renderCloudDetails`: name, color, coverage, density, softness, scale, wind
      + `setCloudLayer` bağlamaları
- [x] `renderDetails` içinde `kind === "cloud"` dalı; Outliner harfi "K"

### Test & doğrulama
- [x] `tools/engine-tests.ts`: `resolveCloudLayer` defaults/override,
      `applyCloudUniforms` uniform itme + hidden/wind, `validateCloudLayer`
      allowlist + `validateLayout` round-trip
- [x] `npx tsc --noEmit` temiz; `node tools/run-engine-tests.mjs` yeşil
- [ ] Manuel akış (tarayıcıda): Add Actor → Cloud Layer → Details'tan
      coverage/density/color/wind → Play'de görünüyor → Save/Reload → Undo/Redo →
      Delete. *(Kod yolu tsc + unit testlerle doğrulandı; dev sunucusu
      playground.json'u autosave ile yeniden yazdığından elle test kullanıcıya
      bırakıldı.)*

---

## İleride (opsiyonel)
- Tone-mapping/colorspace zinciri ile renk tutarlılığı.
- İkinci bir bulut katmanı (cirrus/cumulus ayrımı) veya yükseklik bandı parametresi.
- Sky Atmosphere güneş yönüne göre bulut alt/üst gölgelemesi (yalnızca renk).
