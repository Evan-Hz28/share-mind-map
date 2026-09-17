import { spawn } from "node:child_process";

import type { APIRequestContext } from "@playwright/test";

import { apiChangePassword, apiLogin } from "./api.js";

export const administratorPassword = "Phase1-Administrator-Permanent-Password-1";
const preferredAdministratorLogin = "phase1.admin";
const secretPattern = /Temporary administrator password:\s*(\S+)/u;

interface ProcessResult {
  stdout: string;
  stderr: string;
}

export interface PromptAnswer {
  prompt: string;
  answer: string;
}

function redact(value: string): string {
  return value.replace(/(Temporary administrator password:\s*)\S+/gu, "$1[REDACTED]");
}

async function runProcess(command: string, args: string[], input?: string): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(redact(`Command exited ${String(code)}\n${stdout}\n${stderr}`)));
    });
    child.stdin.end(input);
  });
}

export async function runInteractiveProcess(
  command: string,
  args: string[],
  promptAnswers: PromptAnswer[],
  options: { allowNoPrompts?: boolean } = {},
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let nextAnswer = 0;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      const expected = promptAnswers[nextAnswer];
      if (expected === undefined || !stdout.includes(expected.prompt)) return;
      child.stdin.write(`${expected.answer}\n`);
      nextAnswer += 1;
      if (nextAnswer === promptAnswers.length) child.stdin.end();
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(redact(`Command exited ${String(code)}\n${stdout}\n${stderr}`)));
      } else if (
        nextAnswer !== promptAnswers.length &&
        !(options.allowNoPrompts === true && nextAnswer === 0)
      ) {
        reject(new Error("Admin command exited before requesting every expected answer"));
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

const composeArguments = ["compose", "--env-file", ".env.example"];

async function runAdminCommand(
  command: "init-admin" | "recover-admin",
  answers: string[],
): Promise<string | undefined> {
  const prompts =
    command === "init-admin"
      ? [
          "Organization name: ",
          "Workspace name: ",
          "Administrator login name: ",
          "Administrator display name: ",
          "Create the first administrator? [y/N]: ",
        ]
      : ["Administrator login name: ", "Recover this administrator account? [y/N]: "];
  if (prompts.length !== answers.length) throw new Error("Admin command answer count mismatch");
  const result = await runInteractiveProcess(
    "docker",
    [...composeArguments, "exec", "-T", "api", "node", `dist/cli/${command}.js`],
    prompts.map((prompt, index) => ({ prompt, answer: answers[index] as string })),
    { allowNoPrompts: command === "init-admin" },
  );
  return secretPattern.exec(result.stdout)?.[1];
}

async function currentAdministratorLogin(): Promise<string> {
  const query =
    "SELECT ai.provider_subject FROM auth_identities ai JOIN workspace_memberships wm ON wm.user_id=ai.user_id JOIN users u ON u.id=ai.user_id WHERE ai.provider='local' AND wm.role='admin' AND wm.status='active' AND u.account_status='active' ORDER BY ai.created_at LIMIT 1";
  const result = await runProcess("docker", [
    ...composeArguments,
    "exec",
    "-T",
    "postgres",
    "sh",
    "-ec",
    `psql -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "${query}"`,
  ]);
  const loginName = result.stdout.trim();
  if (loginName.length === 0)
    throw new Error("No active administrator exists after initialization");
  return loginName;
}

export async function prepareAdministrator(
  request: APIRequestContext,
): Promise<{ initialized: boolean; loginName: string; password: string }> {
  const provisioned = await provisionTemporaryAdministrator();
  const { initialized, loginName, temporaryPassword } = provisioned;

  const temporaryLogin = await apiLogin(request, loginName, temporaryPassword);
  if (temporaryLogin.session === undefined) {
    throw new Error(
      `Temporary Admin login failed with ${String(temporaryLogin.response.status())}`,
    );
  }
  const changed = await apiChangePassword(
    request,
    temporaryLogin.session.csrfToken,
    temporaryPassword,
    administratorPassword,
  );
  if (changed.status() !== 204) {
    throw new Error(`Admin password change failed with ${String(changed.status())}`);
  }
  return { initialized, loginName, password: administratorPassword };
}

export async function provisionTemporaryAdministrator(): Promise<{
  initialized: boolean;
  loginName: string;
  temporaryPassword: string;
}> {
  let loginName = preferredAdministratorLogin;
  let temporaryPassword = await runAdminCommand("init-admin", [
    "Phase 1 Organization",
    "Product Workspace",
    loginName,
    "Phase 1 Administrator",
    "y",
  ]);
  const initialized = temporaryPassword !== undefined;
  if (temporaryPassword === undefined) {
    loginName = await currentAdministratorLogin();
    temporaryPassword = await runAdminCommand("recover-admin", [loginName, "y"]);
  }
  if (temporaryPassword === undefined)
    throw new Error("Admin command did not return a temporary password");
  return { initialized, loginName, temporaryPassword };
}

export async function recoverAdministrator(loginName: string): Promise<string> {
  const temporaryPassword = await runAdminCommand("recover-admin", [loginName, "y"]);
  if (temporaryPassword === undefined)
    throw new Error("Recovery did not return a temporary password");
  return temporaryPassword;
}

export async function setMemberRole(loginName: string, role: "reader" | "editor"): Promise<void> {
  if (!/^[a-z0-9.]+$/u.test(loginName)) throw new Error("Unsafe E2E login name");
  const query = `UPDATE workspace_memberships wm SET role='${role}', updated_at=now() FROM auth_identities ai WHERE ai.user_id=wm.user_id AND ai.provider_subject='${loginName}'`;
  await runProcess("docker", [
    ...composeArguments,
    "exec",
    "-T",
    "postgres",
    "sh",
    "-ec",
    `psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "${query}"`,
  ]);
}
