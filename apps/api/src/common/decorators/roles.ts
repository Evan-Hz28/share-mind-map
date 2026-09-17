import { SetMetadata } from "@nestjs/common";

import type { SessionRole } from "../../auth/session/session.types.js";

export const rolesMetadataKey = "share-mind-map:roles";

export const Roles = (...roles: readonly SessionRole[]): MethodDecorator & ClassDecorator =>
  SetMetadata(rolesMetadataKey, roles);
