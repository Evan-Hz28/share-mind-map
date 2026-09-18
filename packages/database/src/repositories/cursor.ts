export interface CursorValue {
  sortValue: string;
  id: string;
}

export function encodeCursor(value: CursorValue): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function decodeCursor(cursor: string): CursorValue {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as { sortValue?: unknown }).sortValue !== "string" ||
      typeof (parsed as { id?: unknown }).id !== "string" ||
      (parsed as { sortValue: string }).sortValue.length === 0 ||
      (parsed as { id: string }).id.length === 0
    ) {
      throw new Error("Invalid cursor shape.");
    }
    return parsed as CursorValue;
  } catch {
    throw new Error("Invalid cursor.");
  }
}
