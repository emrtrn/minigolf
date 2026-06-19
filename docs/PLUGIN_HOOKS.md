# Minimal Plugin Hooks

> Status: deferred design note | Created: 2026-06-13

The editor should not grow a plugin framework before a second real project needs
one. This note defines the smallest future shape so project-specific editor
extensions do not become ad hoc when that moment arrives.

## Trigger

Do not implement plugin loading until at least one real project built on this
template needs a custom asset type, panel, tool, or runtime hook that cannot be expressed
with `project.3dgame.json`, asset catalog metadata, layouts, prefabs, or normal
project runtime code.

## Initial Interface

```ts
export interface EditorPlugin {
  id: string;
  name: string;
  registerAssetTypes?: () => AssetTypeDefinition[];
  registerPanels?: () => EditorPanelDefinition[];
  registerTools?: () => EditorToolDefinition[];
  registerRuntimeHooks?: () => RuntimeHookDefinition[];
}
```

## First Allowed Hook Types

- asset type definitions
- custom panels
- custom editor tools
- runtime hooks used only by Preview Mode or Package Mode

## Explicitly Out Of Scope

- node editor
- shader graph
- material graph
- physics editor
- marketplace ecosystem
- plugin code bundled into every game by default

## Rule

Plugins extend editor behavior; they do not replace the project manifest,
asset catalog, layout/prefab schemas, or runtime-only package boundary.
