import nodemailer, { type Transporter } from "nodemailer";

import type { SmtpConfig } from "../platform/config/app-config.js";
import type { MailMessage, MailProvider } from "./mail-provider.js";

export class SmtpMailProvider implements MailProvider {
  private readonly transporter: Transporter;

  public constructor(
    private readonly config: SmtpConfig,
    transporter?: Transporter,
  ) {
    this.transporter =
      transporter ??
      nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        ...(config.user === undefined
          ? {}
          : { auth: { user: config.user, pass: config.password } }),
      });
  }

  public async verify(): Promise<void> {
    await this.transporter.verify();
  }

  public async send(message: MailMessage): Promise<void> {
    await this.transporter.sendMail({ from: this.config.from, ...message });
  }

  public close(): void {
    this.transporter.close();
  }
}
