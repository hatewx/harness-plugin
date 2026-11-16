---
name: employee-offboarding
description: "按用户明确指定的员工，核对并清理 PineRouter 与 Cursor 访问权限；适用于员工离职或账号回收。"
---

# 员工离职权限处理

## 执行入口与资源

本技能的脚本、测试、参考说明及流程图均维护在当前技能目录。不要在调用方仓库复制实现。

将 `SKILL_DIR` 设为当前加载的技能目录绝对路径，在调用方配置目录（当前为 `~/Work/pf/code/pinerouter`）运行：

```bash
tsx "$SKILL_DIR/scripts/offboarding/offboard-user.ts" --username '员工姓名'
tsx "$SKILL_DIR/scripts/offboarding/offboard-user.ts" --username '员工姓名' --execute
```

第一条只读预览。只有用户明确要求执行具体员工的离职清理时，才运行带 `--execute` 的命令。

- Cursor 单项：`tsx "$SKILL_DIR/scripts/offboarding/cursor.ts" --username '员工姓名'`；执行时追加 `--execute`。
- PineRouter 单项：`tsx "$SKILL_DIR/scripts/pinerouter/offboard-user.ts" --userid '已核对的userid'`；执行时追加 `--execute`。
- 模拟测试：`tsx --test "$SKILL_DIR/scripts/offboarding/offboard-user.test.ts" "$SKILL_DIR/scripts/pinerouter/offboard-user.test.ts"`。
- 原调用方仍可运行 `pnpm offboard`、`pnpm offboard:cursor` 和 `pnpm test:offboarding`，其命令指向本技能目录中的实现。

需要 Node.js、tsx 和已授权 user 身份的 lark-cli。总入口与 Cursor 入口从当前工作目录的 `.env.local` 读取配置，文件中的配置覆盖进程环境中的同名变量。PineRouter 单项需事先加载环境变量。凭据保留在调用方本地配置中，不迁入技能、文档、日志或提交；总流程所需的操作者字段是 `PINE_ROUTER_OPERATOR`。

按处理范围阅读参考资料：

- 总流程或 Cursor：[references/employee-offboarding.md](references/employee-offboarding.md)。包含真实飞书字段、接口与配置说明。
- PineRouter 或漏删排查：[references/pinerouter-offboard-user.md](references/pinerouter-offboard-user.md)。管理员子串搜索必须显式传 `substring_matching=true`，分页读取并在本地核验 user_id 包含关系，覆盖 ss: 前缀。
- 可编辑流程图：[总流程](references/employee-offboarding.drawio)、[PineRouter](references/pinerouter-offboard-user.drawio)。

## 身份核对与决策

- 飞书 Cursor 账号表按姓名精确查询。唯一记录提供邮箱和记录 ID；零条记录表示未开通 Cursor，跳过 Cursor 操作和飞书状态回写；多条记录、未读完分页或结构异常时停止。
- PineRouter userid 先从 Soulforge 精确匹配；无在职记录时查本地历史 UUID 映射；仍无匹配时按姓名或已确认的 Cursor 邮箱精确反查 PineRouter 用户表。零匹配表示未开通 PineRouter；多条 userid 或身份冲突时停止，不猜测。
- 预览应逐项报告姓名、userid（若有）、Cursor 记录/成员状态、PineRouter Key 数量和执行模式。身份或 Key 归属不明确时不要执行。
- 预检通过且用户明确要求执行后，流程会再次核验飞书记录，删除目标 PineRouter Key 并复查，再用 computer use 在 Cursor 管理后台按已核对邮箱移除有效成员，复查后重跑 `--execute`，最后将对应飞书记录状态改为“已离职”并回读验证。未开通 Cursor 的记录不写入离职状态。

## 失败处理

- 任一预检失败时停止，不执行后续写入。
- 执行中失败可能已经完成前序操作；删除不会自动回滚。先根据命令输出核对 PineRouter、Cursor 和飞书的实际状态，再决定是否重跑。报告已完成步骤和仍待处理步骤。
- 当前团队无 Enterprise 权限，不调用 Cursor `/teams/remove-member`。使用 computer use 在 Cursor 管理后台按预览确认的邮箱移除成员；操作后在后台复查，再重跑 `--execute`，由脚本读取成员列表确认无有效成员并回写飞书状态。若后台无法操作，停止并报告已完成步骤。
- 仅当脚本明确报告 PineRouter 无 Key、Cursor 无有效成员（或未开通）且飞书状态已验证为“已离职”时，才报告完整流程成功。未开通某项服务时，明确写“未开通”，不要说已执行移除。
