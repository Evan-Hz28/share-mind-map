/**
 * 「导入 XMind」的前端校验规则。
 *
 * 这些常量和算法是**镜像**服务端的,不是权威来源:前端提前拦一下只是为了少一次往返,
 * 真正的准入判定仍在 API 和 worker 里。改动任意一侧都要同步另一侧:
 * - 扩展名:apps/api/src/imports/imports.service.ts
 * - 单个文件 20 MiB:同名文件里的 MAX_FILE_BYTES
 * - 单批 1..100,以及「该用户活跃任务数 + 本次文件数 ≤ 150、同工作区 ≤ 300」:
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
 * 一次最多提交多少个文件,也是为了「一个文件夹拖进来」而定的。
 *
 * 服务端卡的是「该用户 waiting/uploading/parsing/persisting 的任务数 + 本次文件数 > 150
 * 就整批拒绝」(同一工作区另有 300 的上限)。前端看不到当前活跃数,
 * 所以只能把「超过 100 个」当成必然失败来拦;不超过 100 个也不保证一定成功。
 */
export const IMPORT_BATCH_MAX_FILES = 100;

/** 文件夹层级上限,与服务端 MAX_FOLDER_DEPTH 一致(根为第 1 层)。 */
export const IMPORT_FOLDER_MAX_DEPTH = 8;

/** 文件夹名长度上限,与服务端 normalizeEntityName(name, 50) 一致。 */
export const IMPORT_FOLDER_MAX_NAME_LENGTH = 50;

export function isXmindFileName(name: string): boolean {
  return name.toLocaleLowerCase().endsWith(".xmind");
}

/** 导入路径里的目录部分;顶层文件的返回空串。 */
export function importFolderPath(path: string): string {
  return path
    .split("/")
    .filter((segment) => segment !== "")
    .slice(0, -1)
    .join("/");
}

/**
 * 单个目录段的归一化比较键,规则与服务端文件夹命名一致。
 * 空或超长返回 null(服务端会拒绝,调用方应放弃自动归档该路径)。
 */
export function normalizeFolderName(input: string): string | null {
  const displayName = toDisplayName(input);
  if (displayName === "" || displayName.length > IMPORT_FOLDER_MAX_NAME_LENGTH) return null;
  return displayName.toLocaleLowerCase("en-US");
}

/** 整条目录路径的归一化键;任何一段非法都返回 null。 */
export function normalizeFolderPath(path: string): string | null {
  const segments = path.split("/").filter((segment) => segment !== "");
  if (segments.length === 0) return "";
  if (segments.length > IMPORT_FOLDER_MAX_DEPTH) return null;
  const keys = segments.map((segment) => normalizeFolderName(segment));
  return keys.some((key) => key === null) ? null : keys.join("/");
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

/** 比较键:超过 100 字符的名字归一化会返回 null,这里兜一下,别让它退出查重。 */
function dedupeKey(name: string): string {
  return normalizeImportName(name) ?? name.trim().toLocaleLowerCase("en-US");
}

/** 去掉扩展名,得到默认文档名。 */
function stripExtension(name: string): string {
  return name.replace(/\.xmind$/iu, "");
}

/**
 * 给一批路径分配默认目标文档名(拖入文件夹时用)。
 *
 * 默认就是文件名;只有在会撞名的时候才退到「最短的唯一路径后缀」,
 * 例如 子目录A/登录用例.xmind 与 子目录B/登录用例.xmind 会变成
 * 「子目录A/登录用例」和「子目录B/登录用例」——用户仍然可以逐行改。
 *
 * 撞名是**整组**一起消歧的:只让后来的那几行改名,先来的会白占着短名,
 * 一批导入里出现 「登录用例」和「子目录B/登录用例」并存,读起来很怪。
 *
 * taken 是已经存在的行当前的名字(用户可能手改过)。既有行永远不被改名,
 * 只当作已占用。返回的数组与 paths 下标一一对应。
 */
export function defaultImportNames(
  paths: readonly string[],
  taken: readonly string[] = [],
): string[] {
  const seeded = taken.map((name) => dedupeKey(name));
  // 两种名字是两个互不相干的命名空间:文件名里不可能有 "/",路径后缀里一定有。
  // 所以文件名只可能和文件名撞,后缀只可能和后缀撞,分开维护就够了。
  const usedNames = new Set(seeded);
  const usedSuffixes = new Set(seeded);

  interface Member {
    index: number;
    path: string;
    segments: string[];
  }
  const groups = new Map<string, Member[]>();
  for (const [index, path] of paths.entries()) {
    const segments = path.split("/").filter((segment) => segment !== "");
    const key = dedupeKey(stripExtension(segments.at(-1) ?? ""));
    const member: Member = { index, path, segments };
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [member]);
    else group.push(member);
  }

  // 按组内排在最前的那个路径排序,保证同一批输入永远得到同一个结果。
  const ordered = [...groups.values()].sort((left, right) =>
    (left[0]?.path ?? "").localeCompare(right[0]?.path ?? "", "zh"),
  );
  const names: string[] = [];

  for (const members of ordered) {
    members.sort((left, right) => left.path.localeCompare(right.path, "zh"));
    const first = members[0];
    if (first === undefined) continue;
    const base = stripExtension(first.segments.at(-1) ?? "");
    // 一组里不止一条,或者这个名字已经被既有的行占了,整组都要带路径后缀。
    const needsSuffix = members.length > 1 || usedNames.has(dedupeKey(base));
    for (const member of members) {
      let assigned = base;
      if (needsSuffix) {
        let disambiguated: string | null = null;
        for (let take = 2; take <= member.segments.length; take += 1) {
          const candidate = stripExtension(member.segments.slice(-take).join("/"));
          // 后缀太长时保留结尾:判别性最强的部分在尾部。
          const trimmed =
            candidate.length > IMPORT_FILE_MAX_NAME_LENGTH
              ? candidate.slice(-IMPORT_FILE_MAX_NAME_LENGTH)
              : candidate;
          const key = dedupeKey(trimmed);
          if (usedSuffixes.has(key)) continue;
          disambiguated = trimmed;
          break;
        }
        // 连完整路径都被占用了,退回文件名,交给行校验去标红。
        assigned = disambiguated ?? base;
      }
      names[member.index] = assigned;
      usedSuffixes.add(dedupeKey(assigned));
    }
    usedNames.add(dedupeKey(base));
  }
  return names;
}
