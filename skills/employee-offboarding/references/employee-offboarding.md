# 员工离职：PineRouter 与 Cursor

统一入口：`scripts/offboarding/offboard-user.ts`。
Cursor 单项入口：`scripts/offboarding/cursor.ts`。
流程图：`references/employee-offboarding.drawio`，可在 draw.io 打开和编辑。

## 执行顺序

1. 读取指定飞书表格的真实字段结构，验证 `Name`、`Email` 和状态单选“已离职”选项。
2. 在用户指定视图中搜索姓名。唯一且精确匹配时从 `Email` 读取邮箱；零条记录视为未开通 Cursor，跳过 Cursor 处理；多条或异常结构仍停止执行。CLI 返回的邮箱可能是 Markdown 链接，脚本取其邮箱文本。
3. 从 soulforge 解析 PineRouter userid；精确匹配为零时自动查询唯一的本地历史映射，再按姓名或 Cursor 邮箱精确反查 PineRouter 用户表。所有来源均为零时视为未开通 PineRouter；任何来源出现歧义时停止。也可显式使用 `--local-mapping` 或指定 `--userid`。
4. 用 Cursor 管理 Key 只读查询团队成员，按邮箱精确匹配，识别 `isRemoved` 状态；同时预览 PineRouter Key 数量。
5. 默认只输出预览。显式 `--execute` 后再次核对记录身份，执行 PineRouter Key 删除和残留检查。
6. 使用 Cursor `POST /teams/remove-member` 按邮箱移除成员。要求返回 `success: true`，再查询确认该邮箱没有有效成员。已移除或不在该团队时跳过移除。
7. 再检查 PineRouter 没有残留，然后将同一飞书记录的状态更新为“已离职”，读取验证结果。

Cursor 单项入口执行 1、2、4、6、7 中的 Cursor 与飞书部分，不查询或修改 PineRouter。该表用于 Cursor 账号管理，单项入口中的“已离职”仅说明 Cursor 项完成；如需两项均完成，请使用总入口。

任一预检失败时，不进行任何外部写入。执行中失败可能已经完成前面的步骤，脚本不会回滚删除；可核对后重跑。状态已是“已离职”时仍会查询真实访问情况，不只依据状态跳过清理。写入前重新核对姓名、邮箱和记录 ID，不更改其他字段。

## 目标与凭据

固定目标是用户提供的 [Cursor 账号表](https://pinefield.feishu.cn/base/NOP6bDopDaAQCusL3S1cuTbmnxg?table=tbl1kVfdruWYbyeC&view=vew2eOxWI0)。

- Base：`NOP6bDopDaAQCusL3S1cuTbmnxg`
- Table：`tbl1kVfdruWYbyeC`
- View：`vew2eOxWI0`
- Name：`fldL9KauoN`
- Email：`fld1wK0tf1`
- 状态：`fldUyKVDhr`

脚本维护于 harness-plugin；从调用方配置目录（当前为 llm-gateway 根目录）执行。直接运行时将 SKILL_DIR 设为当前技能目录绝对路径。入口自动读取 `.env.local`，文件中的配置优先于已有进程环境变量，避免终端残留的旧凭据覆盖本地配置。Cursor Key 存放在 `CURSOR_API_KEY`；文件已被 Git 忽略，不要提交实际凭据。

总入口还需 `PINE_ROUTER_BASE_URL`、`PINE_ROUTER_ADMIN_KEY`；在线查用户需 `SOULFORGE_TOKEN`。实际执行总入口时需 `PINE_ROUTER_OPERATOR` 作为审计操作者。飞书操作复用 `lark-cli` 已授权的 user 身份，不读取或复制飞书登录 Token。

Cursor 使用 [官方 Admin API](https://cursor.com/docs/account/teams/admin-api#remove-team-member)，Basic Auth 的用户名是 API Key，密码为空。官方文档注明移除成员仅限 Enterprise。成员列表通过 `GET /teams/members` 读取。

先停用员工登录权限，避免 PineRouter 自动重新生成 Key。本脚本不负责 soulforge 停用。

## 命令

默认总流程预览：

```sh
pnpm offboard --username '员工姓名'
```

员工已从 soulforge 移除时，使用历史映射预览：

```sh
pnpm offboard --username '员工姓名' --local-mapping
```

核对身份后执行总流程：

```sh
pnpm offboard --username '员工姓名' --userid '已核对的userid' --execute
```

仅预览 Cursor：

```sh
pnpm offboard:cursor --username '员工姓名'
```

仅执行 Cursor 离职并回写该账号表：

```sh
pnpm offboard:cursor --username '员工姓名' --execute
```

测试：

```sh
pnpm test:offboarding
```

## 本次验证

已只读核对字段和徐千伟的姓名邮箱映射。提供的 Cursor API Key 调用 `/teams/members` 返回 HTTP 401，当前尚不能确认该凭据的团队成员读取及移除权限。总流程只读试运行在 Cursor 认证处失败，没有发送任何删除或状态更新请求。

模拟测试覆盖预览无写入、顺序执行、认证失败先于写入、PineRouter 失败、Cursor 移除未生效、状态回写未生效、成员已移除、姓名歧义和身份变化。
