# Material Editor Checklist

> Tarih: 2026-06-19
> Amac: Content Browser'da sag tik -> **Material** akisini, Forge'a uygun
> basitlikte bir **form tabanli PBR Material Editor** ile tamamlamak.
>
> Temel karar: Forge'un ilk Material Editor'u Unreal'daki gibi node graph,
> shader graph veya Substrate benzeri katmanli sistem olmayacak. Ilk surum,
> Three.js `MeshStandardMaterial` uzerinden calisan, preset secimli ve kaydedilebilir
> bir materyal varlik editoru olacak.

## Bolum A - Hedef

Kullanicinin bugunku problemi: Content Browser'da materyal olusturabiliyoruz,
ancak materyalin ne tipte olacagina ve ozelliklerine editor icinden karar
veremiyoruz.

Bu dokumanin hedefi:

- Material asset olustururken anlamli preset secimi sunmak.
- Var olan `.material.json` dosyalarini alanli bir editorle duzenlemek.
- Mesh'e atanan materyalin editor, thumbnail ve runtime tarafinda tutarli
  guncellenmesini saglamak.
- Forge'un hafif web-first yapisini korumak.

Bu dokumanin hedefi olmayanlar:

- Node tabanli material graph.
- Custom GLSL shader editor.
- Unreal Substrate benzeri katmanli materyal sistemi.
- Material Function sistemi.
- Vertex deformation / World Position Offset.

Not: `docs/ARCHITECTURE.md` icinde `shader graph or material graph` henuz kapsam
disi olarak geciyor. Bu checklist o karari korur.

---

## Bolum B - Mevcut Forge Durumu

### B.1 Var olan altyapi

- `engine/assets/manifest.ts`, `.material.json` / `.mat.json` dosyalarini
  `assetType: "material"` olarak taniyor.
- `tools/saveValidator.ts`, sag tik -> New Content akisini destekliyor ve
  `kind: "material"` kabul ediyor.
- `vite.config.ts`, `/__content-new` ile yeni typed stub asset olusturuyor ve
  manifest'e best-effort kayit ekliyor.
- `src/scene/materialAssets.ts`, material asset'i yukleyip `MeshStandardMaterial`
  olusturuyor.
- `src/editor/ThumbnailRenderer.ts`, materyal thumbnail'i ve material uygulanmis
  model thumbnail'i uretebiliyor.
- `src/editor/StaticMeshEditor.ts`, mesh asset duzeyinde `Element 0` material
  slot secimini ve `*.materials.json` kaydini destekliyor.
- `src/scene/SceneApp.ts`, sahne instance material override'unu ve asset-level
  default material slot fallback'ini uyguluyor.

### B.2 Mevcut material JSON alani

Bugunku `ForgeMaterialDef` fiilen su alanlari yukluyor:

```json
{
  "schema": 1,
  "materialType": "standard",
  "name": "Example Material",
  "baseColor": "#ffffff",
  "baseColorTexture": "texture-asset-id",
  "normalTexture": "texture-asset-id",
  "roughness": 0.8,
  "metalness": 0,
  "opacity": 1,
  "emissive": "#000000",
  "emissiveIntensity": 0
}
```

Eksik / tutarsiz nokta: Bazi starter materyallerde `maskTexture` var, fakat
`materialAssets.ts` bunu henuz okumuyor. Material Editor once schema'yi
netlestirmeli, sonra loader ve validator ayni alani konusmali.

---

## Bolum C - Kapsam Karari

### C.1 Ilk surum material tipi

Ilk surumun runtime temeli:

- Ana tip: `standard` -> Three.js `MeshStandardMaterial`.
- Opsiyonel ikinci tip: `basic` -> Three.js `MeshBasicMaterial`, yalnizca unlit
  yardimci materyaller icin.
- `physical` -> Three.js `MeshPhysicalMaterial`, ilk surumde sadece preset olarak
  hazirlanabilir; tum fiziksel alanlar acilmamalidir.

Karar: Ilk implementation `standard` ile baslasin. `glass` gibi preset'ler de
ilk etapta `standard + opacity` ile calissin. Gercek `MeshPhysicalMaterial`
alanlari sonraki faza kalsin.

### C.2 Presetler

Content Browser'da sag tik -> Material secildiginde kullanici once preset
secebilmeli:

| Preset | Material tipi | Baslangic degerleri | Not |
| --- | --- | --- | --- |
| Standard Surface | `standard` | beyaz, roughness 0.8, metalness 0 | Varsayilan |
| Textured Surface | `standard` | texture slotlari bos, roughness 0.8 | Doku odakli |
| Metal | `standard` | metalness 1, roughness 0.3 | Basit metal |
| Glass | `standard` | opacity 0.35, roughness 0.05 | Ilk surumde fiziksel cam degil |
| Emissive | `standard` | emissive renk + intensity 1.5 | Isikli yuzey |
| Unlit Basic | `basic` | renk/texture, isiktan etkilenmez | Opsiyonel / debug |

### C.3 Ilk editor alanlari

Minimum yeterli alanlar:

- `name`
- `materialType`
- `baseColor`
- `baseColorTexture`
- `normalTexture`
- `roughness`
- `metalness`
- `opacity`
- `emissive`
- `emissiveIntensity`
- `side`: `front | back | double`
- `alphaMode`: `opaque | blend | mask`
- `alphaTest`

Ilk surumde acilmamasi gereken alanlar:

- `clearcoat`, `transmission`, `ior`, `thickness`
- `anisotropy`, `iridescence`, `sheen`
- `displacementMap`, `bumpMap`, `aoMap`, `lightMap`
- custom blending / stencil / clipping

### C.4 Material Instance karari

2026-06-19 karari: Forge'un yakin vadede Unreal'daki tam Material Instance
sistemini kopyalamasina gerek yok. Node/material graph olmadigi icin ilk ihtiyac
parent material + alan override mantigiyla calisan hafif bir **Material Instance
Lite / Material Variant** sistemidir.

Ilk onerilen veri sekli:

```json
{
  "schema": 1,
  "type": "materialInstance",
  "name": "Blue Painted Metal",
  "parentMaterial": "starter-metal",
  "overrides": {
    "baseColor": "#2b6cff",
    "roughness": 0.45
  }
}
```

Kurallar:

- Parent normal canonical `.material.json` olur.
- Instance sadece degisen alanlari `overrides` icinde tutar.
- Runtime parent + overrides resolve edip yine normal Three.js material uretir.
- Ilk surum shader sistemi, node graph veya Material Function eklemez.
- Bu is, mevcut Material Editor kalan maddeleri kapandiktan sonra ayri faz olarak
  ele alinmalidir.

---

## Bolum D - Mimari Plan

### D.1 Veri modeli

Yeni canonical schema:

```ts
type ForgeMaterialType = "standard" | "basic";
type ForgeMaterialSide = "front" | "back" | "double";
type ForgeMaterialAlphaMode = "opaque" | "blend" | "mask";

interface ForgeMaterialDef {
  schema: 1;
  type: "material";
  materialType: ForgeMaterialType;
  name: string;
  baseColor: string;
  baseColorTexture?: string | null;
  normalTexture?: string | null;
  maskTexture?: string | null;
  roughness: number;
  metalness: number;
  opacity: number;
  alphaMode: ForgeMaterialAlphaMode;
  alphaTest?: number;
  side: ForgeMaterialSide;
  emissive: string;
  emissiveIntensity: number;
}
```

`maskTexture` ilk etapta ORM/MRA paketli texture icin ayrilabilir:

- G kanali -> roughness
- B kanali -> metalness
- A veya R kanali -> alpha/AO icin sonraki faz

Ilk implementation'da `maskTexture` okunacaksa davranis dokumante edilmeli.
Okunmayacaksa editor sadece alani korumali veya gecici olarak gizlemeli.

### D.2 Editor kabugu

Yeni dosya onerisi:

- `src/editor/MaterialEditor.ts`
- `src/editor/materialEditor.css` veya mevcut `editorUi.css` icinde sinirli stiller
- `src/editor/materialStore.ts`
- `src/scene/materialAssets.ts` genisletme

Editor UI:

- Tam ekran overlay veya mevcut asset editor deseni.
- Sol/orta preview: sphere + plane veya secili mesh preview.
- Sag panel: material properties formu.
- Alt/ust toolbar: Save, Reset, Browse, Apply to Selected.

### D.3 Save ve validator

Yeni endpoint:

- `/__save-material`

Yeni validator:

- `validateForgeMaterialDef`
- `validateSaveMaterialPayload`

Kurallar:

- Path `.material.json` veya `.mat.json` ile bitmeli.
- Path `..` icermemeli.
- Renkler `#rrggbb` formatinda olmali.
- Numeric alanlar clamp degil, validator tarafinda aralik kontrollu olmali:
  - roughness: 0..1
  - metalness: 0..1
  - opacity: 0..1
  - emissiveIntensity: 0..20
  - alphaTest: 0..1
- Texture referanslari string asset id veya `null` olmali.

### D.4 Runtime refresh

Kayit sonrasi:

- Material cache invalidate edilmeli.
- Material'i kullanan mesh instance'lari yeniden uygulanmali.
- Static Mesh Editor preview'i yeni material ile yenilenmeli.
- Content Browser thumbnail cache temizlenmeli.

Bu is, onceki `*.materials.json` sidecar refresh desenine benzemeli; yeni tek
seferlik yol icat edilmemeli.

---

## Bolum E - Uygulama Checklist

Durum: `[ ]` yapilmadi, `[~]` kismi, `[x]` tamam.

### Faz 0 - Planlama ve kapsam sabitleme

- [x] Material Editor icin Forge'a uygun kapsam karari yazildi.
- [x] Node/material graph'in ilk surum kapsam disi oldugu belgelendi.
- [x] Ilk preset ve editor alanlari belirlendi.
- [x] Kullanici komutuyla Faz 1'e basla.

### Faz 1 - Material schema ve validator

- [x] `ForgeMaterialDef` tipini canonical hale getir.
- [x] `type: "material"` alanini yeni kayitlarda standartlastir.
- [x] `side`, `alphaMode`, `alphaTest`, `maskTexture` alanlari icin kararli schema ekle.
- [x] `tools/saveValidator.ts` icine `validateForgeMaterialDef` ekle.
- [x] `tools/saveValidator.ts` icine `validateSaveMaterialPayload` ekle.
- [x] `contentStubJson(kind: "material")` ciktisini canonical material schema'ya cevir.
- [x] Existing starter material JSON'lari yeni schema ile uyumlu mu kontrol et.
- [x] `npm run test:engine` icin validator testleri ekle.

Kabul kriteri:

- Yeni material stublari runtime loader'in okuyabildigi gecici degil, canonical
  schema ile olusur.
- Gecersiz renk, sayi araligi, path ve texture alanlari save endpoint'inden gecmez.

### Faz 2 - Preset secimli material olusturma

- [x] `ContentNewKind` icinde material icin optional `materialPreset` destekle.
- [x] Sag tik -> Material akisini preset picker modalina bagla.
- [x] Presetlerden dogru `.material.json` stub'u uret.
- [x] Manifest kaydi sonrasi `editableAssets` refresh akisini koru.
- [x] Hata durumlari: iptal, ayni dosya var, invalid isim, manifest kaydi basarisiz.

Kabul kriteri:

- Kullanici `Standard`, `Metal`, `Glass`, `Emissive`, `Textured` presetlerinden
  biriyle yeni material olusturabilir.
- Olusan asset Content Browser'da material olarak gorunur ve suruklenip mesh'e
  atanabilir.

### Faz 3 - Material Editor overlay

- [x] `MaterialEditor.ts` olustur.
- [x] Material asset'e cift tiklayinca editor overlay ac.
- [x] Mevcut material JSON'u yukle ve form alanlarini doldur.
- [x] Preview sphere sahnesi kur: grid yok veya sade zemin, key/fill light, orbit kamera.
- [x] Form kontrolleri:
  - [x] name
  - [x] baseColor
  - [x] baseColorTexture picker
  - [x] normalTexture picker
  - [x] roughness slider/input
  - [x] metalness slider/input
  - [x] opacity slider/input
  - [x] alphaMode select
  - [x] side select
  - [x] emissive color
  - [x] emissiveIntensity slider/input
- [x] Form degisince preview anlik guncellensin.
- [x] Save butonu `/__save-material` endpoint'ine yazsin.
- [x] Kayit sonrasi dirty state temizlensin.

Kabul kriteri:

- Bir `.material.json` dosyasi editor icinde acilip degistirilebilir.
- Save sonrasi dosya diskte guncellenir.
- Yeniden acinca ayni degerler gelir.

### Faz 4 - Runtime/editor entegrasyon

- [x] `loadForgeMaterial` yeni canonical alanlari desteklesin.
- [x] `side` -> Three.js side mapping.
- [x] `alphaMode` -> transparent / alphaTest / depthWrite karari.
- [x] `maskTexture` destek karari uygulanir veya guvenli sekilde korunur.
- [x] Save sonrasi `SceneApp` material cache invalidate eder.
- [x] Save sonrasi material'i kullanan sahne instance'lari refresh olur.
- [~] Static Mesh Editor icindeki material preview yeni loader helper'ini kullansin.
- [x] Content Browser material thumbnail'i full canonical material degerlerinden render edilir.
- [x] Thumbnail cache invalidation ekle.

Kabul kriteri:

- Material Editor'da kaydedilen degisiklik sahnedeki atanmis objede gorunur.
- Static Mesh Editor ve Content Browser thumbnail'i stale kalmaz.

### Faz 5 - UX tamamlama

- [x] Texture picker sadece manifest texture asset'lerini listeler.
- [x] Texture picker'da `None` secenegi olur.
- [x] Slider + numeric input beraber calisir.
- [x] Glass preset icin transparency siralama uyarisi gerekiyorsa status mesajina eklenir.
- [x] `Apply to Selected` butonu secili static mesh instance'a material atar.
- [x] `Browse` butonu Content Browser'da material asset'i secer.
- [x] Editor kapanirken dirty state varsa kaydetmeden cikma uyarisi verir.

Kabul kriteri:

- Kullanici JSON elle acmadan materyal yaratma, duzenleme, kaydetme ve sahneye
  uygulama akisini tamamlayabilir.

### Faz 6 - Test ve dokuman senkronu

- [x] `tools/engine-tests.ts` icine material validator testleri ekle.
- [x] Content creation preset testleri ekle.
- [~] Loader mapping icin unit test veya headless smoke test ekle.
- [x] `npm run build:verify` calistir.
- [x] Bu checklist'te tamamlanan maddeleri sadece dogrulama sonrasi isaretle.
- [x] Gerekirse `docs/STARTER_CONTENT.md` material preset bilgisini guncelle.

Kabul kriteri:

- `npm run build:verify` gecer.
- Checklist'teki isaretler kod ve test kanitiyla uyumludur.

---

## Bolum F - Sonraki Fazlara Birakilanlar

- `MeshPhysicalMaterial` advanced editor:
  - transmission
  - ior
  - thickness
  - clearcoat
  - sheen
  - anisotropy
- Environment map / HDRI secimi.
- ORM texture channel editor.
- Material Instance Lite / Material Variant:
  - parent canonical `.material.json`;
  - `type: "materialInstance"` asset;
  - `parentMaterial` asset id;
  - sadece degisen alanlari tutan `overrides`;
  - runtime'da parent + overrides resolve edip normal Three.js material uretme.
- Material library / reusable presets.
- Node graph / shader graph.
- Custom GLSL / TSL tabanli shader authoring.

---

## Ilk Baslanacak Is

Kullanici komutu geldiginde ilk teknik adim **Faz 1 - Material schema ve
validator** olmalidir. Bunun nedeni: Editor UI, preset creation ve runtime refresh
ayni canonical schema'ya dayanmazsa sonradan alan uyumsuzlugu ve kayit kaybi
olur.
