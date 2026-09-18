import { Module } from "@nestjs/common";

import { WorkspaceRealtimeGateway } from "./workspace-realtime.gateway.js";

@Module({ providers: [WorkspaceRealtimeGateway] })
// Nest modules are declarative classes consumed through decorator metadata.
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class RealtimeModule {}
