/**
 * Tiny fps / draw-call readout for the HTML overlay (#debug-stats).
 * Enabled only with `?debug` in the URL so it never ships visible.
 * lil-gui (devDependency) is dynamically imported on demand later, when
 * scene parameters need live tweaking — keeps it out of the base bundle.
 */
import type { GameModeDebugSnapshot, RuntimeStatsApp, UiDebugSnapshot } from "./RuntimeSceneApp";

const UPDATE_INTERVAL_MS = 500;

export function attachDebugStats(app: RuntimeStatsApp, element: HTMLElement): void {
  let accumMs = 0;
  let frames = 0;

  app.onFrame = (deltaMs) => {
    accumMs += deltaMs;
    frames += 1;
    if (accumMs < UPDATE_INTERVAL_MS) return;

    const fps = (frames * 1000) / accumMs;
    const { drawCalls, triangles } = app.getRenderStats();
    element.textContent =
      `${fps.toFixed(0)} fps\n` +
      `${drawCalls} draw calls\n` +
      `${triangles} tris` +
      gameModeDebugText(app) +
      uiDebugText(app) +
      scriptMessageDebugText(app);
    accumMs = 0;
    frames = 0;
  };
}

/** The Game Mode / possessed-pawn block, or "" when the app exposes no snapshot. */
function gameModeDebugText(app: RuntimeStatsApp): string {
  if (!app.getGameModeDebugSnapshot) return "";
  return `\n${formatGameModeDebug(app.getGameModeDebugSnapshot()).join("\n")}`;
}

/**
 * Formats a {@link GameModeDebugSnapshot} into overlay lines (pure, so it is
 * unit-tested without the DOM): the active mode, the possessed pawn, and that
 * pawn's movement state. Null fields render as placeholders.
 */
export function formatGameModeDebug(snapshot: GameModeDebugSnapshot): string[] {
  const num = (value: number | null): string => (value === null ? "—" : value.toFixed(2));
  const stance =
    snapshot.grounded === null ? "" : snapshot.grounded ? " (grounded)" : " (airborne)";
  return [
    "game mode",
    `mode: ${snapshot.gameMode}`,
    `possessed: ${snapshot.possessed ?? "none"}`,
    `movement: ${snapshot.movementMode ?? "—"}${stance}`,
    `vel y:${num(snapshot.velocityY)} planar:${num(snapshot.planarSpeed)}`,
    `control yaw:${num(snapshot.controlYawDeg)} pitch:${num(snapshot.controlPitchDeg)}`,
    `camera: ${snapshot.cameraSource ?? "â€”"}`,
    `input: ${snapshot.inputMode}`,
  ];
}

/** The UI inspector block, or "" when the app exposes no snapshot (editor). */
function uiDebugText(app: RuntimeStatsApp): string {
  if (!app.getUiDebugSnapshot) return "";
  return `\n${formatUiDebug(app.getUiDebugSnapshot()).join("\n")}`;
}

/**
 * Formats a {@link UiDebugSnapshot} into overlay lines (pure, DOM-free for unit
 * tests): the mounted HUD, the active screen stack (bottom → top) and each
 * bound ViewModel field. Long string values are clipped to keep lines readable.
 */
export function formatUiDebug(snapshot: UiDebugSnapshot): string[] {
  const lines = [
    "ui",
    `hud: ${snapshot.hud ?? "none"}`,
    snapshot.screens.length > 0
      ? `screens(${snapshot.screens.length}): ${snapshot.screens.join(" > ")}`
      : "screens: none",
    `locale: ${snapshot.locale ?? "none"}`,
  ];
  if (snapshot.fields.length === 0) {
    lines.push("fields: none");
  } else {
    lines.push(`fields(${snapshot.fields.length}):`);
    for (const [path, value] of snapshot.fields) {
      lines.push(`  ${path} = ${formatFieldValue(value)}`);
    }
  }
  if (snapshot.audit.length > 0) {
    lines.push(`a11y(${snapshot.audit.length}):`);
    for (const issue of snapshot.audit) lines.push(`  ${issue}`);
  }
  return lines;
}

/** Renders a store value compactly; strings are quoted and clipped at 32 chars. */
function formatFieldValue(value: string | number | boolean): string {
  if (typeof value !== "string") return String(value);
  const clipped = value.length > 32 ? `${value.slice(0, 29)}...` : value;
  return `"${clipped}"`;
}

function scriptMessageDebugText(app: RuntimeStatsApp): string {
  const snapshot = app.getScriptMessageDebugSnapshot();
  const { lastFlush, recentMessages } = snapshot;
  const lines = [
    "",
    "script messages",
    `flush p:${lastFlush.processed} d:${lastFlush.delivered} w:${lastFlush.warnings.length}`,
    `subscribers: ${snapshot.subscribers.length}`,
  ];
  for (const entry of recentMessages.slice(-5)) {
    const target = entry.envelope.target ?? "*";
    const payload = JSON.stringify(entry.envelope.payload);
    const payloadText = payload.length > 44 ? `${payload.slice(0, 41)}...` : payload;
    lines.push(
      `${entry.envelope.frame} ${entry.envelope.source}->${target} ${entry.envelope.type} ${entry.status}(${entry.delivered}) ${payloadText}`,
    );
  }
  if (lastFlush.warnings.length > 0) {
    lines.push(`last warning: ${lastFlush.warnings[0]?.code ?? "unknown"}`);
  }
  return `\n${lines.join("\n")}`;
}
