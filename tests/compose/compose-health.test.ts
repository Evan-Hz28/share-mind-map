import { describe, expect, it } from "vitest";

import {
  evaluateComposeServices,
  type ComposeServiceStatus,
} from "../../scripts/compose-health.mjs";

function status(
  service: string,
  state: string,
  health: string,
  exitCode = 0,
): ComposeServiceStatus {
  return { Service: service, State: state, Health: health, ExitCode: exitCode };
}

describe("Compose health evaluation", () => {
  it("accepts healthy long-running services and a successful initializer", () => {
    const services = [
      ...["web", "api", "worker", "postgres", "redis", "minio", "mailpit"].map((service) =>
        status(service, "running", "healthy"),
      ),
      status("minio-init", "exited", "", 0),
    ];

    expect(evaluateComposeServices(services)).toEqual([]);
  });

  it("reports missing, unhealthy, and failed one-shot services", () => {
    const services = [
      status("web", "running", "unhealthy"),
      status("api", "exited", "", 1),
      status("worker", "running", "healthy"),
      status("postgres", "running", "healthy"),
      status("redis", "running", "healthy"),
      status("minio", "running", "healthy"),
      status("minio-init", "exited", "", 2),
    ];

    expect(evaluateComposeServices(services)).toEqual([
      "web is running but unhealthy",
      "api is exited, expected running",
      "mailpit is missing",
      "minio-init exited with code 2",
    ]);
  });
});
