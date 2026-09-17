import type { AdminCommandIO } from "../../src/cli/admin-command-io.js";

export class RecordingCommandIO implements AdminCommandIO {
  public readonly inputLabels: string[] = [];
  public readonly confirmationLabels: string[] = [];
  public readonly secrets: Array<{ label: string; value: string }> = [];

  public constructor(
    private readonly inputs: string[],
    private readonly confirmations: boolean[] = [true],
  ) {}

  public input(label: string): Promise<string> {
    this.inputLabels.push(label);
    const value = this.inputs.shift();
    if (value === undefined) throw new Error(`No recorded input for ${label}`);
    return Promise.resolve(value);
  }

  public confirm(label: string): Promise<boolean> {
    this.confirmationLabels.push(label);
    const value = this.confirmations.shift();
    if (value === undefined) throw new Error(`No recorded confirmation for ${label}`);
    return Promise.resolve(value);
  }

  public secretOnce(label: string, value: string): Promise<void> {
    this.secrets.push({ label, value });
    return Promise.resolve();
  }
}
