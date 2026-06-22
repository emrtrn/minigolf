# Post Process Checklist

> Tarih: 2026-06-20
> Amaç: Unreal'daki **Post Process Volume / Post Process Settings** sistemine
> karşılık gelen bir **ekran-uzayı (post-process) efekt** sistemini Forge'a
> eklemek. Sky Atmosphere / Height Fog / Cloud Layer ile aynı kalıpta bir
> **layout singleton "environment actor"** olarak yaşar: transform'suz, sahnede
> tek, `category: "visual-effects"`, undo/redo'lu, kendi Details paneli olan ve
> `Add Actor → Visual Effects` menüsünden tıkla-ekle ile gelen bir aktör.
>
> Bu doküman önce Unreal modelini özetler (Bölüm A), Forge'un mevcut render
> hattıyla eşler (Bölüm B), kapsam/eşleme (Bölüm C) ve mimari kararı (Bölüm D)
> verir, **post-process'e özgü temel refaktörü** (paylaşılan EffectComposer,
> Bölüm E) anlatır, ardından fazlı checklist sunar.
>
> **Kritik fark:** Sky/Fog/Cloud yalnızca bir scene objesi / `scene.fog` /
> renderer property idi — render hattına dokunmadılar. Post Process'in çoğu
> efekti **bir `EffectComposer` pass zinciri** gerektirir. Editör zaten composer
> kullanıyor (seçim outline'ı için); **runtime düz `renderer.render` yapıyor.**
> Yani composer'lı efektlerin temel taşı, composer'ı hem editöre hem runtime'a
> **paylaşımlı** şekilde sokmaktır (Bölüm E).
>
> **Fazlama kararı (2026-06-20, onaylandı):** **Faz 1 yalnızca Exposure +
> Tonemapper** içerir. Bu ikisi salt **renderer property** olduğundan
> (`renderer.toneMapping` / `toneMappingExposure`) **composer gerektirmez** — Faz
> 1'in tek gerçek işi Sky Atmosphere ile tone-mapping sahipliği çakışmasını
> çözmektir (Bölüm B.2 / D.5). Composer pass zinciri ve onun üstündeki efektler
> (Bloom, Vignette, Saturation/Contrast, ardından DoF/CA/Grain/AO) **Faz 2'dir.**

## Kaynaklar (incelenen Unreal dokümantasyonu)

- [Post Process Effects in Unreal Engine](https://dev.epicgames.com/documentation/unreal-engine/post-process-effects-in-unreal-engine)

## Şablon (taklit edilen mevcut Forge deseni)

Sky Atmosphere → Height Fog → Cloud Layer, "layout singleton environment actor"
deseninin üç kanıtlanmış kopyasıdır. Post Process aynı katmanları yeniden kurar:

| Katman | Mevcut singleton referansı (Sky / Fog / Cloud) |
| --- | --- |
| Render-agnostik model | `engine/scene/{skyAtmosphere,heightFog,cloudLayer}.ts` (`Resolved*`, defaults, `resolve*`) |
| Render bağlama | `engine/render-three/{skyAtmosphere,heightFog,cloudLayer}.ts` |
| Layout tipi | `engine/scene/layout.ts:354-358` `skyAtmosphere?` / `heightFog?` / `cloudLayer?` |
| Save validator | `tools/saveValidator.ts` `validateSkyAtmosphere` / `validateHeightFog` / `validateCloudLayer` (+ `vite.config.ts` allowlist) |
| Seçim tipi | `editor/core/selection.ts:6-8` `kind: "sky" \| "fog" \| "cloud"` |
| Outliner/Details VM | `editor/core/sceneObjects.ts` `build*EditableSelection` |
| SceneApp orkestrasyon | `src/scene/SceneApp.ts` `applySkyAtmosphere` / `applyHeightFog` + `add/set/remove*` + `commit*` |
| Runtime bağlama | `src/scene/RuntimeSceneApp.ts` `applyRuntime*` |
| Editör Details paneli | `src/editor/EditorUi.ts` `renderSkyDetails` / `renderFogDetails` |
| Add Actor menüsü | `src/editor/EditorUi.ts:307` "Visual Effects" başlığı |

---

## Bölüm A — Unreal Post Process Modeli (özet)

Unreal'da post-process, sahne render edildikten **sonra** ekran görüntüsüne
uygulanan efektlerin tümüdür. Ayarlar bir **Post Process Volume** (ya da
Camera/Cine Camera) üzerinde yaşar.

### A.1 Post Process Volume mantığı

- **Infinite Extent (Unbound)**: hacim sınırlarını yok sayar, tüm sahneyi etkiler
  (global). **Bounded**: yalnızca hacmin içindeyken etki eder.
- **Blend Weight**: hacmin etkisinin gücü (1 = tam, 0 = etkisiz).
- **Priority**: çakışan hacimlerde hangisinin kazanacağı (yüksek olan ezer).
- **Blend Radius**: hacim kenarında yumuşak geçiş bölgesi.

### A.2 Efektler (Unreal'daki başlıklar)

- **Lens**
  - **Bloom**: parlak yüzeylerde hâle/parıltı.
  - **Lens Flare**: parlak ışıktan görüntü-tabanlı lens parlamaları.
  - **Dirt Mask**: bloom'u doku ile lekeleyen lens kiri.
  - **Chromatic Aberration**: kenarlarda RGB ayrışması.
  - **Vignette**: kenarlara doğru kararma.
  - **Depth of Field**: odak mesafesine göre bulanıklık (sinematik / mobil).
- **Exposure**
  - **Exposure / Eye Adaptation**: sahne parlaklığına göre otomatik pozlama
    (insan gözü uyumu); manuel pozlama da mümkün.
  - **Local Exposure**: yüksek kontrastta detayı koruyan yerel pozlama.
- **Color Grading / Film**
  - **Color Grading**: temperature/tint (white balance), global + shadows/
    midtones/highlights için saturation/contrast/gamma/gain/offset.
  - **Film (Tone Curve)**: ACES uyumlu ton eğrisi (slope/toe/shoulder/black-white
    clip) — tonemapper.
  - **Film Grain**: film greni.
- **Camera**: shutter speed / ISO / aperture (f-stop) / diaphragm blade count.
- **Motion Blur**: hareket hızına göre bulanıklık (velocity buffer gerektirir).
- **Ambient & Shadowing**
  - **Ambient Occlusion (SSAO)**: köşe/oyuk kararması.
  - **Ambient Cubemap**: cubemap'ten ortam ışığı.
- **Global Illumination & Reflections**: Lumen GI / Screen Space GI / RT GI;
  Lumen Reflections / Screen Space Reflections / RT Reflections.
- **İleri**: Post Process Materials (custom `Post Process` domain materyali),
  Path Tracing, RT Translucency. *(RT* ve *Lumen* yolları UE'de motor-içi GI/
  reflection sistemleri; web/Three.js'te karşılığı yok veya çok pahalı.)*

---

## Bölüm B — Forge Mevcut Durum

### B.1 Render hattı asimetrisi (en kritik nokta)

- **Editör**: `EditorSelectionOutline` (`src/scene/editorSelectionOutline.ts`)
  bir **`EffectComposer`** kurar: `RenderPass → OutlinePass → OutputPass`.
  Render loop'ta `SceneApp.ts:602` `this.selectionOutline.render(delta)` çağrılır.
  Yani editör **zaten composer üzerinden** çiziyor (OutputPass tone-mapping +
  sRGB encode'u yapıyor).
- **Runtime/Play**: `RuntimeSceneApp.ts:301` **doğrudan** `this.renderer.render(
  scene, camera)` — **composer yok**. `SceneRuntimeCore.applyEditorMatchedPlayLook`
  notu da bunu doğruluyor: "Play renders directly (no composer)".
- **Sonuç:** Post-process efektlerinin Play modunda da görünmesi için runtime'a
  bir composer eklenmeli; editörde de OutlinePass ile **aynı** composer'a PP
  pass'leri girmeli. Bu, Sky/Fog/Cloud'da olmayan, PP'ye özgü temel iştir
  (Bölüm E).

### B.2 Tone mapping sahipliği — çakışma noktası

- Tone mapping şu an **Sky Atmosphere'in elinde**: `applySkyToneMapping`
  (`engine/render-three/skyAtmosphere.ts:108`) sky varken
  `renderer.toneMapping = ACESFilmicToneMapping` + `toneMappingExposure =
  sky.exposure`, sky yokken `NoToneMapping`/`1` yapıyor. `SceneApp.ts:2608/2620`
  ve `RuntimeSceneApp.ts:985/997`'ten çağrılıyor.
- Post Process'in **Exposure** ve **Color Grading/Film (tonemapper)** alanları da
  tam olarak bu renderer property'lerini istiyor. **İki sistem aynı anda
  `renderer.toneMapping`'i yazarsa çakışır.** → Tek bir sahip (coordinator)
  belirlenmeli (Bölüm D.5).

### B.3 Eldeki Three.js pass'leri (ek bağımlılık YOK)

`three/examples/jsm/postprocessing/` zaten kullanımda (EffectComposer, RenderPass,
OutlinePass, OutputPass). Aynı dizinde hazır gelenler:

- `UnrealBloomPass` → **Bloom** (threshold / strength / radius).
- `BokehPass` → **Depth of Field** (focus / aperture / maxblur).
- `ShaderPass` + hazır shader'lar: `VignetteShader` → **Vignette**,
  `ColorCorrectionShader` → temel **Color Grading** (pow/mul), `RGBShiftShader` →
  basit **Chromatic Aberration**.
- `FilmPass` → **Film Grain** (+ tarama/scanline; greni izole kullanırız).
- `GTAOPass` / `SSAOPass` → **Ambient Occlusion**.
- `SMAAPass` → kenar yumuşatma (PP toggle olarak faydalı; `OutputPass`'tan
  **önce** çalışmalı).
- `OutputPass` → tonemapping + sRGB encode (zaten kullanılıyor; PP zincirinin
  **sonunda** kalmalı).

**Anti-alias araştırma notu (2026-06-22):**

- Three.js `EffectComposer` pass'leri sırayla çalıştırır ve render loop'ta
  `renderer.render()` yerine `composer.render()` kullanılır. Composer kendi read/
  write render target'larını oluşturur; constructor'a özel `WebGLRenderTarget`
  verilirse onu ve klonunu buffer olarak kullanır.
- `SMAAPass`, Three.js dokümantasyonuna göre linear-sRGB uzayında çalışır ve
  `OutputPass`'tan **önce** olmalıdır. Bu Forge için en düşük riskli ilk AA
  yoludur: yeni bağımlılık yok, post-process zincirine tek pass eklenir.
- `OutputPass` tonemapping + color-space conversion'ı en sonda yapar. Bu yüzden
  FXAA gibi sRGB-input isteyen bir pass seçilirse `OutputPass` sonrası özel sıra
  gerektirir; Forge'un mevcut zinciri için SMAA daha temizdir.
- Renderer zaten `antialias: true` ile kuruluyor; bu default framebuffer MSAA'sı
  düz render yolunda işe yarar. Composer aktifken görüntü ara render target'lara
  çizildiği için F2.5'te pratik çözüm `SMAAPass`; gerekirse ikinci deney olarak
  EffectComposer'a multisample-capable özel render target (`samples`) verilebilir,
  ama ilk hedef değil.
- Editörde seçim outline'ı da yumuşatılacaksa sıra şu olmalı:
  `RenderPass → efektler → [OutlinePass] → SMAAPass → OutputPass`. Mevcut
  pipeline effect pass'leri injected editor pass'lerden önce ekliyor; bu yüzden
  SMAA ayrı bir "final AA" slot'u olarak tasarlanmalı, sıradan efekt pass'i gibi
  OutlinePass önüne konmamalı.

Kaynaklar: Three.js `EffectComposer`, `SMAAPass`, `OutputPass`,
`WebGLRenderer.capabilities.maxSamples` dokümanları.

### B.4 Ölçek uyarısı

Kamera far-plane'i sadece **100 birim** (`skyAtmosphere.ts:36`). DoF odak
mesafesi, bloom threshold'u, AO yarıçapı bu küçük ölçeğe göre ayarlanmalı (Fog'da
da aynı uyarı geçti).

### B.5 Hazır altyapı

Sky/Fog/Cloud singleton boru hattı (tıkla-ekle, undo/redo, save round-trip,
transform'suz Outliner/Details, `kind` tabanlı seçim) hazır — PP veri/UI
katmanı bunların birebir ikizi. Tek yeni teknik risk render-pipeline tarafında.

---

## Bölüm C — Eşleme & Kapsam Kararı

**Faz 1** yalnızca **renderer-property** efektleri (Exposure + Tonemapper,
composer'sız). **Faz 2** paylaşılan composer'ı kurup üstüne pass-tabanlı efektleri
(Bloom, Vignette, grading, ardından DoF/CA/Grain/AO) ekler. Lumen/RT/Path Tracing
ve bounded-volume karışımı **kapsam dışı**.

| Unreal alanı | Forge karşılığı | Faz |
| --- | --- | --- |
| Exposure (manuel) | `exposure` → `toneMappingExposure` | **Faz 1** |
| Film / Tone Curve (tonemapper) | `toneMapping: "aces" \| "neutral" \| "none"` → `renderer.toneMapping` | **Faz 1** |
| hidden / enabled | `hidden?` (Sky gibi) | **Faz 1** |
| Color Grading (temel) | `saturation`, `contrast` → grading shader (ColorCorrection tarzı) | **Faz 2** |
| Bloom | `bloom{enabled,threshold,intensity,radius}` → `UnrealBloomPass` | **Faz 2** |
| Vignette | `vignette{enabled,intensity,offset}` → `ShaderPass`+VignetteShader | **Faz 2** |
| Depth of Field | `dof{enabled,focusDistance,aperture,maxBlur}` → `BokehPass` (ölçeğe uygun) | **Faz 2** |
| Chromatic Aberration | `chromaticAberration{enabled,amount}` → `RGBShiftShader` | **Faz 2** |
| Film Grain | `grain{enabled,intensity}` → `FilmPass` (yalnız gren) | **Faz 2** |
| Ambient Occlusion | `ao{enabled,radius,intensity}` → `GTAOPass` (GTAO; SSAO/SAO değil, 2026-06-22) | **Faz 2** |
| Anti-alias (kalite) | `antialias: "none" \| "smaa"` → `SMAAPass` | **Faz 2 (F2.5)** |
| White Balance (temp/tint) | grading shader'a temp/tint | **Faz 2 (ops.)** |
| Shadows/Mid/Highlights grading | bölgesel grading (lift/gamma/gain) | **İPTAL (2026-06-22)** |
| Auto Exposure / Eye Adaptation | luminance histogram + zamanla uyum | **KAPSAM DIŞI (pahalı)** |
| Local Exposure | yerel pozlama | **KAPSAM DIŞI** |
| Motion Blur | velocity buffer gerektirir | **KAPSAM DIŞI (Faz 3)** |
| Lens Flare / Dirt Mask / Ambient Cubemap | görüntü/doku tabanlı lens | **KAPSAM DIŞI** |
| Lumen / SSGI / RT GI · Reflections | motor-içi GI/yansıma | **KAPSAM DIŞI (Three.js'te yok)** |
| Path Tracing / RT Translucency | RT yolları | **KAPSAM DIŞI** |
| Post Process Materials (custom domain) | kullanıcı PP materyali | **KAPSAM DIŞI (Faz 3)** |
| Camera (shutter/ISO/f-stop) | fiziksel kamera | **KAPSAM DIŞI** |
| Bounded volume + blend/priority | birden çok hacim karışımı | **KAPSAM DIŞI (tek global singleton)** |

---

## Bölüm D — Mimari Kararlar

1. **Veri sahipliği:** Post Process, **layout singleton actor**'dür
   (`RoomLayout.postProcess?`), Sky/Fog/Cloud ile birebir. **Tek, global,
   sınırsız (infinite-extent) bir hacim** gibi davranır. Unreal'ın **bounded
   volume + blend weight + priority** karışımı **kapsam dışı** (web-hafif; tek
   global ayar yeter, ileride gerekirse eklenir).
2. **Tek seçim/komut yolu:** `Selection`'a `kind: "post"` eklenir; ekleme/silme/
   düzenleme `commitPostProcess` ile tek undoable komut (`commitSky`/`commitFog`
   ikizi).
3. **Paylaşılan render boru hattı:** Composer hem editör hem runtime'da **tek bir
   yardımcıdan** kurulur (Bölüm E). Bu, PP'nin Sky/Fog/Cloud'dan ayrıldığı tek
   yapısal nokta.
4. **Editör core generic kalır:** PP engine-generic; proje-özel kural yok.
   Details paneli + menü `src/editor/` altında, `?editor` dinamik importu
   arkasında; game build'e girmez. Render boru hattı engine ortak.
5. **Tone mapping/exposure sahipliği (çakışma çözümü):**
   - **PP aktörü yokken:** bugünkü davranış aynen korunur — Sky Atmosphere tone
     mapping'i yönetir (`applySkyToneMapping`).
   - **PP aktörü varken:** tone mapping + exposure'ı **PP sahiplenir**;
     `applySkyToneMapping`'in PP varken çalışmaması için tek bir koordinasyon
     noktası (ör. `applyPostProcess` Sky'dan sonra çağrılır ve PP aktifse
     renderer'ı kendi `toneMapping`/`exposure` değerine set eder). Sky'ın
     exposure'ı PP'nin başlangıç değeri olarak okunabilir. Bu kural test ve
     dokümanla sabitlenir.
6. **Save validator gotcha:** `validatePostProcess` eklenir; her alan allowlist'te
   açıkça kopyalanır, aralık dışı/eksik enum değer reddedilir
   (`validateSkyAtmosphere`/`validateCloudLayer` deseni). `vite.config.ts`
   `validateLayout`'u import ettiği için allowlist saveValidator içinde olmalı.
   CLAUDE.md "save-validator allowlist gotcha" notuna `postProcess` eklenir.
7. **Performans:** Her pass tam-ekran bir çizim + ek render target. Pass'ler
   **yalnızca ilgili efekt `enabled` iken** zincire eklenir (kapalıyken hiç
   allocate edilmez). Hiçbir PP efekti açık değilse composer yine de OutputPass
   ile çalışır (mevcut editör davranışı korunur); runtime'da hiç PP yoksa düz
   `renderer.render` yolunda kalınabilir. `?debug` overlay ile draw-call izlenir.

---

## Bölüm E — Temel Refaktör: Paylaşılan Post-Process Boru Hattı (Faz 2 ön koşulu)

Bu, PP'nin asıl mühendislik işidir; **Faz 2'nin ilk adımı** (`F2.0`). Faz 1
(Exposure + Tonemapper) buna ihtiyaç duymaz — composer'lı efektler gelmeden önce
oturmalıdır.

**Hedef yapı:** Tek bir engine yardımcısı (`engine/render-three/postProcess.ts`)
sıralı bir pass zinciri kurar:

```text
RenderPass → [Bloom?] → [DoF?] → [AO?] → [grading/CA/grain ShaderPass'leri?]
           → [OutlinePass — yalnız editör] → OutputPass
```

- **Pass sırası önemli:** AO/DoF beauty'ye yakın; bloom ondan sonra; renk
  düzeltme/vignette/grain genelde sona yakın; **OutlinePass editöre özel ve
  OutputPass'ten hemen önce**; **OutputPass her zaman en sonda** (tonemapping +
  sRGB).
- **Editör entegrasyonu:** `EditorSelectionOutline`'ın kendi composer'ı yerine,
  paylaşılan boru hattına bir OutlinePass enjekte edecek şekilde refaktör edilir
  (ya da boru hattı opsiyonel bir "outline target sink" sunar). Amaç: editörde
  **tek composer** hem PP hem outline'ı taşısın.
- **Runtime entegrasyonu:** `RuntimeSceneApp.start` içindeki düz
  `renderer.render` yerine, PP aktörü varsa `pipeline.render(delta)` çağrılır;
  yoksa düz render korunur (sıfır maliyet).
- **Resize:** `composer.setSize` + her pass'in kendi `setSize`'ı viewport
  resize'ında çağrılmalı (editör + runtime resize yolları).
- **Settings → pass senkronu:** `applyPostProcess(resolved)` her commit'te
  zinciri yeniden kurar **veya** mevcut pass uniform'larını günceller. İlk sürüm
  için "enabled set'i değişince yeniden kur, değer değişince uniform güncelle"
  yeterli.

---

## Checklist

Durum: `[ ]` yapılmadı · `[~]` kısmi · `[x]` tamam

### Faz 0 — Araştırma & Karar (bu doküman)

- [x] Unreal Post Process dokümanını incele ve özetle (Bölüm A)
- [x] Forge render hattı durumu: editör composer'lı / runtime düz render; tone
      mapping Sky'da; eldeki Three.js pass'leri (Bölüm B)
- [x] Kapsam/eşleme (Bölüm C) ve mimari karar (Bölüm D)
- [x] Temel refaktör planı: paylaşılan composer boru hattı (Bölüm E)
- [x] **Kullanıcı onayı (2026-06-20):** **tek global singleton** + **Faz 1 =
      yalnızca Exposure + Tonemapper** (composer'sız). Bloom/Vignette/Saturation
      ve composer refaktörü Faz 2'ye alındı.

---

### Faz 1 — Exposure + Tonemapper (MVP, composer'sız)

**Hedef:** `Add Actor → Visual Effects → Post Process` ile eklenen; **Exposure +
Tonemapper** alanlı; editör ve Play'de **aynı görünen**, undo/save/Details'lı tam
singleton aktör. Composer **gerekmez** — yalnızca `renderer.toneMapping` /
`toneMappingExposure` set edilir ve Sky ile sahiplik çakışması çözülür.

#### F1.1 — Model (render-agnostik)

- [x] `engine/scene/postProcess.ts`: `ResolvedPostProcess` (`name`, `hidden`,
      `exposure`, `toneMapping`)
- [x] `POST_PROCESS_DEFAULTS` (nötr: `exposure:1`, `toneMapping:"aces"`)
- [x] `resolvePostProcess(actor)` — `resolveSkyAtmosphere` ikizi

#### F1.2 — Render bağlama

- [x] `engine/render-three/postProcess.ts`: `applyPostProcessToneMapping(
      renderer, resolved | null)` → enum'a göre `toneMapping` + `exposure`; null/
      hidden'da bir şey yapmaz (sahiplik koordinasyonu Bölüm D.5)
- [x] Model + defaults re-export (Sky'ın render modülü deseni)

#### F1.3 — Layout tipi & persistans

- [x] `engine/scene/layout.ts`: `LayoutPostProcess` + `RoomLayout.postProcess?`
- [x] `tools/saveValidator.ts`: `validatePostProcess` (allowlist, exposure aralık
      reddi, `toneMapping` enum reddi, round-trip — `validateCloudLayer` deseni)
- [x] `validateLayout`'a `postProcess` bağlı (`vite.config.ts` zaten import eder)
- [x] CLAUDE.md allowlist gotcha notuna `postProcess` eklendi

#### F1.4 — Seçim & Outliner/Details VM

- [x] `editor/core/selection.ts`: `kind: "post"` (clone/encode/parse/equals +
      `PostSelection`)
- [x] `editor/core/sceneObjects.ts`: `POST_PROCESS_ASSET_ID`,
      `buildPostEditableSelection` (`category: "visual-effects"`, transform'suz)
- [x] `EditableSelection`'a `post?: EditablePostProcess` (+ tip)

#### F1.5 — SceneApp orkestrasyon (editör + ortak)

- [x] `applyPostProcess()` — `layout.postProcess` → tone mapping (Sky'dan **sonra**
      çağrılır; PP aktifse Sky'ın `applySkyToneMapping` sonucunu ezer, Bölüm D.5)
- [x] `addPostProcess()` / `removePostProcess()` / `setPostProcess(patch, label)`
- [x] `commitPostProcess(next, label)` — tek undoable mutasyon (`commitSky` ikizi)
- [x] `rename`/`setHidden`/`deleteSelected` + singleton dalları `kind: "post"`

#### F1.6 — Runtime bağlama

- [x] `RuntimeSceneApp.applyRuntimePostProcess()` yükleme yolunda tone mapping'i
      uyguluyor; Play editörle birebir aynı (Sky çakışması çözülmüş)

#### F1.7 — Editör UI

- [x] "Visual Effects" başlığına `<button data-add-post-process>Post Process</button>`
- [x] Tıkla-ekle bağlaması (`addPostProcess()`), Sky handler ikizi — drag yok
- [x] `renderPostDetails(selection)`: name, exposure, tonemapper (aces/neutral/
      none) + `setPostProcess` bağlamaları
- [x] `renderDetails` içinde `selection.kind === "post"` dalı
- [x] Outliner harfi `kind === "post"` → "P"

#### F1.8 — Test & doğrulama

- [x] `tools/engine-tests.ts`: `resolvePostProcess` defaults; tone mapping/
      exposure sahipliği — **PP varken Sky'ı ezer, PP yokken Sky yönetir** testi
- [x] Save round-trip testi (`validatePostProcess` + `validateLayout`; alanlar
      düşmüyor, enum dışı `toneMapping` reddediliyor)
- [x] `npx tsc --noEmit` temiz; `node tools/run-engine-tests.mjs` yeşil
- [x] Manuel akış (tarayıcı): Add → Details (exposure/tonemapper) → Play'de aynı →
      Save/Reload → Undo/Redo → Delete *(dev sunucusu playground.json'u autosave
      ile yeniden yazdığından elle test kullanıcıya bırakılır)*

---

### Faz 2 — Composer + Pass-tabanlı Efektler — *gerekirse*

**Hedef:** Önce paylaşılan composer boru hattı (Bölüm E), ardından Bloom +
Vignette + temel grading (saturation/contrast); sonra DoF, Chromatic Aberration,
Film Grain, AO ve F2.5'te anti-alias. Bölgesel grading (shadows/midtones/
highlights lift/gamma/gain) iptal edildi; F2.6 test/doğrulama anti-alias'tan
sonra yapılacak.

#### F2.0 — Paylaşılan composer boru hattı (Bölüm E — önce bu)

- [x] `engine/render-three/postProcess.ts`'e composer kurucu: `RenderPass …
      OutputPass`, efekt `enabled` set'ine göre ara pass ekleme
- [x] `EditorSelectionOutline` paylaşılan boru hattına OutlinePass enjekte edecek
      şekilde refaktör (editörde tek composer)
- [x] `RuntimeSceneApp.start`: composer'lı efekt aktifse `pipeline.render`, değilse
      düz render
- [x] Resize yolu: editör + runtime `setSize` boru hattına bağlı
- [x] Composer'lı efekt yokken davranış birebir korunuyor (editör outline + Faz 1
      tone mapping yolu)

#### F2.1 — İlk pass efektleri (onaylı set: Bloom, Vignette, Saturation/Contrast)

- [x] **Bloom** (`UnrealBloomPass`): `bloom{enabled,threshold,intensity,radius}`,
      100u ölçeğine ayarlı + Details + validator
- [x] **Vignette** (`ShaderPass`+`VignetteShader`): `vignette{enabled,intensity,
      offset}` + Details + validator
- [x] **Saturation/Contrast** (ColorCorrection tarzı grading shader):
      `saturation`, `contrast` + Details + validator

#### F2.2 — Sonraki onaylı set (CA + Grain + White Balance + DoF)

Mevcut çekirdeğe (Bloom/Vignette/Saturation/Contrast) eklenecek, "tam paket"
hissini tamamlayan düşük-maliyetli üçlü + en büyük eksik DoF (2026-06-20 onaylı).

- [x] **Chromatic Aberration** (`RGBShiftShader` ShaderPass):
      `chromaticAberration{enabled,amount}` + Details + validator (amount ×0.01
      ölçek; nötr 0.5 → RGBShift varsayılan 0.005)
- [x] **Film Grain** (`FilmPass`, yalnız gren — three r150+ FilmShader scanline'sız):
      `grain{enabled,intensity}` (0..1, doğrudan) + Details + validator
- [x] **White Balance** (grading shader'a temp/tint uniform): `temperature`,
      `tint` (Saturation/Contrast grading pass'ine eklendi; nötr 0, aralık -1..1) +
      Details + validator. Grading pass artık temp/tint ≠ 0 iken de zincire girer.
- [x] **Depth of Field** (`BokehPass`): `dof{enabled,focusDistance,aperture,
      maxBlur}`, 100u ölçeğine tune (focusDistance dünya birimi; aperture ×0.0002,
      maxBlur ×0.01) + Details + validator. **DoF + BokehPass `scene`+`camera`
      gerektirdiğinden `createPostProcessEffectPasses(resolved, {scene,camera,
      width,height})` fabrikası bu oturumda genişletildi** (F2.4 AO bunu hazır
      bulur). `bokehPass.setSize` pass kurulurken + composer resize'ında çağrılır.

#### F2.3 — Bloom kalitesi (karar: global bloom korunuyor)

> **Geçmiş:** Güneşin bloom blowout'unu önlemek için **selective bloom** (sky/cloud
> backdrop'ları hariç) denendi ve **geri alındı (2026-06-20)** — güneşin bloom'u,
> selective bloom'da kalan Sky-shader Mie halesinden **daha iyi görünüyor**. Karar:
> **global bloom** (güneş dahil her şey parlar) korunur.
> Emissive bloom'u görünür kılmak için yol, materyalin **emissive intensity**
> tavanını yükseltmek (mevcut cap 20; ~1000'e dek istenebilir).

- [ ] Emissive intensity cap'ini yükselt (MaterialEditor slider+input clamp +
      `saveValidator` `material.emissiveIntensity` aralığı) — örn. 0..1000
- [ ] (ileride, opsiyonel) Selective / per-object bloom layer — yalnızca istenirse
- [x] **Bölgesel grading iptal:** Bloom kalitesi kapsamında shadows/midtones/
      highlights lift/gamma/gain eklenmeyecek; global saturation/contrast +
      white-balance yeterli kabul edildi.
- [x] Anti-alias kapsamı ayrı F2.5 fazına taşındı.

#### F2.4 — Kalan opsiyonel pass efektleri

- [x] **Ambient Occlusion** (`GTAOPass`): `ao{enabled,radius,intensity}` → GTAO
      (SSAOPass/SAOPass yerine seçildi, 2026-06-22). **Durum:** boru hattı + UI +
      validator + testler tamam, ikon çerçevesi düzeldi **ve Play karakterinin
      siyah görünmesi sorunu ÇÖZÜLDÜ (2026-06-22)** — bkz. aşağıdaki "Çözüldü"
      notu. **Mimari not:** AO pass'i
      `scene` + `camera` ister; F2.2'de DoF için fabrika imzası zaten
      `createPostProcessEffectPasses(resolved, {scene,camera,width,height})`
      olarak genişletildi — AO `context.scene`/`context.camera`'yı doğrudan
      kullanır, ek imza değişikliği gerekmez. AO, RenderPass'ten hemen sonra,
      DoF/Bloom'dan **önce** girer; `radius` 100u far-plane ölçeğine tune edilir;
      resize'da `gtaoPass.setSize`. Faz-1 pattern ikizi: model alanı → `resolve` →
      fabrika → Details → `saveValidator` allowlist → engine-tests. **Runtime'da
      kullanıcı tarafından kapatılabilir** (maliyet yüksekse); o ayar UI'si
      **sonraki/ayrı iş** (ölçek dışı bırakıldı).
      **Yapıldı (2026-06-22):** `ao{enabled,radius,intensity}` modelden Details'a
      tüm katmanlarda kuruldu. `radius` authored ~1-tabanlı (0..4) →
      `AO_RADIUS_SCALE 0.5` ile dünya birimine (1 → 0.5u, GTAO'nun 0.25 default'unun
      2 katı); `intensity` (0..2) doğrudan `blendIntensity`. GTAOPass'in `render()`'ı
      projeksiyon matrislerini her kare kameradan kopyaladığı için FOV değişimi
      (sprint) güvenli; `setSize` yalnız resolution/RT + ilk projeksiyon için
      (kurulumda çağrılıyor). `tsc` temiz, 274 engine-test yeşil. Manuel tarayıcı
      doğrulaması (autosave nedeniyle) kullanıcıya bırakıldı.
      **Düzeltme (2026-06-22) — iki ayrı sorun:**
      1. **Editör ikon siyah çerçevesi:** GTAOPass normal+derinlik G-buffer'ını
         sahnenin tümünü materyal-override ile çizer; dahili görünürlük cull'ı
         yalnız Points/Line atlar, böylece editör billboard **Sprite** ikonları
         (light / Player Start "simge"leri) derinlik duvarı yaratıp siyah çerçeve
         veriyordu. `ForgeGtaoPass` (GTAOPass alt sınıfı) `_overrideVisibility`'i
         ezerek AO pass'inde Sprite + `userData.noAmbientOcclusion` nesnelerini de
         gizler (görünürlük base pass tarafından aynı karede, beauty RenderPass'ten
         sonra geri yüklenir). Gerçek geometri (karakter dahil) içeride kalır.
      2. **Editör ikon çerçevesi düzeldi** (Sprite hariç tutma çalışıyor).

      ### Çözüldü (2026-06-22) — Play karakteri AO ile siyah: eksik vertex normalleri

      **Belirtiydi:** Post Process → Ambient Occlusion açıkken Play modunda karakter
      (`character-a`, default pawn, `characterScale: 0.3`, ~0.5u boy) tamamen
      **siyah** render oluyordu; düz zemin ve gökyüzü normaldi.

      **Kök neden:** `character-a.glb`'nin 6 mesh primitive'inin **hiçbirinde NORMAL
      attribute'u yok** (yalnız `POSITION` + `TEXCOORD_0`). glTF spec'ine göre
      normal yokken `GLTFLoader` normalleri **hesaplamaz**; sadece materyali
      `flatShading = true` yapar (`assignFinalMaterial`, GLTFLoader satır ~3505).
      Flat shading yüzey normallerini fragment shader'da ekran-uzayı türevlerinden
      (`dFdx`/`dFdy`) üretir — bu yüzden **beauty render düzgün** görünür. Ama
      geometride hâlâ `normal` attribute'u yoktur. GTAOPass G-buffer'ını
      `MeshNormalMaterial` override ile çizer ve bu materyal **doğrudan `normal`
      attribute'unu** okur (flatShading kullanmaz). Attribute olmadığından normaller
      sıfır-uzunlukta çıkar → GTAO karakteri tam occluded hesaplar → beauty × AO(0)
      = **siyah**. Zemin/bloklar built-in geometriler (normalleri var) olduğu için
      etkilenmedi. `AO_RADIUS_SCALE` 0.1'in işe yaramaması da bunu doğrular: sorun
      ölçek değil, eksik normaldi.

      **Düzeltme:** `engine/render-three/models.ts` içine `ensureVertexNormals(root)`
      yardımcısı eklendi — `normal` attribute'u olmayan her renderable mesh
      geometrisine `computeVertexNormals()` uygular (idempotent; paylaşılan/klon
      geometriler normal varsa atlanır). `createCharacterSceneObject` (clone'dan
      önce) ve `createInstancedModelGroup` (instancing'den önce) çağırır, böylece
      hem editör hem runtime, hem karakter hem statik glTF mesh'leri kapsanır.
      `flatShading` materyali beauty görünümünü sürdürdüğünden **on-screen görünüm
      değişmez** (regresyon yok); AO override'ı artık geçerli (smooth) normaller
      okur. `tsc` temiz, 274 engine-test yeşil. Manuel tarayıcı doğrulaması
      (autosave nedeniyle) kullanıcıya bırakıldı.
- [x] **Bölgesel grading iptal:** shadows/midtones/highlights lift/gamma/gain
      F2.4'te yapılmayacak. Mevcut global saturation/contrast + temperature/tint
      grading yüzeyi korunur; ek bölgesel shader/UI/validator alanı açılmaz.

#### F2.5 — Anti-alias (SMAA)

**Karar:** İlk uygulama `SMAAPass`. Composer `samples` / multisampled render
target yolu yalnızca SMAA yetersiz kalırsa ayrı kalite deneyi olarak ele alınır.

- [x] Model: `LayoutPostProcess.antialias?: "none" | "smaa"` +
      `ResolvedPostProcess.antialias` default `"none"`
- [x] `resolvePostProcess` + `POST_PROCESS_DEFAULTS` + `validatePostProcess`
      allowlist/enum testi
- [x] Details UI: Post Process altında Anti-alias seçimi (`None` / `SMAA`)
- [x] Pipeline: `SMAAPass` final AA slot'u olarak eklenir; sıra editörde
      `RenderPass → efektler → OutlinePass → SMAAPass → OutputPass`, runtime'da
      `RenderPass → efektler → SMAAPass → OutputPass`
- [x] Resize/dispose: `SMAAPass.setSize(width,height)` ve `dispose()` pipeline
      lifecycle'ına bağlı
- [x] `hasPostProcessEffectPasses` anti-alias açıkken composer yolunu aktif eder;
      anti-alias kapalı ve diğer pass'ler nötrse runtime düz render yoluna döner
- [ ] Manuel kontrol: Play + editor kenarları, OutlinePass çizgileri, yüksek
      kontrastlı mesh kenarları ve performans/draw-call etkisi

#### F2.6 — Test & doğrulama

- [ ] Pass sırası + resize + dispose her efekt için doğrulanmış
- [ ] `tools/engine-tests.ts`: `applyPostProcess` enabled-set'e göre pass ekleme/
      çıkarma + her efekt lifecycle testi
- [ ] `npx tsc --noEmit` temiz + akış doğrulaması

---

### Faz 3 / Kapsam Dışı

- Auto Exposure / Eye Adaptation, Local Exposure (luminance histogram — pahalı)
- Motion Blur (velocity buffer altyapısı gerek)
- Lens Flare, Dirt Mask, Ambient Cubemap (görüntü/doku tabanlı)
- Lumen GI, SSGI, RT GI / Reflections / Translucency, Path Tracing (Three.js'te
  yok veya çok pahalı)
- Post Process Materials (kullanıcı custom-domain materyali)
- Fiziksel Camera (shutter/ISO/f-stop)
- Bounded Post Process Volume + blend weight / priority / blend radius
  (tek global singleton yeterli; çoklu hacim karışımı ertelendi)

---

## Kararlar

1. **Veri sahipliği:** PP = **layout singleton actor** (`RoomLayout.postProcess?`),
   tek global infinite-extent hacim gibi. Bounded volume + blend/priority kapsam
   dışı.
2. **Render boru hattı:** Composer hem editör hem runtime'da **paylaşılan tek
   yardımcıdan** kurulur (Bölüm E) — ama bu **Faz 2'nin ön koşulu**. **Faz 1
   composer gerektirmez** (yalnız renderer property). PP'nin Sky/Fog/Cloud'dan
   ayrıldığı tek yapısal nokta composer'dır; Faz 2'de oturur.
3. **Tone mapping/exposure:** PP yokken Sky sahiplenir (bugünkü davranış); PP
   varken PP sahiplenir. Tek koordinasyon noktası + test ile sabitlenir.
4. **Faz 1 efekt seti (onaylı):** yalnızca **Exposure + Tonemapper**. **Faz 2**:
   önce composer, sonra Bloom + Vignette + Saturation/Contrast (onaylı set),
   ardından DoF/CA/Grain/AO ve F2.5 anti-alias/SMAA. **Auto-exposure, motion blur,
   Lumen/RT/Path Tracing, çoklu hacim** kapsam dışı.
5. **Menü:** `Add Actor → Visual Effects` başlığında, Cloud Layer'ın yanında
   **"Post Process"**; Sky gibi tıkla-ekle (drag yok).
6. **Ölçek:** DoF/bloom/AO değerleri 100u far-plane ölçeğine göre ayarlanır.
7. **Bloom kalitesi (2026-06-20):** Selective bloom (sky/cloud hariç) denendi ve
   **geri alındı** — güneşin bloom'u Mie halesinden daha iyi. **Global bloom**
   (güneş dahil) korunur; emissive bloom için materyalin emissive intensity
   tavanı yükseltilir (F2.3).
8. **Ambient Occlusion (2026-06-22, onaylandı):** AO = **GTAOPass** (Ground Truth
   AO); SSAOPass/SAOPass yerine seçildi — en iyi kalite/gürültü dengesi, dahili
   denoise, yeni bağımlılık yok (`three/examples` içinde). Pass RenderPass'ten
   sonra, Bloom'dan **önce** girer; `scene`+`camera` gerektirdiğinden pass
   fabrikasına bu ikisi eklenir (mevcut ekran-uzayı pass'leri yalnız `size`
   alıyor). `radius` 100u far-plane ölçeğine göre tune edilir. **Runtime'da
   kullanıcı kapatabilir** (maliyet yüksekse) — o ayarlar UI'si **ayrı/sonraki
   iş**, bu PP entegrasyonunun kapsamında değil. PP işleri başka bir oturumda
   sırayla yapılacak.
9. **Bölgesel grading (2026-06-22):** shadows/midtones/highlights lift/gamma/gain
   iptal. Forge tarafında global saturation/contrast + temperature/tint yeterli
   kapsam olarak korunur.
10. **Anti-alias (2026-06-22):** sıradaki PP işi F2.5 SMAA toggle'dır. SMAA,
    editor OutlinePass'tan sonra ve `OutputPass`'tan önce çalışacak ayrı final-AA
    slot'u olarak tasarlanır; F2.6 test/doğrulama bunun ardından yapılır.
