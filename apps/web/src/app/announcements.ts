/** 首页公告。首版没有公告表，前端静态维护，随发布一起更新。 */
export interface Announcement {
  date: string;
  title: string;
  body: string;
}

export const announcements: readonly Announcement[] = [
  {
    date: "2026-10-20",
    title: "首页工作台上线",
    body: "新增首页，汇总文档、节点、导入任务和待办。测试计划、缺陷、报告等模块尚未建设，暂不展示。",
  },
  {
    date: "2026-10-20",
    title: "XMind 导入支持整个文件夹",
    body: "导入弹窗现在可以直接拖入文件夹或选择目录，自动展开其中的 .xmind，单批最多 100 个。",
  },
  {
    date: "2026-10-20",
    title: "密码长度下限调整为 6 位",
    body: "只影响设置新密码，已有账号不需要修改密码。",
  },
];
