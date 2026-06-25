# User Interface Arastirmasi ve Forge UI Uretim Plani

> Tarih: 2026-06-23  
> Kapsam: Unreal Engine'de UMG, Slate, Widget Blueprint, Common UI, MVVM, Widget Component ve bunlarin Forge mimarisine cevrilebilir karsiliklari.  
> Hedef: Forge icin basit, veri tabanli, editor ile uretilebilen ve runtime paketinde hafif kalan bir UI uretim modeli tarif etmek.

## Kisa sonuc

Forge, Unreal'in UI araclarini birebir kopyalamamali; ayrimlarini almalidir.

- **Oyun/HUD/menu UI:** UMG benzeri, veri tabanli `.ui.json` asset'leri ve runtime HTML/CSS overlay renderer'i.
- **Editor ve arac UI:** Slate benzeri dusunulmeli, ama Forge'da mevcut TypeScript/DOM `EditorUi` cizgisinde kalmali.
- **UI state ve binding:** Tick ile surekli okuma degil, event-driven MVVM-lite store ve alan bazli bildirimler.
- **Input routing:** Common UI'dan alinacak ders; screen stack, focus, back/cancel, gamepad/klavye/fare ayrimi.
- **World-space UI:** Widget Component benzeri bir ozellik olarak sonraya birakilmali; ilk faz screen-space HUD/menu olmali.

Onerilen karar: Forge icin once **UMG Lite** insa edilmeli. Bu, gorsel UI editoru + `.ui.json` widget agaci + runtime renderer + basit event/binding sistemi anlamina gelir. Slate benzeri dusuk seviye UI framework'u veya Blueprint Graph benzeri genel gorsel script sistemi ilk faza alinmamalidir.

## Unreal Engine tarafinda kullanilan araclar

### UMG UI Designer

Unreal Motion Graphics UI Designer, oyun HUD'u, menu ve arayuz grafikleri icin kullanilan gorsel UI authoring aracidir. Temeli widget'lardir: button, checkbox, slider, progress bar, text, image gibi hazir parcalar kullanilir. Widget Blueprint icinde iki temel calisma yuzu vardir:

- **Designer:** layout, widget agaci, anchor, boyut, stil ve gorsel yerlesim.
- **Graph:** widget davranisi, event handling ve gameplay ile haberlesme.

Forge karsiligi: `UI Editor` icinde Designer/Hierarchy/Details/Preview panelleri; Graph yerine ilk fazda typed action/event listesi.

Kaynaklar:
- https://dev.epicgames.com/documentation/unreal-engine/umg-ui-designer-for-unreal-engine
- https://dev.epicgames.com/documentation/unreal-engine/widget-blueprints-in-umg-for-unreal-engine
- https://dev.epicgames.com/documentation/unreal-engine/displaying-your-umg-ui-in-the-viewport-in-unreal-engine

### Widget Blueprint Editor

Widget Blueprint Editor; palette, hierarchy, visual designer, details, animation ve editor mode alanlariyla UI uretim merkezidir. Content Browser'dan Widget Blueprint uretilir, Designer'da yerlesim yapilir, viewport'a eklenerek runtime'da gosterilir.

Forge karsiligi:

- Content Browser'da `New UI Widget`.
- `.ui.json` dosyasina cift tiklayinca UI Editor acilmasi.
- Palette: `Panel`, `Stack`, `Text`, `Image`, `Button`, `ProgressBar`.
- Hierarchy: widget agaci.
- Details: secili widget props, style, binding, action.
- Preview: desktop/mobile/safe-area olculeri.

### Slate UI Framework

Slate, Unreal'in dusuk seviye, deklaratif ve platformdan bagimsiz UI framework'udur. Unreal Editor'un buyuk kismi Slate ile kurulur; oyun UI icin ise Epic dokumanlari UMG'yi tercih edilen yol olarak konumlandirir.

Forge karsiligi: runtime UI icin Slate kopyasi gerekmiyor. Forge editor UI zaten TypeScript/DOM/CSS ile uretiliyor ve `?editor` modunda ayri chunk olarak yukleniyor. Bu ayrim korunmali: editor araclari dev-only kalmali, oyun UI asset'leri ise runtime paketine girmeli.

Kaynaklar:
- https://dev.epicgames.com/documentation/unreal-engine/slate-ui-framework-in-unreal-engine
- https://dev.epicgames.com/documentation/unreal-engine/slate-overview-for-unreal-engine

### Common UI

Common UI, input routing ve platform uyumlu UI davranislari icin kullanilir. Temel fikir; viewport'un input routing tabani olmasi, UI action'larin adlandirilmis veri olarak tanimlanmasi ve controller/keyboard/mouse akislarinin ayni UI sisteminden gecmesidir.

Forge karsiligi:

- `RuntimeUiSubsystem` icinde screen stack: `push`, `replace`, `pop`.
- Her screen icin default focus ve back/cancel davranisi.
- UI etkinken gameplay input'unun kisilmasi veya yonlendirilmesi.
- UI action isimleri: `confirm`, `cancel`, `back`, `navigateUp`, `navigateDown`.

Kaynak:
- https://dev.epicgames.com/documentation/unreal-engine/common-ui-quickstart-guide-for-unreal-engine

### MVVM ve ViewModel

Unreal'in UMG Viewmodel/MVVM yaklasimi, UI'nin ihtiyac duydugu veriyi ViewModel'de tutar ve degisen alanlari widget'lara bildirir. Bu, karmasik UI'da her frame binding okumaktan daha saglikli bir modeldir.

Forge karsiligi:

- `RuntimeUiStore` veya `RuntimeViewModelStore`.
- Alan bazli subscribe/update.
- Binding ifadeleri ilk fazda sinirli ve typed olmali: `player.health`, `player.maxHealth`, `inventory.gold`.
- Liste widget'lari sonraki faza birakilmali.

Kaynak:
- https://dev.epicgames.com/documentation/unreal-engine/umg-viewmodel-for-unreal-engine

### Widget Component ve Widget Interaction

Widget Component, UMG ile uretilen UI'nin 3D dunyada veya screen-space'te gosterilmesini saglar. Widget Interaction Component ise raycast/pointer benzeri etkilesimi simule eder.

Forge karsiligi:

- Ilk fazda 3D dunyaya gomulu UI alinmamali.
- Daha sonra `WidgetComponentLite` eklenebilir:
  - world-space label/prompt,
  - actor ustunde projected DOM,
  - raycast ile button hit test,
  - gerekirse DOM-to-texture veya canvas tabanli render.

Kaynaklar:
- https://dev.epicgames.com/documentation/unreal-engine/widget-components-in-unreal-engine
- https://dev.epicgames.com/documentation/unreal-engine/umg-widget-interaction-components-in-unreal-engine

### UMG best practices, optimizasyon ve erisilebilirlik

Unreal tarafinda one cikan dersler:

- Hedef cozum ve DPI olcekleri bastan dusunulmeli.
- Reusable User Widget'lar tercih edilmeli.
- Karmasik UI'da her frame binding yerine event-driven update kullanilmali.
- Layout degistiren sik animasyonlar pahali olabilir; transform/material benzeri hafif animasyonlar tercih edilmeli.
- UI debug/inspection araci gereklidir.
- Lokalizasyon, text formatting ve accessibility UI sisteminin sonraki ama planli parcalari olmalidir.

Forge karsiligi: CSS variable temalari, responsive anchor/safe-area kurallari, event-driven binding, debug inspector ve ileride localization/accessibility metadata.

Kaynaklar:
- https://dev.epicgames.com/documentation/unreal-engine/optimization-guidelines-for-umg-in-unreal-engine
- https://dev.epicgames.com/documentation/unreal-engine/umg-best-practices-in-unreal-engine

## Forge mevcut durum analizi

### Guclu baslangic noktalarimiz

- `src/style.css`, canvas ustunde `#ui-overlay` katmani kuruyor. Root click-through; `.ui-interactive` ile etkilesimli widget'lar pointer event alabiliyor.
- `src/style.css`, editor stillerini runtime stillerinden ayiriyor; editor CSS'i `src/editor/editorUi.css` tarafinda dev-only chunk'a ait.
- `src/main.ts`, default route'ta `RuntimeSceneApp`, `?editor` modunda ise `SceneApp + EditorUi` yukluyor. Bu, Unreal'daki runtime/editor ayrimina uygun.
- `RuntimeSceneApp`, `inputMode: "ui"` kavramina ve UI etkinken gameplay input'unu kisma noktasina sahip.
- `public/assets/starter-content/UI/Menu.ui.json` var; ancak simdilik sadece stub.
- `tools/saveValidator.ts`, `/__content-new` icin `ui` turunu kabul ediyor ve `.ui.json` stub uretiyor.

### Bosluklar

- `.ui.json` icin gercek schema yok.
- `.ui.json` dosyasini runtime'da DOM'a render eden sistem yok.
- UI Editor yok.
- UI asset manifest'te birinci sinif asset tipi degil; mevcut `Menu.ui.json`, `assetType: "prefab"` olarak duruyor.
- Screen stack, modal/menu gecisi, back/cancel, focus ve gamepad navigation yok.
- ViewModel/binding sistemi yok.
- Reusable widget/template ve named slot sistemi yok.
- UI animation modeli yok.
- Localization/accessibility metadata yok.
- World-space UI ve UI raycast etkilesimi yok.

## Forge icin onerilen UI uretim modeli

### 1. Asset modeli

Yeni bir birinci sinif UI asset tipi hedeflenmeli:

```json
{
  "schema": 1,
  "type": "uiWidget",
  "name": "MainMenu",
  "preview": { "width": 1280, "height": 720 },
  "theme": "assets/ui/default.theme.json",
  "root": {
    "id": "root",
    "widget": "Canvas",
    "children": []
  }
}
```

Ilk widget seti:

- `Canvas`
- `Panel`
- `Stack`
- `Text`
- `Image`
- `Button`
- `ProgressBar`

Sonraki widget seti:

- `Slider`
- `Checkbox`
- `InputText`
- `ListView`
- `ScrollView`
- `Modal`

### 2. Runtime renderer

`RuntimeUiSubsystem` eklenmeli:

- `.ui.json` asset'ini okur.
- `#ui-overlay` altinda DOM agaci uretir.
- Widget id -> DOM element map tutar.
- UI screen stack'i yonetir.
- `RuntimeSceneApp.setInputMode("ui" | "game")` ile entegre olur.
- Button/action event'lerini game tarafina message veya callback olarak yollar.

Ilk aksiyon formati basit tutulmali:

```json
{
  "onClick": {
    "type": "message",
    "message": "MainMenu.StartGame"
  }
}
```

### 3. Binding ve ViewModel-lite

Binding sistemi ilk fazda genel JavaScript expression calistirmamali. Guvenli, typed ve sinirli path binding yeterli:

```json
{
  "text": { "bind": "player.healthLabel" },
  "value": { "bind": "player.health" },
  "max": { "bind": "player.maxHealth" }
}
```

Runtime tarafinda hedef:

- `setField(path, value)`
- `getField(path)`
- `subscribe(path, listener)`
- batched update
- sadece degisen widget'lari yenileme

### 4. UI Editor

Forge UI Editor, UMG Editor'dan su bolumleri almali:

- Palette
- Hierarchy
- Designer canvas
- Details panel
- Preview resolution selector
- Binding/action panel
- Save/validate

Ilk fazda alinmamasi gerekenler:

- Blueprint Graph benzeri genel node scripting.
- Full Slate benzeri custom UI framework.
- Full animation timeline.
- World-space widget editing.

### 5. Stil ve tema modeli

UI stilleri inline CSS karmasina donusmemeli. Basit tema/token modeli kullanilmali:

```json
{
  "schema": 1,
  "type": "uiTheme",
  "tokens": {
    "color.background": "#10131a",
    "color.text": "#f5f7fb",
    "radius.sm": 4,
    "space.md": 12
  }
}
```

Runtime renderer bu token'lari CSS variable olarak `#ui-overlay` altina uygular. Widget JSON'u token referansi tasir.

### 6. Paketleme ayrimi

Kritik kural:

- UI Editor ve editor CSS'i production game build'e girmemeli.
- `.ui.json`, `.theme.json` ve runtime renderer production build'e girebilir.
- `EditorUi` akisi ile runtime UI akisi birbirine import zinciriyle baglanmamali.

Bu, Forge'un mevcut `?editor` / runtime ayrimina uyumludur.

## Onerilen kararlar

1. Forge UI sistemi **UMG Lite** olarak adlandirilmali: gorsel editor + deklaratif widget asset + runtime renderer.
2. Slate benzeri dusuk seviye framework kopyalanmamali; editor UI mevcut TypeScript/DOM cizgisinde gelismeli.
3. UI Graph ilk faza alinmamali; typed event/action ve path binding yeterli.
4. `.ui.json` birinci sinif asset tipine cevrilmeli; manifest'te `assetType: "ui"` veya `assetType: "uiWidget"` olarak temsil edilmeli.
5. UI input routing, runtime input mode ile ayni kontrata baglanmali.
6. World-space UI, screen UI oturmadan baslatilmamali.

## Kontrol listesi

- [x] Unreal UI dokumantasyonundaki ana araclar incelendi: UMG, Widget Blueprint, Slate, Common UI, MVVM, Widget Component.
- [x] Forge mevcut UI tabani incelendi: `#ui-overlay`, runtime/editor split, `.ui.json` stub, input mode.
- [x] `uiWidget` asset schema'si tanimla ve `Menu.ui.json` stub'ini yeni modele tasimak icin migration plani yaz. → `engine/ui/uiWidget.ts` (savunmaci `normalizeUiWidgetDef` + `defaultUiWidgetDef`); `Menu.ui.json` gercek menuye tasindi.
- [x] Manifest/save validator tarafinda UI'yi birinci sinif asset tipi yap. → `AssetType` artik `"ui"` iceriyor, `.ui.json` inference `"ui"`ya gidiyor, `/__content-new` stub'i `defaultUiWidgetDef` uretiyor, `menu` manifest girdisi `assetType: "ui"`.
- [x] `RuntimeUiSubsystem` v1 ekle: `Canvas`, `Panel`, `Stack`, `Text`, `Button`, `ProgressBar`. → `engine/ui/uiRenderer.ts` (7 widget: + `Image`) + `src/ui/RuntimeUiSubsystem.ts` (tek-ekran mount/unmount + action dispatch).
- [x] Runtime screen stack ekle: `push`, `replace`, `pop`, `back`. → `RuntimeUiSubsystem` v2 (HUD katmani + screen stack scrim'leri, `onScreenStackChange`).
- [x] `RuntimeSceneApp` input mode entegrasyonu ile UI/game input gecisini netlestir. → `Escape` -> `menu` action toggle + pointer-lock birakilinca pause menu; screen acikken `inputMode = "ui"`, kapaninca `reengage()`.
- [x] MVVM-lite store ekle: field update, subscribe, batched render. → `engine/ui/uiViewModel.ts` (`UiViewModelStore`) + `engine/ui/uiBinding.ts` (collect/resolve/apply/bind); HUD canli bagli; UI editorde literal↔bind toggle.
- [x] UI Editor v1 ekle: palette, hierarchy, designer canvas, details, save/validate. → `src/editor/UiWidgetEditor.ts` (overlay; palette/hierarchy/canli onizleme/details) + `/__save-ui` endpoint (`validateSaveUiPayload`).
- [x] Content Browser'da `.ui.json` cift tiklama ile UI Editor ac. → `EditorUi.openUiWidgetEditor` (`assetEditorOpener` + dblclick + "UI Widget" badge).
- [x] Tema/token sistemi ekle: `.theme.json` ve CSS variable uretimi. → `engine/ui/uiTheme.ts` (`UiThemeDef`, `themeToCssVariables`, `applyUiTheme`); widget prop'larinda `$token` ref → `var(--forge-ui-*)`; runtime widget'in `theme` ref'ini yukler + koke uygular.
- [x] UI icin headless schema/render testleri ekle. → `tools/engine-tests.ts` icinde 11 check (normalizer + render-tree + style allowlist).
- [x] `npm run build:verify` ile runtime paketinde editor UI import'u olmadigini dogrula. → U3 sonrasi yesil: 330 test + `verify:dist --strict` "runtime-only" (UI artik runtime bundle'da, editor degil).
- [x] **Include** widget kind ekle: baska `.ui.json` asset'lerini inline gomme, derinlik limiti ile dongü koruması, placeholder + resolved CSS wrapper, RuntimeUiSubsystem'e `resolveWidget` callback, RuntimeSceneApp'te tum `.ui.json` asset'leri on-load, 4 yeni headless test. → 344 check + `verify:dist --strict` yesil.
- [x] **UI debug inspector** ekle: `?debug` overlay'inde aktif HUD + ekran stack'i + ViewModel store alanlari. → `UiViewModelStore.snapshot()` + `RuntimeUiSubsystem.getDebugSnapshot()` + `RuntimeSceneApp.getUiDebugSnapshot()` + `debugStats.ts#formatUiDebug` (pure); 4 yeni headless test → 348 check.
- [x] **Editor tema onizleme** ekle: UI editordeki canli preview artik widget'in `theme` ref'ini cozup uyguluyor (`loadUiThemeAsset` + `applyUiTheme`); stage'e runtime `--forge-ui-*` varsayilanlari verildi, boylece temasiz widget'lar da oyundaki gibi gorunuyor. `verify:dist --strict` hala runtime-only (editor kodu dist'e sizmaz).
- [x] Sonraki faz icin animation, localization, accessibility ve world-space UI gereksinimlerini ayri planla. (U7) → asagidaki "## U7 — Ileri UI plani" bolumu; U7a–U7d alt-fazlari + onerilen sira + kapsam sinirlari.
- [x] **U7a — UI animation:** deklaratif gecis preset'leri (fade/slide/scale) ekran push/pop icin; `prefers-reduced-motion` saygisi. (timeline yok) → `engine/ui/uiTransition.ts` + `UiWidgetDef.transition` + RuntimeUiSubsystem enter/exit + style.css preset'leri + editor transition paneli & "Play"; 6 yeni headless test → 354 check, `verify:dist --strict` runtime-only.
- [x] **U7b — Localization:** `.loc.json` string tablolari + Text `textKey`, aktif locale resolver, runtime + binding entegrasyonu. → `engine/ui/uiLocale.ts` (`normalizeUiLocaleTable`/`applyLocParams`/`LocaleRegistry`) + `UiTextKey` (`uiWidget.ts`) + renderer `resolveLoc` + `bindUiLocale` (locale-change re-apply) + `RuntimeSceneApp.loadUiLocaleRegistry` + `worldSettings.locale` (save-validator allowlist) + debug `locale:` satiri; demo en/tr tablolari, `Menu.ui.json` textKey'lere tasindi; 8 yeni headless test → 361 check, `verify:dist --strict` runtime-only.
- [x] **U7c — Accessibility:** ARIA rol/label/alt, klavye focus navigation, modal focus trap + initial/restore focus, high-contrast tema. → `engine/ui/uiA11y.ts` (`resolveUiA11yAttrs`/`collectFocusables`/`nextFocusIndex`/`auditUiA11y`) + `UiNode.a11y`/`UiWidgetDef.initialFocus` (`uiWidget.ts`) + renderer ARIA attrs + ProgressBar canli `aria-valuenow` (`uiBinding.ts`) + RuntimeUiSubsystem `role=dialog`/`aria-modal` + focus trap + initial/restore focus + Tab/arrow nav + `?debug` a11y audit + `:focus-visible` & `prefers-contrast` (style.css) + editor a11y/initialFocus paneli; 8 yeni headless test → 369 check, `verify:dist --strict` runtime-only.
- [ ] **U7d — World-space widget (WidgetComponentLite):** once screen-projected DOM (billboard label/prompt), sonra raycast etkilesim; true 3D widget mesh en sona.

## Uygulama durumu

### U1 — Asset + runtime render cekirdegi (TAMAMLANDI)

Eklenenler:

- `engine/ui/uiWidget.ts`: saf veri modeli. `UiWidgetDef`/`UiNode`, 7 widget kind
  (`Canvas`, `Panel`, `Stack`, `Text`, `Image`, `Button`, `ProgressBar`), typed
  `UiAction` (`{ type: "message", message }`) ve `UiBinding` (`{ bind: path }`).
  `normalizeUiWidgetDef` savunmaci: bozuk/legacy `root: {}` stub'i bos `Canvas`
  koke yukseltir, bilinmeyen kind -> `Panel`, leaf cocuklarini atar, id'leri
  benzersizlestirir. Three/DOM bagimsiz; editor + runtime + saveValidator ortak okur.
- `engine/ui/uiRenderer.ts`: iki katman. `buildUiRenderTree` (saf, DOM'suz,
  node ortaminda test edilebilir) authored agaci `UiRenderNode` IR'ine cevirir;
  `renderUiWidget`/`mountUiRenderNode` ince DOM katmani, action listener'lari +
  id->element haritasi kurar. `resolveInlineStyle` allowlistli stil token'lari
  (px/flex-alias/passthrough) — `style` keyfi CSS olamaz.
- `src/ui/RuntimeUiSubsystem.ts`: `#ui-overlay` host'una tek widget mount/unmount,
  action'lari `onAction(message)` olarak disari verir. Ekran stack'i U3'te buyur.
- `src/style.css`: 7 widget icin runtime CSS sinifi (`.forge-ui-*`) + `--forge-ui-*`
  tema token seam'i. Sadece `Button` `.ui-interactive` (pointer-events) alir.
- Manifest: `"ui"` birinci sinif `AssetType`; `.ui.json` -> `"ui"` inference.
- `Menu.ui.json`: stub yerine calisir bir ornek menu (Canvas > Stack > Text+Button).
- 11 engine testi; `tsc --noEmit`, `npm run test:engine`, `npm run build`,
  `check:assets` hepsi yesil.

### U2/U3 — HUD/menu ornegi + input routing (TAMAMLANDI)

Eklenenler:

- `RuntimeUiSubsystem` v2: **HUD katmani** (`setHud`, click-through) + **screen stack**
  (`pushScreen`/`replaceScreen`/`popScreen`/`back`/`clearScreens`). Her ekran tam-cerceve
  bir *scrim* (`.forge-ui-screen-layer`, `pointer-events: auto`) — acik menu canvas'a
  tiklama gecisini engeller (kazara kamera yeniden-kilitlenmesi yok). `onScreenStackChange`
  derinlik degisince app'e haber verir.
- Action ayrimi: `{ type: "back" }` ekrani host icinde pop'lar (Common UI cancel);
  `{ type: "message" }` disari `onMessageAction` ile cikar.
- `RuntimeSceneApp` entegrasyonu: layout `worldSettings.hudWidget` / `pauseMenuWidget`
  asset id'lerini okur, manifest'ten `ui` asset'lerini cekip normalize eder. HUD boot'ta
  mount edilir; `Escape` (`menu` action) pause menuyu toggle eder. Ekran acilinca
  `inputMode = "ui"` + pointer-lock birakilir + cursor gosterilir; kapaninca
  `pointerLook.reengage()` (yalniz pointer-lock kamerada) yeniden kilitler. Pointer-lock
  birakilinca (Escape/alt-tab) pause menu otomatik acilir — Escape keydown'i yutan
  tarayicilarda da calisir.
- `message` widget action'lari `behaviorSubsystem.emitScriptMessage("ui-action", ...)`
  ile yayinlanir (UI -> gameplay, generic).
- UiAction `back` varyanti (engine/ui/uiWidget.ts) + renderer gecirgen.
- `PointerLookSource.release()` / `reengage()`; `Escape -> "menu"` binding.
- Demo data: `Menu.ui.json` artik pause menu (title "Paused", Resume=`back`,
  Options=`message`); yeni `Hud.ui.json` (health label + ProgressBar, statik deger —
  canli binding U5); `playground.json` worldSettings `hudWidget:"hud"` +
  `pauseMenuWidget:"menu"`.

Dogrulama: `tsc`, `npm run build:verify` (330 test + `verify:dist --strict` runtime-only),
`check:assets` PASS. Tarayicida elle dogrulanmasi gereken kisim: `/` ac, sol-ust HUD'u gor,
`Escape` ile pause menuyu ac/kapa, Resume ile oyuna don.

Acik nokta: HUD degerleri statik (ProgressBar `value: 72`). Canli `{ "bind": ... }`
cozumlemesi U5 (MVVM-lite store) isi; schema bind'leri simdiden tolere ediyor.

### U4 — UI Editor v1 (TAMAMLANDI)

Eklenenler:

- `src/editor/UiWidgetEditor.ts`: `*.ui.json` icin modal authoring shell (dev-only,
  dinamik import). Dort bolge: **Palette** (secili container'a widget ekle), **Hierarchy**
  (agac; sec/yeniden-sirala/sil), **Designer** (canli WYSIWYG — *runtime* renderer
  `renderUiWidget` ile, oyunda gorunenle birebir; tasarim cozunurlugu stage'e olceklenir),
  **Details** (secili node icin typed alanlar + Button `onClick` editoru none/back/message).
- `engine/ui/uiWidget.ts`: `createUiNode` (kind basina default prop), `findUiNode`,
  `findUiNodeParent` (saf, test edilebilir tree helper'lari).
- Save: `/__save-ui` dev endpoint + `validateSaveUiPayload` (path `.ui.json` + sunucu
  tarafi `normalizeUiWidgetDef`) — editor asla bozuk asset yazamaz. `src/editor/uiWidgetStore.ts`
  client load/save (`materialStore` deseni). `vite.config.ts` PRIVILEGED_URLS'e eklendi.
- `EditorUi.ts`: Content Browser `.ui.json` cift-tiklama -> editor; `assetEditorOpener` +
  "UI Widget" rozeti. `editorUi.css` `.uie-*` stilleri (editor chunk'inda, oyun build'inde yok).
- 3 yeni engine testi (createUiNode / find* / validateSaveUiPayload). `build:verify` 333 test
  ve `verify:dist --strict` runtime-only (editor dist'e sizmaz).

Bilinen v1 sinirlari (sonraki polish): drag-and-drop yerlestirme yok (palette ekle +
hierarchy reorder var); binding alanlari editlenmez (U5); animasyon/tema timeline yok.

### U5 — Binding / ViewModel-lite (TAMAMLANDI)

Eklenenler:

- `engine/ui/uiViewModel.ts`: `UiViewModelStore` — `setField`/`getField`/`setFields`/
  `subscribe`/`flush`/`clear`. Sadece gercekten degisen path dirty olur; `flush`
  her dinleyiciyi flush basina **bir kez** cagirir (cok-pathli bir node tek sefer
  re-render olur = batched). Saf, DOM'suz.
- `engine/ui/uiBinding.ts`: `collectUiBindings` (saf — bind tasiyan node'lar),
  `resolveUiBoundValue` (bound→store / static→literal), `applyBoundNode` (DOM:
  Text/Button→textContent, Image→backgroundImage, ProgressBar→fill width),
  `bindUiWidget` (initial apply + path abonelikleri, unmount'ta unsubscribe).
  v1 bindable prop seti: `text`, `value`, `max`, `src`.
- `RuntimeUiSubsystem`: opsiyonel `store`; HUD + her ekran mount'unda binding
  wire'lanir, unmount'ta cozulur.
- `RuntimeSceneApp`: `UiViewModelStore` olusturur, subsystem'e verir, frame basina
  possessed pawn'un `planarSpeed`'ini `player.speed` + `player.speedLabel` olarak
  besleyip `flush` eder (yalniz degisince re-render).
- `Hud.ui.json`: artik canli bagli — `Text` → `{ bind: "player.speedLabel" }`,
  `ProgressBar.value` → `{ bind: "player.speed" }` (max 6). Karakter hareket edince
  etiket + bar guncellenir.
- UI editor: bindable alanlar (text/value/max/src) icin **literal ↔ bind toggle**
  ("bind" dugmesi; aktifken alan bir field-path girer, prop `{ bind }` olur).
- 4 yeni engine testi (store notify/batched/unsubscribe + collect/resolve).
  `build:verify` 337 test + `verify:dist --strict` runtime-only.

### U6 — Tema/token sistemi (TAMAMLANDI)

Eklenenler:

- `engine/ui/uiTheme.ts`: `UiThemeDef` (`schema/type:"uiTheme"/name/tokens`),
  `normalizeUiThemeDef` (yalniz scalar token), `tokenToCssVar` (`color.surface` →
  `--forge-ui-color-surface`), `themeToCssVariables` (sayi→px, string→aynen),
  `applyUiTheme` (token'lari elemana CSS degiskeni olarak yazar; subtree miras alir).
- `uiRenderer.ts`: `resolveInlineStyle` artik `$token` ref'lerini taniyor —
  `"$color.surface"` → `var(--forge-ui-color-surface)` (prop turunden bagimsiz,
  literal px/string mantigini gecersiz kilar).
- `RuntimeUiSubsystem`: `resolveTheme(ref)` option; mount sonrasi widget'in
  `theme` ref'i cozulup koke uygulanir. `RuntimeSceneApp`: widget'larin `theme`
  ref'lerini (asset id veya path) yukler, `resolveTheme` verir.
- `EditorUi`: widget editoru artik yalniz `.ui.json`'a acilir (`isUiWidgetItem`);
  `.theme.json` (ayni `ui` asset tipi) widget olarak acilip uzerine yazilmaz.
- Demo: `Default.theme.json` (+ manifest `default-theme`); `Menu.ui.json`'a
  `theme: "default-theme"` + panel `background/padding/radius` ve baslik renkleri
  `$token`. Tema `accent` token'i built-in `--forge-ui-accent`'i de override eder
  (buton rengi temadan gelir).
- 3 yeni engine testi (normalize/themeToCssVariables/$token resolve). `build:verify`
  340 test + runtime-only.

Kapsam disi (U6b'ye not): reusable widget/template (named slot) ve debug inspector
bu fazda yapilmadi — ayri, daha buyuk parcalar.

### U6b — reusable widget + debug inspector + editor tema onizleme (TAMAMLANDI)

Uretim kalitesi polish'inin kalan ucu. Uc parca:

- **Reusable widget (`Include`):** ayri `.ui.json` asset'lerini inline gomer
  (yukarida ayri checklist maddesi + Include notlari). Named slot/template sonraki
  fazda.
- **UI debug inspector:** `?debug` overlay'i artik UI host durumunu da yaziyor —
  mounted HUD adi, aktif ekran stack'i (alt→ust) ve ViewModel store alanlari
  (`path = value`, uzun string'ler kirpilir). Veri yollari:
  `UiViewModelStore.snapshot()` (path-sorted `[path, value]`), `RuntimeUiSubsystem`
  ekran/HUD adlarini izler ve `getDebugSnapshot()` ile verir,
  `RuntimeSceneApp.getUiDebugSnapshot()` ikisini + store'u birlestirir,
  `debugStats.ts#formatUiDebug` (pure, DOM'suz) overlay satirlarina cevirir.
  `RuntimeStatsApp.getUiDebugSnapshot?` opsiyonel — editor `SceneApp`'te yok, o
  yuzden inspector yalniz runtime app'te gorunur. 4 yeni headless test
  (snapshot sirasi + formatUiDebug doluluk/placeholder/kirpma).
- **Editor tema onizleme:** UI editordeki canli preview artik widget'in `theme`
  ref'ini cozup uyguluyor (`uiWidgetStore.loadUiThemeAsset` → manifest id/path
  resolve, sonra `applyUiTheme` preview kokune). Ayrica `.uie-stage-inner`'a
  runtime `--forge-ui-*` varsayilanlari verildi, boylece temasiz widget'lar da
  oyundaki gibi gorunuyor; tema varsa onun token'lari ustune yazar. Editor kodu
  dev-only kalir (`verify:dist --strict` hala runtime-only).

Dogrulama: `tsc`, `npm run build:verify` (348 test + `verify:dist --strict`
runtime-only) PASS.

Kapsam disi (U6b'de yapilmadi): named slot/template (Include'un parametreli
hali) ve editorde Include subtree'sinin canli onizlemesi (editor hala placeholder
gosterir) — U7 oncesi opsiyonel polish.

### U7a — UI animation (TAMAMLANDI)

U7 ilk alt-fazi: deklaratif ekran gecis animasyonlari (web-first, CSS
transform/opacity — timeline yok).

Eklenenler:

- `engine/ui/uiTransition.ts` (saf): `UI_TRANSITION_PRESETS`
  (`none|fade|slide-up|slide-down|slide-left|slide-right|scale`), `UiTransition`
  (`enter`/`exit`/`durationMs`), `normalizeUiTransition` (string kisayolu veya
  obje; gecersiz preset → `none`, sure [0,2000]ms clamp, iki uc da none ise
  `null`), `transitionClasses(preset, reducedMotion)` (base + offset CSS sinifi,
  none/reduced-motion → null).
- `engine/ui/uiWidget.ts`: `UiWidgetDef.transition?` + `normalizeUiWidgetDef`
  alani normalize eder (no-op ise dusurur). `validateSaveUiPayload` zaten tum
  def'i normalize ettigi icin kayitta korunur (ayri allowlist gerekmez).
- `src/ui/RuntimeUiSubsystem.ts`: `pushScreen` enter animasyonu (offset state'te
  mount → sonraki frame offset'i kaldir), `popScreen` exit animasyonu (input +
  binding hemen birakilir; layer `transitionend`/timeout sonrasi DOM'dan silinir;
  `pointer-events:none` ile olen ekran tiklama yutmaz). `prefers-reduced-motion`
  → animasyon atlanir (anlik). Bekleyen exit timer'lari `dispose`'da temizlenir.
- `src/style.css`: `.forge-ui-tx` (transition seam) + `.forge-ui-tx-<preset>`
  offset state'leri + `@media (prefers-reduced-motion)` guvenligi.
- `src/editor/UiWidgetEditor.ts`: root secince Details'te **Screen Transition**
  paneli (enter/exit preset + sure) ve **Play transition** ile canli preview'da
  enter'i tekrar oynatma. (editor reduced-motion'i yok sayar ki yazar daima gorsun)
- Demo: `Menu.ui.json` (pause menu) artik `scale` gecisi tasiyor.
- 6 yeni headless test (normalize varyantlari + transitionClasses + def round-trip).

Dogrulama: `tsc`, `npm run build:verify` (354 test + `verify:dist --strict`
runtime-only), `check:assets` PASS. Elle: `/` ac, `Escape` ile pause menu
acilirken/kapanirken scale+fade gecisini gor.

### U7b — Localization (TAMAMLANDI)

U7 ikinci alt-fazi: typed string-table lokalizasyonu (FText/string-table
analogu — expression yok, sadece `{name}` substitution).

Eklenenler:

- `engine/ui/uiLocale.ts` (saf): `UiLocaleTable` (`schema/type:"uiLoc"/locale/
  strings`), `normalizeUiLocaleTable` (yalniz string entry'leri korur, eksik
  locale → "en"), `applyLocParams` (`{name}` substitution; bilinmeyen yer tutucu
  oldugu gibi kalir), `LocaleRegistry` (tablolari tutar, aktif locale + degisim
  abonesi; `resolve(key, params?, fallback?)` eksikse key'in kendisine duser,
  bilinmeyen locale'i yok sayar — UI hicbir zaman boslanmaz).
- `engine/ui/uiWidget.ts`: `UiTextKey` (`{ key, params? }`) — `UiBinding`'in
  kardesi, `text` prop'u icin; `isUiTextKey` + `readUiTextKey` (param'lari string'e
  sanitize eder, sayilari coerce eder, obje param'lari duser). Prop bag'da bind
  gibi tasinir; ayri normalize/allowlist gerekmez (`validateSaveUiPayload` zaten
  tum def'i normalize eder).
- `engine/ui/uiRenderer.ts`: `UiBuildOptions.resolveLoc` + `RenderUiWidgetOptions.
  resolveLoc`; Text/Button ilk render'da `{ key }`'i cozer (resolver yoksa ham
  key'i gosterir — temasiz editor onizlemesi anlamli kalir). `{ bind }` text'i
  bos render edip binding'e birakma davranisi korunur.
- `engine/ui/uiBinding.ts`: `collectUiLocBindings` (saf — localized Text/Button
  node'lari), `applyLocNode`, `bindUiLocale` (locale degisince ilgili node'lari
  yeniden cozer; store flush deseninin kardesi, unmount'ta unsubscribe).
- `src/ui/RuntimeUiSubsystem.ts`: opsiyonel `locale` registry; `renderOptions`'a
  `resolveLoc`, `bind()` artik store + locale dispose'unu birlestirir.
- `src/scene/RuntimeSceneApp.ts`: `loadUiLocaleRegistry` manifest'ten `.loc.json`
  tablolarini (manifest sirasinda, deterministik) yukler; aktif locale
  `worldSettings.locale`'den (yoksa ilk tablo) secilir; subsystem'e verilir.
  `getUiDebugSnapshot` aktif locale'i tasir.
- `engine/scene/layout.ts` + `tools/saveValidator.ts`: `worldSettings.locale`
  (non-empty string) — save-validator allowlist'ine eklendi (gotcha), yoksa
  kayitta dusurulurdu.
- `src/scene/debugStats.ts`: `?debug` UI inspector'inda `locale:` satiri.
- `src/editor/UiWidgetEditor.ts`: localized `{ key }` text prop'u Details'te
  read-only gosterilir ("loc" rozeti + disabled input) — v1'de loc authoring UI
  yok, ama alan key'i literal'e ezmez / "[object Object]" gostermez.
- Demo: `Default_en.loc.json` (+`loc-en`) ve `Default_tr.loc.json` (+`loc-tr`)
  manifest girdileri; `Menu.ui.json` baslik/alt-baslik/Resume/Options textKey'lere
  tasindi (alt-baslik `{version}` param ornegi); `playground.json`
  `worldSettings.locale: "en"`.
- 8 yeni headless test (normalize/applyLocParams/registry resolve+notify/
  readUiTextKey/render resolveLoc/collectUiLocBindings + worldSettings.locale
  round-trip).

Dogrulama: `tsc`, `npm run build:verify` (361 test + `verify:dist --strict`
runtime-only), `check:assets` PASS. Elle: `/` ac, `Escape` ile pause menuyu ac,
metinlerin locale'den geldigini gor; `worldSettings.locale`'i `"tr"` yapinca
menu Turkce gelir.

Kapsam disi (planda): cogul/plural, cinsiyet, sayi/tarih formatlama, runtime
canli kultur hot-swap UI editoru. (RTL → U7c layout notu.)

### U7c — Accessibility (TAMAMLANDI)

U7 ucuncu alt-fazi: web-native erisilebilirlik. DOM zaten erisilebilir oldugu
icin gercek ARIA roller/oznitelikler ve klavye focus'u neredeyse bedava — bu faz
widget'i dogru semantige esleyip screen stack uzerine modal focus yonetimi kurar.

Eklenenler:

- `engine/ui/uiA11y.ts` (saf): `UiA11y` (`label`/`role`/`focusable`),
  `normalizeUiA11y` (bos/yanlis tipleri duser), `resolveUiA11yAttrs` (widget
  kind + a11y → ARIA harita: ProgressBar `role=progressbar`+`aria-value*`, Image
  `role=img`, `label`→`aria-label`, `role` override, `focusable`→`tabindex`),
  `isUiNodeFocusable`/`collectFocusables` (focus sirasi: Button + `focusable:true`),
  `nextFocusIndex` (wrap'li navigasyon), `auditUiA11y` (isimsiz Button / label'siz
  Image lint'i).
- `engine/ui/uiWidget.ts`: `UiNode.a11y?` + `UiWidgetDef.initialFocus?`;
  `normalizeUiNode`/`dedupeNodeIds`/`normalizeUiWidgetDef` alanlari korur (no-op
  a11y dusurulur). `validateSaveUiPayload` tum def'i normalize ettigi icin kayitta
  korunur (ayri allowlist gerekmez — `.ui.json` node alani, layout alani degil).
- `engine/ui/uiRenderer.ts`: `UiRenderNode.attrs?` (build pass'te
  `resolveUiA11yAttrs`), `mountUiRenderNode` `setAttribute` ile uygular.
- `engine/ui/uiBinding.ts`: bagli ProgressBar guncellenince `aria-valuenow`/
  `aria-valuemax` da senkron (canli ilerleme screen reader'a yansir).
- `src/ui/RuntimeUiSubsystem.ts`: her ekran layer'i `role=dialog`+`aria-modal`+
  `aria-label`; push'ta onceki focus saklanir → `initialFocus` (yoksa ilk
  focusable, yoksa layer) odaklanir; pop/clear onceki focus'u geri verir; modal
  **focus trap** + Tab/Shift+Tab + ok tuslari `screenRoot` keydown handler'inda
  `collectFocusables`+`nextFocusIndex` ile (public `moveFocus`/`activateFocused`
  ileride gamepad icin); `getDebugSnapshot` artik `auditUiA11y` bulgularini tasir.
- `src/scene/RuntimeSceneApp.ts` + `debugStats.ts`: `UiDebugSnapshot.audit`;
  `?debug` UI inspector'inda `a11y(n):` satirlari (isimsiz Button/Image uyarisi).
- `src/style.css`: `:focus-visible` ring (`--forge-ui-focus` token) +
  `@media (prefers-contrast: more)` high-contrast token override (U6 tema sistemi
  uzerine). reduced-motion zaten U7a'da.
- `src/editor/UiWidgetEditor.ts`: Details'te **Accessibility** paneli (label/role/
  focusable) ve root secince **Initial Focus** selektoru (focusable node id'leri).
- Demo: `Menu.ui.json` → `initialFocus: "resume"`, logo Image'a `a11y.label`.
- 8 yeni headless test (normalize/round-trip/resolveUiA11yAttrs/collectFocusables/
  nextFocusIndex/render attrs/audit + formatUiDebug audit satiri).

Dogrulama: `tsc`, `npm run build:verify` (369 test + `verify:dist --strict`
runtime-only), `check:assets` PASS. Elle: `/` ac, `Escape` ile pause menuyu ac;
Resume odakli gelir, Tab/ok tuslari menude gezer, Escape kapatip oyuna doner;
`?debug` ile a11y audit satirlarini gor.

Kapsam disi (planda): gamepad focus routing (public `moveFocus`/`activateFocused`
hazir ama action-map'e baglanmadi — `GamepadInputSource` yok), tam screen-reader
live-region senaryolari, otomatik kontrast hesaplama, RTL layout.

### Sonraki adim (U7)

- Sirada **U7d (world-space widget / WidgetComponentLite)** — son alt-faz, ayri
  subsystem; Secenek A (screen-projected DOM billboard) ile baslar. Detayli plan
  asagida ("## U7 — Ileri UI plani").

## U7 — Ileri UI plani

U7, UMG'nin "ileri" UI katmanidir: animation, localization, accessibility ve
world-space widget. Dordu de ayri, kendi icinde tamamlanabilen alt-fazlardir
(U7a–U7d). Hepsi U1–U6b'nin kurdugu cekirdek uzerine biner ve ayni kurallari
korur:

- Saf engine yardimcilari `engine/ui/*` altinda (DOM/Three'siz, headless test
  edilebilir); ince DOM/runtime katmani `src/ui` + `src/scene`.
- Editor kodu dev-only kalir; `npm run build:verify` her adimda
  `verify:dist --strict` "runtime-only" gecmeli.
- `.ui.json`'a eklenen **her yeni alan** `normalizeUiWidgetDef` (engine) + sunucu
  tarafi `validateSaveUiPayload`/`normalizeUiWidgetDef` (tools/saveValidator.ts)
   uzerinden gecmeli, yoksa kayitta sessizce dusurulur. Yeni bir **placement /
  layout actor alani** ise `tools/saveValidator.ts` allowlist'ine eklenmeli
  (CLAUDE.md "Save-validator allowlist gotcha").
- Binding/expression yok kurali surur: localization keyleri ve a11y label'lari
  typed/path tabanli olur, arbitrary JS degil.
- Her alt-faz: `tsc --noEmit` + `npm run test:engine` + `npm run build:verify`
  yesil; yeni davranis icin headless test.

### U7a — UI animation (gecis preset'leri)

**Unreal dersi:** UMG widget animation timeline (transform/opacity/color
keyframe). Best-practice notu (bu dokuman §103): layout degistiren animasyon
pahali; transform/opacity gibi hafif animasyon tercih edilmeli.

**Forge yaklasimi (web-first):** full timeline editoru YOK (U4 kapsam disi).
Bunun yerine deklaratif, isimli gecis preset'leri — CSS `transform`/`opacity`
transition'lari ile.

- Veri modeli: ekran (ve istege bagli node) icin opsiyonel
  `transition: { enter, exit, durationMs }`. Preset enum (sinirli):
  `none | fade | slide-up | slide-down | slide-left | slide-right | scale`.
  `normalizeUiWidgetDef` gecersiz preset'i `none`'a indirger, `durationMs`'i
  makul araliga clamp eder.
- Engine (saf): `engine/ui/uiTransition.ts` — `normalizeUiTransition`,
  `transitionClasses(preset)` (enter/exit/active CSS sinif adlari),
  `prefersReducedMotion()` ortam kontrolu icin enjekte edilebilir bayrak.
- Runtime: `RuntimeUiSubsystem` push'ta enter sinifini uygular (bir sonraki
  frame'de kaldirarak transition tetikler), pop'ta exit sinifini uygular ve
  `transitionend` (veya `durationMs` timeout fallback) sonrasi layer'i DOM'dan
  siler. `prefers-reduced-motion: reduce` → animasyon atlanir (anlik).
- CSS: `src/style.css`'te `.forge-ui-screen-layer.is-entering/.is-exiting` +
  preset siniflari (transform/opacity). Editor degil, runtime stili.
- Editor: Details'te root/ekran icin transition selektoru + "Play transition"
  onizleme dugmesi (preview'da enter'i oynatir).
- Test: `normalizeUiTransition` (gecerli koru / gecersiz dusur / clamp);
  `transitionClasses` esleme; reduced-motion'da bos sinif.
- Kapsam disi: keyframe timeline, per-property egri, material/renk animasyonu,
  spring fizik.

### U7b — Localization

**Unreal dersi:** FText, string table, kultur degisimi, text formatting.

**Forge yaklasimi:** `.loc.json` string tablolari + Text widget'inda typed
`textKey`.

- Asset: `.loc.json` = `{ schema:1, type:"uiLoc", locale, strings: { key: text } }`.
  Manifest'te — `.theme.json` gibi — `ui` asset tipi altinda kalir, uzanti ile
  ayrilir. `EditorUi.isUiWidgetItem` guard'i `.loc.json`'i da widget editorunden
  haric tutmali (tema icin yapildigi gibi).
- Veri modeli: Text prop'u `text: { key: "menu.start", params?: { name: "..." } }`
  destekler (mevcut `{ bind }` deseninin kardesi). Param yer tutucu yalniz
  `{name}` substitution — expression yok.
- Engine (saf): `engine/ui/uiLocale.ts` — `normalizeUiLocaleTable`,
  `LocaleRegistry` (locale → tablo), `resolveLocString(key, params)` (eksikse
  key'i veya verilen default'u dondurur). `uiBinding` resolver'i `textKey`'i
  cozer; locale degisince ilgili node'lar yeniden uygulanir (store flush
  desenine paralel bir locale-change abonesi).
- Runtime: `RuntimeSceneApp` manifest'ten `.loc.json` tablolarini yukler, aktif
  locale'i proje ayarindan/varsayilandan secer, resolver'i
  `RuntimeUiSubsystem`'e verir.
- saveValidator: v1'de loc tablolari elle yazilir (save endpoint yok) →
  validator gerekmez; ileride loc editoru eklenirse `validateSaveLoc` notu.
- Test: `resolveLocString` fallback + param substitution; `normalizeUiLocaleTable`
  scalar koruma; Text `textKey` cozumleme.
- Kapsam disi: cogul/plural kurallari, cinsiyet, sayi/tarih formatlama, runtime
  canli kultur hot-swap UI editoru. (RTL bir bayrak olarak U7c layout'una not.)

### U7c — Accessibility

**Unreal dersi:** Slate accessibility, screen reader, Common UI focus/navigation
(default focus, back/cancel, gamepad/klavye).

**Forge avantaji:** DOM native a11y'ye sahip — gercek roller/oznitelikler bedava.

- Semantik: renderer widget kind → ARIA. Button gercek `<button>` (veya
  `role="button"` + klavye) + `aria-label`; ProgressBar `role="progressbar"` +
  `aria-valuenow/min/max`; Image `alt`; ekran `role="dialog"` + `aria-modal`.
  Node'da opsiyonel `a11y: { label, role?, focusable? }`; ekranda `initialFocus`
  (node id). Bu alanlar normalizer + saveValidator allowlist'inden gecmeli.
- Engine (saf): `engine/ui/uiA11y.ts` — `resolveUiA11yAttrs(node)` (oznitelik
  haritasi), `collectFocusables(tree)` (focus sirasi), `nextFocusIndex(...)`
  (wrap'li navigasyon).
- Runtime: `RuntimeUiSubsystem` modal focus trap (ust ekran), ekran acilinca
  initial focus, kapaninca onceki focus restore. Input action'lari
  (`navigateUp/Down/Left/Right`, `confirm`, `cancel`) Common UI haritasindan
  focus hareketine baglanir (klavye + gamepad). `cancel` zaten `back`.
- Tema: high-contrast token seti + `prefers-contrast` saygisi (U6 tema sistemi
  uzerine). reduced-motion zaten U7a'da.
- Editor: Details'te a11y alanlari; debug inspector'a basit audit (label'siz
  Button / alt'siz Image uyarisi).
- Test: a11y oznitelik esleme; `collectFocusables` sira; focus trap wrap;
  navigasyon indeksi.
- Kapsam disi: tam screen-reader live-region senaryolari (minimal `aria-live`
  status disinda), otomatik kontrast hesaplama. a11y label'lari U7b geldiyse
  `textKey` ile lokalize edilir.

### U7d — World-space widget (WidgetComponentLite)

**Unreal dersi:** Widget Component (UI'yi 3D dunyada/screen-space goster) +
Widget Interaction Component (raycast pointer). Bu dokuman, screen UI oturmadan
baslamamali demisti — artik oturdu.

**Forge yaklasimi — iki secenek, asamali:**

- **Once Secenek A — screen-projected DOM (billboard label/prompt):** bir
  `.ui.json` widget'i DOM overlay olarak render edilir ve her frame bir dunya
  capasinin (actor/socket/dunya noktasi) ekran izdusumune konumlandirilir.
  Ucuz, net metin, DOM-to-texture yok. Kameraya gore mesafe-bazli scale/fade,
  kamera arkasinda gizleme, opsiyonel raycast occlusion. Pointer etkilesimi
  gercek DOM oldugu icin dogal calisir (z-order + pointer-events ayari).
- **Sonra Secenek B — gercek 3D widget mesh:** DOM→canvas/texture (CSS3D veya
  html-to-image) bir Three duzlemde, ya da widget'i dogrudan Three mesh olarak
  kurma. Egri/aydinlatilmis/occlude olan sahne-ici UI icin; agir, ertelenir.
  Raycast→UV→sentetik event etkilesimi de buraya.
- Veri modeli: yeni yerlestirilen actor/component — `widgetComponents[]`:
  `{ widget: assetId, anchor: {entityId|worldPos|socket}, space:"screen",
  offset, maxDistance, billboard }`. **Bu yeni layout alani saveValidator
  allowlist'ine eklenmeli** (applyTransformFields/validate* — CLAUDE.md gotcha).
- Engine (saf): dunya→ekran izdusum matematigi (varsa mevcut yardimciyi kullan)
  ve `resolveWidgetComponentVisibility(distance, maxDistance)` → scale/opacity.
- Runtime: `WorldUiSubsystem` (ya da `RuntimeUiSubsystem` uzantisi) — dunya-bagli
  widget'lari ayri overlay layer'a mount eder, transform'larini her frame gunceller.
- Editor: yeni actor tipi olarak yerlestirme (diger placed actor'lar gibi), capa
  uzerinde gizmo, Details'te widget ref + space + maxDistance.
- Test: izdusum gorunurluk/scale matematigi; placement normalizer/validator.
- Kapsam disi (ilk kesim): gercek 3D widget mesh, 3D widget'ta raycast etkilesim,
  egri panel.

### U7 onerilen sira ve gerekce

1. **U7a (animation)** — kucuk, self-contained, mevcut ekran/menuye aninda polish.
2. **U7b (localization)** — veri tesisati; a11y label'lari bunun ustune lokalize
   olabilsin diye accessibility'den once.
3. **U7c (accessibility)** — screen stack focus/nav uzerine biner; web-native,
   yuksek deger.
4. **U7d (world-space)** — en buyuk, ayri subsystem; en sona, Secenek A ile baslar.

## Onerilen uygulama sirasi

1. **U1 - Asset ve runtime render cekirdegi:** `uiWidget` schema, validator, manifest tipi, minimal DOM renderer.
2. **U2 - HUD/menu ornegi:** mevcut `Menu.ui.json` gercek menuye cevrilir; basit health/progress HUD eklenir.
3. **U3 - Input routing:** screen stack, focus, back/cancel ve game input kisma kurali tamamlanir.
4. **U4 - UI Editor v1:** Designer/Hierarchy/Details/Palette ile JSON uretme ve kaydetme.
5. **U5 - Binding:** ViewModel-lite store ve event-driven widget update.
6. **U6 - Uretim kalitesi:** tema token'lari, reusable widget/template, debug inspector.
7. **U7 - Ileri UI:** animation, localization, accessibility, world-space widget/component.

## Kapsam disi kararlar

- Ilk fazda full Blueprint Graph yok.
- Ilk fazda Slate benzeri genel UI framework yok.
- Ilk fazda DOM-to-texture veya 3D widget raycast yok.
- Ilk fazda arbitrary JavaScript expression binding yok.

Bu sinirlar, UI sisteminin once gercek oyun menusu/HUD uretmesini ve production paketinde hafif kalmasini saglar.
