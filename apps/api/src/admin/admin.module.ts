import { Module } from "@nestjs/common";

import { MembersController } from "./members.controller.js";
import { MembersService } from "./members.service.js";
import { ImportFailuresController } from "./import-failures.controller.js";
import { ImportFailuresService } from "./import-failures.service.js";

@Module({
  controllers: [MembersController, ImportFailuresController],
  providers: [MembersService, ImportFailuresService],
})
// Nest modules are declarative classes consumed through decorator metadata.
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class AdminModule {}
