export interface AdminCommandIO {
  input(label: string): Promise<string>;
  confirm(label: string): Promise<boolean>;
  secretOnce(label: string, value: string): Promise<void>;
}
