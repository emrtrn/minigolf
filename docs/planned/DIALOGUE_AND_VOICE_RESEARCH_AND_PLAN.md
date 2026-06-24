# Diyalog ve Voice Araştırması ve Forge Planı

> Tarih: 2026-06-23
> Kapsam: Unreal tarzı author edilmiş diyalog, dialogue voice metadata, altyazı, localization ve Sound Cue Lite ile ilişkisi.
> Durum: Araştırma / planlama. Bu dilimde runtime veya editor uygulaması yoktur.

## Kısa sonuç

Dialogue and Voice, Sound Cue Lite'tan **ayrı bir Forge çalışma başlığı** olmalıdır.

Sound Cue Lite şu soruya cevap verir: "Sesleri nasıl mixler, varyasyonlu çalar ve temel playback özelliklerini değiştiririz?"

Dialogue/Voice şu soruya cevap verir: "Kim konuşuyor, kim dinliyor, hangi recorded line/subtitle/localized variant çalmalı ve gameplay/conversation akışı nasıl ilerlemeli?"

İki alan playback noktasında kesişir: bir dialogue line, aynı `AudioSubsystem` üzerinden raw `sound`, `soundCue` veya ileride `dialogueWave` source çalabilir. Fakat authoring modeli, localization ihtiyacı, subtitle timing, speaker/listener context ve conversation state farklı olduğu için bunları Sound Cue v1 içine koymak kapsamı gereksiz büyütür.

## Unreal araştırması

### Dialogue Voice ve Dialogue Wave

Unreal spoken dialogue için iki ayrı asset kavramı kullanır:

- `Dialogue Voice`: konuşan voice identity/metadata. Gender ve plurality gibi alanlar tutar; audio dosyası içermez.
- `Dialogue Wave`: tek bir konuşma satırı. Spoken text, subtitle text/override, voice actor direction, mature flag ve birden fazla context mapping taşır.

Ana fikir: aynı metin, speaker/listener context'e göre farklı recorded audio'ya çözülebilir. Dialogue Context, speaker ve target voice'ları eşler; context mapping ise bunu bir Sound Wave'e bağlar.

Kaynaklar:

- https://dev.epicgames.com/documentation/en-us/unreal-engine/audio-system-overview?application_version=4.27
- https://dev.epicgames.com/documentation/en-us/unreal-engine/using-dialogue-voices-and-waves?application_version=4.27
- https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/DialogueWave?application_version=5.3
- https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/DialogueContextMapping?application_version=5.0

### Altyazı ve localization

Unreal Dialogue Wave yalnızca audio wrapper değildir. Audio'yu spoken text, subtitle text, translation context ve voice actor notlarıyla bağlar. Unreal dokümanları Dialogue Voice/Wave asset'lerini in-game dialogue event, subtitle ve localization desteği için konumlandırır.

Forge'da da ayrım şöyle olmalı:

- audio file = raw asset;
- dialogue line = text, subtitle, context, metadata, resolved audio;
- conversation = sequence/branching/state logic.

Altyazılar Sound Cue asset içine gömülmemelidir. Sound Cue audio işler; dialogue ise metin ve gameplay context ister.

### Sound Cue ilişkisi

Unreal Sound Cue içinde `Dialogue Player` node'u bulunur. Bu node, belirli speaker/listener context altında bir Dialogue Wave çalar. Fakat daha karmaşık konuşmalar için Sound Cue + Audio Component yanında ayrı conversation manager ihtiyacı vardır; ayrıca basit Sound Cue akışında Dialogue Context'in dinamik değiştirilmesi sınırlıdır.

Forge için sonuç:

- Sound Cue Lite dialogue logic sahibi olmamalı.
- İleride Sound Cue Lite içine `dialogueSource` / `dialoguePlayer` node'u eklenebilir.
- Ana runtime API yine `dialogue.play(lineId, context)` olmalıdır; cue tetikleyip altyazı/conversation state'in eşleşmesini ummak doğru değildir.

Kaynak:
https://dev.epicgames.com/documentation/en-us/unreal-engine/sound-cue-reference?application_version=4.27

### Voice chat ve microphone capture

Unreal'da "voice" canlı voice chat veya microphone capture anlamına da gelebilir:

- EOS Voice Chat, online/multiplayer voice service katmanıdır.
- Audio Capture Component, microphone/audio input tarafıdır; recording veya live input'a yakındır.

Bunlar authored NPC dialogue ile aynı problem değildir. Forge'da multiplayer chat veya recording ihtiyacı doğana kadar Dialogue/Voice authoring track dışında kalmalıdır.

Kaynaklar:

- https://dev.epicgames.com/documentation/en-us/unreal-engine/unreal-engine-4.27-release-notes?application_version=4.27
- https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/AudioCaptureComponent?application_version=5.5

## Kapsam kararı

Üç ayrı başlık kullanılmalı:

1. **Sound Cue Lite**
   - Mixing, randomization, pitch/volume modulation, loop, delay, cue preview.
   - Asset: `*.soundcue.json`.

2. **Dialogue and Voice**
   - Dialogue voice kimliği, dialogue line, subtitle text, localization key, voice actor direction, speaker/listener context, conversation playback.
   - Asset: `*.dialoguevoice.json`, `*.dialogue.json` veya `*.dialoguewave.json`, ileride `*.conversation.json`.

3. **Live Voice / Capture**
   - Microphone capture, multiplayer voice chat, recording, WebRTC/media izinleri.
   - Gerçek ürün ihtiyacı gelene kadar kapsam dışı.

## Forge mevcut durum

Forge'da bugün:

- manifest `sound` file desteği var;
- `AudioComponent`, `clipId`, `volume`, `loop`, `spatial`, `autoPlay` taşıyor;
- `AudioSubsystem` ile Web Audio one-shot/file playback var;
- dialogue asset modeli yok;
- subtitle runtime yok;
- localization table yok;
- conversation manager yok;
- audio-finished callback/handle yok;
- microphone capture veya live voice chat katmanı yok.

Bu, Dialogue/Voice'un küçük bir Sound Cue extension'ı gibi ele alınmaması gerektiğini doğrular. Ayrı data/runtime/editor yüzeyi gerekir.

## Önerilen Forge asset modeli

### Dialogue Voice

```ts
type DialogueVoiceAsset = {
  schema: 1;
  type: "dialogueVoice";
  id: string;
  name: string;
  actorId?: string;
  displayName?: string;
  gender?: "neutral" | "feminine" | "masculine";
  plurality?: "singular" | "plural";
  localeHints?: string[];
};
```

Amaç:

- karakter/voice identity;
- localization metadata;
- recorded audio olmadan da kullanılabilir voice referansı.

### Dialogue Line

```ts
type DialogueLineAsset = {
  schema: 1;
  type: "dialogueLine";
  id: string;
  spokenText: string;
  subtitleText?: string;
  voiceActorDirection?: string;
  mature?: boolean;
  contexts: DialogueContextMapping[];
};

type DialogueContextMapping = {
  speakerVoiceId: string;
  targetVoiceIds?: string[];
  locale?: string;
  audioSourceId?: string;
  audioSourceType?: "sound" | "soundCue";
  localizationKey?: string;
};
```

Amaç:

- tek authored line;
- context'e göre birden fazla recorded variant;
- subtitle/translation data line yanında kalır.

### Conversation

```ts
type ConversationAsset = {
  schema: 1;
  type: "conversation";
  id: string;
  nodes: ConversationNode[];
  startNodeId: string;
};

type ConversationNode =
  | { id: string; kind: "line"; lineId: string; speakerVoiceId: string; next?: string }
  | { id: string; kind: "choice"; prompt?: string; choices: { text: string; next: string }[] }
  | { id: string; kind: "event"; eventId: string; next?: string };
```

Amaç:

- sequence, branching, choices ve gameplay event'leri;
- basit bark/tek satır için şart değil, NPC konuşmaları için gereklidir.

## Runtime ihtiyaçları

`AudioSubsystem`'den ayrı bir `DialogueSubsystem` eklenmeli.

Sorumlulukları:

- `lineId + speakerVoiceId + targetVoiceId + locale` ile dialogue line çözmek;
- mapped raw `sound` veya `soundCue` source seçmek;
- playback için `AudioSubsystem` çağırmak;
- subtitle event'lerini runtime UI katmanına göndermek;
- `onLineStart`, `onLineEnd`, `onConversationChoice`, `onConversationEnd` event'leri sağlamak;
- audio eksikken subtitle'ı text length üzerinden estimated duration ile göstermek;
- context resolution ve conversation flow için deterministic headless test sağlamak.

Paralel veya ön koşul audio ihtiyaçları:

- playback handle;
- completion callback;
- decoded buffer metadata üzerinden opsiyonel duration lookup;
- dialogue line source'u `soundCue` olabilecekse cue playback desteği.

## Editor ihtiyaçları

Minimum yararlı editor yüzeyi:

- Content Browser `dialogueVoice`, `dialogueLine` ve ileride `conversation` asset'lerini tanır.
- Dialogue Voice editor: name, actor binding, gender/plurality/localization hints.
- Dialogue Line editor: spoken text, subtitle override, voice actor direction, mature flag, context mappings, linked audio source, preview.
- Conversation editor v1 görsel graph olmadan form/list tabanlı olabilir: line order, speaker, next, choices.
- Validation panel: missing audio, missing subtitle, duplicate localization key, missing speaker voice, source'suz context.

İlk adımda visual conversation graph kurulmamalı. List/tree editor daha hızlı ve test edilebilir.

## Kontrol listesi

### Faz 0 - Araştırma ve kapsam

- [x] Unreal Dialogue Voice / Dialogue Wave ayrımı araştırıldı.
- [x] Dialogue Player node'unun Sound Cue ile ilişkisi incelendi.
- [x] Live voice chat ve microphone capture ayrı kapsam olarak ayrıldı.
- [x] Dialogue/Voice'un Sound Cue Lite altında değil ayrı başlıkta ele alınmasına karar verildi.

### Faz D1 - Dialogue Line ve altyazı dikey kesiti

- [ ] `dialogueVoice` asset schema ekle.
- [ ] `dialogueLine` asset schema ekle.
- [ ] Yeni JSON asset tipleri için manifest recognition ekle.
- [ ] Loader/validator katmanını ekle.
- [ ] `DialogueSubsystem.playLine(lineId, context)` API'ini ekle.
- [ ] RuntimeSceneApp içinde subtitle event sink ekle.
- [ ] Minimal subtitle UI overlay ekle.
- [ ] Text + mevcut audio asset kullanan bir starter line ekle.
- [ ] Missing audio durumunda subtitle'ı estimated duration ile göster.
- [ ] Context resolution için headless test ekle.
- [ ] `npm run build:verify` gate'ini geçir.

### Faz D2 - Dialogue editor

- [ ] Dialogue Voice editor ekle.
- [ ] Dialogue Line editor ekle.
- [ ] Raw `sound` ve ileride `soundCue` için audio source picker ekle.
- [ ] Subtitle preview ile playback preview ekle.
- [ ] Missing audio/subtitle/speaker/localization key uyarılarını ekle.
- [ ] Save flow ve validation testlerini ekle.

### Faz D3 - Conversation manager

- [ ] `conversation` asset schema ekle.
- [ ] Line sequence ve choice node modelini ekle.
- [ ] Runtime conversation state machine ekle.
- [ ] Existing script/message system üzerinden gameplay event hook'ları ekle.
- [ ] Basit conversation UI ekle.
- [ ] NPC interaction ile conversation başlatma örneği ekle.
- [ ] Conversation flow testleri ekle.

### Faz D4 - Localization ve production pipeline

- [ ] Localization key ve per-locale mapping desteği ekle.
- [ ] Script/recording sheet için CSV/JSON import/export ekle.
- [ ] Missing recording raporu ekle.
- [ ] Voice actor direction export ekle.
- [ ] Locale bazlı subtitle/audio fallback policy ekle.
- [ ] Build öncesi missing localized asset raporu ekle.

### Kapsam dışı / ayrı başlık

- [ ] Microphone capture ayrı medya/recording planına taşınacak.
- [ ] Multiplayer voice chat ayrı online/WebRTC planına taşınacak.
- [ ] Procedural TTS ayrı üretim pipeline kararı gerektirir.

## Sound Cue Lite roadmap'i ile ilişki

Önerilen sıra:

1. Acil ihtiyaç SFX/ambience varyasyonuysa Sound Cue Lite Faz 1.
2. Acil ihtiyaç NPC line/subtitle ise Dialogue Faz D1.
3. Sonra köprü: dialogue context mapping, audio source olarak `soundCue` hedefleyebilir.

Dialogue D1 tam Sound Cue editor'a bağlı olmamalı. Dialogue raw `sound` asset'leriyle başlayabilir; cue desteği daha sonra eklenebilir.

## Son karar

**Dialogue and Voice** ayrı bir planned feature alanı olarak ele alınmalı.

Sound Cue Lite'a yakın durur çünkü playback altyapısını paylaşır; ama aynı kapsam değildir. İlk Forge deliverable küçük bir Dialogue Line + Subtitle dikey kesiti olmalı; live voice chat veya full conversation graph olmamalıdır.
