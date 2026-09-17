export interface MailMessage {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
}

export interface MailProvider {
  send(message: MailMessage): Promise<void>;
}

export const MAIL_PROVIDER = Symbol("MAIL_PROVIDER");
