import { Module } from "@nestjs/common";

import { ExportsController } from "./exports.controller.js";
import { ExportsService } from "./exports.service.js";

@Module({ controllers: [ExportsController], providers: [ExportsService] })
// Nest modules are declarative classes consumed through decorator metadata.
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class ExportsModule {}
