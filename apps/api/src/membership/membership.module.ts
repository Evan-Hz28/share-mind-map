import { Module } from "@nestjs/common";

import {
  AdminPermissionRequestsController,
  PermissionRequestsController,
  RevokeEditingController,
} from "./permission-requests.controller.js";
import { PermissionRequestsService } from "./permission-requests.service.js";

@Module({
  controllers: [
    PermissionRequestsController,
    AdminPermissionRequestsController,
    RevokeEditingController,
  ],
  providers: [PermissionRequestsService],
})
// Nest modules are declarative classes consumed through decorator metadata.
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class MembershipModule {}
