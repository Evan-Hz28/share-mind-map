import { Inject, Module } from "@nestjs/common";
import type { DynamicModule, OnApplicationShutdown } from "@nestjs/common";

import { AdminModule } from "./admin/admin.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { HealthController } from "./health/health.controller.js";
import {
  createInfrastructureHealthRuntime,
  HEALTH_CHECKS,
  HealthService,
  type HealthChecks,
  type InfrastructureHealthRuntime,
} from "./health/health.service.js";
import { MAIL_PROVIDER, type MailProvider } from "./mail/mail-provider.js";
import { SmtpMailProvider } from "./mail/smtp-mail.provider.js";
import { ConfigModule } from "./platform/config/config.module.js";
import type { AppConfig } from "./platform/config/app-config.js";

const INFRASTRUCTURE_HEALTH_RUNTIME = Symbol("INFRASTRUCTURE_HEALTH_RUNTIME");

class InfrastructureLifecycle implements OnApplicationShutdown {
  public constructor(
    @Inject(INFRASTRUCTURE_HEALTH_RUNTIME)
    private readonly runtime: InfrastructureHealthRuntime,
  ) {}

  public async onApplicationShutdown(): Promise<void> {
    await this.runtime.close();
  }
}

export interface AppModuleOptions {
  config: AppConfig;
  healthChecks?: HealthChecks;
  mailProvider?: MailProvider;
}

@Module({})
// Nest modules are declarative classes consumed through decorator metadata.
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class AppModule {
  public static register(options: AppModuleOptions): DynamicModule {
    const infrastructure =
      options.healthChecks === undefined
        ? createInfrastructureHealthRuntime(options.config)
        : undefined;
    const mailProvider =
      options.mailProvider ??
      infrastructure?.mailProvider ??
      new SmtpMailProvider(options.config.smtp);
    const runtime =
      infrastructure ??
      ({
        checks: options.healthChecks as HealthChecks,
        mailProvider,
        close: () => {
          if (mailProvider instanceof SmtpMailProvider) mailProvider.close();
          return Promise.resolve();
        },
      } satisfies InfrastructureHealthRuntime);
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(options.config),
        AuthModule.register(options.config),
        AdminModule,
      ],
      controllers: [HealthController],
      providers: [
        { provide: INFRASTRUCTURE_HEALTH_RUNTIME, useValue: runtime },
        { provide: HEALTH_CHECKS, useValue: runtime.checks },
        { provide: MAIL_PROVIDER, useValue: mailProvider },
        HealthService,
        InfrastructureLifecycle,
      ],
      exports: [MAIL_PROVIDER],
    };
  }
}
