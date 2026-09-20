import { Module } from "@nestjs/common";

import { WorkspaceRealtimeGateway } from "./workspace-realtime.gateway.js";
import { DocumentRoomService } from "./document-room.service.js";

@Module({
  providers: [DocumentRoomService, WorkspaceRealtimeGateway],
  exports: [DocumentRoomService],
})
// Nest modules are declarative classes consumed through decorator metadata.
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class RealtimeModule {}
