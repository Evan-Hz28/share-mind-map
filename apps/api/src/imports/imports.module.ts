import { Module } from "@nestjs/common";

import { ImportsController } from "./imports.controller.js";
import { ImportsService } from "./imports.service.js";

@Module({ controllers: [ImportsController], providers: [ImportsService] })
// Nest modules are declarative classes consumed through decorator metadata.
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class ImportsModule {}
