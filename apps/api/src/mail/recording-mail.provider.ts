import type { MailMessage, MailProvider } from "./mail-provider.js";

function copyMessage(message: MailMessage): MailMessage {
  return {
    ...message,
    to: Array.isArray(message.to) ? [...message.to] : message.to,
  };
}

export class RecordingMailProvider implements MailProvider {
  private readonly recorded: MailMessage[] = [];

  public get messages(): readonly MailMessage[] {
    return this.recorded.map(copyMessage);
  }

  public send(message: MailMessage): Promise<void> {
    this.recorded.push(copyMessage(message));
    return Promise.resolve();
  }
}
