# Player Controller & Camera Control - Rapor & Checklist

> Tarih: 2026-06-22
> Kapsam: `Player.actor.json` uzerine eklenen `SpringArm` + `Camera`
> component'lerini runtime'a baglamak, fare ile kontrol edilen bir ucuncu
> sahis kamerasi kurmak ve Forge'un "PlayerController" katmanini Unreal'e
> yaklastirmak.
>
> Onkosul: `docs/completed/PLAYER_CHARACTER_REQUIREMENTS_CHECKLIST.md` (Faz 0-6) tamam.
> Player.Actor artik mesh + capsule + CharacterMovement + SpringArm + Camera
> tasiyor; possession, locomotion ve takip kamera calisiyor. Bu dokuman bir
> sonraki adimi (Faz 7) tanimlar.

---

## Kaynaklar

- Unreal Player Controller: https://dev.epicgames.com/documentation/unreal-engine/player-controllers-in-unreal-engine
- Unreal Player-Controlled Cameras (C++): https://dev.epicgames.com/documentation/unreal-engine/quick-start-guide-to-player-controlled-cameras-in-unreal-engine-cpp
- Unreal Spring Arm Component: https://dev.epicgames.com/documentation/unreal-engine/using-spring-arm-components-in-unreal-engine
- Unreal Camera Component: https://dev.epicgames.com/documentation/unreal-engine/using-camera-components-in-unreal-engine
- Unreal Enhanced Input: https://dev.epicgames.com/documentation/unreal-engine/enhanced-input-in-unreal-engine
- Unreal Player Camera Manager: https://dev.epicgames.com/documentation/unreal-engine/player-camera-manager-in-unreal-engine
- Forge onceki calisma: `docs/completed/PLAYER_CHARACTER_REQUIREMENTS_CHECKLIST.md`

---

## Mevcut Durum Tespiti

### 1. SpringArm + Camera component'leri "olu veri"

`public/assets/starter-content/Script/Player.actor.json` bugun `SpringArm` ve
`Camera` component'lerini tasiyor; Details formu ve save akisi calisiyor. Fakat
runtime hicbirini okumuyor:

- `readSpringArmComponent` / `readCameraComponent` (`engine/scene/components.ts`)
  tanimli, ama `src/` altinda hicbir yerde cagrilmiyor.
- Oyun kamerasi hala `src/game/gameModes/tpsCharacterGameMode.ts` icindeki sabit
  `FOLLOW_CAMERA_CONFIG = { offset: [0, 1.2, 2.6], lookHeight: 0.5 }` ile
  surunuyor. Authored `targetArmLength`, `cameraLagSpeed`, `fieldOfView`,
  clip planlari yok sayiliyor.
- Bu, `completed/PLAYER_CHARACTER_REQUIREMENTS_CHECKLIST.md` Faz 5 son maddesinde
  bilincli olarak boyle birakildi: "Runtime kamera hala GameMode follow camera;
  component degerleri sadece authored+persist - sonraki faz follow camera'ya
  mapler." Bu dokuman o "sonraki faz".

### 2. Fare ile kamera oynamiyor

Uc ayri eksik var, ucu birbirine bagli:

1. **TPS look delta'yi tuketmiyor.** Altyapi hazir: `RuntimeSceneApp` zaten
   `consumeLookDelta`'yi `pointerLook`'a bagliyor ve `defaultCameraGameMode`
   bunu sag-tik suruklemeyle kullaniyor. Ama `TpsCharacterSession`
   `consumeLookDelta()`'yi hic cagirmiyor -> fare karakteri orbit edemiyor.
2. **Follow kamerasi donmuyor, sadece kayiyor.** `src/game/followCamera.ts`
   yorumunda yazili: kamera sabit world yonelimini koruyor, sadece pozisyon
   takip ediyor. Yaw/pitch kavrami yok.
3. **Hareket world-relative, kamera-relative degil.** `characterMovementSystem.ts`
   `planarMoveStep`'i ham WASD ile cagiriyor; kamera yaw'ini hesaba katmiyor.
   Su an "dogru" gorunmesinin tek sebebi kameranin donememesi. Kamera orbit
   etmeye baslar baslamaz W tusu hep world `-z`'ye gidecegi icin bozulur.

### 3. PlayerController stateful degil

Forge'da "PlayerController" sadece `src/game/gameModes/types.ts` icindeki statik
`PlayerControllerDefinition` (id, inputActions, possess stratejisi). Tick'lenen,
control rotation tutan bir runtime nesnesi yok.

---

## Unreal Karsilastirmasi

Unreal PlayerController'da olup Forge'da eksik olanlar:

| Unreal ozelligi | Ne ise yarar | Forge durumu |
|---|---|---|
| **Control Rotation** | Controller'in pawn'dan bagimsiz yaw/pitch'i; fare bunu dondurur, spring arm bunu kullanir | Yok - en kritik eksik |
| **Possess / UnPossess / OnPossess** | Pawn'i runtime'da sahiplen/birak | Kismen: spawn + possess var, unpossess/yeniden possess yok |
| **PlayerCameraManager + ViewTarget** | View target ata, kameralar arasi blend, shake, FOV blend | Yok - tek follow pose |
| **Enhanced Input** (actions, mapping context, modifiers, triggers, analog axis) | Deadzone/scale/invert, gamepad, mouse axis | ActionMap sadece boolean held/pressed; analog eksen yok |
| **Input Mode (Game/UI) + cursor lock** | Pointer lock, imleci gizle/goster | Yok - sadece sag-tik drag |
| **bUseControllerRotationYaw / bOrientRotationToMovement / bUseControllerDesiredRotation** | Karakter yonelimi: harekete mi kameraya mi (strafe/aim) | Sadece `orientRotationToMovement` |
| **SpringArm collision probe** (`doCollisionTest`) | Duvar arkasina girince kamerayi iceri cek | Field var (`components.ts`), kullanilmiyor |

---

## Mimari Karar

### 1. Control Rotation keystone'dur

Fare ile kamera kontrolunun anahtari, controller-owned bir `yaw/pitch` durumudur.
Mevcut araclarin hepsi hazir; yeniden yazmaya gerek yok:

```text
pointerLook (RuntimeSceneApp)
  -> consumeLookDelta()          (zaten GameModeContext'te)
  -> applyMouseLook()            (zaten cameraControl.ts'te)
  -> session.controlRotation     (YENI: TpsCharacterSession state)
  -> spring arm pose + movement frame
```

### 2. SpringArm + Camera component'leri follow pose'a maplenmeli

TPS session, possess ettigi pawn'in `readSpringArmComponent` /
`readCameraComponent` degerlerini okumali:

- `targetArmLength` + control yaw/pitch -> kamera pozisyonu (pivot etrafinda orbit).
- `socketOffset` / `targetOffset` -> sosket ve pivot ofsetleri.
- `enableCameraLag` / `cameraLagSpeed` -> mevcut `smoothingFactor` smoothing.
- `fieldOfView` / `nearClip` / `farClip` -> `camera.fov` + projeksiyon guncelleme.

Sabit `FOLLOW_CAMERA_CONFIG`'in yerini bu alir; Player.actor.json degerleri
gercekten is yapar.

### 3. Hareket kamera-relative olmali

Control yaw `CharacterMovementSubsystem`'e gecirilmeli; planar input vektoru yaw
kadar dondurulmeli (`cameraPlanarPan` mantigi zaten var). Bu olmadan Karar 1
kamerayi dondurdugu an WASD bozulur. Karar 1 ve 3 ayni adimda gitmeli.

### 4. Yonelim modu (orient-to-movement vs orient-to-control)

`orientRotationToMovement = true` -> karakter hareket yonune doner (free-look
takip). Aim/strafe icin `orientRotationToControl` (Unreal
`bUseControllerDesiredRotation`/`bUseControllerRotationYaw`) eklenmeli. Bu sonraki
fazda; ilk teslimde orient-to-movement yeterli.

### 5. PlayerController ilerleyen fazda stateful nesneye terfi

Ilk teslimde control rotation TPS session icinde yasayabilir. Olgunlastiginda
control rotation + input mapping context + input mode + possession sahibi olan
ayri bir runtime `PlayerController` nesnesine cikarilmali (Unreal-faithful).

---

## Ihtiyac Duyulan Bilesenler

### Runtime systems

- **Control rotation state**: TPS session'da yaw/pitch (`LookAngles`); her tick
  `consumeLookDelta` + `applyMouseLook`. Layout'a yazilmaz.
- **Spring arm camera resolver**: possessed pawn'in SpringArm/Camera
  component'ini okuyup control rotation ile orbit pose hesaplayan saf helper
  (`src/game/springArmCamera.ts` gibi, headless test edilebilir).
- **Camera-relative movement**: `CharacterMovementSubsystem`'e control yaw
  girisi; planar input'un yaw'a gore dondurulmesi (saf, test edilebilir).
- **Projection sync**: Camera component FOV/clip -> live PerspectiveCamera
  (`fov`, `near`, `far`, `updateProjectionMatrix`).

### Sonraki faz bilesenleri

- **SpringArm collision probe** (`doCollisionTest`): bom bloklaninca kamerayi
  iceri cek; mevcut collision/raycast altyapisini kullan.
- **Pointer lock + Input Mode**: play modunda imleci kilitle/gizle; Game/UI
  ayrimi.
- **ActionMap analog axis**: gamepad sag cubuk / mouse axis -> look. Deadzone,
  scale, invert modifier'lari.
- **Stateful PlayerController**: control rotation + mapping context + possess
  sahibi runtime nesnesi.

### Editor / tooling

- SpringArm/Camera Details formlari zaten var; runtime baglandiktan sonra alan
  isimleri davranisla eslesmeli (gerekirse tooltip/aciklama guncelle).
- Runtime debug paneline control rotation (yaw/pitch) ve aktif kamera kaynagi
  (follow config vs spring arm component) eklenmeli.

---

## Checklist

Durum: `[ ]` yapilmadi, `[~]` devam ediyor, `[x]` tamam.

### Faz 7 - Fare kontrollu spring arm kamera (oncelik)

- [x] `TpsCharacterSession`'a control rotation (`LookAngles`) state'i ekle;
      her tick `consumeLookDelta()` + `applyMouseLook()` ile guncelle.
- [x] Saf `springArmCamera` helper: possessed pawn'in SpringArm + Camera
      component'inden control yaw/pitch ile orbit pose ureten fonksiyon
      (headless test).
- [x] `readSpringArmComponent` / `readCameraComponent`'i TPS session'da oku;
      sabit `FOLLOW_CAMERA_CONFIG` yerine authored degerleri kullan.
- [x] `enableCameraLag` / `cameraLagSpeed` -> `smoothingFactor` smoothing'e bagla.
- [x] Camera component FOV/near/far -> live PerspectiveCamera projeksiyonu.
- [x] Hareketi kamera-relative yap: control yaw'i `CharacterMovementSubsystem`'e
      gecir, planar input'u yaw kadar dondur (saf, test edilebilir).
- [x] Component yoksa eski sabit follow davranisina guvenli geri donus.
- [x] Engine tests: control rotation clamp, orbit pose, camera-relative input
      donusu, FOV mapping.
- [x] Runtime debug paneli: control yaw/pitch + aktif kamera kaynagi.
- [x] `npm run build:verify`.

### Faz 8 - Yonelim ve girdi olgunlugu

- [x] `orientRotationToControl` (strafe/aim) yonelim modu; CharacterMovement
      prop + validator allowlist + Details form.
- [x] SpringArm `doCollisionTest`: bom bloklaninca kamerayi iceri cek.
- [x] Pointer lock + Input Mode (Game/UI), imleci gizle/goster;
      `Esc` sonrası UI moda gecip gameplay input'unu kes, canvas tiklayinca Game moda don.
- [x] PlayerController look ayarlari: mouse sensitivity + invert Y runtime'a bagli.
- [x] ActionMap analog axis (gamepad/mouse axis) + deadzone/scale/invert
      modifier'lari.

### Faz 9 - PlayerController terfisi ve kamera yonetimi

- [x] Stateful runtime `PlayerController`: control rotation + mapping context +
      input mode + possess/unpossess sahibi.
- [x] PlayerCameraManager benzeri view target + kameralar arasi blend.
- [x] Sprint'te FOV blend / camera shake gibi gameplay kamera efektleri.
- [x] `docs/UNREAL_BASICS_LESSONS.md` progress log + kanonik dosya listesi
      guncel kalsin.

---

## Kabul Kriteri (Faz 7)

- Fare hareketi karakteri orbit ediyor (yaw + clamp'li pitch).
- Kamera pozisyonu/FOV/lag, Player.actor.json'daki SpringArm + Camera
  degerlerinden geliyor; sabit `FOLLOW_CAMERA_CONFIG` yalnizca component yoksa
  fallback.
- WASD kameranin baktigi yone gore calisiyor (kamera-relative).
- Component degerleri degistirilince kamera davranisi gozle gorulur sekilde
  degisiyor (artik olu veri degil).
- Runtime state layout'a yazilmiyor; built-in default camera modu etkilenmiyor.

---

## Ilgili Dosyalar

- `public/assets/starter-content/Script/Player.actor.json` - SpringArm + Camera authored.
- `engine/scene/components.ts` - `readSpringArmComponent` / `readCameraComponent`.
- `src/game/playerController.ts` - runtime `PlayerController`: control rotation, input policy, possess/unpossess.
- `src/game/playerCameraManager.ts` - runtime view target, projection sync,
  kamera kaynaklari arasi blend, sprint FOV offset ve camera shake efektleri.
- `src/game/gameModes/tpsCharacterGameMode.ts` - TPS possession, spring arm camera ve locomotion bridge.
- `src/game/gameModes/defaultCameraGameMode.ts` - live camera pawn + runtime controller kullanimi.
- `src/game/gameModes/projectGameMode.ts` - project GameMode'un TPS controller varsayilanlarini devralmasi.
- `src/game/followCamera.ts` - fallback takip kamera matematigi.
- `src/game/gameModes/cameraControl.ts` - `applyMouseLook`, `forwardFromLookAngles`, `cameraPlanarPan`.
- `src/game/characterMovementSystem.ts` - kamera-relative hareket ve orient-to-control.
- `src/game/gameModes/types.ts` - `consumeLookDelta`, `PlayerControllerDefinition`, `GameModeSession`.
- `src/scene/RuntimeSceneApp.ts` - `pointerLook` -> `consumeLookDelta` baglantisi.
</content>
</invoke>
