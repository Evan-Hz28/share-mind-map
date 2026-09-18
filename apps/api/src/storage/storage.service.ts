import { QuotaRepository, type Database } from "@share-mind-map/database";
import { Inject, Injectable } from "@nestjs/common";

import type { AuthContext } from "../auth/auth-context.js";
import { AUTH_DATABASE } from "../auth/auth.tokens.js";
import { ApiError } from "../platform/errors/api-error.js";
import type { StorageUsageDto } from "./dto/storage.dto.js";

@Injectable()
export class StorageService {
  private readonly quotas: QuotaRepository;

  public constructor(@Inject(AUTH_DATABASE) private readonly database: Database) {
    this.quotas = new QuotaRepository(database);
  }

  public async read(auth: AuthContext): Promise<StorageUsageDto> {
    const usage = await this.quotas.readWorkspaceUsage(auth.session.workspaceId);
    if (usage === null) throw new ApiError("NOT_FOUND");
    return usage;
  }
}
