# Actor Script (Blueprint) Sistemi — Rapor & Checklist

> Tarih: 2026-06-19
> Amaç: Content Browser'da sağ tık → **Script** akışını, Unreal'ın **Pick Parent
> Class** diyalogu + **Actor Blueprint Editörü** modeline karşılık gelen, Forge'a
> uygun bir **Actor Script (sınıf/prefab) sistemine** dönüştürmek.
>
> **Temel felsefe (kullanıcı yönü):** Bizim "Blueprint"imiz **görsel node
> grafiği değildir**. Editör, Unreal mimarisinin _ayrımlarını_ (sınıf ≠ instance,
> component ağacı, değişkenler, event'ler, default'lar) **veri** olarak modeller
> ve **parametreleri** yüzeye çıkarır. Asıl çalışma mantığı (kod) tamamen VS Code
> AI eklentileri (Claude/Codex) üzerinden TypeScript olarak yazılır; AI sistemi
> kurar ve parametreleri ortaya koyar, kullanıcı parametreleri değiştirerek
> istediği davranışı elde eder. Yani: **Unreal mimarisi + AI ile serbest kod.**
>
> Bu doküman önce Unreal modelini özetler (Bölüm A), Forge'un mevcut durumuyla
> eşler (Bölüm B), kapsam/eşleme kararını verir (Bölüm C), mimariyi sabitler
> (Bölüm D), ardından fazlı checklist'i sunar. `STATIC_MESH_COLLISION_EDITOR_
> CHECKLIST.md` ile aynı sözleşme formatını kullanır.

## Kaynaklar

- Kullanıcı brief'i: Pick Parent Class görseli + Actor Blueprint Editör paneli
  açıklamaları + Components "Add" menüsü kategorileri (konuşma ekleri).
- [Blueprints Visual Scripting](https://dev.epicgames.com/documentation/unreal-engine/blueprints-visual-scripting-in-unreal-engine)
- [Components in Unreal Engine](https://dev.epicgames.com/documentation/unreal-engine/components-in-unreal-engine)
- Forge kaynak: `engine/scene/components.ts`, `engine/behavior/behaviorSubsystem.ts`,
  `src/game/behaviors.ts`, `src/game/gameModes/types.ts`,
  `engine/scene/metadataSchema.ts`, `src/editor/StaticMeshEditor.ts`,
  `src/editor/EditorUi.ts`, `tools/saveValidator.ts`, `vite.config.ts`.

---

## Bölüm A — Unreal Actor Blueprint Modeli (özet)

### A.1 Pick Parent Class (sınıf seçimi)

Sağ tık → Blueprint Class oluştururken bir **ebeveyn sınıf** seçilir:

| Sınıf | Anlamı |
| --- | --- |
| **Actor** | Dünyaya yerleştirilebilen/spawn edilebilen temel nesne |
| **Pawn** | Possess edilebilen, input alabilen aktör |
| **Character** | Yürüme/karakter hareket yeteneği olan Pawn |
| **Player Controller** | Bir Pawn'ı yöneten oyuncu aktörü |
| **Game Mode Base** | Oyun kurallarını/akışını tanımlar |
| **Actor Component** | Aktöre eklenebilen yeniden kullanılabilir bileşen |
| **Scene Component** | Transform taşıyan, sahne hiyerarşisine bağlanabilen component |

Önemli: Bir Blueprint bir **sınıf/şablondur** (reusable), yerleştirilmiş bir
instance değil. Tasarlanır → level'a defalarca spawn edilir.

### A.2 Actor Blueprint Editör panelleri

1. **Components** — aktörün parçalarının (mesh, collision, audio, light, AI…)
   hiyerarşik (Parent-Child) ağacı; `+ Add` ile eklenir.
2. **Viewport** — component'lerin 3D önizlemesi; taşı/döndür/ölçekle (W/E/R).
3. **Graph Editörleri** — görsel kodlama:
   - **Event Graph**: runtime mantığı (BeginPlay, Tick, Overlap…).
   - **Construction Script**: editörde / yerleştirmede, oyun başlamadan çalışan
     prosedürel kurulum.
4. **Details** — seçili component/değişken/node özellikleri (dinamik form).
5. **My Blueprint** — Graphs / Functions / Macros / **Variables** /
   **Event Dispatchers** kütüphanesi.
6. **Toolbar** — **Compile**, **Save**, **Browse**, **Play**.
7. **Alt paneller** — Compiler Results, Find Results.

### A.3 Components "Add" menüsü (kategoriler)

Scripting, Common (Static/Skeletal Mesh, Scene, Audio, Collision şekilleri,
Light…), AI, Animation, Audio, Basic Shapes, Camera (+ Spring Arm), Physics,
Collision, Lights, **Movement** (Floating/Projectile/Rotating…), Navigation,
Rendering, UI (Widget), Custom (proje-özel component'lar).

---

## Bölüm B — Forge Mevcut Durum

Forge'da Unreal mimarisinin **çoğu ayrımı zaten kurulu** — eksik olan, bunları
bir **sınıf/prefab katmanı + sınıf seçici + Blueprint editör kabuğu** altında
birleştirmek.

### B.1 Var olanlar (yeniden kullanılacak temel)

- **Component modeli** (`engine/scene/components.ts`): `Transform`,
  `MeshRenderer`, `Light`, `Metadata`, **`Behavior`**, `Collider`, `Audio`,
  `ParticleEmitter`, `Interaction`. Her biri tipli `read*Component` okuyucusuna
  sahip. → "Components" panelinin veri tabanı.
- **Behavior sistemi** = Forge'un "Event Graph runtime"ı:
  - `BehaviorComponent { scriptId, params }` (`components.ts:52`).
  - `BehaviorRegistry` (`engine/behavior/behaviorSubsystem.ts:66`): `scriptId →
    update fn`. **Mantık koddadır**, veri değil.
  - `src/game/behaviors.ts:createBehaviorRegistry` kayıtlı id'ler: `spin`,
    `input-move`, `collision-chime`, `goal-reached`, `interact`. Her behavior
    `BehaviorContext` alır (engine tick, actions, physics, audio, transform,
    params). → **AI'nin TS kod yazıp kaydettiği yer tam olarak burası.**
- **Gameplay framework** (Unreal-inspired, hazır): `GameModeDefinition`,
  `PlayerControllerDefinition`, `PawnDefinition`, `PlayerState`, `GameState`
  (`src/game/gameModes/types.ts`). Pick Parent Class'ın Pawn/Controller/GameMode
  dalları bu tiplerle örtüşür.
- **Schema-driven Details/değişkenler** (`engine/scene/metadataSchema.ts`):
  `MetadataFieldDef` tipleri `text | number | boolean | select | tags`,
  gruplar, default'lar, `appliesTo`/`categories` filtreleri. Editör generic form
  render eder. → "My Blueprint → Variables" + "Details" formunun tam karşılığı.
- **Details'ta component ekleme** (`src/editor/EditorUi.ts:89`
  `ADDABLE_COMPONENTS`): `audio`, `behavior`, `particle`, `interaction`. → "Add
  Component" menüsünün çekirdeği (henüz kısıtlı).
- **Asset editör kabuğu precedent'i**: `src/editor/StaticMeshEditor.ts` — Content
  Browser'da **çift tıkla açılan tam-ekran overlay doküman**, dinamik `?editor`
  importunun arkasında, kendi viewport + toolbar + details paneliyle, `*.collision
  .json` sidecar'a kaydeden. → Blueprint Editör **birebir bu deseni izleyecek**.
- **Event Dispatcher analoğu**: `src/core/events.ts` `EventBus` — yorumda zaten
  "lightweight, code-only Event Dispatcher" olarak tanımlı.
- **Content "new" akışı**: `CONTENT_NEW_ITEMS` (`EditorUi.ts:74`) → `Script`
  dahil; `createContent` (`1496`) sadece isim sorar; `/__content-new` endpoint'i
  (`vite.config.ts:333`) `contentStubJson` (`tools/saveValidator.ts:813`) ile
  `<name>.<kind>.json` yazar.

### B.2 Mevcut "Script"in sınırı

Bugün sağ tık → **Script**, yalnızca şu stub'ı üretir
(`saveValidator.ts:818`):

```json
{ "schema": 1, "type": "script", "name": "<name>", "graph": {} }
```

- **Sınıf seçimi yok** (Actor/Pawn/Character… diyalogu yok).
- **Editör yok** (çift tık bir Blueprint editörü açmıyor; `graph: {}` ölü alan).
- **Sınıf/prefab katmanı yok**: bir "Actor Script" tanımlanıp level'a instance
  olarak spawn edilemiyor. Bugün level'lar doğrudan asset instance'ı + component
  yerleştiriyor (`Asset ≠ Actor` ayrımı henüz yarım — roadmap "Ana Sonuç").

### B.3 Eksikler (bu işin kapsamı)

1. **Pick Parent Class** diyalogu (sağ tık → Script).
2. **Actor Script sınıf-asset formatı** (`*.actor.json`): parentClass + component
   şablon ağacı + değişken şeması + default'lar + event binding'leri.
3. **Blueprint Editör overlay dokümanı** (StaticMeshEditor deseniyle).
4. **Component şablon ağacı** UI'si (parent-child, Add menüsü).
5. **Event Bindings** paneli ("Event Graph"in veri karşılığı).
6. **Instance/spawn katmanı**: level'da bir Actor Script'i referansla yerleştirme
   + per-instance override.
7. **Compile = validate** (referans edilen `scriptId`'ler registry'de çözülüyor
   mu, değişken tipleri tutuyor mu).

---

## Bölüm C — Eşleme & Kapsam Kararı

Forge web-first ve hafif; Unreal'ın görsel node VM'i kapsam dışı. **Faithful ama
veri-odaklı + AI-kod-odaklı** bir model.

| Unreal kavramı | Forge karşılığı | Karar |
| --- | --- | --- |
| Pick Parent Class diyalogu | Sağ tık → Script → sınıf seçici modal | **Al (öncelik)** |
| Parent Class: **Actor** | `parentClass: "actor"` | **Al** |
| Parent Class: **Pawn / Character** | `parentClass: "pawn"/"character"` → `PawnDefinition`/Character'la köprü | **Al** |
| Parent Class: **Player Controller / Game Mode Base** | `gameModes/` tipleriyle köprü | **Al (sadeleştir)** |
| Parent Class: **Actor / Scene Component** | Yeniden kullanılabilir component şablonu | **Faz 2'ye ertele** |
| Blueprint = sınıf/prefab (instance değil) | `*.actor.json` sınıf-asset + level'da `classRef` instance | **Al (öncelik)** |
| **Components** paneli + hiyerarşi | Component şablon ağacı (parent-child) | **Al** |
| Components "Add" menüsü (dev kategoriler) | Forge component seti + roadmap'ten süzme alt-küme | **Sadeleştir** |
| **Viewport** | StaticMeshEditor sahne/grid/ışık + ThumbnailRenderer payı | **Al** |
| **Event Graph (görsel node'lar)** | **Event Bindings listesi**: `event → scriptId + params`; mantık TS'te (`src/game/`), AI yazar | **Yeniden tanımla (görsel grafik YOK)** |
| **Construction Script** | Editör-zamanı construction hook'u (opsiyonel TS) | **Ertele (Faz 5)** |
| **Details** paneli | Mevcut schema-driven form (`metadataSchema`) yeniden kullanılır | **Al** |
| My Blueprint → **Variables** | Sınıf-başı değişken şeması (`MetadataFieldDef` tipleri) | **Al** |
| My Blueprint → **Functions** | Adlandırılmış behavior'lar (TS) | **Al (kod = AI)** |
| My Blueprint → **Macros** | — | **Atla** |
| My Blueprint → **Event Dispatchers** | `src/core/events.ts` `EventBus` | **Sadeleştir (sonra)** |
| Toolbar **Compile** | Validate: scriptId çözümü + değişken tip kontrolü | **Al (sadeleştir)** |
| Toolbar **Save / Browse / Play** | Sidecar yaz / Content'te bul / Play moduna gir | **Al** |
| Compiler Results / Find Results | Validate sonuç satırları (alt panel) | **Sadeleştir** |
| Görsel node VM / bytecode | (yok — kod TS, AI yazar) | **Atla** |

### C.1 Merkezi tasarım kararı — "Event Graph" yerine ne?

Unreal Event Graph'ı görsel bir VM'dir. Forge'da bunun yerine:

```jsonc
// *.actor.json içinde
"eventBindings": [
  { "event": "tick",       "scriptId": "spin",       "params": { "speedDeg": 90, "axis": "y" } },
  { "event": "beginPlay",  "scriptId": "input-move",  "params": { "speed": 3 } },
  { "event": "overlap",    "scriptId": "interact",    "params": { "action": "open-door" } }
]
```

- `event` küçük, sabit bir küme: `beginPlay | tick | overlap | hit | interact`
  (önce mevcut behavior tetikleyicileriyle birebir).
- `scriptId` → `BehaviorRegistry`'deki bir TS fonksiyonu. **AI bu fonksiyonu
  `src/game/behaviors.ts` (veya yeni `src/game/scripts/<name>.ts`) içine yazar
  ve registry'ye kaydeder.** Editör sadece `scriptId`'yi seçtirir, parametreleri
  şemadan render eder.
- Kullanıcı akışı: (1) editörde Actor Script + component'ler + değişkenler +
  event binding iskeletini kur, (2) "bana bunun `dash` davranışını yaz" de → AI
  VS Code'da TS behavior'ı yazıp kaydeder + param şemasını ortaya koyar, (3)
  kullanıcı Details'ta parametreleri ayarlar. Görsel grafik hiç çizilmez.

Bu, "Unreal mimarisi kullanıp AI ile serbest kod yazma" hedefinin somut halidir.

---

## Bölüm D — Mimari Kararlar

### D.1 Sınıf-asset formatı (`*.actor.json`)

`public/` kapsamında sidecar; StaticMesh'in `*.collision.json`'ı gibi. Taslak:

```jsonc
{
  "schema": 1,
  "type": "actor",
  "name": "DoorBP",
  "parentClass": "actor",          // actor | pawn | character | playerController | gameMode
  "variables": [                   // My Blueprint → Variables (MetadataFieldDef şeması)
    { "key": "openSpeed", "label": "Open Speed", "type": "number", "default": 2, "min": 0 }
  ],
  "components": [                   // Components paneli (parent-child ağaç)
    { "id": "root",  "component": "Transform", "props": {} },
    { "id": "mesh",  "parent": "root", "component": "MeshRenderer", "props": { "assetId": "door_01" } },
    { "id": "trig",  "parent": "root", "component": "Collider",     "props": { "shape": "box", "isSensor": true } }
  ],
  "eventBindings": [               // "Event Graph"in veri karşılığı
    { "event": "overlap", "scriptId": "interact", "params": { "action": "open-door" } }
  ],
  "construction": null            // Faz 5: editör-zamanı hook (opsiyonel)
}
```

- **Component props default'ları** mevcut `read*Component` tipleriyle aynı
  şekilde; runtime, instance spawn ederken bunları uygular.
- **Geriye dönük uyum**: eski `{ schema:1, type:"script", graph:{} }` stub'ı
  okunduğunda boş bir `actor` sınıfına normalize edilir (validator default'a
  düşer).

### D.2 Sınıf ≠ Instance (Forge'a prefab katmanı)

- `*.actor.json` = **sınıf** (template). Level (`*.level.json`/layout) bir
  **instance** yerleştirir: `{ classRef: "blueprints/DoorBP.actor.json",
  transform, overrides?: { variables?, components? } }`.
- Runtime spawn: sınıfı çöz → component'leri ve event binding'lerini kur →
  `BehaviorSubsystem.setEntities` zaten `BehaviorComponent`'ten türetiyor; sınıf
  her event binding'i bir Behavior'a derler.
- **İlk sürümde** override'sız, sadece "sınıfı yerleştir + spawn" yeterli;
  per-instance override sonraki faz.

### D.3 Blueprint Editör kabuğu

- Yeni `src/editor/ActorScriptEditor.ts` — **StaticMeshEditor desenini izler**:
  dinamik import (`?editor` arkası, game build'e girmez), tam-ekran overlay
  doküman, Esc ile kapanır, aynı anda tek editör.
- Paneller (v1): **Components** (sol ağaç + Add) · **Viewport** (StaticMesh
  sahne/ışık/grid payı) · **Details** (schema form yeniden kullanımı) · **Event
  Bindings** ("Event Graph" yerine liste) · **Toolbar** (Compile/Save/Browse/
  Play). **My Blueprint** v1'de Components+Variables+Events ağacına gömülebilir;
  ayrı panel sonra.
- Açılış: Content Browser'da `*.actor.json` kartına **çift tık** (StaticMesh'in
  `dblclick → openStaticMeshEditor` deseni; `EditorUi.ts`).

### D.4 AI entegrasyonu (kod yolu)

- Editör sadece **veri** üretir (`*.actor.json`) ve referans edilen `scriptId`
  için bir **TS behavior stub yolu** önerir (örn. `src/game/scripts/<name>.ts`).
- Asıl `BehaviorUpdate` fonksiyonunu **AI (Claude/Codex) yazar** ve
  `createBehaviorRegistry`'deki Map'e ekler. Sözleşme `BehaviorContext`
  (`behaviorSubsystem.ts:29`) — değişmez.
- **Compile** = davranış kodu derlemez; **validate** eder: her `eventBindings[]
  .scriptId` registry'de var mı, `params`/`variables` şema tiplerine uyuyor mu,
  component prop'ları `read*Component` ile geçerli mi. Sonuçlar alt panelde
  satır satır (Compiler Results analoğu).

### D.5 Editör core generic kalır

- Sınıf-asset/behavior **katalog'u proje/game verisidir**; editör core'u sadece
  generic form + ağaç + binding listesi render eder. Hangi event neyi yapar →
  game runtime/TS'te. (CLAUDE.md "editor core generic" kuralı.)
- **Bundle ayrımı**: `ActorScriptEditor` `src/editor/` altında, dinamik import
  arkasında.

### D.6 Persistans & save-validator gotcha'sı

- Yeni dev endpoint `/__save-actor` (StaticMesh'in `/__save-collision`/`/__save-
  uvw` deseni, `vite.config.ts`) **veya** oluşturmada mevcut `/__content-new`
  yeniden kullanılır; düzenleme kaydı için ayrı save yolu net.
- `validateActorScriptDef` + `normalizeActorScriptDef` (`tools/saveValidator.ts`),
  bozuk/eksik dosyayı güvenli default'a düşürür.
- **Allowlist gotcha**: level instance'ına eklenen her yeni alan (`classRef`,
  `overrides`…) `applyTransformFields`'e eklenmezse kayıtta **sessizce düşer**
  (CLAUDE.md). Faz 4 ile birlikte güncellenir.

---

## Checklist

Durum: `[ ]` yapılmadı · `[~]` kısmi · `[x]` tamam

Her `[x]` öncesi değişmez gate:

```bash
npx tsc --noEmit        # temiz
npm run test:engine     # tüm check'ler geçmeli
npm run build           # başarılı
```

### Faz 0 — Araştırma & Karar (bu doküman)

- [x] Unreal Blueprint/Components modelini özetle (Bölüm A)
- [x] Forge mevcut durumu çıkar (Bölüm B)
- [x] Kapsam/eşleme (Bölüm C) + mimari karar (Bölüm D)
- [ ] Açık soruları kullanıcıyla netleştir (aşağıdaki "Açık Sorular")

### Faz 1 — Veri Modeli (engine + validator)

- [ ] `ParentClass` tipi: `actor | pawn | character | playerController | gameMode`
- [ ] `ActorScriptDef` tipi: `parentClass`, `variables[]`, `components[]`,
      `eventBindings[]`, `construction?` (engine, three.js'siz)
- [ ] `ActorEventKind`: `beginPlay | tick | overlap | hit | interact` (sabit küme)
- [ ] `EventBinding` tipi: `{ event, scriptId, params? }`
- [ ] `ComponentTemplateNode` tipi: `{ id, parent?, component, props }`
- [ ] `variables[]` için mevcut `MetadataFieldDef`'i yeniden kullan
- [ ] `validateActorScriptDef` + `normalizeActorScriptDef` (`tools/saveValidator.ts`)
- [ ] Eski `type:"script"` stub'ını boş `actor` sınıfına normalize et (geriye uyum)
- [ ] `tools/engine-tests.ts`: tip okuma + normalize + round-trip testleri

### Faz 2 — Pick Parent Class diyalogu (sağ tık → Script)

- [ ] `openContentContextMenu`'da "Script" → isim prompt'u yerine **sınıf seçici
      modal** (Actor/Pawn/Character/Player Controller/Game Mode Base; görsele
      yakın ikon + açıklama)
- [ ] Seçim → `createProjectContent({ kind:"script", parentClass, name })`
      (`ContentNewRequest`'e `parentClass` ekle)
- [ ] `contentStubJson` "script" dalı → seçilen `parentClass` ile `ActorScriptDef`
      iskeleti yazar (`graph:{}` yerine)
- [ ] (ertele) Actor/Scene **Component** sınıfı dalları

### Faz 3 — Actor Script Editör kabuğu (overlay + viewport)

- [ ] `src/editor/ActorScriptEditor.ts` overlay doküman (StaticMeshEditor deseni,
      dinamik import, Esc kapat, tek editör)
- [ ] Content Browser `*.actor.json` kartına `dblclick` → editörü aç
- [ ] Viewport: grid + ışık + arkaplan (StaticMesh sahne kurulumu payı)
- [ ] Orbit/pan/dolly kamera (minimal inline controller payı)
- [ ] Başlık = sınıf adı + parentClass rozeti; production'da DEV-gate

### Faz 4 — Components paneli (şablon ağacı)

- [ ] Sol panelde component **parent-child ağacı** (root = Transform/Scene)
- [ ] `+ Add` menüsü: Forge component seti (`MeshRenderer`, `Collider`, `Audio`,
      `ParticleEmitter`, `Light`, `Interaction`, `Behavior`) kategorize
- [ ] Component seçimi → Details'ta prop formu (schema-driven form yeniden kullanımı)
- [ ] Viewport'ta component önizleme (mesh/collider/light gizmo'ları)
- [ ] (ertele) Add menüsünü roadmap kategorileriyle (Movement/Camera/Spring Arm…)
      genişlet

### Faz 5 — Event Bindings + Variables + Details

- [ ] **Event Bindings** paneli: `event` dropdown + `scriptId` dropdown (registry'den)
      + `params` formu (şema)
- [ ] `scriptId` listesi `BehaviorRegistry`'den dinamik; çözülemeyen id uyarısı
- [ ] **Variables** editörü: `MetadataFieldDef` ekle/sil/düzenle (key/label/type/default)
- [ ] Details paneli seçili öğeye göre (component / variable / event binding) form
- [ ] (ertele) **Construction Script** hook'u (editör-zamanı TS)

### Faz 6 — Toolbar (Compile / Save / Browse / Play)

- [ ] **Save / Ctrl+S** → `/__save-actor` (veya content-new save yolu)
- [ ] **Compile** = validate: scriptId çözümü + değişken/param tip kontrolü +
      component prop geçerliliği; sonuçlar alt panelde (Compiler Results analoğu)
- [ ] **Browse** → Content Browser'da dosyayı seç/vurgula
- [ ] **Play** → Play moduna gir (varsa test instance'ıyla)

### Faz 7 — Instance/Spawn katmanı (sınıf → level)

- [ ] Level/layout instance şeması: `{ classRef, transform, overrides? }`
- [ ] Content'ten `*.actor.json` sürükle/yerleştir → level'a class instance
- [ ] Runtime spawn: sınıfı çöz → component'ler + event binding'leri → entity;
      `BehaviorSubsystem.setEntities` ile bağla
- [ ] Save validator allowlist: `classRef`/`overrides` alanlarını `applyTransform
      Fields`'e ekle (yoksa sessizce düşer)
- [ ] (ertele) per-instance `overrides` (variable/component override) UI'si

### Faz 8 — AI kod yolu (behavior stub)

- [ ] Editörde "Yeni Behavior" → `src/game/scripts/<name>.ts` stub yolu önerisi +
      `BehaviorContext` imzası
- [ ] Stub'a beklenen `params` şemasını yorum olarak yaz (AI'ye sözleşme)
- [ ] `createBehaviorRegistry` Map'ine kayıt notu/yardımı
- [ ] Doküman: "AI ile behavior yazma" akışı (CLAUDE.md / bu doküman)

### Faz 9 — Test & Doküman

- [ ] `tools/engine-tests.ts`: ActorScriptDef + eventBinding + instance spawn testleri
- [ ] Save round-trip (yeni alanlar düşmüyor)
- [ ] `npx tsc --noEmit` temiz · `npm run build` başarılı
- [ ] `docs/UNREAL_BASICS_LESSONS.md` Progress Log'a giriş
- [ ] Uçtan uca akış: sağ tık → sınıf seç → editör → component+değişken+event →
      AI behavior yaz → kaydet → level'a yerleştir → Play'de çalış

---

## Açık Sorular (Faz 1 öncesi netleşmeli)

1. **Görsel grafik vs. parametre listesi:** Rapor, kullanıcı yönüne uyarak
   görsel node grafiği **yapmamayı**, event'i `scriptId + params` listesiyle
   modellemeyi öneriyor. Onaylanıyor mu, yoksa minimal bir görsel akış da
   isteniyor mu? **(Öneri: parametre listesi.)**
2. **Dosya uzantısı/format:** `*.actor.json` mı, `*.bp.json` / `*.script.json`
   mı? (Rapor `*.actor.json` öneriyor; mevcut `*.script.json` stub'ı normalize
   edilir.)
3. **v1 parent class kümesi:** Sadece **Actor + Pawn + Character** ile başlayıp
   Player Controller / Game Mode Base'i sonraya bırakalım mı?
4. **Prefab/instance katmanı (Faz 7):** Şimdi mi, yoksa önce tek-sınıf editör +
   doğrudan yerleştirme yeterli mi?
5. **Behavior kod konumu:** Yeni `src/game/scripts/<name>.ts` modülleri mi, yoksa
   her şey `src/game/behaviors.ts` içinde mi büyüsün?
6. **Construction Script:** İlk sürümde tamamen ertelensin mi (Faz 5 opsiyonel)?
