import type { EditorCommand, EditorHistoryState } from "@editor/core/history";
import { EditorCommandStore } from "@editor/core/history";
import type { Selection } from "@editor/core/selection";
import { SelectionStore } from "@editor/core/selectionStore";

type StatusTone = "info" | "success" | "warning" | "error";

export interface EditorSceneControllerHost {
  emitHistoryChanged: () => void;
  emitSelectionChanged: () => void;
  getGroupedSelections: (selection: Selection) => Selection[];
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
}
