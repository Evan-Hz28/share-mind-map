import { Global, Module } from "@nestjs/common";
import type { DynamicModule } from "@nestjs/common";

import type { AppConfig } from "./app-config.js";

export const APP_CONFIG = Symbol("APP_CONFIG");

@Global()
@Module({})
// Nest modules are declarative classes consumed through decorator metadata.
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class ConfigModule {
  public static forRoot(config: AppConfig): DynamicModule {
    return {
      module: ConfigModule,
      providers: [{ provide: APP_CONFIG, useValue: config }],
      exports: [APP_CONFIG],
    };
  }
}
