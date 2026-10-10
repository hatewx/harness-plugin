# 员工离职 Key 清理

脚本：`scripts/pinerouter/offboard-user.ts`，TypeScript，使用 Node.js 内置模块；通过 tsx 运行。
流程图：`references/pinerouter-offboard-user.drawio`，可用 draw.io 打开编辑。

## 已核对的实现

- spatial-smart-cc 的 `src-pilot/lib/routes/litellm/key-management.ts` 中，`handleLiteLLMKeyGenerate` 使用认证用户 userid，并写入 `metadata.owner_user_id`。
- `src-pilot/lib/litellm/key-models.ts` 中，`ensureKeyCreation` 将 userid 写入 PineRouter `/key/generate` 的 `user_id`。
- `src-pilot/lib/litellm/user-key-manager.ts` 中，自动 Key 使用 `ss:<userid>`，需要一并清理。
- 当前 PineRouter 内置 LiteLLM 的 `key_management_endpoints.py` 提供分页搜索 `/key/list?user_id=<userid>` 和 `/key/delete`；删除支持 token hash。线上管理员搜索需显式传入 substring_matching=true，默认精确匹配；本地源码按管理员角色自动开启，行为与线上不同。
- Noesis 的 `scripts/update-uuid-mapping.ts` 使用 soulforge 公司用户接口；CSV 仅有 `uuid,showname,phone`，没有登录 username 字段。故默认在线匹配 userName 或规范化后的 showname；本地模式只能按 showname 匹配。

## 使用

先停用员工登录权限，避免 spatial-smart 自动重新创建 Key。脚本不负责停用 soulforge 账号、清理应用 Redis 缓存或删除用户记录。

通过环境变量提供配置（不要把实际密钥提交到仓库）：

- `PINE_ROUTER_BASE_URL`：网关管理 API 地址，包含部署时的路径前缀。
- `PINE_ROUTER_ADMIN_KEY`：管理员 Key。
- `SOULFORGE_TOKEN`：在线查用户所需 Token。
- `SOULFORGE_USERS_URL`：可选，默认沿用 UUID 更新脚本中的公司用户接口。
- `PINE_ROUTER_OPERATOR`：实际执行必填，操作者标识，写入审计请求头。

默认只读预览：

```sh
tsx "$SKILL_DIR/scripts/pinerouter/offboard-user.ts" --username '员工姓名或登录名'
```

核对目标 userid 后执行：

```sh
tsx "$SKILL_DIR/scripts/pinerouter/offboard-user.ts" --userid '已核对的userid' --execute
```

员工已从 soulforge 删除时，用历史映射预览：

```sh
tsx "$SKILL_DIR/scripts/pinerouter/offboard-user.ts" --username '员工姓名' --local-mapping
```

本地映射默认是 `~/Work/noesis/02-工作/pf/local.uuid-mapping.csv`，可用 `--mapping <文件路径>` 替换。不会在在线接口失败后自动切换到本地映射。同名多个 UUID 或无匹配时失败，需要人工核对后指定 `--userid`；账号重建导致多个历史 UUID 时，分别清理每个 UUID。

## 删除范围与结果

脚本通过 `/key/list?user_id=<userid>&substring_matching=true` 分页搜索活动 Key，再在脚本中校验 `user_id` 是否包含目标 userid（不区分大小写）。管理凭据需为 proxy_admin 或具备该搜索能力的管理员角色。覆盖原始 userid、ss:userid 以及其他前后缀形式。按用户要求，仅以 user_id 包含关系确定删除范围，不按 metadata、别名、创建人、团队或项目负责人推测归属。

先完成全部分页扫描，再每批最多删除 100 个 token/hash；不输出 token、管理员凭据或接口响应正文。删除后重新分页搜索并匹配，只有无残留才报告完成。中途失败可能已删除部分批次；排查后可重跑。并发创建仍可能发生，因此先停用登录权限是离职流程的前置步骤。

验证：

```sh
tsx --test "$SKILL_DIR/scripts/pinerouter/offboard-user.test.ts"
```

自动测试使用模拟接口。实际执行需显式传入 --execute。当前会话未提供 drawio MCP，流程图以兼容 draw.io 的 XML 文件交付。
