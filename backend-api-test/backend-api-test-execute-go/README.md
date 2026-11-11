# backend-api-test-execute-go

Go 后端 API 测试执行 Agent 的任务文件夹。

## 1. 这个 Agent 做什么

给定一个任务包（case package + Go 测试代码 + 运行配置），它负责：

- 只执行任务包 `scope` 中指定的测试用例。
- 运行 Go 测试代码，解析 `go test -json` 结果。
- 把实际结果与 case package 中的期望进行比对。
- 记录成功/失败/阻塞/跳过，并给出失败分类。
- 收集可复现的证据（请求、响应、trace、日志、DB/下游计数）。
- 按委派范围输出结构化结果和人类可读报告。

## 2. 这个 Agent 不做什么

- 不编写、不修改测试用例。
- 不编写、不修改 Go 测试代码。
- 不修复产品代码。
- 不扩大任务包给定的 case 范围。
- 不把未执行的用例推断成通过或失败。
- 不在生产环境执行写操作、注入、越权、压测或破坏性测试。
- 不读取其他 Agent 文件夹的内容。

## 3. 在整体流程中的位置

```text
写用例 Agent
    └── case package（用例 ID、优先级、请求、期望、副作用、清理）
              │
Go 代码 Agent
    └── Go 测试代码 + case ID 映射
              │
              ▼
backend-api-test-execute-go
    ├── 执行指定 case
    ├── 解析 go test 结果
    ├── 比对期望/实际
    ├── 分类失败
    └── execution-result.yaml + execution-report.md + 证据
```

测试代码由代码 Agent 产出，通过输入包传入；执行 Agent 不生成测试代码。

## 4. 输入

| 输入 | 必填 | 说明 |
|---|---|---|
| `task_id` | 是 | 本次执行任务 ID |
| `scope.case_ids` | 是 | 本次允许执行的 case ID 列表 |
| `scope.priorities` | 否 | 只跑指定优先级 |
| `scope.exclude_case_ids` | 否 | 明确排除的 case |
| `scope.max_cases` | 否 | 上限，超过则停止并报 partial |
| `artifacts.case_package` | 是 | 归一化后的用例包路径 |
| `artifacts.code.path` | 是 | Go 测试代码目录/文件 |
| `artifacts.code.mapping` | 否 | case ID 到 Go test 名称的映射；支持代码 Agent 的 `case_mapping.md` 或 YAML |
| `artifacts.code.summary` | 否 | 代码 Agent 的 `summary.yaml`，用于确认代码版本和编译状态 |
| `artifacts.report_dir` | 是 | 结果与证据输出目录 |
| `environment` | 是 | base URL、认证、账号、DB/Mock、环境变量 |
| `run.command` | 是 | 实际执行的 `go test` 命令 |
| `run.timeout` | 否 | 整体超时 |
| `run.retries` | 否 | 仅对 env/flaky 的重试策略 |
| `constraints` | 是 | 只读/沙箱写、是否允许清理、是否生产 |

完整字段见 [input.example.yaml](./input.example.yaml)。

## 5. 输出

| 输出 | 说明 |
|---|---|
| `execution-result.yaml` | 机器可读结果：范围、统计、逐 case 状态、证据、分类 |
| `execution-report.md` | 人类可读报告：范围、环境、总览、失败详情、阻塞、清理、限制 |
| `artifacts/` | `go-test.json`、JUnit、原始日志、覆盖率等 |
| 返回摘要 | 给编排器的短摘要，不粘贴全文 |

完整字段见 [output.example.yaml](./output.example.yaml)。

## 6. 文件说明

| 文件 | 用途 |
|---|---|
| `README.md` | 本文件夹的职责、边界、输入输出 |
| `backend-api-test-execute-go.md` | 主 Prompt，加载给执行 Agent |
| `input.example.yaml` | 输入包示例 |
| `output.example.yaml` | 结果包示例 |

## 7. 加载方式

1. 将 `backend-api-test-execute-go.md` 作为 Agent 的主 Prompt。
2. 将本次任务的输入包作为用户消息传入。
3. 要求 Agent 把结果写到 `artifacts.report_dir`。
4. 只接收摘要和文件路径，不要求 Agent 在对话里粘贴全部日志。

## 8. 边界与安全

- 只执行 `scope.case_ids` 内的用例；其他 case 标记为 `out_of_scope`，不执行。
- 不修改 case package、测试代码或产品代码。
- 不在生产环境执行写操作、注入、越权、压测、破坏性测试。
- 安全类用例必须有输入包中的授权说明；没有授权就 `blocked`。
- 报告中的 token、cookie、手机号、身份证、卡号、内部 IP 必须脱敏。
- 清理即使失败也要记录；不能清理时标 `cleanup_failed`，不要隐瞒。

## 9. 完成标准

- 每个 `scope.case_ids` 都有最终状态，不允许遗漏。
- 每个失败都有证据、期望/实际对比和分类。
- 统计数字与逐 case 结果一致。
- 报告明确写出“未执行/超出范围”的部分。
- 没有把未执行用例写成通过。
- 没有代码、用例或环境被静默修改。
