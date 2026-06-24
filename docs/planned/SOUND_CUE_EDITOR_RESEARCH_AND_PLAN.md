# Sound Cue Editor Araştırması ve Forge Planı

> Tarih: 2026-06-23
> Kapsam: Forge için Unreal tarzı ses cue authoring sistemi.
> Durum: Araştırma / planlama. Bu dilimde runtime veya editor uygulaması yoktur.

## Kısa sonuç

Forge, Unreal'ın tüm ses sistemini kopyalamamalı. Doğru hedef **Sound Cue Lite**:

- ham ses dosyaları manifest içinde `sound` asset olarak kalır (`wav`, `ogg`, `mp3`);
- authoring cue'ları ayrı veri asset'i olur: `*.soundcue.json` / `assetType: "soundCue"`;
- editor, katmanlama, random seçim, volume/pitch varyasyonu, loop, delay, preview ve output gain için küçük bir node graph sunar;
- runtime bu graph'ı `AudioSubsystem` üzerinden Web Audio node'larına derler;
- 3B attenuation, bus/submix, modulation ve occlusion sonraki fazlara bırakılır.

İlk sürümde hedef procedural synthesis değil; "impact sesini küçük pitch farklarıyla çal", "footstep varyasyonu seç", "oda ambiyansını loop et", "fire loop + crackle sparks mixle" gibi pratik iş akışlarıdır.

## Unreal araştırması

### Sound Cue Editor

Unreal'da Sound Cue, ses playback davranışını node tabanlı bir audio asset içinde tanımlar. Editor yüzeyi Details panel, Audio Node Graph, Palette ve toolbar preview kontrollerinden oluşur. Graph, soldaki Sound Wave source node'larından sağdaki Output node'una akar. Editor, tüm cue'yu veya seçili node'u preview edebilir; playback sırasında aktif bağlantıların görselleştirilmesi debug için kullanılır.

Forge için alınacak ders:

- raw audio ile cue asset'i ayrı kalmalı;
- yalnızca form değil, graph + node details yüzeyi olmalı;
- preview/debug baştan tasarlanmalı;
- cue output volume/pitch cue seviyesinde, layer kontrolü node seviyesinde tutulmalı.

Kaynak:
https://dev.epicgames.com/documentation/en-us/unreal-engine/sound-cue-editor?application_version=4.27

### Sound Cue node tipleri

Unreal Sound Cue referansı geniştir; Forge ilk sürümde küçük bir alt kümeyi almalı:

- `Wave Player`: ham audio clip source.
- `Mixer`: aynı anda çalan layer'lar ve giriş başına volume.
- `Modulator`: cue tetiklendiğinde random volume/pitch aralığı.
- `Random`: weighted varyant seçimi ve no-repeat seçeneği.
- `Looping`: source loop.
- `Delay`: source başlamadan önce gecikme.
- `Switch` / `Branch`: runtime parametreyle seçim.
- `Crossfade by Param` / `Crossfade by Distance`: dinamik blend.
- `Attenuation`: mesafe/spatial davranış override'ı.

Forge v1 için Source, Output, Mixer, Random, Modulator, Loop ve Delay yeterlidir. Switch/crossfade/attenuation, cue parametreleri ve positional audio gerçek olduğunda gelmelidir.

Kaynak:
https://dev.epicgames.com/documentation/en-us/unreal-engine/sound-cue-reference?application_version=4.27

### AudioComponent

Unreal'da `AudioComponent`, Actor altında bir ses instance'ı oluşturur ve kontrol eder. Sound Wave veya Sound Cue çalabilir; runtime kodu play/stop/fade ve property değişiklikleri yapabilir.

Forge'da doğru kavramsal yüzey zaten var: scene object üstünde authored `Audio` component. Eksik olan, bu component'in bugün tek bir `clipId` göstermesi; reusable cue graph veya canlı playback handle taşımamasıdır.

Kaynak:
https://dev.epicgames.com/documentation/en-us/unreal-engine/audio-components?application_version=4.27

### Attenuation ve spatial audio

Unreal Sound Attenuation ayrı bir settings asset'tir; distance falloff, attenuation shape, spatialization, air absorption, listener focus, reverb send ve occlusion gibi alanları kontrol eder.

Forge burada tüm sistemi değil, ayrımı kopyalamalıdır. İlk pratik model:

- aktif kamera/player'dan tek listener;
- spatial source başına `PannerNode`;
- sphere distance attenuation: `innerRadius`, `falloffDistance`, curve type;
- debug visualization daha sonra.

Box/capsule/cone shape, air absorption, listener focus, reverb send ve occlusion sonraki fazlara kalmalıdır.

Kaynak:
https://dev.epicgames.com/documentation/en-us/unreal-engine/sound-attenuation?application_version=4.27

### Submix ve audio modulation

Unreal Submix, source sesleri ortak output buffer'larda mixleyen ve grup efektleri uygulayan DSP graph'tır. Audio Modulation ise control bus ve mix stage mantığıyla ortak float/buffer parametrelerini yönetir.

Forge karşılığı daha küçük bir **Audio Bus Lite** olmalıdır:

- bus listesi: `master`, `music`, `sfx`, `ui`, `ambience`;
- her bus bir `GainNode`;
- cue output bir bus'a route edilir;
- mix snapshot'ları bus gain değerlerini değiştirir;
- filter/compressor/reverb gibi efekt slotları bus routing sabitlendikten sonra eklenir.

Kaynaklar:

- https://dev.epicgames.com/documentation/en-us/unreal-engine/submixes?application_version=4.27
- https://dev.epicgames.com/documentation/en-us/unreal-engine/audio-modulation-overview?application_version=4.27

### MetaSounds

UE5 MetaSounds, Sound Cue'dan daha çok programlanabilir audio rendering graph'ıdır: sample-accurate control, game-data parametreleri, event'ler, graph composition, interface, preset ve plugin API'leri sunar.

Forge ilk sürümde MetaSound hedeflememeli. MetaSound benzeri procedural graph; sample scheduling, oscillator, envelope, parameter-rate semantics ve daha güçlü graph compiler gerektirir. Bu, basit ses mixleme ve temel özellik değiştirme ihtiyacından ayrı bir araç setidir.

Kaynak:
https://dev.epicgames.com/documentation/en-us/unreal-engine/unreal-engine-5.0-release-notes?application_version=5.0

## Forge mevcut durum

Forge'da bugün şu temel parçalar var:

- `LayoutAudio`, `clipId`, `volume`, `loop`, `spatial`, `autoPlay` alanlarını serializable layout data olarak tutuyor.
- Details panel bir `Audio` component ekleyebiliyor, manifest `sound` asset'leri dropdown'dan seçilebiliyor, volume/autoPlay/loop/spatial düzenlenebiliyor.
- `RuntimeSceneApp`, manifest `sound` asset'lerini fetch edilebilir URL'lere mapliyor, scene load sırasında `autoPlay` audio çalıyor ve ilk pointer/key gesture sonrası Web Audio context'i resume ediyor.
- `AudioSubsystem`, Web Audio backend, one-shot queue, decoded-buffer promise cache, built-in tone clip ve file playback (`AudioBufferSourceNode` + `GainNode`) içeriyor.
- Asset manifest `wav`, `ogg`, `mp3` dosyalarını `sound` olarak tanıyor.

Önemli yerel referanslar:

- `engine/audio/audioSubsystem.ts`
- `engine/scene/layout.ts`
- `src/editor/EditorUi.ts`
- `src/scene/RuntimeSceneApp.ts`
- `engine/assets/manifest.ts`

Mevcut sınır: `spatial` saklanıyor ama gerçek positional audio olarak uygulanmıyor. Playback handle dönmediği için uzun loop'lar sonradan durdurulamıyor, fade edilemiyor veya pitch/volume güncellenemiyor.

## Gap analizi

| Alan | Unreal karşılığı | Forge bugün | Öneri |
| --- | --- | --- | --- |
| Raw clip asset | Sound Wave | Manifest `sound` file | Koru |
| Cue asset | Sound Cue graph | Minimal `.sound.json` stub / graph yok | `soundCue` asset ekle |
| Cue editor | Graph + palette + details + preview | Sadece Details Audio component | Ayrı editor ekle |
| Mixing | Mixer node | Yok | v1 |
| Varyant | Random weighted/no-repeat | Yok | v1 |
| Varyasyon | Pitch/volume modulator | Sadece volume | v1 |
| Runtime parametre | Branch/switch/crossfade | Yok | v2/v3 |
| Loop kontrolü | Looping / Wave Player loop | BufferSource loop, stop handle yok | v1 playback handle |
| Spatial audio | Attenuation/spatialization | Boolean saklanıyor | v2 |
| Submix | DSP graph ve send | Direct destination | v3 Audio Bus Lite |
| Modulation | Control bus/mix stage | Yok | v3 |
| Occlusion/reverb zone | Attenuation/reverb/occlusion | Yok | v4 |

## Önerilen Forge mimarisi

### Asset modeli

İki ayrı asset kategorisi kullanılmalı:

```ts
type RawSoundAsset = {
  assetType: "sound";
  path: "assets/audio/ui_click.wav";
};

type SoundCueAsset = {
  schema: 1;
  type: "soundCue";
  name: string;
  output: {
    volume?: number;
    pitch?: number;
    bus?: "master" | "music" | "sfx" | "ui" | "ambience";
  };
  nodes: SoundCueNode[];
  connections: SoundCueConnection[];
};
```

Önerilen uzantı: `*.soundcue.json`.

Raw `sound` asset'i overload edilmemeli. Bu repo içinde `sound` zaten playable audio dosyası anlamına geliyor. Cue graph farklı bir authoring asset'tir ve Audio component içinde seçilebilir ayrı source olmalıdır.

### V1 node seti

```ts
type SoundCueNode =
  | { id: string; kind: "output"; volume?: number; pitch?: number }
  | { id: string; kind: "source"; clipId: string; loop?: boolean; volume?: number; pitch?: number }
  | { id: string; kind: "mixer"; inputs: { pin: string; volume?: number }[] }
  | { id: string; kind: "random"; weights?: number[]; withoutReplacement?: boolean }
  | { id: string; kind: "modulator"; volumeMin?: number; volumeMax?: number; pitchMin?: number; pitchMax?: number }
  | { id: string; kind: "delay"; secondsMin?: number; secondsMax?: number };
```

V1 compiler kuralı:

- bir cue trigger, bir veya daha çok `AudioPlayRequest` üretir;
- `source.clipId`, manifest sound URL map'i üzerinden çözülür;
- `AudioBufferSourceNode`, `GainNode` ve opsiyonel playbackRate değişiklikleri oluşturulur;
- `mixer` birden fazla branch'i aynı anda başlatır;
- `random` tek branch seçer;
- `delay`, source'u `context.currentTime + delay` ile schedule eder;
- loop'lar için playback handle döner.

### Audio component değişikliği

Bugün:

```ts
{ clipId: "starter-snd-ui-click", volume: 0.8, loop: false, spatial: false }
```

Önerilen additive model:

```ts
{
  sourceId: "cue.fire_loop",
  sourceType: "soundCue",
  volume: 0.8,
  autoPlay: true,
  loop: true,
  spatial: true
}
```

Uyumluluk:

- `clipId` legacy/raw clip referansı olarak kabul edilmeye devam eder;
- runtime içinde `sourceId/sourceType` modeline normalize edilir;
- editor save açılmadan önce yeni alanlar `tools/saveValidator.ts` içinde allowlist edilmelidir.

### Editor yüzeyi

Mevcut asset editor desenini izleyen ayrı bir `SoundCueEditor` eklenmeli:

- Content Browser double-click ile `*.soundcue.json` açılır;
- sol/palette: Output, Source, Mixer, Random, Modulator, Delay;
- orta graph: pin'li kompakt node kutuları;
- sağ/details: seçili node alanları;
- üst toolbar: play cue, play selected node, stop, save;
- status/validation: missing clip, disconnected output, empty random input, invalid weight, decode failure.

Tam Blueprint graph sistemi kurmak ilk adım olmamalı. Tek output'a akan tree/DAG kısıtlı küçük typed graph yeterlidir.

### Runtime yüzeyi

`AudioSubsystem` şu yüzeyle genişlemeli:

```ts
interface AudioPlaybackHandle {
  stop(fadeSeconds?: number): void;
  setVolume(value: number, fadeSeconds?: number): void;
  setPitch(value: number): void;
}

interface AudioBus {
  playOneShot(clipId: string, options?: AudioPlayOptions): void;
  playCue(cueId: string, options?: AudioPlayOptions & { params?: Record<string, unknown> }): AudioPlaybackHandle | null;
}
```

Cue playback; saf graph evaluator + ince Web Audio compiler olarak ayrılmalı. Headless testler evaluator üstünde kalmalı.

## Kontrol listesi

### Faz 0 - Araştırma ve kapsam

- [x] Unreal Sound Cue Editor temel iş akışı araştırıldı.
- [x] Sound Cue node tiplerinden Forge v1 için gerekli alt küme seçildi.
- [x] MetaSounds kapsam dışı / ileri faz olarak ayrıldı.
- [x] Dialogue/Voice kapsamı ayrı dokümana taşındı.

### Faz 1 - Sound Cue Lite

- [ ] `soundCue` asset type ve `*.soundcue.json` manifest desteği ekle.
- [ ] Cue schema, normalize/validate ve loader/store katmanını ekle.
- [ ] `SoundCueEditor` kabuğunu ekle.
- [ ] Source, Output, Mixer, Random, Modulator, Loop, Delay node'larını destekle.
- [ ] Editor preview play/stop akışını ekle.
- [ ] Runtime cue evaluator'ı headless testlerle doğrula.
- [ ] Audio component'ten `soundCue` seçip Game Mode'da çal.
- [ ] `npm run build:verify` gate'ini geçir.

### Faz 2 - Audio component ve spatial v1

- [ ] `sourceId/sourceType` modelini `clipId` uyumluluğunu koruyarak ekle.
- [ ] Playback handle ile loop stop/fade desteği ekle.
- [ ] `spatial: true` için Web Audio `PannerNode` uygula.
- [ ] Listener konumunu runtime kamera/player üzerinden güncelle.
- [ ] Basit sphere attenuation alanlarını ekle.
- [ ] Runtime bundle içinde editor import sızıntısı olmadığını doğrula.

### Faz 3 - Audio Bus Lite

- [ ] `master`, `music`, `sfx`, `ui`, `ambience` bus'larını ekle.
- [ ] Cue output'u bus'a route et.
- [ ] Bus gain kontrolleri ve mix snapshot desteği ekle.
- [ ] Pause/menu ducking örneği ekle.
- [ ] Bus davranışını gerçek audio output olmadan test et.

### Faz 4 - İleri Unreal parity adayları

- [ ] Parametre tabanlı switch/branch/crossfade node'ları.
- [ ] Distance crossfade.
- [ ] Reusable attenuation preset asset'i.
- [ ] Forge collider'larına karşı occlusion ray testleri.
- [ ] World Settings içinde reverb/audio volume desteği.
- [ ] Cue debug overlay.
- [ ] Voice limit / concurrency.
- [ ] Procedural MetaSound benzeri node'lar.

## Riskler ve guardrail'ler

- Browser autoplay politikaları ilk gesture sonrası resume gerektirir; bu davranış korunmalı.
- `AudioBufferSourceNode` one-shot'tır; loop sesler retained handle ve replay için yeni source node ister.
- `spatial`, daha görünür hale geldiğinde no-op kalmamalıdır.
- Çok sayıda clip decode etmek bellek/CPU spike üretebilir; buffer cache korunmalı, sonra unload/voice limit eklenmelidir.
- Cue graph asset'leri plain JSON kalmalı. Web Audio node, decoded buffer veya runtime handle serialize edilmemeli.
- Runtime route editor graph UI import etmemeli.
- Yeni layout/asset alanları `tools/saveValidator.ts` içinde allowlist edilmelidir.

## Önerilen ilk uygulama

İlk dikey kesit:

1. `soundCue` schema + manifest recognition.
2. Tek output, birkaç source, mixer/random/modulator edit edebilen basit editor.
3. Cue'yu mevcut `AudioSubsystem` play request'lerine çeviren runtime evaluator.
4. Bir starter cue: `SC_Footstep_Stone.soundcue.json`.

Bu kesit, Forge'u tam visual scripting veya MetaSound mimarisine bağlamadan hemen tasarım değeri üretir.

## İlgili kapsam: Dialogue and Voice

Dialogue/Voice, Sound Cue Lite'a yakın durmalı ama aynı kapsama alınmamalıdır. Sound Cue Lite audio graph playback işini sahiplenir: mixing, randomization, pitch/volume variation, looping, delay, preview ve ileride bus/spatialization. Dialogue/Voice ise speaker/listener context, subtitle, localization key, voice actor direction, conversation flow ve doğru recorded line çözümlemeyi sahiplenir.

Takip planı: `docs/planned/DIALOGUE_AND_VOICE_RESEARCH_AND_PLAN.md`.
