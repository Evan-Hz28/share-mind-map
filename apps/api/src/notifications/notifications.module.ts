import { Module } from "@nestjs/common";

import { NotificationsController } from "./notifications.controller.js";
import { NotificationsService } from "./notifications.service.js";

@Module({ controllers: [NotificationsController], providers: [NotificationsService] })
// Nest modules are declarative classes consumed through decorator metadata.
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class NotificationsModule {}
