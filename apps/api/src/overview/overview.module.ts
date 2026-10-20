import { Module } from "@nestjs/common";

import { OverviewController } from "./overview.controller.js";
import { OverviewService } from "./overview.service.js";

@Module({ controllers: [OverviewController], providers: [OverviewService] })
// Nest modules are declarative classes consumed through decorator metadata.
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class OverviewModule {}
