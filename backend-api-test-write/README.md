# 后端 API 测试用例编写 Prompt 套件

本目录是一套**给 Agent 加载的写用例 Prompt**，不是测试代码，也不是测试执行脚本。

本套件只负责**编写测试用例**：不执行测试、不调用接口、不回填执行结果。所有文件都在本目录内，不引用其他 Agent 目录。

它的目标只有一个：把一个后端 API 变更拆成**范围极小、类型明确**的任务，由 Agent 产出可直接评审、可直接转自动化的测试用例。

类型体系采用你在讨论中确认的实践口径：**默认 3 种必做 + 2 种按风险有条件挂载，上限 5 种**。不是每个迭代都把 5 种做全。

---

## 1. 测试类型：3 + 2

| # | 类型 | 定位 | 单次任务范围 | 时机 | 默认/条件 |
|---|---|---|---|---|---|
| 1 | 接口契约测试 | 锁住接口的“形状”：路径、方法、字段名、类型、必填、状态码、错误结构 | 1 个 operation（method + path） | 接口定义冻结后、开发开始前；CI 持续校验 | **默认必做** |
| 2 | 参数测试（API + Mock 数据，含异常/负向） | 验证单接口在正常、边界、非法、状态相关输入下的行为和副作用 | 1 个 endpoint | 开发过程中，随代码一起写、一起跑 | **默认必做** |
| 3 | 端到端核心链路测试 | 验证一条核心业务链路能闭环，关键状态一致 | 1 条核心链路，3–8 步 | 提测前 / 发布前 | **默认必做** |
| 4 | 幂等性 / 重试验证 | 验证重试、重复提交、并发下不会产生重复副作用 | 1 个写接口 + 1 种幂等机制 | 发布前，针对关键写接口 | **条件触发** |
| 5 | 安全测试 | 验证认证、授权、租户隔离、敏感数据、注入与业务滥用防护 | 1 个 endpoint 或 1 个信任边界 | 提测前 / 发布前，针对高风险接口 | **条件触发** |

关键边界：

- **契约测试不验证业务值是否正确**，只验证响应结构是否符合 OpenAPI/Swagger/消费方约定。
- **参数测试必须包含异常/负向**；“负向测试”不是第 6 种类型，而是参数测试的必含部分。Mock 数据的意义就在于构造正常、边界、非法输入。
- **E2E 只覆盖核心主链路**，不铺全量分支；成本高、失败定位难，失败时要能拿到 trace/correlation id。
- **第 4、5 种是风险触发的检查项**，不是每个迭代的常规必跑项。没有触发条件就明确写“不适用 + 原因”，不要为了凑五类而做。

---

## 2. 文件清单

| 文件 | 角色 | 加载给谁 | 单次范围 |
|---|---|---|---|
| [`backend-api-testcase-orchestrator.md`](./backend-api-testcase-orchestrator.md) | **总体编排 Prompt**：选类型、切任务、派发、汇总、验收；不执行测试 | 编排 Agent / 测试负责人 | 一个变更、一个特性或一个 PR 的影响面 |
| [`backend-api-contract-testcase-write.md`](./backend-api-contract-testcase-write.md) | 契约测试用例编写 | 契约测试 Worker | 1 个 operation |
| [`backend-api-parameter-testcase-write.md`](./backend-api-parameter-testcase-write.md) | 参数测试用例编写（含负向/边界/业务规则） | 参数测试 Worker | 1 个 endpoint |
| [`backend-api-e2e-testcase-write.md`](./backend-api-e2e-testcase-write.md) | E2E 核心链路用例编写 | E2E Worker | 1 条核心链路 |
| [`backend-api-idempotency-testcase-write.md`](./backend-api-idempotency-testcase-write.md) | 幂等/重试用例编写 | 幂等测试 Worker | 1 个写接口 + 1 种机制 |
| [`backend-api-security-testcase-write.md`](./backend-api-security-testcase-write.md) | 安全测试用例编写 | 安全测试 Worker | 1 个 endpoint 或 1 个信任边界 |

每个专用 Prompt 都是**自包含**的：即使不加载总体 Prompt，也能单独完成该类任务。若同时加载总体 Prompt，**总体 Prompt 决定范围与派发，专用 Prompt 决定该类用例的写法**。

> 不要把 5 个专用 Prompt 同时塞给一个 Agent。类型混在一起，最容易产出“什么都沾一点、什么都不深”的用例。

---

## 3. 三种用法

### 模式 A：编排 Agent + 专用 Worker（推荐）

1. 编排 Agent 加载 `backend-api-testcase-orchestrator.md`。
2. 编排 Agent 读取变更信息，产出 `00-test-plan.md` 和 `01-task-board.md`。
3. 每个 Worker 只加载**一个**专用 Prompt，拿到一个任务包，产出**一个**用例文件。
4. 编排 Agent 汇总、去重、补缺口、验收。

适合：一个需求涉及多个接口、多条链路；需要并行；需要控制每个 Agent 的上下文。

### 模式 B：单 Agent 单任务

一个 Agent 同时加载：

- 总体 Prompt（用于理解全局约定和边界）
- 一个专用 Prompt（用于执行）

然后只给它一个 endpoint / 一条链路。适合：临时补一类用例、范围明确的单点任务。

### 模式 C：人工复制使用

把专用 Prompt 作为系统提示词，把“输入包”作为用户消息，直接让 Agent 输出用例。适合：还没接编排、先验证 Prompt 效果。

---

## 4. 最小输入包

无论哪种模式，Worker 至少需要下面这些信息。缺失时，Agent 应先问阻塞问题，不能凭空编造接口、字段、错误码或业务规则。

```yaml
task_id: TASK-PARAM-ORD-001
test_type: parameter            # contract | parameter | e2e | idempotency | security
scope:
  endpoint: "POST /v1/orders"   # 或 flow: "登录→下单→支付"
  resource: "order"
spec:
  openapi_path: "specs/openapi.yaml"
  version: "2026-11-01 / commit abc123"
  operation_id: "createOrder"
business:
  rules:
    - id: BR-002
      text: "quantity 必须为 1..99 的整数"
  states: ["CREATED", "PAID", "CANCELLED"]
environment:
  base_url: "https://test-api.example.com"
  auth: "Bearer ${TEST_USER_TOKEN}"
  users:
    - role: buyer
      token_env: TEST_BUYER_TOKEN
  fixtures: "fixtures/orders.yaml"
  downstream_mocks: ["payment-mock", "inventory-mock"]
constraints:
  max_cases: 25
  language: zh-CN
  output_path: "cases/parameter/order-create.md"
  allowed_actions: "sandbox-write"   # read-only | sandbox-write
```

---

## 5. 输出物

编排模式下，默认产出：

```text
<out>/
├── 00-test-plan.md                 # 范围、类型选择、理由、执行顺序、风险
├── 01-task-board.md                # 任务清单、负责人/Agent、依赖、状态
├── 10-cases/
│   ├── contract/<resource>.md
│   ├── parameter/<resource>.md
│   ├── e2e/<flow>.md
│   ├── idempotency/<resource>.md
│   └── security/<resource>.md
├── 90-coverage-matrix.md           # 对象 × 类型 × 维度 × 覆盖情况
├── 91-open-questions.md            # 契约缺口、业务规则待确认、环境阻塞
└── 92-review-report.md             # 去重、遗漏、质量门禁结果
```

单任务模式下，至少产出一个用例 Markdown 文件；文件内必须包含用例清单、用例详情、覆盖矩阵、缺口与待确认。

---

## 6. 执行时序

```text
接口定义冻结
   │
   ├─ 1. 契约测试（开发前，锁形状，进 CI）
   │
   ├─ 2. 参数测试（开发中，随代码；含正常/边界/负向/业务规则）
   │
   ├─ 3. 幂等/重试（条件触发；资金、订单、库存、权益类写接口）
   │
   ├─ 4. 安全测试（条件触发；认证、授权、租户、敏感数据、文件、URL 外联）
   │
   └─ 5. E2E 核心链路（提测/发布前，只跑核心主链路）
```

顺序不是绝对的：契约测试必须前置；参数测试随开发；E2E 依赖多个服务就绪，放在提测前；幂等和安全按风险在发布前挂载。

---

## 7. 设计原则

1. **一次一个最小对象**：一个 operation、一个 endpoint、一条链路、一个写接口 + 一种机制。范围越小，用例越深。
2. **证据可追溯**：每条用例都要能指回契约位置、业务规则 ID 或链路步骤。没有依据的期望，不写成硬断言。
3. **不发明**：不编造接口、字段、错误码、状态机、限额。缺失就进“待确认”，不要猜。
4. **期望可判定**：不写“返回成功”“数据正确”。写清状态码、错误码、字段、状态变化、副作用次数。
5. **一次只变一个主变量**：负向用例尤其如此；组合场景只在有交互风险时用 pairwise，不做全笛卡尔积。
6. **数据可重复**：唯一后缀、工厂/夹具、用后清理；不依赖执行顺序；不写生产 PII。
7. **非破坏**：默认只读或沙箱写；安全测试必须有书面授权；禁止 DoS、拖库、破坏性 payload。
8. **区分“用例”与“缺陷/缺口”**：用例是设计，缺陷是观察结果，契约缺口是文档问题。三者不要混在一张表里。

---

## 8. 常见误区

| 误区 | 后果 | 正确做法 |
|---|---|---|
| 把契约测试做成业务逻辑测试 | 用例臃肿、和参数测试重复、契约漂移反而没测到 | 契约只测形状、状态码、错误结构；业务值交给参数测试 |
| 参数测试只测正常值 | 线上大量 4xx/5xx 和脏数据问题漏测 | 正常 + 边界 + 负向 + 业务规则/状态，必须成组覆盖 |
| E2E 铺全量分支 | 跑得慢、不稳定、失败定位难 | 只覆盖核心主链路 + 最多 2 个关键失败分支 |
| 为了“5 类齐全”硬做安全和幂等 | 成本高、收益低、团队抵触 | 按触发条件挂载；不触发就写 N/A + 原因 |
| 用例期望写成“返回成功” | 无法自动化、无法判定 | 写状态码、错误码、字段断言、状态变化、副作用计数 |
| 一条用例同时改多个参数 | 失败无法定位、组合爆炸 | 一个主变量；交互场景单独标注 pairwise |
| 用例依赖执行顺序/共享数据 | 不可重复、CI 随机失败 | 每条用例自备前置数据，用后清理 |
| 把 spec 没定义的行为当缺陷 | 误报、和开发扯皮 | 进“契约缺口/待确认”，不要写死期望 |

---

## 9. 维护

- 版本：`1.0`
- 类型体系变更时，先改总体 Prompt 的“类型选择规则”，再同步 5 个专用 Prompt 的边界章节。
- 新增测试类型时，不要塞进现有文件；新增独立 Prompt，并在 README 和总体 Prompt 的文件清单里注册。
- 每次实战后，把“误报/漏报/无法判定”的用例回灌到对应 Prompt 的“反模式”或“质量门禁”。
