# Skeletal Root Motion / In Place

Forge supports clip-level root-motion playback settings for skeletal mesh assets.
The setting is stored in the asset sidecar as `rootMotion[]` inside the matching
`*.skeleton.json`.

Modes:

- `preserve`: play the imported clip as-is.
- `lockXZ`: pin the root node's horizontal translation and keep vertical motion.
- `lockXYZ`: pin the root node's full translation to the first frame.

The Skeletal Mesh Editor exposes the controls in Animation mode for the selected
clip. `Root Node` can be left on Auto or assigned to an animated position node
such as `Root`, `Armature`, or `Hips`.

Playback does not rewrite the source GLTF. The editor and runtime build filtered
`AnimationClip` variants before handing clips to `AnimationMixer`, so character
movement still comes from gameplay systems such as CharacterMovement/capsule
motion while the animation supplies the pose.
