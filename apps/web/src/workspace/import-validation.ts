/**
 * 「导入 XMind」的前端校验规则。
 *
 * 这些常量和算法是**镜像**服务端的,不是权威来源:前端提前拦一下只是为了少一次往返,
 * 真正的准入判定仍在 API 和 worker 里。改动任意一侧都要同步另一侧:
 * - 扩展名:apps/api/src/imports/imports.service.ts
 * - 单个文件 20 MiB:同名文件里的 MAX_FILE_BYTES
 * - 单批 1..50,以及「该用户活跃任务数 + 本次文件数 ≤ 10、同工作区 ≤ 50」:
 *   packages/database/src/repositories/import.repository.ts 的 createBatch
 * - 名字归一化:packages/database/src/repositories/name-normalization.ts
 *
 * 不要 import @share-mind-map/database:那会把 pg / bullmq 一并拖进浏览器包。
 */

/** 单个 .xmind 的大小上限,与服务端 MAX_FILE_BYTES 一致(20 MiB)。 */
export const IMPORT_FILE_MAX_BYTES = 20 * 1024 * 1024;

/** 上限的 MB 表示,给文案用,免得 20 这个数字散落在模板里。 */
export const IMPORT_FILE_MAX_MEGABYTES = IMPORT_FILE_MAX_BYTES / (1024 * 1024);

/** 目标文档名长度上限,与服务端 normalizeEntityName(name, 100) 一致。 */
export const IMPORT_FILE_MAX_NAME_LENGTH = 100;

/**
 * 一次建议最多提交多少个文件。
 *
 * 服务端卡的是「该用户 waiting/uploading/parsing/persisting 的任务数 + 本次文件数 > 10
 * 就整批拒绝」(同一工作区另有 50 的上限,但先被 10 挡住)。前端看不到当前活跃数,
 * 所以只能把「超过 10 个」当成必然失败来拦;不超过 10 个也不保证一定成功。
 */
export const IMPORT_BATCH_MAX_FILES = 10;

export function isXmindFileName(name: string): boolean {
  return name.toLocaleLowerCase().endsWith(".xmind");
}

/** 与服务端 normalizeEntityName 一致的展示串:NFC → 去首尾空白 → 连续空白折成一个空格。 */
function toDisplayName(input: string): string {
  return input.normalize("NFC").trim().replace(/\s+/gu, " ");
}

/**
 * 归一化后的比较键,用来查重;规则照抄服务端(末尾再转小写)。
 * 空或超长返回 null——服务端在这两种情况下会抛 EntityNameValidationError,
 * 而那个异常没被 createBatch 的 try 包住,会变成 500。
 */
export function normalizeImportName(input: string): string | null {
  const displayName = toDisplayName(input);
  if (displayName === "" || displayName.length > IMPORT_FILE_MAX_NAME_LENGTH) return null;
  return displayName.toLocaleLowerCase("en-US");
}

/** 目标文档名的问题;没问题返回 null。 */
export function validateImportName(input: string): string | null {
  const displayName = toDisplayName(input);
  if (displayName === "") return "目标文档名不能为空。";
  if (displayName.length > IMPORT_FILE_MAX_NAME_LENGTH) {
    return `目标文档名不能超过 ${String(IMPORT_FILE_MAX_NAME_LENGTH)} 个字符。`;
  }
  return null;
}

/** 这个文件身上的问题;没问题返回 null。 */
export function validateImportFile(file: File): string | null {
  if (!isXmindFileName(file.name)) return "不是 .xmind 文件，不能导入。";
  if (file.size > IMPORT_FILE_MAX_BYTES) {
    return `超过 ${String(IMPORT_FILE_MAX_MEGABYTES)} MB 上限。`;
  }
  return null;
}
