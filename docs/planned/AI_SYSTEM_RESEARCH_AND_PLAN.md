# AI Sistemi Arastirmasi ve Forge Planı

> Tarih: 2026-06-29
> Durum: Gelecek faz plani. Kod uygulanmadi.
> Amac: Unreal Engine AI dokumanlarindaki temel sistemi inceleyip Forge icin
> uygulanabilir, data-driven ve editor/runtime sinirlarina uygun bir AI mimarisi
> tanimlamak.

## Kaynaklar

Bu dokuman resmi Unreal Engine dokumanlarina gore hazirlandi:

- Artificial Intelligence:
  https://dev.epicgames.com/documentation/unreal-engine/artificial-intelligence-in-unreal-engine
- AI Controllers:
  https://dev.epicgames.com/documentation/unreal-engine/ai-controllers-in-unreal-engine
- Behavior Trees:
  https://dev.epicgames.com/documentation/unreal-engine/behavior-trees-in-unreal-engine
- Behavior Tree Overview:
  https://dev.epicgames.com/documentation/unreal-engine/behavior-tree-in-unreal-engine---overview
- Behavior Tree Node Reference:
  https://dev.epicgames.com/documentation/unreal-engine/behavior-tree-node-reference-in-unreal-engine
- AI Perception:
  https://dev.epicgames.com/documentation/unreal-engine/ai-perception-in-unreal-engine
- Environment Query System:
  https://dev.epicgames.com/documentation/unreal-engine/environment-query-system-overview-in-unreal-engine
- Navigation System:
  https://dev.epicgames.com/documentation/unreal-engine/navigation-system-in-unreal-engine
- State Tree:
  https://dev.epicgames.com/documentation/unreal-engine/state-tree-in-unreal-engine
- Smart Objects:
  https://dev.epicgames.com/documentation/unreal-engine/smart-objects-in-unreal-engine

## Unreal AI sisteminin ozeti

Unreal tarafinda AI tek bir "zeka" sinifi degil, birkac katmanin beraber calismasi:

| Unreal kavrami | Ne is yapar | Forge karsiligi |
| --- | --- | --- |
| AIController | PlayerController gibi Pawn/Character possess eder; insan inputu yerine cevre ve oyun durumuna gore karar verir. | Runtime-only `AIController` session/instance. NPC pawn'ini possess eder, input yerine karar cikisi uretir. |
| Blackboard | Behavior Tree ve servislerin okudugu/yazdigi ajan hafizasi. | Agent basina typed `AiBlackboardState`; serialize edilen asset semasi ayridir, runtime degerleri layout'a yazilmaz. |
| Behavior Tree | Karar akisidir. Unreal'da event-driven calisir; Decorator/Service/Task ayrimi vardir. | Ilk versiyonda JSON asset + TypeScript task/action registry. Visual graph sonra. |
| Decorator | Dal calisabilir mi kararini verir. | Saf predicate: blackboard/world/perception/query okur. |
| Service | Dal aktifken periyodik check ve Blackboard update yapar. | Throttled evaluator: gorus, hedef mesafe, EQS sonucu, cooldown gibi verileri gunceller. |
| Task | Yapilacak eylem: move, wait, attack, set blackboard, send message. | `AiTask` registry. Hareket icin CharacterMovement/Nav, oyun eylemi icin `BehaviorContext.messages`. |
| AI Perception | Sight, hearing, damage gibi stimulus kaynaklarini dinler ve AI'ya veri verir. | `AiPerceptionSubsystem`: vision cone/raycast, hearing event, damage/gameplay stimulus. |
| EQS | Ortamdan aday nokta/actor toplar, testlerle skorlar, en uygun item'i dondurur. | `AiQuerySubsystem`: grid/ring/actor/tag generator + distance/visibility/nav-reachable tests. |
| Navigation System | Collision'dan nav mesh/graph uretir; ajanlar pathfinding ve avoidance kullanir. | Ilk etapta nav grid/waypoint graph; sonra Recast/Detour veya navmesh adapter. |
| StateTree | State machine + selector + evaluator + task tabanli daha genel AI akisi. | Behavior Tree'den sonra "AiStateTree" olarak boss/quest/civilian gibi uzun omurlu state mantigi. |
| Smart Objects | Level'a yerlestirilmis, ajanlarin query edip rezerve edebildigi kullanilabilir aktiviteler. | `SmartObjectComponent`: slot, tag, claim/release, interaction task. |

## Forge mevcut durum

- Runtime/editor ayrimi zaten net: `/` `RuntimeSceneApp`, `/?editor` `SceneApp`.
  AI runtime kodu editor import etmemeli.
- `BehaviorSubsystem` mevcut ve actor'leri `BehaviorComponent` uzerinden tick ediyor.
  `BehaviorContext` icinde `messages`, `world`, `state`, `physics`, `audio`,
  `interactionComponent` gibi AI davranislari icin kullanilabilir yuzeyler var.
- Actor Script sistemi Unreal Actor Blueprint benzeri: parent class, component
  template, event binding, reference/interface/message binding tasiyor.
- Game Mode, PlayerController, Pawn/Character ve CharacterMovement hattı artik
  runtime tarafinda birinci sinif. AIController bu hattin dogal devamidir.
- `RuntimeSceneApp` input, physics, behavior, audio, animation ve UI subsystem
  orkestrasyonunu zaten yapiyor. AI sisteminin runtime insertion point'i burasi
  olmalidir, editor tarafina karar mantigi konmamalidir.
- Mevcut `BehaviorSubsystem`, kucuk script davranislari icin yeterli; fakat uzun
  omurlu NPC karari, hedef secimi, path takip, algi hafizasi ve debug icin ayri
  bir `AISubsystem` gerekir.

## Forge icin temel mimari karari

Forge AI sistemi Unreal'i birebir kopyalamamali. Dogru yaklasim:

- Data asset'ler Unreal ilhamli olsun: `*.blackboard.json`, `*.behavior.json`,
  ileride `*.stateTree.json`, `*.eqs.json`.
- Runtime generic engine katmani DOM/Three/editor bagimsiz olsun:
  `engine/ai/*`, `engine/navigation/*`, `engine/perception/*` gibi.
- Oyun-spesifik eylemler `src/game/ai/*` veya `src/game/scripts/*` altinda
  TypeScript olarak yazilsin; editor sadece bu asset ve parametreleri author etsin.
- Ilk fazda visual node editor yazilmasin. Once asset schema, runtime execution,
  debug snapshot ve basit editor form/paneli gelsin.
- AI debug verisi kayda yazilmasin. Blackboard runtime degerleri, active tree node,
  perception stimuli, path ve query sonuclari debug overlay/editor inspect olarak
  gosterilsin.

## Onerilen dosya ve sorumluluk bolumu

| Alan | Oneri |
| --- | --- |
| `engine/ai/` | AIController, Blackboard, BehaviorTree runner, node contracts, debug snapshot. |
| `engine/perception/` | Generic stimulus, sight/hearing/damage perception, listener/source index. |
| `engine/navigation/` | Nav agent, path request/result, grid/graph pathfinding, avoidance adapter. |
| `engine/query/` veya `engine/ai/eqs*` | EQS benzeri generator/test/score runner. |
| `src/game/ai/` | Project task registry: attack, patrol, flee, use smart object, send game messages. |
| `src/editor/` | AI asset editors, visualizers, debug panels. Editor runtime kodunu import etmez. |
| `tools/saveValidator.ts` | Yeni AI sidecar ve layout alanlari icin allowlist/normalize fonksiyonlari. |

## Veri modeli taslagi

### Blackboard asset

```json
{
  "schema": 1,
  "type": "blackboard",
  "keys": [
    { "key": "target", "kind": "entity", "default": null },
    { "key": "lastKnownTargetPosition", "kind": "vec3", "default": null },
    { "key": "hasLineOfSight", "kind": "boolean", "default": false },
    { "key": "patrolPoint", "kind": "vec3", "default": null }
  ]
}
```

### Behavior tree asset

```json
{
  "schema": 1,
  "type": "behaviorTree",
  "blackboard": "assets/AI/Enemy.blackboard.json",
  "root": {
    "kind": "selector",
    "children": [
      {
        "kind": "sequence",
        "decorators": [{ "kind": "blackboard", "key": "hasLineOfSight", "op": "equals", "value": true }],
        "children": [
          { "kind": "task", "task": "forge.moveToBlackboard", "params": { "key": "target" } },
          { "kind": "task", "task": "game.attackTarget" }
        ]
      },
      { "kind": "task", "task": "game.patrol" }
    ]
  }
}
```

### AI Controller component / class

Ilk uygulanabilir secenek: Actor Script Character/Pawn uzerine bir
`AIController` component eklemek:

```json
{
  "component": "AIController",
  "props": {
    "behaviorTree": "assets/AI/Enemy.behavior.json",
    "blackboard": "assets/AI/Enemy.blackboard.json",
    "perception": {
      "sightRadius": 18,
      "fieldOfViewDeg": 110,
      "hearingRadius": 12
    },
    "navAgent": {
      "radius": 0.35,
      "height": 1.8,
      "maxSpeed": 3.2
    }
  }
}
```

Ikinci, Unreal'a daha yakin secenek: `parentClass: "aiController"` Actor Script
asset'i ve pawn uzerinde `aiControllerClassRef`. Bu daha temiz ama editor/runtime
semalarina daha fazla dokunur. Bu yuzden Faz 1 icin component, Faz 4 icin class
asset onerilir.

## Fazlar

### Faz 0 - Arastirma kapatma ve mimari sozlesme

- [ ] Bu dokumani AI sistemi icin kaynak plan kabul et.
- [ ] `docs/architecture/UNREAL_BASICS_LESSONS.md` icine AI planina kisa link ekle.
- [ ] `docs/architecture/ARCHITECTURE.md` icinde AI runtime/editor sinirini bir
      paragrafla netlestir.
- [ ] `engine/behavior` ile yeni `engine/ai` sorumluluk farkini yaz:
      `BehaviorSubsystem` kucuk script tick/message, `AISubsystem` karar ve ajan
      orkestrasyonu.
- [ ] Security notu: behavior stub, generated content veya dev endpoint
      degisecekse Codex Security diff scan oner/iste.

### Faz 1 - Minimal AIController + Blackboard + debug snapshot

Hedef: Bir NPC ajaninin runtime'da possess edilmesi, kendi hafizasini tutmasi ve
debug'da izlenebilmesi.

- [ ] `engine/ai/blackboard.ts` ekle: typed key schema, runtime value store,
      serialize edilmeyen per-agent state.
- [ ] `engine/ai/aiController.ts` ekle: pawn entity id, controller id,
      blackboard, current goal, debug snapshot.
- [ ] `engine/ai/aiSubsystem.ts` ekle: AIController instance lifecycle,
      `setEntities`, `update`, `dispose`.
- [ ] Actor Script component listesine `AIController` ekle.
- [ ] `engine/scene/components.ts` icine `AIControllerComponent` reader ekle.
- [ ] `tools/saveValidator.ts` icinde component props allowlist ekle.
- [ ] `RuntimeSceneApp` icinde `AISubsystem` kur, entity listesini runtime scene
      build sonrasinda bagla.
- [ ] `?debug` overlay veya debug snapshot'a aktif AI sayisi, controller id,
      active goal, blackboard key sayisi ekle.
- [ ] Test: headless engine test ile blackboard default/read/write.
- [ ] Test: runtime smoke ile AIController component'li actor crash olmadan boot eder.
- [ ] Validation: `npx tsc --noEmit`, `npm run test:engine`, `npm run build:verify`.

### Faz 2 - Behavior Tree runtime, visual editor olmadan

Hedef: Unreal Behavior Tree'nin sade JSON karsiligi; Selector/Sequence/Decorator/
Service/Task modeli.

- [ ] `*.behavior.json` schema ve normalizer tanimla.
- [ ] Behavior Tree runner ekle:
      - [ ] `selector`
      - [ ] `sequence`
      - [ ] `task`
      - [ ] `decorator`
      - [ ] `service`
      - [ ] `wait`
      - [ ] `subtree` icin basit asset referansi.
- [ ] Event-driven yaklasim icin blackboard key change ve perception event
      invalidation modeli ekle; her frame tum agaci pahali sekilde tarama.
- [ ] Node-specific mutable data'yi node asset'inde degil agent runtime memory'de
      tut; Unreal'in shared node instance riskini Forge'da bastan engelle.
- [ ] `src/game/ai/tasks.ts` icinde task registry kur.
- [ ] Built-in tasklar:
      - [ ] `forge.wait`
      - [ ] `forge.setBlackboard`
      - [ ] `forge.sendMessage`
      - [ ] `forge.moveToPosition`
      - [ ] `forge.moveToBlackboard`
- [ ] Built-in decoratorlar:
      - [ ] blackboard compare
      - [ ] distance compare
      - [ ] cooldown
      - [ ] has perception stimulus
- [ ] Built-in serviceler:
      - [ ] update target distance
      - [ ] update line of sight
      - [ ] refresh query result
- [ ] Editor ilk surum: JSON asset create/edit formu, node tree text outline,
      task/decorator/service parametre editoru.
- [ ] Debug: active node path, last status, task duration, failed decorator.
- [ ] Test: selector/sequence/decorator/task runner unit tests.
- [ ] Test: enemy patrol/chase sample layout.
- [ ] Validation: `npx tsc --noEmit`, `npm run test:engine`, `npm run build:verify`.

### Faz 3 - Navigation ve path following

Hedef: AI hareketi `CharacterMovement` ile uyumlu, path tabanli ve debug
edilebilir olsun.

- [ ] `engine/navigation` contract ekle:
      - [ ] `NavAgent`
      - [ ] `PathRequest`
      - [ ] `PathResult`
      - [ ] `PathFollowingState`
- [ ] Ilk uygulama olarak collision AABB'lerinden 2D grid/waypoint graph uret.
- [ ] Static blocker AABB'lerini mevcut `PhysicsQuery.staticBlockerAabbs()`
      yuzeyinden besle.
- [ ] `forge.moveToPosition` task'ini path request + path following ile calistir.
- [ ] Ajan hareketini transform teleport yerine CharacterMovement input benzeri
      velocity/desired direction ile uygula.
- [ ] Basit local avoidance ekle: ajanlar arasi separation ve stuck recovery.
- [ ] Debug draw:
      - [ ] nav grid/graph
      - [ ] path polyline
      - [ ] current waypoint
      - [ ] blocked/stuck state.
- [ ] Editor `Show > AI Navigation` gorunumunu ekle.
- [ ] Test: obstacle etrafini dolasan path.
- [ ] Test: path yoksa task failure.
- [ ] Validation: TypeScript, engine tests, build verify, mumkunse Playwright
      viewport smoke.

### Faz 4 - Perception

Hedef: NPC kararlarini game-state polling yerine stimulus ve algi eventleriyle
beslemek.

- [ ] `engine/perception` contract ekle:
      - [ ] `PerceptionListener`
      - [ ] `StimulusSource`
      - [ ] `PerceivedStimulus`
      - [ ] dominant/priority sense.
- [ ] Sight:
      - [ ] radius
      - [ ] field of view
      - [ ] line-of-sight ray/AABB test
      - [ ] target lost grace period.
- [ ] Hearing:
      - [ ] `emitNoise(position, loudness, sourceEntityId)`
      - [ ] radius attenuation
      - [ ] last heard position blackboard update.
- [ ] Damage/gameplay stimulus:
      - [ ] `damage`, `alert`, `ui-action`, `game-event` gibi mevcut message
            bus eventlerinden perception'a bridge.
- [ ] AIController component props icinde perception config expose et.
- [ ] Behavior Tree serviceleri perception result'larini Blackboard'a yazsin.
- [ ] Debug:
      - [ ] sight cone
      - [ ] hearing radius
      - [ ] current sensed targets
      - [ ] last known positions.
- [ ] Test: target FOV disindayken gorulmez, FOV icinde ve obstruction yokken gorulur.
- [ ] Test: noise event blackboard'a last heard position yazar.
- [ ] Validation: TypeScript, engine tests, build verify, Playwright editor debug smoke.

### Faz 5 - EQS benzeri query sistemi

Hedef: "nereye gitmeli?", "en iyi cover neresi?", "hangi pickup yakin ve guvenli?"
gibi kararlar data-driven sorgu ile cozulsun.

- [ ] `*.eqs.json` veya `*.query.json` asset schema tanimla.
- [ ] Generatorlar:
      - [ ] points around querier
      - [ ] grid around context
      - [ ] actors by tag/interface/classRef
      - [ ] smart objects by tag.
- [ ] Contextler:
      - [ ] querier
      - [ ] target entity
      - [ ] blackboard entity/position
      - [ ] all actors of tag/interface.
- [ ] Testler:
      - [ ] distance min/max/score
      - [ ] line of sight
      - [ ] nav reachable
      - [ ] occupancy/reservation free
      - [ ] dot/FOV.
- [ ] Behavior Tree task: `forge.runQueryToBlackboard`.
- [ ] Query debug:
      - [ ] generated candidates
      - [ ] per-test score
      - [ ] winner item
      - [ ] failure reason.
- [ ] Editor ilk surum: query asset formu + viewport candidate overlay.
- [ ] Performance: query tick interval, candidate cap, debug-only expensive details.
- [ ] Test: best patrol point / best cover point deterministic sample.
- [ ] Validation: full local gate ve Playwright overlay smoke.

### Faz 6 - Smart Objects

Hedef: Level'daki kullanilabilir aktiviteleri AI ve oyuncu icin ortak, rezerve
edilebilir data haline getirmek.

- [ ] `SmartObjectComponent` ekle:
      - [ ] tags
      - [ ] slots
      - [ ] interaction position
      - [ ] cooldown
      - [ ] reservedBy.
- [ ] Runtime reservation API:
      - [ ] query
      - [ ] claim
      - [ ] use
      - [ ] release
      - [ ] expire.
- [ ] EQS generator: smart objects by tag/search radius.
- [ ] Behavior Tree task: `forge.claimSmartObject`, `forge.useSmartObject`.
- [ ] Message bridge: use baslayinca actor script message emit et.
- [ ] Editor marker/Details UI: slot gizmo, tag editor, reservation debug.
- [ ] Test: iki ajan ayni slotu ayni anda alamaz.
- [ ] Test: claim timeout release eder.
- [ ] Validation: TypeScript, engine tests, build verify.

### Faz 7 - AI asset authoring ve Content Browser entegrasyonu

Hedef: AI sistemi kodla calismakla kalmasin, editor icinde uretilip
baglanabilsin.

- [ ] Content Browser create menu:
      - [ ] Blackboard
      - [ ] Behavior Tree
      - [ ] EQS Query
      - [ ] ileride State Tree.
- [ ] Actor Script Editor:
      - [ ] AIController component add/remove.
      - [ ] behavior tree picker.
      - [ ] blackboard picker.
      - [ ] perception/nav agent settings.
- [ ] Behavior Tree Editor v1:
      - [ ] tree outline
      - [ ] add/remove/reorder node
      - [ ] node details panel
      - [ ] validation errors.
- [ ] Runtime debug inspector:
      - [ ] selected AI actor blackboard values
      - [ ] active behavior path
      - [ ] perception stimuli
      - [ ] path/query overlay toggles.
- [ ] Save validation: tum yeni sidecar formatlari ve layout fields
      `tools/saveValidator.ts` icinde allowlist/normalize edilmeli.
- [ ] Security: AI-generated behavior stublari, dev endpoint veya file write
      degisiklikleri icin Codex Security diff scan calistirmayi planla.
- [ ] Validation: full local gate + Playwright `?editor` smoke.

### Faz 8 - StateTree secenegi

Hedef: Behavior Tree'nin iyi olmadigi uzun omurlu state akislari icin StateTree
benzeri sistem.

- [ ] `*.stateTree.json` schema:
      - [ ] states
      - [ ] selectors/transitions
      - [ ] evaluators
      - [ ] tasks
      - [ ] parameters/context data.
- [ ] Runtime runner: active state path, transition guards, enter/tick/exit.
- [ ] Behavior Tree ile ortak task/condition registry kullan.
- [ ] GameMode, boss fight, civilian routine, quest actor gibi use-case'leri
      Behavior Tree yerine StateTree ile modelle.
- [ ] Editor ilk surum: nested state outline + transition table.
- [ ] Debug: active state, last transition reason, evaluator values.
- [ ] Test: patrol -> alert -> chase -> search -> patrol state akisi.
- [ ] Validation: full local gate + Playwright debug smoke.

## Ilk uygulanabilir vertical slice onerisi

En dusuk riskli ilk sprint:

1. Blackboard runtime store.
2. AIController component.
3. Behavior Tree runner icin sadece `selector`, `sequence`, `task`, basit
   blackboard decorator.
4. `forge.wait`, `forge.setBlackboard`, `forge.sendMessage` tasklari.
5. Debug snapshot.
6. Bir `Enemy.behavior.json` sample'i: idle -> message emit.

Bu slice navigation/perception/EQS beklemeden AI karar altyapisini dogrular.
Sonraki sprintte path following ve perception eklenir.

## Kabul kriterleri

- Runtime route AI kullanirken editor import etmez.
- Editor route AI asset'lerini author eder ama runtime decision code'u editor
  shell'e tasimaz.
- AI runtime state layout JSON'a geri yazilmaz.
- Yeni layout/sidecar alanlari save validator tarafindan bilincli allowlist edilir.
- Behavior Tree node runtime memory'si agent basina ayridir.
- Debug snapshot olmadan AI feature tamam sayilmaz.
- Engine-level AI kodu DOM, Three.js ve editor bagimliligi tasimaz; render/debug
  visualizer ayri katmanda kalir.
- Oyun-spesifik combat/mission/score kararlari `src/game` tarafinda kalir.

## Acik kararlar

- Ilk nav implementasyonu grid/waypoint mi, yoksa dogrudan Recast/Detour
  entegrasyonu mu olacak?
- AIController once component olarak mi kalacak, yoksa `parentClass:
  "aiController"` Actor Script class'i mi acilacak?
- Behavior Tree visual editor ne zaman gerekli? Ilk fazlarda JSON/form editor
  yeterli gorunuyor.
- AI task'lari mevcut `BehaviorSubsystem` mesaj API'ini mi kullanacak, yoksa
  ayri action/event bus mi gerekecek?
- Multiplayer/replication su an kapsam disi; ileride AI state replication
  sozlesmesi ayrica planlanmali.
