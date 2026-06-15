import type { EditorCommand, EditorCommandPhase, EditorHistoryState } from "@editor/core/history";
import { EditorCommandStore } from "@editor/core/history";
import { uniqueEditorId } from "@editor/core/ids";
import {
  cloneSelection,
  parseSelectionId,
  selectionsEqual,
  type Selection,
} from "@editor/core/selection";
import { SelectionStore } from "@editor/core/selectionStore";

type StatusTone = "info" | "success" | "warning" | "error";

type MutableHierarchyTransform = {
  groupId?: string;
  nodeId?: string;
  parentId?: string;
};

export interface EditorSceneControllerHost {
  applyGroupId: (
    selection: Selection,
    groupId: string | undefined,
    options?: { notify?: boolean },
  ) => void;
  descendantsOf: (selection: Selection) => Selection[];
  emitHistoryChanged: () => void;
  emitSelectionChanged: () => void;
  getAllSelections: (options: { includeHidden: boolean }) => Selection[];
  getGroupedSelections: (selection: Selection) => Selection[];
  getMutableTransform: (selection: Selection) => MutableHierarchyTransform | null;
  getSelectionLabel: (selection: Selection) => string;
  hasSelection: (selection: Selection) => boolean;
  onStatus: (message: string, tone?: StatusTone) => void;
  updateGizmo: () => void;
  updateSelectionBox: () => void;
}

/**
 * Editor-only scene command controller. This starts as the history/command
 * owner; tightly coupled command orchestration moves here in later slices.
 */
export class EditorSceneController {
  private readonly host: EditorSceneControllerHost;
  private readonly commandStore = new EditorCommandStore();
  private readonly selectionStore = new SelectionStore();

  constructor(host: EditorSceneControllerHost) {
    this.host = host;
  }

  getHistoryState(): EditorHistoryState {
    return this.commandStore.state();
  }

  get selection(): Selection | null {
    return this.selectionStore.activeSelection;
  }

  set selection(value: Selection | null) {
    this.selectionStore.activeSelection = value;
  }

  get selectedCount(): number {
    return this.selectionStore.selectedCount;
  }

  undo(): void {
    const result = this.commandStore.undo();
    if (!result) return;
    this.host.emitHistoryChanged();
    this.host.onStatus(result.statusMessage, result.statusTone);
  }

  redo(): void {
    const result = this.commandStore.redo();
    if (!result) return;
    this.host.emitHistoryChanged();
    this.host.onStatus(result.statusMessage, result.statusTone);
  }

  executeCommand(command: EditorCommand): void {
    const result = this.commandStore.execute(command);
    this.host.emitHistoryChanged();
    this.host.onStatus(result.statusMessage, result.statusTone);
  }

  select(selection: Selection | null): void {
    this.selection = this.selectionStore.selectGroup(
      selection,
      selection ? this.host.getGroupedSelections(selection) : [],
    );
    this.host.updateSelectionBox();
    this.host.updateGizmo();
    this.host.emitSelectionChanged();
  }

  selectMany(selections: Selection[], active: Selection | null): void {
    this.selection = this.selectionStore.selectMany(
      selections.filter((selection) => this.host.hasSelection(selection)),
      active,
    );
    this.host.updateSelectionBox();
    this.host.updateGizmo();
    this.host.emitSelectionChanged();
  }

  toggleSelection(selection: Selection): void {
    this.selection = this.selectionStore.toggleGroup(
      selection,
      this.host.getGroupedSelections(selection),
    );
    this.host.updateSelectionBox();
    this.host.updateGizmo();
    this.host.emitSelectionChanged();
  }

  isSelectionSelected(selection: Selection): boolean {
    return this.selectionStore.has(selection);
  }

  getSelectedSelections(): Selection[] {
    return this.selectionStore.list((selection) => this.host.hasSelection(selection));
  }

  groupSelected(): void {
    const selections = this.getSelectedSelections();
    if (selections.length < 2) {
      this.host.onStatus("Select at least two objects to group.", "warning");
      return;
    }

    const groupId = this.createGroupId();
    const entries = selections.flatMap((selection) => {
      const target = this.host.getMutableTransform(selection);
      return target
        ? [
            {
              selection: cloneSelection(selection),
              previousGroupId: target.groupId,
            },
          ]
        : [];
    });
    if (entries.length < 2) {
      this.host.onStatus("Select at least two objects to group.", "warning");
      return;
    }

    const active = this.selection
      ? cloneSelection(this.selection)
      : cloneSelection(entries[0]!.selection);
    const applyEntries = (mode: EditorCommandPhase): void => {
      for (const entry of entries) {
        this.host.applyGroupId(
          entry.selection,
          mode === "redo" ? groupId : entry.previousGroupId,
          { notify: false },
        );
      }
      this.selectMany(
        entries.map((entry) => cloneSelection(entry.selection)),
        active,
      );
      this.host.emitSelectionChanged();
    };

    this.executeCommand({
      label: `Group ${entries.length} objects`,
      redo: () => applyEntries("redo"),
      undo: () => applyEntries("undo"),
    });
  }

  /** Clears the group id from every member of any group in the current selection. */
  ungroupSelected(): void {
    const groupIds = new Set<string>();
    for (const selection of this.getSelectedSelections()) {
      const groupId = this.host.getMutableTransform(selection)?.groupId;
      if (groupId) groupIds.add(groupId);
    }
    if (groupIds.size === 0) {
      this.host.onStatus("Selection is not grouped.", "warning");
      return;
    }

    const entries = this.host.getAllSelections({ includeHidden: true }).flatMap((selection) => {
      const target = this.host.getMutableTransform(selection);
      return target?.groupId && groupIds.has(target.groupId)
        ? [{ selection: cloneSelection(selection), previousGroupId: target.groupId }]
        : [];
    });
    if (entries.length === 0) return;
    const active = this.selection ? cloneSelection(this.selection) : null;

    const applyEntries = (mode: EditorCommandPhase): void => {
      for (const entry of entries) {
        this.host.applyGroupId(
          entry.selection,
          mode === "redo" ? undefined : entry.previousGroupId,
          { notify: false },
        );
      }
      this.selectMany(entries.map((entry) => cloneSelection(entry.selection)), active);
      this.host.emitSelectionChanged();
    };

    this.executeCommand({
      label: `Ungroup ${entries.length} objects`,
      redo: () => applyEntries("redo"),
      undo: () => applyEntries("undo"),
    });
  }

  /** Parents the other selected objects to the active selection (the parent). */
  parentSelectionToActive(): void {
    if (!this.selection) return;
    const parent = cloneSelection(this.selection);
    const parentTarget = this.host.getMutableTransform(parent);
    if (!parentTarget) return;

    // Cycle guard: an ancestor of the parent cannot become its child.
    const parentDescendantIds = new Set(
      this.host
        .descendantsOf(parent)
        .map((entry) => this.host.getMutableTransform(entry)?.nodeId)
        .filter((id): id is string => Boolean(id)),
    );

    const parentNodeId = parentTarget.nodeId ?? this.createNodeId();
    const children = this.getSelectedSelections().flatMap((selection) => {
      if (selectionsEqual(selection, parent)) return [];
      const target = this.host.getMutableTransform(selection);
      if (!target) return [];
      // Skip if this object is the parent's ancestor (would form a cycle).
      if (target.nodeId && parentDescendantIds.has(target.nodeId)) return [];
      if (target.parentId === parentNodeId) return [];
      return [{ selection: cloneSelection(selection), previousParentId: target.parentId }];
    });
    if (children.length === 0) {
      this.host.onStatus("Select children plus a parent (active) to parent.", "warning");
      return;
    }

    const hadParentNodeId = parentTarget.nodeId !== undefined;
    const apply = (mode: EditorCommandPhase): void => {
      const parentMut = this.host.getMutableTransform(parent);
      if (parentMut) {
        if (mode === "redo") parentMut.nodeId = parentNodeId;
        else if (!hadParentNodeId) delete parentMut.nodeId;
      }
      for (const child of children) {
        const target = this.host.getMutableTransform(child.selection);
        if (!target) continue;
        if (mode === "redo") target.parentId = parentNodeId;
        else if (child.previousParentId === undefined) delete target.parentId;
        else target.parentId = child.previousParentId;
      }
      this.host.emitSelectionChanged();
    };

    this.executeCommand({
      label: `Parent ${children.length} to ${this.host.getSelectionLabel(parent)}`,
      redo: () => apply("redo"),
      undo: () => apply("undo"),
    });
  }

  /**
   * Parents one or more objects (by scene-object id) to a target object.
   * Used by outliner drag-and-drop: drag child rows onto a parent row.
   * Cycle-safe (a target that is a descendant of a dragged object is skipped).
   */
  parentObjectsTo(childIds: string[], parentId: string): void {
    const parent = parseSelectionId(parentId);
    if (!parent || !this.host.hasSelection(parent)) return;
    const parentTarget = this.host.getMutableTransform(parent);
    if (!parentTarget) return;

    const parentNodeId = parentTarget.nodeId ?? this.createNodeId();
    const children = childIds.flatMap((childId) => {
      const selection = parseSelectionId(childId);
      if (!selection || !this.host.hasSelection(selection)) return [];
      if (selectionsEqual(selection, parent)) return [];
      const target = this.host.getMutableTransform(selection);
      if (!target) return [];
      // Cycle guard: the target cannot be a descendant of this child.
      const descendantIds = new Set(
        this.host
          .descendantsOf(selection)
          .map((entry) => this.host.getMutableTransform(entry)?.nodeId)
          .filter((id): id is string => Boolean(id)),
      );
      if (target.nodeId && descendantIds.has(parentNodeId)) return [];
      if (target.parentId === parentNodeId) return [];
      return [{ selection: cloneSelection(selection), previousParentId: target.parentId }];
    });
    if (children.length === 0) return;

    const hadParentNodeId = parentTarget.nodeId !== undefined;
    const apply = (mode: EditorCommandPhase): void => {
      const parentMut = this.host.getMutableTransform(parent);
      if (parentMut) {
        if (mode === "redo") parentMut.nodeId = parentNodeId;
        else if (!hadParentNodeId) delete parentMut.nodeId;
      }
      for (const child of children) {
        const target = this.host.getMutableTransform(child.selection);
        if (!target) continue;
        if (mode === "redo") target.parentId = parentNodeId;
        else if (child.previousParentId === undefined) delete target.parentId;
        else target.parentId = child.previousParentId;
      }
      this.host.emitSelectionChanged();
    };

    this.executeCommand({
      label: `Parent ${children.length} to ${this.host.getSelectionLabel(parent)}`,
      redo: () => apply("redo"),
      undo: () => apply("undo"),
    });
  }

  /** Clears the parent of every selected object. */
  unparentSelected(): void {
    const entries = this.getSelectedSelections().flatMap((selection) => {
      const target = this.host.getMutableTransform(selection);
      return target?.parentId !== undefined
        ? [{ selection: cloneSelection(selection), previousParentId: target.parentId }]
        : [];
    });
    if (entries.length === 0) {
      this.host.onStatus("Selection has no parent.", "warning");
      return;
    }

    const apply = (mode: EditorCommandPhase): void => {
      for (const entry of entries) {
        const target = this.host.getMutableTransform(entry.selection);
        if (!target) continue;
        if (mode === "redo") delete target.parentId;
        else target.parentId = entry.previousParentId;
      }
      this.host.emitSelectionChanged();
    };

    this.executeCommand({
      label: `Unparent ${entries.length} objects`,
      redo: () => apply("redo"),
      undo: () => apply("undo"),
    });
  }

  private createGroupId(): string {
    const existing = new Set<string>();
    for (const selection of this.host.getAllSelections({ includeHidden: true })) {
      const groupId = this.host.getMutableTransform(selection)?.groupId;
      if (groupId) existing.add(groupId);
    }

    return uniqueEditorId("group", existing, 10_000);
  }

  private createNodeId(): string {
    const existing = new Set<string>();
    for (const selection of this.host.getAllSelections({ includeHidden: true })) {
      const nodeId = this.host.getMutableTransform(selection)?.nodeId;
      if (nodeId) existing.add(nodeId);
    }
    return uniqueEditorId("node", existing);
  }
}
