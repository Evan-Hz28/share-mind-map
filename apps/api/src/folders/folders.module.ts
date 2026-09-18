import { Module } from "@nestjs/common";

import { FoldersController } from "./folders.controller.js";
import { FoldersService } from "./folders.service.js";

@Module({ controllers: [FoldersController], providers: [FoldersService] })
// Nest modules are declarative classes consumed through decorator metadata.
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class FoldersModule {}
