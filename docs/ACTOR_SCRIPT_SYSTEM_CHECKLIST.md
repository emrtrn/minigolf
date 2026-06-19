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

## Kararlar (2026-06-19 netleşti)

Açık sorular, kullanıcı "uygula, sorma; gerekirse öneri geliştir" dediği için
şöyle karara bağlandı ve uygulandı:

1. **Görsel grafik vs. parametre listesi → parametre listesi.** Görsel node
   grafiği yok; event = `scriptId + params`, mantık TS'te (AI yazar).
2. **Format → `*.actor.json`.** Eski `*.script.json` stub'ı okunduğunda boş bir
   `actor` sınıfına normalize edilir.
3. **v1 parent class → 5'i de tipte tanımlı**, picker'da hepsi seçilebilir
   (Actor/Pawn/Character tam akış; Controller/GameMode iskelet — runtime
   farklılaşması Faz 7'de).
4. **Prefab/instance katmanı → ertelendi (Faz 7).** Önce authoring (sınıf-asset +
   editör + kaydet) tam çalışır; spawn sonraki adım.
5. **Behavior kod konumu → `src/game/behaviors.ts`** (katalog `BEHAVIOR_SCRIPT_IDS`
   olarak export edildi); `src/game/scripts/` opsiyonel olarak desteklenir.
6. **Construction Script → ertelendi** (`construction: null` rezerve).

## Uygulama Durumu (2026-06-19)

Authoring dikey kesiti **tamamlandı ve yeşil** (tsc temiz · build başarılı ·
175 engine check). Kullanılabilir akış: sağ tık → **Script** → Pick Parent Class
→ isim → `*.actor.json` · Content Browser'da çift tık → **Actor Script editörü**
(Components ağacı, My Blueprint Variables, Event Graph bindings, Details,
Compile/Save). Instance/spawn (Faz 7) tamamlandı: runtime + editör-içi sürükle-
bırak yerleştirme/seçim/gizmo/sil/undo + WYSIWYG mesh. **Faz 10 tamamlandı
(2026-06-19):** editör viewport'u artık gerçek 3D component-ağacı önizlemesi
(orbit kamera, mesh/collider/light/marker gizmo'ları, ağaç↔viewport seçim
senkronu, canlı rebuild, dispose hijyeni) — `src/editor/ActorScriptViewport.ts` +
saf `engine/scene/actorPreview.ts`. Kalan: per-instance override, behavior stub
üretimi (Faz 8).

İlgili commit'ler: veri modeli + content/save plumbing; editör (picker, overlay,
paneller).

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
- [x] Açık soruları karara bağla (yukarıdaki "Kararlar")

### Faz 1 — Veri Modeli (engine + validator)

- [x] `ParentClass` tipi: `actor | pawn | character | playerController | gameMode`
- [x] `ActorScriptDef` tipi: `parentClass`, `variables[]`, `components[]`,
      `eventBindings[]`, `construction` (engine, three.js'siz — `engine/scene/actorScript.ts`)
- [x] `ActorEventKind`: `beginPlay | tick | overlap | hit | interact` (sabit küme)
- [x] `EventBinding` tipi: `{ event, scriptId, params? }`
- [x] `ComponentTemplateNode` tipi: `{ id, parent?, component, props }`
- [x] `variables[]` için mevcut `MetadataFieldDef`'i yeniden kullan
- [x] `validateSaveActorPayload` + `normalizeActorScriptDef` (`tools/saveValidator.ts`)
- [x] Eski `type:"script"` stub'ını boş `actor` sınıfına normalize et (geriye uyum)
- [x] `tools/engine-tests.ts`: normalize + content-new + save payload testleri

### Faz 2 — Pick Parent Class diyalogu (sağ tık → Script)

- [x] `createContent`'te "Script" → isim prompt'undan önce **sınıf seçici modal**
      (Actor/Pawn/Character/Player Controller/Game Mode Base; ikon + açıklama)
- [x] Seçim → `createProjectContent({ kind:"script", parentClass, name })`
      (`ContentNewRequest`'e `parentClass` eklendi)
- [x] `contentStubJson` "script" dalı → seçilen `parentClass` ile `ActorScriptDef`
      iskeleti + `.actor.json` uzantısı (`graph:{}` kaldırıldı)
- [ ] (ertele) Actor/Scene **Component** sınıfı dalları

### Faz 3 — Actor Script Editör kabuğu (overlay + viewport)

- [x] `src/editor/ActorScriptEditor.ts` overlay doküman (StaticMeshEditor deseni,
      dinamik import, Esc kapat, tek editör)
- [x] Content Browser `*.actor.json` kartına `dblclick` → editörü aç (+ "BP" rozeti)
- [x] Viewport: gerçek 3D component-ağacı önizlemesi (**Faz 10**'da tamamlandı;
      placeholder kart kaldırıldı)
- [x] Orbit/pan/dolly kamera (**Faz 10.1**)
- [x] Başlık = sınıf adı + parentClass rozeti; dinamik import ile DEV-gate

### Faz 4 — Components paneli (şablon ağacı)

- [x] Sol panelde component **parent-child ağacı** (root = Transform, silinemez)
- [x] `+ Add` menüsü: Forge component seti (`MeshRenderer`, `Collider`, `Audio`,
      `ParticleEmitter`, `Light`, `Interaction`, `Behavior`)
- [x] Component seçimi → Details'ta form (id/parent/kind + **Mesh seçici** (model
      varlık açılır listesi → `assetId`) + **Transform alanları** (position/rotation/
      scale X/Y/Z) + katlanır **ham props JSON** editörü)
- [x] Viewport'ta component önizleme (mesh/collider/light gizmo'ları) (**Faz 10.2–10.3**)
- [ ] (ertele) Add menüsünü roadmap kategorileriyle (Movement/Camera/Spring Arm…)

### Faz 5 — Event Bindings + Variables + Details

- [x] **Event Bindings** paneli: `event` dropdown + `scriptId` (datalist + serbest
      metin) + `params` JSON editörü
- [x] `scriptId` önerileri `BEHAVIOR_SCRIPT_IDS`'ten; çözülemeyen id Compile'da uyarı
- [x] **Variables** editörü: `MetadataFieldDef` ekle/sil/düzenle (key/label/type/default/options)
- [x] Details paneli seçime göre (class / component / variable / event)
- [ ] (ertele) **Construction Script** hook'u (editör-zamanı TS)

### Faz 6 — Toolbar (Compile / Save / Browse / Play)

- [x] **Save / Ctrl+S** → `/__save-actor`
- [x] **Compile** = validate: benzersiz id'ler, parent referansları, döngü yok,
      benzersiz değişken key, boş olmayan scriptId; sonuç toolbar'da + footer'da
- [~] **Browse** → şimdilik statü mesajı (kart seçme/vurgu sonra)
- [ ] **Play** → Play moduna gir (instance/spawn sonrası)

### Faz 7 — Instance/Spawn katmanı (sınıf → level)

Runtime yarısı (veri modeli + spawn/render/behavior) **bitti ve gate yeşil**
(tsc temiz · 181 engine check · build başarılı). **Slice 3 — editör-içi
yerleştirme de tamamlandı (2026-06-19):** kullanıcı kararı **tam kapsam** (sürükle/
yerleştir + seç + gizmo + sil + undo/redo) ve **gerçek mesh (WYSIWYG)** —
RuntimeSceneApp'in classRef çözme/mesh yükleme mantığı SceneApp'e taşındı,
mesh'siz logic/trigger actor'lar için placeholder marker render edilir.
Per-instance override hâlâ ertelenmiş durumda.

- [x] Level/layout instance şeması: `LayoutActorInstance { classRef, transform,
      hierarchy/flags }` (`engine/scene/layout.ts`) + `RoomLayout.actors?`.
      `overrides` ertelendi.
- [x] Content'ten `*.actor.json` sürükle/yerleştir → level'a class instance
      (drop pipeline `editor/input/bindings.ts`'e `application/x-forge-actor-class`
      payload'ı + `onActorClassDrop` eklendi; editör seçim union'ına `actor` türü
      eklendi (`editor/core/selection.ts`); `SceneApp.addActorAt` sınıfı çözer +
      mesh'i yükler + undoable yerleştirir + seçer; `*.actor.json` kartları
      sürüklenebilir (classRef = public-relative yol))
- [x] Runtime spawn: sınıfı çöz → component'ler + event binding'leri → entity
      (saf `actorInstanceToEntity`, `engine/scene/actorInstance.ts`);
      `RuntimeSceneApp` classRef'leri çözer (cache'li), mesh modellerini yükler,
      tek-Object3D (character) render yolunu yeniden kullanır, entity'leri sahne
      dokümanına ekleyip `physics`/`behavior.setEntities` ile bağlar; `actor:<i>`
      transform-sync render yoluna eklendi.
- [x] Save validator allowlist: `classRef` + transform alanları (`validateActorInstance`)
      + `validateLayout`'ta `actors[]` (`tools/saveValidator.ts`). `overrides` ertelendi.
- [ ] (ertele) per-instance `overrides` (variable/component override) UI'si

**v1 collapse kararları (dokümante, gözden kaçma değil):** Forge entity'leri düz
(tip başına tek component) → actor component *ağacı* tek entity'ye çöker (her
türden ilk node kazanır); instance world transform'u otoriter (root Transform
node props'u yok sayılır); event binding'ler tek Behavior'a çöker (ilk binding,
yoksa bir `Behavior` component node'u). Çoklu-behavior / çoklu-node hiyerarşi +
procedural `shape:<type>` actor mesh'i + actor parent hiyerarşisi → B4/sonraki.

### Faz 8 — AI kod yolu (behavior stub)

- [x] `BEHAVIOR_SCRIPT_IDS` kataloğu export edildi (`src/game/behaviors.ts`); editör önerilerde kullanır
- [~] Details'ta "scriptId → src/game TS behavior'ı yaz/kaydet" sözleşme notu var
- [ ] Editörde "Yeni Behavior" → `src/game/scripts/<name>.ts` stub yolu + imza üretimi
- [ ] Doküman: "AI ile behavior yazma" akışı (CLAUDE.md / bu doküman)

### Faz 9 — Test & Doküman

- [x] `tools/engine-tests.ts`: normalize/coerce + content-new + save payload (175 check)
- [x] Save payload normalize testi (bozuk gövde güvenli default'a düşüyor)
- [x] `npx tsc --noEmit` temiz · `npm run build` başarılı
- [x] `docs/UNREAL_BASICS_LESSONS.md` Progress Log'a giriş
- [x] Uçtan uca: sağ tık → sınıf seç → editör → component+değişken+event → kaydet
      → Content'ten level'a sürükle-bırak → seç/taşı/sil/undo → Play'de spawn
      (✓). Kalan uç: per-instance override authoring.

### Faz 10 — Actor Script Editör 3D Viewport (component-ağacı önizleme)

> Amaç: `ActorScriptEditor`'daki **placeholder kartı** (bugün `renderViewport()`
> "3D preview coming soon" yazan statik HTML basıyor), sınıfın **component
> ağacını canlı render eden, orbit'lenebilir** gerçek bir 3D viewport ile
> değiştirmek. Desen `src/editor/StaticMeshEditor.ts`'in izole viewport'unu izler
> (kendi `WebGLRenderer` + `PerspectiveCamera` + `Scene` + grid + ışık + spherical
> orbit + render döngüsü + dispose). **Editör-only**: tüm kod `src/editor/` altında,
> `?editor` dinamik importu arkasında (game bundle'a girmez).
>
> **Tasarım kararı:** Bu viewport bir **read-only önizlemedir**; component
> transform'ları/props'ları Details panelinden düzenlenir (viewport'ta zorunlu
> gizmo yok — 10.4'teki opsiyonel viewport-seçimi hariç). Runtime'ın v1 "flat
> entity" collapse'ından **bağımsızdır**: editör önizlemesi component ağacının
> _tamamını_ (çoklu node + parent-child) gösterir.
>
> **Yeniden kullanım noktaları:** `StaticMeshEditor.buildScene/bindCameraControls/
> updateCamera/startRenderLoop/resize/dispose` deseni; mesh için `AssetLoader`
> (`loadModels`) + `createCharacterSceneObject`/clone; collider için
> `@engine/render-three/collisionView` (`collisionWireboxes`) /
> `colliderBoxFromBounds`; ışık için `@engine/render-three/lights` helper'ları.

#### Slice 10.1 — Viewport altyapısı (placeholder → gerçek sahne)

- [x] Ayrı `src/editor/ActorScriptViewport.ts`: kendi `WebGLRenderer` +
      `PerspectiveCamera` + `Scene` (bg + `AmbientLight` + 2 `DirectionalLight`
      + `GridHelper` + bir `modelGroup`); editör onu dinamik import arkasından kurar
- [x] `renderViewport()` placeholder kartını canvas + render döngüsü ile değiştirir
      (`startRenderLoop` + `ResizeObserver` + `resize`)
- [x] Orbit/pan/dolly kamera (`spherical` + `target` deseni; sol=orbit, MMB/Shift/sağ=pan, tekerlek=dolly)
- [x] Editör kapanışında **dispose**: `renderer.dispose`, build kaynaklarının
      (geometri/materyal/texture/light-gizmo) + cache'li GLTF temizliği, RAF iptali,
      observer disconnect (editörün `dispose()` yoluna bağlı)
- [x] Boş/derlenmemiş sınıfta zarif boş durum (grid + ışık + küçük ipucu rozeti)
- Gate: `tsc` temiz · `build` başarılı.

#### Slice 10.2 — Component ağacını sahneye derle (transform hiyerarşisi + mesh)

- [x] `def.components` → three `Object3D` ağacı; `ComponentTemplateNode.parent` ile
      parent-child kurulur (her node bir `Group`), her node'un `props`
      position/rotation/scale'i local transform olarak uygulanır + parent zinciri
      boyunca three sahne grafiği compose eder
- [x] `MeshRenderer` node → `assetId` modelini yükle (kendi `GLTFLoader`'ı +
      `MeshoptDecoder`, path-cache'li) + clone; eksik/yüklenemeyen/`shape:`/path'siz
      assetId → placeholder kutu (önce placeholder, model gelince değişir)
- [x] Birden çok aynı-tip node desteklenir (runtime'da ilk-kazanır; **önizlemede
      hepsi** görünür — editör gerçek ağacı gösterir)
- [x] Saf dönüşüm yardımcısı: `actorPreviewNodes(def)` → preview node listesi
      (three.js'siz, `engine/scene/actorPreview.ts`; headless test edilir)
- Gate: `tsc` · `build` · görsel: `door` mesh'li `ZZ_SmokeBP` açılınca kapıyı gösterir.

#### Slice 10.3 — Görsel-olmayan / yardımcı component gizmo'ları

- [x] `Collider` node → shape'e göre wireframe (box/sphere/capsule≈sphere/
      cylinder/cone); `isSensor` farklı renk; `size`/`center`/`rotation` props'tan
- [x] `Light` node → ışık + reach wireframe gizmo (engine `lights` helper'ları:
      `createLightObject`/`buildLightGizmo`/`disposeLightGizmo`)
- [x] `ParticleEmitter` node → glyph billboard sprite marker
- [x] `Audio`/`Interaction`/`Behavior`/`Metadata` → glyph ikon sprite marker
- Gate: `tsc` · `build` · görsel: collider+light içeren sınıf gizmo'ları gösterir.

#### Slice 10.4 — Ağaç ↔ viewport seçim senkronu

- [x] Sol Components ağacında bir node seçince viewport'ta eşleşen objeyi **vurgula**
      (`BoxHelper`; node id → `Group` map, her kare `update()` ile takip)
- [x] Seçili node'un props transform'unu Details'tan düzenleyince viewport **canlı**
      güncellenir (debounce'lu rebuild + re-highlight)
- [x] Viewport'ta tıklayınca ağaç node'unu seç (raycast → `userData.nodeId`)
- Gate: `tsc` · `build` · görsel: ağaçtan seçim viewport'ta vurgulanır.

#### Slice 10.5 — Canlı güncelleme + perf/lifecycle

- [x] `def` değişince (component ekle/sil, props/mesh `assetId` düzenle) viewport'u
      yeniden derle (tam rebuild; component-ağacı imzası değişmedikçe atlanır,
      seçim-değişimi rebuild tetiklemez)
- [x] Model yükleme path-cache'li + lazy (yalnızca mesh node'u için); render döngüsü
      editör kapanınca (`dispose`) durur — overlay tam-ekran olduğu için "gizliyken" durumu yok
- [x] Geometri/materyal/texture/light-gizmo dispose hijyeni (her rebuild + editör
      kapanışı); clone'lanan model kaynakları paylaşımlı → sadece detach, cache teardown'da bir kez dispose
- Gate: `tsc` · `build`.

#### Slice 10.6 — Test & doküman

- [x] Headless test: `actorPreviewNodes` dönüşümü (parent-child korunur + per-node
      transform + mesh/collider/light payload + bozuk props default'ları + bare class)
- [x] Bu checklist + `docs/UNREAL_BASICS_LESSONS.md` Progress Log güncellenir
- Gate: `tsc` · `npm run test:engine` · `build`.

**Notlar / sınırlar:**

- Faz 3 (`[~]` viewport placeholder, `[ ]` orbit kamera) ve Faz 4 (`[ ]` component
  önizleme) maddeleri buraya taşındı/genişletildi.
- Skeletal mesh animasyonu, gerçek malzeme/UVW sidecar uygulaması, gölge kalitesi
  **kapsam dışı** (önizleme statik + temel ışık). Construction Script önizlemesi
  Faz 5'e bağlı, ertelenmiş.
