import { Module } from "@nestjs/common";

import { LocksModule } from "../locks/lock.module.js";
import { RealtimeModule } from "../realtime/realtime.module.js";
import { DocumentsController } from "./documents.controller.js";
import { DocumentsService } from "./documents.service.js";

@Module({
  imports: [LocksModule, RealtimeModule],
  controllers: [DocumentsController],
  providers: [DocumentsService],
})
// Nest modules are declarative classes consumed through decorator metadata.
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class DocumentsModule {}
