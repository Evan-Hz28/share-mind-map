import { Module } from "@nestjs/common";

import { LocksModule } from "../locks/lock.module.js";
import { FoldersController } from "./folders.controller.js";
import { FoldersService } from "./folders.service.js";

@Module({ imports: [LocksModule], controllers: [FoldersController], providers: [FoldersService] })
// Nest modules are declarative classes consumed through decorator metadata.
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class FoldersModule {}
