import { Module } from "@nestjs/common";

import { ApiTestsController } from "./api-tests.controller.js";
import { ApiTestsService } from "./api-tests.service.js";

@Module({ controllers: [ApiTestsController], providers: [ApiTestsService] })
// Nest modules are declarative classes consumed through decorator metadata.
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class ApiTestsModule {}
