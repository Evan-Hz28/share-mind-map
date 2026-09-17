import { randomInt } from "node:crypto";

import { argon2id, hash as argon2Hash, verify as argon2Verify } from "argon2";

import type { AppConfig } from "../../platform/config/app-config.js";
import { validatePassword } from "./password-policy.js";

type PasswordConfig = Pick<AppConfig, "environment" | "argon2">;

const upperCharacters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const lowerCharacters = "abcdefghijkmnopqrstuvwxyz";
const digitCharacters = "23456789";
const symbolCharacters = "!#$%&*+-=?@^_";
const allTemporaryCharacters =
  upperCharacters + lowerCharacters + digitCharacters + symbolCharacters;

function randomCharacter(characters: string): string {
  return characters[randomInt(characters.length)] as string;
}

export class PasswordService {
  public constructor(private readonly config: PasswordConfig) {
    const { memoryKiB, iterations, parallelism } = config.argon2;
    if (
      config.environment !== "test" &&
      (memoryKiB < 65_536 || iterations < 3 || parallelism !== 1)
    ) {
      throw new Error("Argon2 configuration is below the non-test security policy");
    }
  }

  public async hash(password: string): Promise<string> {
    validatePassword(password);
    return argon2Hash(password, {
      type: argon2id,
      memoryCost: this.config.argon2.memoryKiB,
      timeCost: this.config.argon2.iterations,
      parallelism: this.config.argon2.parallelism,
    });
  }

  public async verify(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await argon2Verify(passwordHash, password);
    } catch {
      return false;
    }
  }

  public generateTemporary(): string {
    const characters = [
      randomCharacter(upperCharacters),
      randomCharacter(lowerCharacters),
      randomCharacter(digitCharacters),
      randomCharacter(symbolCharacters),
    ];
    while (characters.length < 24) characters.push(randomCharacter(allTemporaryCharacters));
    for (let index = characters.length - 1; index > 0; index -= 1) {
      const target = randomInt(index + 1);
      [characters[index], characters[target]] = [
        characters[target] as string,
        characters[index] as string,
      ];
    }
    return characters.join("");
  }
}
