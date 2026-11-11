# backend-api-test-code-go

> 本目录是 `backend-api-test-code` 的 Go 实现。
> 把一个**已冻结的测试用例包**转换成**可编译、可评审、可执行的 Go API 测试代码**。
> 本目录是一个自包含的 Agent 任务文件夹，不读取其他 Agent 文件夹。

---

## 1. 这个 Agent 做什么

- 读取 `case_package`（用例包）和 `project_profile`（Go 项目约束）。
- 按用例 ID 生成 Go `_test.go` 文件。
- 复用项目已有的 HTTP client、认证 helper、数据工厂、清理函数。
- 生成用例到测试代码的映射。
- 运行**编译级验证**：`gofmt`、`go vet`、`go test -run '^$'`。
- 输出验证报告和阻塞项。

## 2. 不做什么

- 不设计或改写测试用例；用例由上游提供。
- 不修改生产代码。
- 不执行完整集成测试、不判定业务结果；完整执行交给执行 Agent。
- 不为了让测试通过而削弱断言或删除用例。
- 不自行新增第三方依赖；需要时输出 `dependency_request.md`。
- 不读取其他 Agent 文件夹，不引用其他 Agent 的文件路径。

---

## 3. 输入

### 3.1 必填

| 输入 | 说明 |
|---|---|
| `task_id` | 本次任务 ID |
| `case_package` | 用例包：路径或内联 YAML/JSON |
| `project_profile` | Go 项目约束：模块、目录、测试栈、helper、命令 |
| `environment` | base URL、认证、账号、租户、夹具、下游 Mock 的环境变量名 |
| `constraints` | 输出目录、允许修改范围、是否允许新增依赖、最大文件数 |
| `output_dir` | 测试代码输出目录 |

### 3.2 选填

| 输入 | 说明 |
|---|---|
| `existing_tests` | 2–3 个现有 `_test.go`，用于对齐风格 |
| `helper_inventory` | 现有 helper 清单：登录、建单、清理、HTTP 封装 |
| `ci_commands` | 团队实际使用的 `go test` / lint 命令 |
| `build_tags` | 例如 `integration` |
| `case_mapping_rules` | 用例 ID 到测试名的命名规则 |

### 3.3 最小输入包

```yaml
task_id: TASK-CODE-GO-ORD-001
language: go
case_package:
  path: "inputs/order-cases.yaml"
project_profile:
  module: "github.com/acme/order"
  go_version: "1.22"
  test_package: "api_test"
  test_layout: "test/api"
  assertion: "testify/require"
  http_client: "internal/testkit/client"
  auth_helper: "testkit.LoginAs"
  db: "testcontainers"
  mock: "httptest"
  build_tags: ["integration"]
  test_command: "go test ./test/api/... -tags=integration -race -count=1"
  lint_command: "golangci-lint run ./..."
environment:
  base_url_env: "TEST_BASE_URL"
  token_env: "TEST_TOKEN"
  tenant_env: "TEST_TENANT"
constraints:
  output_dir: "test/api"
  test_only: true
  allow_new_dependencies: false
  max_files: 10
```

> 输入包由编排器提供；本 Agent 不自己去其他目录找用例。

---

## 4. 输出

### 4.1 代码文件

| 输出 | 说明 |
|---|---|
| `*_test.go` | 按用例包生成的 Go 测试文件 |
| helper 文件（可选） | 仅当现有 helper 不足时新增，放在约定目录 |
| `case_mapping.md` | 用例 ID → 测试函数/子测试的映射 |
| `verification.md` | `gofmt`、`go vet`、`go test -run '^$'` 的结果 |
| `dependency_request.md` | 需要新增依赖时输出，不直接改 `go.mod` |
| `summary.yaml` | 任务状态、文件数、用例数、阻塞项 |

### 4.2 输出目录示例

```text
test/api/
├── order_create_test.go
├── order_query_test.go
└── testkit/
    └── order_fixture.go        # 仅当需要新增 helper
case_mapping.md
verification.md
summary.yaml
```

### 4.3 状态

`summary.yaml` 必须包含：

```yaml
task_id: TASK-CODE-GO-ORD-001
status: done            # done | partial | blocked
files:
  - test/api/order_create_test.go
case_count: 12
mapped_count: 12
compile_status: passed  # passed | failed | not_run
lint_status: passed     # passed | failed | not_run
dependency_requests: []
blocked_reasons: []
```

---

## 5. 目录内容

| 文件 | 作用 |
|---|---|
| `README.md` | 本文件：职责、输入、输出、边界 |
| `prompt.md` | 主 Prompt：加载给 Go 代码 Agent |
| `conventions.md` | Go 测试代码规范 |
| `project-profile.example.yaml` | 项目约束模板 |
| `case-package.example.yaml` | 用例包输入示例 |
| `templates/api_test.go.tmpl` | 测试文件骨架 |
| `examples/order_create_test.go` | 黄金示例（风格参考） |

---

## 6. 使用方式

1. 加载 `prompt.md` 作为 Agent 的主 Prompt。
2. 把 `case_package`、`project_profile`、`environment`、`constraints` 组装成输入包。
3. Agent 只生成测试代码，不修改生产代码。
4. 运行编译级验证；完整执行交给执行 Agent。
5. 检查 `case_mapping.md`、`verification.md`、`summary.yaml`。

---

## 7. 质量门禁

- [ ] 每个用例 ID 都有且只有一个测试函数/子测试
- [ ] 测试名或子测试名包含用例 ID
- [ ] 断言覆盖用例的 `expected`，不是只断言 200
- [ ] 副作用用例断言了 DB/下游/事件
- [ ] 使用 `t.Cleanup` 清理数据
- [ ] 没有用 `time.Sleep` 作为同步手段
- [ ] 并行测试的数据彼此隔离
- [ ] 没有修改生产代码
- [ ] 没有未经批准的新依赖
- [ ] `gofmt`、`go vet`、`go test -run '^$'` 通过
- [ ] `case_mapping.md` 与代码一致
- [ ] `summary.yaml` 状态准确

---

## 8. 原子化边界

- 本目录自包含：Prompt、规范、模板、示例都在本目录内。
- 不引用其他 Agent 文件夹，不读取其他 Agent 的输出。
- 需要其他信息时，返回 `status: blocked` 或 `partial`，由编排器补充输入。
- 输入包是唯一的外部信息来源。
