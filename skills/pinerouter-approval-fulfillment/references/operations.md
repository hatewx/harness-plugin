# 资源与字段

2026-10-27 已读取机制文档 revision 1984，以及申请表全部 24 个字段。以下为字段快照；执行时核对目标表结构。

- 机制：https://pinefield.feishu.cn/wiki/MLHTwF8uOiSm9EkRjkJcDj7Zn6d
- 申请表：https://pinefield.feishu.cn/wiki/OBYLw0rGbiJH3IkNHbCcBKT5nng
- Base token：`CfDDbYZBQahhCjs7lB3c6raWnwg`
- Table ID：`tblW0Ym27fukV0Xh`

用 `lark-cli base +field-list --base-token <token> --table-id <id> --as user` 核对结构；查询或写入命令参数不明确时查看对应 `--help`。

| 内容 | 字段 ID | 类型/说明 |
| --- | --- | --- |
| 项目 | fld8XJqZwR | text |
| 项目类型 | fldD5HREjX | select |
| 使用场景与申请说明 | fldMaoWUrS | text |
| 申请人&负责人 | fldFJOp5po | user |
| 技术负责人 | fld9UBOnpA | user |
| 业务负责人 | fldKPZxVt9 | user |
| 预算(RMB) | flddw2ENuf | number，循环为周期金额 |
| 预算重置周期 | fldMiQq8li | select，目前仅天/周/月 |
| 预算开始时间 | fldkzHAuST | datetime |
| 结束时间 | fldc2SKuuC | datetime |
| 可使用模型（; 分隔） | fldFJR9M3C | text |
| 超限规则 | fldB00Cckh | select：禁止调用/提示升级/降级到免费模型 |
| TPM / RPM | fld3RPMDwp / fldLUh2nrt | number |
| 审批实例 ID | fldOZm4N90 | text，审批查重键 |
| 关联审批单 | fldJvHWBsj | URL 样式 text |
| key alias | fldiydfjFD | text |
| key name / key digest | fld6fUincL / fldiWuMu7P | text，不写明文 Key |
| 父记录 2 | fldqCFAsUJ | 同表 link |
| Operator | fldoxoRyMO | user |
| 平台 | fldQ6ke7Gt | select |
| 备注 | fld5FyW2YD | text |

当前表没有“不循环”选项，而机制允许不循环。此类审批先展示冲突并确认落地办法，不静默改为“月”、新增选项或改变表结构。人员用真实 Open ID，关联用 record ID；沿用现有父/子记录结构。

# PineRouter 实现边界

本技能自带以下资源，路径均相对于技能目录，不依赖调用方仓库或设备目录：

- [执行脚本](../scripts/pinerouter/execute-approved-budget.ts)
- [输入示例](../scripts/pinerouter/approved-budget.example.json)
- [模拟测试](../scripts/pinerouter/execute-approved-budget.test.ts)
- [Project 接口源码快照](litellm/project_endpoints.py)及其 [LICENSE](litellm/LICENSE)

Project 接口源码来自 LiteLLM commit `30d9cf356eefd2c05e7bebc274af8477d01a487c`，仅供阅读接口约束，不作为 Python 模块运行，也不需要安装完整 LiteLLM。具体参数、分页及响应以目标部署为准。只读查询包括 `/team/list`、`/project/list`、`/project/info`、`/key/list`；写入包括 `/project/new`、`/key/generate`。Project 必须绑定已有 Team；所有 Key 必须绑定正确 `project_id`。

## 独立运行与验证

需要 Node.js 及 tsx；脚本只导入 Node.js 内置模块，无调用方代码依赖。将 `SKILL_DIR` 设为当前加载技能的实际绝对目录，输入文件使用操作者准备的路径：

```bash
tsx "$SKILL_DIR/scripts/pinerouter/execute-approved-budget.ts" --approval-id '<实际实例ID>' --input "$SKILL_DIR/scripts/pinerouter/approved-budget.example.json"
tsx --test "$SKILL_DIR/scripts/pinerouter/execute-approved-budget.test.ts"
```

示例含占位值，仅演示无外部写入的本地输入预览。实际输入复制到技能目录以外的工作目录后填写，不覆盖随技能分发的示例。预览不需要凭据；原始执行模式需要 `PINE_ROUTER_BASE_URL`、`PINE_ROUTER_ADMIN_KEY`、`SS_CLAW_APP_ID`、`SS_CLAW_APP_SECRET`，以及可选审计标识 `PINE_ROUTER_OPERATOR`，从操作者环境注入，禁止随技能分发实际值。

随附 `execute-approved-budget.ts` **不能直接作为通用执行器**：

- 其默认 dry-run 仅校验输入，未读取审批、Base 或网关，不能替代技能的只读核验。
- 默认按审批 ID 派生 Project ID，且已有项目必须具有同一审批 metadata；无法直接完成其他审批下已有项目的复用。
- 仅接受天/周/月，映射 `1d`/`7d`/`30d`；30 天滚动不等于自然月。金额原字段为 RMB，`gatewayBudgetUsd` 是执行人确认的美元值。
- 仅支持“禁止调用”。“提示升级”和“降级到免费模型”须有经核验的额外能力，不能靠写 Base 或 metadata 实现；不能擅自改成停止调用。
- 日期检查按 UTC，Key 有效期按天向上取整；不能保证按审批时区精确到期。
- Key 查重只读一页；不能据此判定全量不存在。审批状态没有自动校验。
- 执行顺序是 Project → Key → Base，且将新 Key 明文输出到 stdout。不能直接运行以满足本技能的交付与日志要求。

执行使用已核验的管理 API 和 lark-cli；随附脚本仅用于本地输入预览和实现参考，修复上述限制前不使用 `--execute`。错误输出须去除凭据和 Key。

## 预算口径

≤ 1 万元由业务 Leader 审批；> 1 万元需业务 Leader + CEO。循环预算按“一年 / 重置周期 × 周期预算”核验门槛，天/周非整除口径不明确时确认；非循环使用总预算。80%—99% 提醒负责人，100% 执行登记的超限策略。只登记策略不代表已实现提醒或降级能力。

以上口径来自所列机制版本；用户提供新版机制或要求核对制度时再读取文档，不必每次执行重读规则。
