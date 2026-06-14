import type { EngineUpdateContext, Subsystem } from "./Subsystem";
import { SubsystemRegistry } from "./SubsystemRegistry";

export class EngineApp {
  readonly subsystems = new SubsystemRegistry();

  private elapsedSeconds = 0;
  private frame = 0;

  registerSubsystem(subsystem: Subsystem): Subsystem {
    return this.subsystems.register(subsystem);
  }

  async init(): Promise<void> {
    await this.subsystems.init();
  }

  async start(): Promise<void> {
    await this.subsystems.start();
  }

  update(deltaSeconds: number): EngineUpdateContext {
    this.elapsedSeconds += deltaSeconds;
    this.frame += 1;

    const context: EngineUpdateContext = {
      deltaSeconds,
      elapsedSeconds: this.elapsedSeconds,
      frame: this.frame,
    };
    this.subsystems.update(context);
    return context;
  }

  async dispose(): Promise<void> {
    await this.subsystems.dispose();
  }
}
