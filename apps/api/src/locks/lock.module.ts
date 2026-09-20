import { Module } from "@nestjs/common";

import { RealtimeModule } from "../realtime/realtime.module.js";
import { LockController } from "./lock.controller.js";
import { LockService } from "./lock.service.js";

@Module({
  imports: [RealtimeModule],
  controllers: [LockController],
  providers: [LockService],
  exports: [LockService],
})
// Nest modules are declarative classes consumed through decorator metadata.
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class LocksModule {}
