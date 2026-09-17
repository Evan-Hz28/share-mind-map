import { Module } from "@nestjs/common";

import { MembersController } from "./members.controller.js";
import { MembersService } from "./members.service.js";

@Module({ controllers: [MembersController], providers: [MembersService] })
// Nest modules are declarative classes consumed through decorator metadata.
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class AdminModule {}
