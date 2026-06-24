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
- [ ] `uiWidget` asset schema'si tanimla ve `Menu.ui.json` stub'ini yeni modele tasimak icin migration plani yaz.
- [ ] Manifest/save validator tarafinda UI'yi birinci sinif asset tipi yap.
- [ ] `RuntimeUiSubsystem` v1 ekle: `Canvas`, `Panel`, `Stack`, `Text`, `Button`, `ProgressBar`.
- [ ] Runtime screen stack ekle: `push`, `replace`, `pop`, `back`.
- [ ] `RuntimeSceneApp` input mode entegrasyonu ile UI/game input gecisini netlestir.
- [ ] MVVM-lite store ekle: field update, subscribe, batched render.
- [ ] UI Editor v1 ekle: palette, hierarchy, designer canvas, details, save/validate.
- [ ] Content Browser'da `.ui.json` cift tiklama ile UI Editor ac.
- [ ] Tema/token sistemi ekle: `.theme.json` ve CSS variable uretimi.
- [ ] UI icin headless schema/render testleri ekle.
- [ ] `npm run build:verify` ile runtime paketinde editor UI import'u olmadigini dogrula.
- [ ] Sonraki faz icin animation, localization, accessibility ve world-space UI gereksinimlerini ayri planla.

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
