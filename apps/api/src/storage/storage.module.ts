import { Module } from "@nestjs/common";

import { StorageController } from "./storage.controller.js";
import { StorageService } from "./storage.service.js";

@Module({ controllers: [StorageController], providers: [StorageService] })
// Nest modules are declarative classes consumed through decorator metadata.
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class StorageModule {}
