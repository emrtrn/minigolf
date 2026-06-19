# Forge Starter Content

This pack lives under `public/assets/starter-content` and is registered in
`public/assets/manifest.json`. It is meant for fast prototyping in the default
project, similar in purpose to Unreal Starter Content, but project-local and
replaceable.

## Created In Repo

- `StaticMeshes/Shapes`
  - `SM_Starter_Cube.glb`
  - `SM_Starter_Sphere.glb`
  - `SM_Starter_Cylinder.glb`
  - `SM_Starter_Cone.glb`
  - `SM_Starter_Plane.glb`
- `StaticMeshes/Prototype`
  - `SM_Prototype_Ramp.glb`
  - `SM_Prototype_Wall.glb`
  - `SM_Prototype_Platform.glb`
  - `SM_Prototype_Pillar.glb`
- `StaticMeshes/Props`
  - `SM_Prototype_Crate.glb`
- `Textures`
  - `T_Prototype_Grid.png`
  - `T_Checker_Neutral.png`
  - `T_Concrete_Noise.png`
  - `T_Grass_Noise.png`
  - `T_Flat_Normal.png`
  - `T_Roughness_Mid.png`
  - `T_Brick_Clay_Beveled_D.png`
  - `T_Brick_Clay_Beveled_M.png`
  - `T_Brick_Clay_Beveled_N.png`
  - `T_Brick_Clay_New_D.png`
  - `T_Brick_Clay_New_M.png`
  - `T_Brick_Clay_New_N.png`
  - `T_Brick_Clay_Old_D.png`
  - `T_Brick_Clay_Old_N.png`
  - `T_Brick_Cut_Stone_D.png`
  - `T_Brick_Cut_Stone_N.png`
  - `T_Brick_Hewn_Stone_D.png`
  - `T_Brick_Hewn_Stone_M.png`
  - `T_Brick_Hewn_Stone_N.png`
  - `T_Burst_M.png`
  - `T_Ceramic_Tile_M.png`
  - `T_Ceramic_Tile_N.png`
  - `T_Checker_Noise_M.png`
- `Materials`
  - `M_Prototype_Grid.material.json`
  - `M_Concrete.material.json`
  - `M_Grass.material.json`
  - `M_Metal.material.json`
  - `M_Glass.material.json`
  - `M_Emissive.material.json`
  - `M_Brick_Clay_Beveled.material.json`
  - `M_Brick_Clay_New.material.json`
  - `M_Brick_Clay_Old.material.json`
  - `M_Brick_Cut_Stone.material.json`
  - `M_Brick_Hewn_Stone.material.json`
- `Sounds`
  - `S_UI_Click.wav`
  - `S_UI_Confirm.wav`
  - `S_Footstep_Stone.wav`
  - `S_Impact_Light.wav`
  - `S_Door_Open.wav`
  - `S_Ambient_Room.wav`
  - `Collapse01.OGG`
  - `Collapse02.OGG`
  - `Explosion01.OGG`
  - `Explosion02.OGG`
  - `Fire01.OGG`
  - `Fire_Sparks01.OGG`
  - `Light01.OGG`
  - `Light02.OGG`
  - `Smoke01.OGG`
  - `Starter_Birds01.OGG`
  - `Starter_Music01.OGG`
  - `Starter_Wind05.OGG`
  - `Starter_Wind06.OGG`
  - `Steam01.OGG`
- `Effects`
  - `FX_Smoke_Puff.effect.json`
  - `FX_Spark_Burst.effect.json`
  - `FX_Dust_Hit.effect.json`
  - `FX_Interaction_Glow.effect.json`
- `Levels`
  - `L_Starter_Showcase.level.json`
  - `L_Greybox_Prototype.level.json`

## Material Authoring

Content Browser -> New -> Material opens a preset picker before creating the
asset. Current starter presets seed canonical `.material.json` data for:

- Standard Surface
- Textured Surface
- Metal
- Glass
- Emissive
- Unlit Basic

Double-click a material asset to open the form-based Material Editor. The editor
updates the material preview sphere, writes through `/__save-material`, refreshes
scene material caches, and invalidates Content Browser thumbnails so saved color,
texture, roughness, metalness, opacity, side, alpha, and emissive changes show in
the asset card.

Future material reuse should prefer a lightweight Material Instance Lite /
Material Variant model instead of copying Unreal's full Material Instance stack.
The intended shape is parent canonical `.material.json` plus a
`type: "materialInstance"` asset that stores `parentMaterial` and only the
overridden fields. Resolve parent + overrides at load time and still emit a
normal Three.js material.

## Needs User Replacement

These generated files are functional placeholders. Replace them with authored or
properly licensed production-quality content when available:

- Real PBR texture sets:
  - concrete: baseColor, normal, roughness
  - grass: baseColor, normal, roughness
  - wood: baseColor, normal, roughness
  - metal: baseColor, normal, roughness, metallic
  - water/noise masks for shader experiments
- Real audio:
  - footstep sets for stone, wood, metal, grass
  - UI click, hover, confirm, error
  - object impact, pickup, door open/close
- Better prototype meshes:
  - stairs module
  - doorway module
  - arch/window module
  - floor/wall corner modules
  - gameplay markers or pickup props
- VFX textures and authored effect presets:
  - smoke sprite
  - spark sprite
  - dust sprite
  - glow/ring sprite

## License Note

Do not copy Unreal Engine Starter Content directly into Forge unless the license
for the target use is confirmed. Use it as a reference for coverage and folder
shape, then use original or compatible licensed assets here.
