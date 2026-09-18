import { Module } from "@nestjs/common";

import { AuditController } from "./audit.controller.js";
import { AuditService } from "./audit.service.js";

@Module({ controllers: [AuditController], providers: [AuditService] })
// Nest modules are declarative classes consumed through decorator metadata.
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class AuditModule {}
