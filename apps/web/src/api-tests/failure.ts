import type { ApiTestRunItemResponseDto } from "@share-mind-map/api-client";

/**
 * pytest 的 longrepr 是给人看的完整 traceback：真正有用的只有末尾的 E 行和一两帧用户代码，
 * 其余几十帧都是 requests/urllib3 内部实现。这里把原文解析成「分类 + 一句话结论 + 关键片段」，
 * 原文仍然完整保留，交给 UI 折叠。
 */
export type FailureKind =
  "assertion" | "unreachable" | "timeout" | "not-run" | "script-error" | "unknown";

export interface FailureView {
  kind: FailureKind;
  label: string;
  tagType: "danger" | "warning" | "info";
  headline: string;
  detail: string | null;
  location: string | null;
  sources: string[];
  method: string | null;
  path: string | null;
  status: number | null;
  durationMs: number | null;
  raw: string;
}

const LABELS: Record<FailureKind, string> = {
  assertion: "断言不符",
  unreachable: "环境不可达",
  timeout: "请求超时",
  "not-run": "用例未执行",
  "script-error": "用例代码报错",
  unknown: "未分类",
};

const TAG_TYPES: Record<FailureKind, FailureView["tagType"]> = {
  assertion: "danger",
  unreachable: "warning",
  timeout: "warning",
  "not-run": "info",
  "script-error": "danger",
  unknown: "info",
};

export function failureLabel(kind: FailureKind): string {
  return LABELS[kind];
}

export function failureTagType(kind: FailureKind): FailureView["tagType"] {
  return TAG_TYPES[kind];
}

const E_LINE = /^E\s{2,}(.+)$/;
const EXC_CLASS =
  /^([A-Za-z_][\w.]*(?:Error|Exception|Timeout|Failure|gaierror|Interrupt)|Failed)\s*:/;
const FRAME_LINE = /^([^\s:][^\n:]*\.py):(\d+):/;
const PROJECT_PATH = /(^|\/)(testcases|common|tests)\//;

function exceptionClass(line: string): string | null {
  return EXC_CLASS.exec(line)?.[1] ?? null;
}

function clip(value: string, limit = 160): string {
  const text = value.trim();
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

/** 只保留项目内的相对路径，绝对路径和 venv 路径都是噪声。 */
function shortPath(file: string): string {
  const match = PROJECT_PATH.exec(file);
  if (match) return file.slice(match.index + (file[match.index] === "/" ? 1 : 0));
  const site = file.indexOf("site-packages/");
  if (site >= 0) return file.slice(site + "site-packages/".length);
  return file.replace(/^\.\//, "");
}

interface Frame {
  file: string;
  line: string;
}

function collectFrames(lines: string[]): Frame[] {
  const frames: Frame[] = [];
  for (const line of lines) {
    const match = FRAME_LINE.exec(line);
    const file = match?.[1];
    const lineNumber = match?.[2];
    if (file !== undefined && lineNumber !== undefined) {
      frames.push({ file, line: lineNumber });
    }
  }
  return frames;
}

function pickLocation(frames: Frame[]): string | null {
  // 只认项目内的帧；urllib3/requests 的路径对定位问题没有帮助，用例 nodeId 已经在上面。
  const project = frames.filter((frame) => PROJECT_PATH.test(frame.file));
  const frame = project.at(-1);
  return frame ? `${shortPath(frame.file)}:${frame.line}` : null;
}

function firstExchange(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    const first: unknown = value[0];
    return first !== null && typeof first === "object" ? (first as Record<string, unknown>) : null;
  }
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function exchangeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function exchangeText(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function urlPath(url: string | null): string | null {
  if (url === null) return null;
  try {
    return new URL(url).pathname;
  } catch {
    return url.split("?")[0] ?? url;
  }
}

function lastMatch(text: string, pattern: RegExp): string | null {
  return [...text.matchAll(pattern)].at(-1)?.[1] ?? null;
}

function classify(text: string, eLines: string[]): FailureKind {
  if (/fixture '[^']+' not found/.test(text)) return "not-run";
  if (
    /socket\.gaierror|NameResolutionError|No address associated with hostname|Name or service not known/.test(
      text,
    )
  ) {
    return "unreachable";
  }
  if (/ConnectTimeout|ReadTimeout|TimeoutError|timed out/.test(text)) return "timeout";
  if (/ConnectionError|ConnectionRefused|MaxRetryError|SSLError/.test(text)) return "unreachable";

  const classes = eLines.map(exceptionClass).filter((value): value is string => value !== null);
  if (classes.some((name) => name === "AssertionError" || name === "Failed")) return "assertion";
  if (eLines.some((line) => /^assert\b/.test(line))) return "assertion";
  if (classes.length > 0) return "script-error";
  return "unknown";
}

/**
 * 断言消息经常把整个响应体塞进字符串，例如
 * `期望状态码 200，实际 404，响应: {"code":1001,"details":"route not found",...}`。
 * 只留 details/message 这一句，比一长串 JSON 好读；解析失败（截断过）就保留原文。
 */
function compactResponse(message: string): string {
  const match = /^(.*)[:：]\s*(\{.*)$/s.exec(message);
  const prefix = match?.[1];
  const payload = match?.[2];
  if (prefix === undefined || payload === undefined) return message;
  try {
    const body = JSON.parse(payload) as Record<string, unknown>;
    const details = body["details"];
    const text = typeof details === "string" && details !== "" ? details : body["message"];
    const note = typeof text === "string" && text !== "" && text !== "error" ? text : null;
    const head = prefix.replace(/[，,、\s]*(?:响应|实际)?\s*$/, "");
    return note === null ? head : `${head} · ${note}`;
  } catch {
    return message;
  }
}

/** 断言消息通常写得最清楚，优先用它；没有消息再退回归一化后的 assert 表达式。 */
function assertionHeadline(eLines: string[]): string {
  const message = eLines.find((line) => /^AssertionError\s*:\s*\S/.test(line));
  if (message) return clip(compactResponse(message.replace(/^AssertionError\s*:\s*/, "")));
  const assertion = eLines.find((line) => /^assert\b/.test(line));
  return clip(assertion ?? eLines.at(-1) ?? "断言失败");
}

function assertionDetail(eLines: string[], headline: string): string | null {
  if (/实际/.test(headline)) return null;
  for (const line of eLines) {
    const equals = /^assert\s+(\S+)\s*==\s*([^,\s]+)\s*(?:,|$)/.exec(line);
    const actual = equals?.[1];
    const expected = equals?.[2];
    if (actual !== undefined && expected !== undefined) {
      return `期望 ${expected}，实际 ${actual}`;
    }
    const inList = /^assert\s+(\S+)\s+in\s+(.+?)\s*(?:,\s*(?:"|f["']|'|$)|$)/.exec(line);
    const actualItem = inList?.[1];
    const allowed = inList?.[2];
    if (actualItem !== undefined && allowed !== undefined) {
      return `实际 ${actualItem}，期望 ${allowed}`;
    }
  }
  return null;
}

function unreachableHeadline(text: string, url: string | null): string {
  const host =
    /host\s*=\s*['"]([^'"]+)['"]/.exec(text)?.[1] ??
    (url === null
      ? null
      : (() => {
          try {
            return new URL(url).hostname;
          } catch {
            return null;
          }
        })());
  return host === null ? "目标域名无法解析" : `域名解析失败：${host}`;
}

function notRunHeadline(text: string): string {
  const fixture = /fixture '([^']+)' not found/.exec(text)?.[1];
  return fixture === undefined ? "用例在初始化阶段就失败" : `缺少 fixture「${fixture}」`;
}

function timeoutHeadline(eLines: string[]): string {
  const detail = eLines.map(exceptionClass).find((name) => name?.endsWith("Timeout"));
  const content = eLines.find((line) => /timed out|timeout/i.test(line));
  return clip(detail ?? content ?? "请求超时");
}

function scriptErrorHeadline(eLines: string[]): string {
  const last = eLines.at(-1) ?? "用例执行异常";
  return clip(last);
}

function sourcesFor(lines: string[], kind: FailureKind, eLines: string[]): string[] {
  if (kind === "unreachable" || kind === "timeout" || kind === "not-run") return [];
  const highlighted: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const current = lines[index];
    if (current === undefined || !/^>/.test(current)) continue;
    let text = current.replace(/^>/, "").trim();
    let next = index;
    // pytest 只给多行语句的第一行打标记，续行靠行尾反斜杠接回来。
    while (text.endsWith("\\") && next + 1 < lines.length) {
      next += 1;
      text = `${text.slice(0, -1).trimEnd()} ${(lines[next] ?? "").trim()}`;
    }
    index = next;
    if (text !== "") highlighted.push(text);
  }
  if (highlighted.length > 0) return highlighted.slice(-2);
  const assertion = eLines.find((line) => /^assert\b/.test(line));
  return assertion === undefined ? [] : [assertion];
}

export function parseFailure(
  failure: string | null | undefined,
  request?: unknown,
  response?: unknown,
): FailureView | null {
  if (failure === null || failure === undefined || failure.trim() === "") return null;

  const raw = failure.trimEnd();
  const lines = raw.split("\n");
  const marked = lines
    .map((line) => E_LINE.exec(line)?.[1])
    .filter((value): value is string => value !== undefined)
    .map((line) => line.trim());
  // 兼容只有结论文本、没有 pytest E 标记的数据（例如历史记录或人工写入的单行失败）。
  const eLines =
    marked.length > 0
      ? marked
      : lines
          .map((line) => line.trim())
          .filter((line) => line !== "")
          .slice(-1);

  const kind = classify(raw, eLines);
  const frames = collectFrames(lines);
  const requestRecord = firstExchange(request);
  const responseRecord = firstExchange(response);
  // 网络错误和 fixture 失败通常没有 exchanges，退回从 urllib3 的参数行里捞请求信息。
  const method =
    exchangeText(requestRecord?.["method"]) ?? lastMatch(raw, /method\s*=\s*'([A-Z]+)'/g);
  const url = exchangeText(requestRecord?.["url"]) ?? lastMatch(raw, /url\s*=\s*'([^']+)'/g);

  let headline: string;
  let detail: string | null = null;
  switch (kind) {
    case "assertion":
      headline = assertionHeadline(eLines);
      detail = assertionDetail(eLines, headline);
      break;
    case "unreachable":
      headline = unreachableHeadline(raw, url);
      detail = "目标域名无法解析，该环境下整批用例都会失败，先检查环境地址和网络";
      break;
    case "timeout":
      headline = timeoutHeadline(eLines);
      detail = "请求没有在超时时间内返回，先确认环境是否可达";
      break;
    case "not-run":
      headline = notRunHeadline(raw);
      detail = "用例在初始化阶段就失败，断言没有执行；属于用例自身问题，不是接口回归";
      break;
    case "script-error":
      headline = scriptErrorHeadline(eLines);
      break;
    default:
      headline = clip(eLines.at(-1) ?? lines.find((line) => line.trim() !== "") ?? "执行失败");
  }

  return {
    kind,
    label: LABELS[kind],
    tagType: TAG_TYPES[kind],
    headline,
    detail,
    location: pickLocation(frames),
    sources: sourcesFor(lines, kind, eLines),
    method,
    path: urlPath(url),
    status: exchangeNumber(responseRecord?.["status"]),
    durationMs: exchangeNumber(responseRecord?.["durationMs"]),
    raw,
  };
}

/** 列表页只需要分类，不必把整段原文都返回给调用方。 */
export function failureKind(item: ApiTestRunItemResponseDto): FailureKind | null {
  if (item.status !== "failed" && item.status !== "error") return null;
  return parseFailure(item.failure, item.request, item.response)?.kind ?? null;
}
