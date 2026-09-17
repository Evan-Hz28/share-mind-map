import { Controller, Get, HttpStatus, Res } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";

import { HealthService } from "./health.service.js";

@ApiTags("health")
@Controller("health")
export class HealthController {
  public constructor(private readonly health: HealthService) {}

  @Get("live")
  @ApiOperation({ operationId: "healthLive" })
  @ApiOkResponse({ description: "The API event loop is serving requests." })
  public live(): { status: "ok" } {
    return this.health.liveness();
  }

  @Get("ready")
  @ApiOperation({ operationId: "healthReady" })
  @ApiOkResponse({ description: "All required API dependencies are ready." })
  @ApiResponse({ status: 503, description: "At least one required dependency is unavailable." })
  public async ready(@Res({ passthrough: true }) response: Response) {
    const result = await this.health.readiness();
    response.status(result.status === "ok" ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return result;
  }
}
