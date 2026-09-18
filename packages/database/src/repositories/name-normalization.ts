export class EntityNameValidationError extends Error {
  public constructor(
    public readonly reason: "required" | "too_long",
    message: string,
  ) {
    super(message);
    this.name = "EntityNameValidationError";
  }
}

export interface NormalizedEntityName {
  displayName: string;
  normalizedName: string;
}

export function normalizeEntityName(input: string, maxLength: number): NormalizedEntityName {
  const displayName = input.normalize("NFC").trim().replace(/\s+/gu, " ");
  if (displayName.length === 0) {
    throw new EntityNameValidationError("required", "Name is required.");
  }
  if (displayName.length > maxLength) {
    throw new EntityNameValidationError(
      "too_long",
      `Name must be at most ${String(maxLength)} characters.`,
    );
  }
  return { displayName, normalizedName: displayName.toLocaleLowerCase("en-US") };
}
