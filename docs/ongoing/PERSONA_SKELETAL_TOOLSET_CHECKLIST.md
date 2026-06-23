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
- [x] **Blend Space (data)**: 1D/2D blend noktaları tanımla (örn. hız →
      idle↔walk↔run sürekli harman) + viewport önizleme; runtime'da `AnimationMixer`
      ağırlıklarıyla harman. `blendSpaces` sidecar'a yazılır. (CrossfadeAnimator'ın
      "tek aktif klip" modelini çok-klip ağırlıklı harmana yükseltmenin authoring ucu;
      node-graph değil, saf data.)
      - Tip+çözümleyici [`assetSkeletonLoader.ts`](../../src/scene/assetSkeletonLoader.ts):
        `AssetSkeletonBlendSpaceDef` (1d/2d, axisX[/axisY], samples[]) +
        saf `resolveBlendSpaceWeights` (1D piecewise-linear, 2D normalize edilmiş
        ters-mesafe/Shepard; çakışan klip ağırlıkları birleşir). Normalize blendSpaces'i
        ayıklar (boş/yinelenen ad, alan-dışı/NaN örnekleri kırpar).
      - Authoring + önizleme [`SkeletalMeshEditor.ts`](../../src/editor/SkeletalMeshEditor.ts)
        Animation modunda: blend space ekle/sil/seç, ad/tip/eksen ad+min/max,
        örnek (klip+koordinat) ekle/sil, "Preview Blend" → eksen slider'ları
        `AnimationMixer` action ağırlıklarını canlı sürer (faz-senkron), yüzde okuması.
      - Save validator [`saveValidator.ts`](../../tools/saveValidator.ts):
        `validateBlendSpaces` (eksen/örnek tip kontrolü, 2D'de y zorunlu, yinelenen
        ad reddi). engine-tests: normalize + 1D/2D resolver + save round-trip.
      - **Runtime tüketimi (bağlandı):** `CrossfadeAnimator.playBlend` faz-senkron
        ağırlıklı oynatma (tek-klip yoluyla karşılıklı dışlayan); `src/game`'de saf
        `pickLocomotionBlendSpace` + `resolveLocomotionAnimation` (grounded+blend
        space → ağırlık, yoksa/airborne tek klip); `RuntimeSceneApp` karakter
        sidecar'larını ref'lere iliştirir; `tpsCharacterGameMode.updateAnimation`
        karara göre `playBlend`/`play`. Konvansiyon: 1D, ad "Locomotion" (yoksa ilk
        kullanılabilir 1D), X ekseni planar hız. Demo `character-a.skeleton.json`
        idle@0/walk@3/sprint@6 ile etkin.
      - **Anim-set rol haritası da bağlandı:** `resolveLocomotionClip` artık authored
        `animationSet`'i (rol→klip) önce kullanıyor (ROLE_FALLBACKS ile run→walk→idle,
        fall→jump→idle semantik zinciri), sonra eski klip-ismi sözlüğü heuristiği.
        Tek-klip fallback'i (airborne / blend space yok) keyfi klip isimli asset'lerde
        de doğru çalışır. `LocomotionAssetConfig` (blendSpace + animationSet) +
        `locomotionConfigForSkeleton` possess'te bir kez kurulur.

### Faz 3 — Animation Notifies + Montage-lite (ertelenmiş)

- [ ] Klip timeline'ında **notify** işaretleri ekle/düzenle (ayak sesi, hasar
      penceresi, efekt tetikleyici)
- [ ] `notifies[]` sidecar formatı + runtime'da notify yayını (event akışı)
- [~] **Montage-lite + Upper Body slot (runtime + editör authoring bağlandı; notify pending).**
      Unreal'in "Slot + Layered Blend Per Bone" mekaniğinin **veri** karşılığı kuruldu
      (node-graph yok). Şema: `*.skeleton.json` `montages[]`
      (`{name, clip, slot:"upperBody"|"fullBody", loop, blendIn/OutSeconds}`) +
      `upperBodyBone` (maske kökü). Engine: `bodyMask.splitClipsByUpperBody` (klibi
      node-subtree'ye göre alt/üst track'lere böler — skinned VEYA rigid rig),
      `LayeredCharacterAnimator` (iki kanal: alt=locomotion, üst=slot; üst normalde
      locomotion'ı yansıtır, montage/aim geçici sahiplenir; tek-atış montage
      `update(dt)` zamanlayıcısıyla aim/passthrough'a döner). Input:
      `PointerButtonSource` (Mouse0=fire, Mouse2=aim). Game mode
      `tpsCharacterGameMode`: `upperBodyBone` varsa layered, yoksa düz CrossfadeAnimator
      (geriye dönük). RMB→aim pozu (üst gövde), LMB→fire montage; **bacaklar yürürken
      üst gövde ateş eder**. Demo `character-a`: `torso` maske kökü, hazır
      `holding-both`(aim)/`holding-both-shoot`(fire) klipleri. **Editör authoring
      tamamlandı** (Adım 2 aşağıda): Skeleton mode'da Upper-Body Root seçimi (tüm
      named node'lardan, skinned VEYA rigid rig), Animation mode'da Montages bölümü
      (ad/clip/slot/loop/blendIn/Out CRUD, `fullBody` slot dahil). **Pending:** notify
      yayını, montage canlı önizleme (opsiyonel), kemik-başına yumuşak blend (şu an
      sert ayrım).
- [~] **Montage → input bağı: KOD katmanında, Player/Character'a ait (yön değişti).**
      Geçici olarak montage'a sidecar `trigger: {action, mode}` alanı + editör "Input
      Trigger" UI'ı eklenmişti; **kullanıcı mimari itirazıyla bu yaklaşım supersede
      edildi.** Gerekçe: input eşlemesi bir Character/kod sorumluluğudur, paylaşılan
      skeletal-mesh asset'i değil (aynı mesh bir NPC'ye verilirse "emote→Q" bağı
      anlamsızca taşınır). Forge'da axis mapping (look) ve action mapping (move/jump)
      zaten **kodda** (`DEFAULT_INPUT_BINDINGS`, key→action); montage→input de aynı
      desenle kodda çözülür. Unreal eşlemesi: skeletal mesh/AnimBP montage'ı *sağlar*
      (asset), Character BP input'la `PlayAnimMontage` *çağırır*.
      - **Korunan:** `tpsCharacterGameMode` genel hold/press montage döngüsü
        (`resolveMontageBindings`; ilk basılı hold kazanır, press tek-atış);
        `KeyQ → "emote"`; Skeletal Mesh Editor Montage authoring UI (klip/slot/loop/blend).
      - **Geri alınacak (ileride):** `*.skeleton.json` montage'ından `trigger` alanı
        (schema [`assetSkeletonLoader.ts`](../../src/scene/assetSkeletonLoader.ts),
        validator [`saveValidator.ts`](../../tools/saveValidator.ts), editör "Input
        Trigger" UI [`SkeletalMeshEditor.ts`](../../src/editor/SkeletalMeshEditor.ts),
        ilgili engine-tests). `MONTAGE_TRIGGER_MODES`/`MontageTriggerMode` (press/hold)
        nötr bir yerde tutulabilir (kod-map de aynı mode'u kullanır).
      - **Yeni hedef (ileride, kullanıcı istedikçe montage-başına):**
        (1) kod-map `src/game/montageInputBindings.ts` `action → {montage, mode}`;
        (2) `resolveMontageBindings` action→montage'ı sidecar trigger yerine kod-map'ten
        okur, klip/slot/blend'i `skeleton.montages`'tan ada göre çözer, aim/fire isim
        konvansiyonu geriye-dönük varsayılan kalır (kod-map çakışmada kazanır);
        (3) **Details salt-okunur gösterim:** ActorScriptEditor'da MeshRenderer node'unun
        altında (assetId bir `skeletalMesh` ise) mesh'in montage'larını + kod-map'i +
        `DEFAULT_INPUT_BINDINGS`'i okuyup `emote1 → emote → Q` zincirini listeler.
      - **İş akışı:** kullanıcı Skeletal Mesh Editor'da montage oluşturur → ajana
        "Player'a şu tuşu ata" der → ajan kod-map'e satır ekler → Details'te görünür.
      - **Kısıt (bugün):** çalıştırma yalnız `upperBody` slot + `upperBodyBone` authored
        karakterlerde (layered animator); `fullBody`/non-layered runtime pending.
      - Plan: `~/.claude/plans/twinkly-discovering-sprout.md`.
- [ ] (opsiyonel) Montage section'ları / basit branching — Animation Composite
      ihtiyacını da büyük ölçüde karşılar

#### ▶ SONRAKİ OTURUM — Adım 2: Editör Montage + Upper-Body Root Authoring UI

> Hedef: `*.skeleton.json` `montages[]` ve `upperBodyBone` alanlarını **elle JSON
> yazmadan**, `SkeletalMeshEditor` içinde görsel olarak yazmak. Runtime + şema +
> save validator ZATEN HAZIR (bu oturumda kuruldu); bu adım **yalnızca editör UI**.
> Yeni karakter authoring'i bundan sonra kullanıcıya geçer (bana sormaya gerek kalmaz).

**Bağlam / hazır olanlar (yeniden keşfetme):**

- Şema + persistans: [`assetSkeletonLoader.ts`](../../src/scene/assetSkeletonLoader.ts)
  `AssetSkeletonMontageDef` (`{name, clip, slot:"upperBody"|"fullBody", loop,
  blendInSeconds, blendOutSeconds}`), `MONTAGE_SLOTS`, `AssetSkeletonDef.upperBodyBone`.
  Store re-export'ları [`assetSkeletonStore.ts`](../../src/editor/assetSkeletonStore.ts)
  (`AssetSkeletonMontageDef`, `MontageSlot`, `MONTAGE_SLOTS` zaten dışa açık).
- Save validator (`tools/saveValidator.ts`) `validateMontages` + `upperBodyBone`
  zaten allowlist'te — yeni alan EKLEME yok, sadece UI `this.skeleton`'ı mutate edip
  mevcut `save()`'i çağırsın.
- **En yakın şablon = Blend Space UI** ([`SkeletalMeshEditor.ts`](../../src/editor/SkeletalMeshEditor.ts)):
  `renderBlendSpaceDetails` / `renderBlendSpaceEditor` / `bindBlendSpaceControls` +
  immutable mutator deseni (`replaceSelectedBlendSpace`, `markDirty`, `renderDetails`).
  Montage UI bunu birebir taklit etmeli. CSS: `editorUi.css` `sm-*` sınıfları.

**Yapılacaklar:**

- [x] **Upper-Body Root seçimi (Skeleton mode):** `renderSkeletonDetails` içinde ayrı
      bir **"Upper-Body Root"** section: mevcut değeri gösteren satır + tüm named
      node'lardan **Node dropdown** (`upperRootOptions`, eksik değeri "(missing)" gösterir)
      + seçili kemik varken **"Set … as Upper-Body Root"** kısayolu + **"Clear"**.
      `setUpperBodyBone` `this.skeleton.upperBodyBone`'ı mutate eder. Node listesi
      `collectModelInfo`'da toplanır (`this.nodeNames`) → **skinned VEYA rigid rig**
      (Kenney `character-a`'nın `torso`'su gibi Bone olmayan node'lar dahil) çalışır.
- [x] **Montages bölümü (Animation mode):** `renderMontageDetails` Blend Space desenini
      taklit eder: liste (ad/clip/slot/loop, eksik clip "(missing)"), **Add Montage**
      (default `{name:"montage", clip: ilk klip, slot:"upperBody", loop:false,
      blendIn:0.12, blendOut:0.2}`), seç → düzenle (ad text, clip dropdown=
      `blendSampleClipOptions` None'suz, slot select=`MONTAGE_SLOTS` `fullBody` dahil,
      loop checkbox, blendIn/Out text [0,4]'e kırpılır), sil. Yinelenen ad/boş ad UI'da
      uyarır (validator zaten atar).
- [ ] **(Opsiyonel) Montage önizleme:** ATLANDI (minimum sürüm). `LayeredCharacterAnimator`'ı
      editörde kurup iki mixer'ı render loop'ta ilerletmek gerekir; authoring blind
      yapılıyor (klip, Animation Clips listesinden tek-klip önizlenebilir). İleride eklenebilir.
- [x] **İpucu metni:** Montages section'ında game mode konvansiyonu hint'i — `upperBody`
      `"aim"` (held) + `"fire"` (one-shot) RMB/LMB'ye otomatik bağlanır. `upperBody`
      montage + `upperBodyBone` yokken editörde uyarı. (Editör generic kalır, kural
      zorlanmaz.)
- [x] **Gate:** `npx tsc --noEmit` temiz; `npm run test:engine` 296/296 yeşil. El ile
      Play doğrulaması (montage ekle→kaydet→runtime) kullanıcıya bırakıldı (dev server
      gerekir). engine-tests normalize/validate'i zaten kapsıyor (yeni saf mantık yok).

**Gotcha:** Montage `clip` dropdown'ı **None içermemeli** (boş clip save'de reddedilir);
Blend Space sample'larında çözdüğüm gibi `blendSampleClipOptions` desenini kullan.

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
5. **Montage → input bağı nerede yaşar? → KOD katmanı (Player/Character), asset değil.**
   (Karar: 2026-06-23.) Forge'da input eşlemesi bir Character/kod sorumluluğudur:
   axis mapping (look) + action mapping (move) zaten `DEFAULT_INPUT_BINDINGS`'te
   (kod). Montage→input de aynı desenle kodda çözülür — `*.skeleton.json` sidecar'ına
   gömülmez (paylaşılan mesh asset'i input intent'i taşımamalı; Unreal'de de Character
   BP `PlayAnimMontage` çağırır, skeletal mesh çağırmaz). Skeletal mesh yalnız montage
   **klip tanımı** sağlar; "hangi tuş hangi montajı oynatır" kod-map'te yaşar ve ajan
   montage-başına atar. Atanan tuşlar Details'te, Player'ın MeshRenderer (skeletal
   mesh) bileşeni altında salt-okunur gösterilir. Geçici eklenen sidecar `trigger`
   alanı bu kararla supersede edildi (geri alma + yeni hedef Faz 3'te listelendi).
   İlgili plan: `~/.claude/plans/twinkly-discovering-sprout.md`.
