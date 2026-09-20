import { Module } from "@nestjs/common";

import { LocksModule } from "../locks/lock.module.js";
import { AssetsController } from "./assets.controller.js";
import { AssetsService } from "./assets.service.js";

@Module({ imports: [LocksModule], controllers: [AssetsController], providers: [AssetsService] })
// Nest modules are declarative classes consumed through decorator metadata.
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class AssetsModule {}
