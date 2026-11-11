# Go API 测试代码规范

适用于本目录的代码生成 Agent。项目有更具体约定时，以 `project_profile` 为准。

---

## 1. 目录与包

- 优先使用黑盒测试：`package api_test`。
- 测试文件放在 `project_profile.test_layout` 指定目录，默认 `test/api`。
- 集成测试使用 build tag：

```go
//go:build integration

package api_test
```

- 文件名：`<resource>_test.go`，例如 `order_create_test.go`。
- 一个文件只放一组相关接口的测试，不要把所有接口塞进一个文件。

---

## 2. 命名与映射

- 测试函数：`Test<Operation>_<CaseID>`，例如：

```go
func TestCreateOrder_TC_PA_ORD_004(t *testing.T)
```

- 表驱动子测试：`t.Run("TC-PA-ORD-004", func(t *testing.T) {...})`。
- 每个 case_id 必须有且只有一个测试入口。
- `case_mapping.md` 中记录：

```text
TC-PA-ORD-004 -> TestCreateOrder_TC_PA_ORD_004
```

---

## 3. HTTP 调用

- 优先复用项目已有 client/helper，不重复造轮子。
- base URL 从环境变量读取，例如 `TEST_BASE_URL`。
- 每次请求设置 `context.WithTimeout`，默认 10–30 秒。
- 读取并关闭 `resp.Body`：

```go
defer resp.Body.Close()
```

- 统一解析错误响应，断言 `status`、`code`、关键字段。
- 失败日志包含：case_id、method、path、status、响应体（脱敏）。

---

## 4. 断言

- 致命断言用 `require`，继续收集信息用 `assert`。
- 结构体比较优先 `go-cmp` 或项目已有 diff helper。
- 不只断言 `200`：至少包含状态码 + 关键业务字段/错误码。
- 副作用用例必须断言：
  - DB 行数/状态
  - 下游调用次数/请求体
  - 事件是否发送
- 错误响应断言：
  - 状态码
  - 错误码
  - 不泄露堆栈/SQL/内部路径

---

## 5. 数据与清理

- 每次运行生成唯一 `runID`：

```go
runID := fmt.Sprintf("%d", time.Now().UnixNano())
```

- 使用工厂/helper 造数据，避免手工 SQL 散落在测试里。
- 所有创建的数据用 `t.Cleanup` 清理：

```go
t.Cleanup(func() {
    _ = deleteOrder(ctx, client, orderID)
})
```

- 不依赖执行顺序；不共享可变全局变量。
- 不写真实 PII、真实手机号、真实卡号。

---

## 6. 同步与异步

- 禁止用 `time.Sleep` 作为唯一同步手段。
- 使用 `require.Eventually` 或项目已有轮询 helper：

```go
require.Eventually(t, func() bool {
    return getOrderStatus(ctx, client, orderID) == "PAID"
}, 30*time.Second, 500*time.Millisecond)
```

- 轮询要有超时和失败信息。
- 异步事件断言优先查业务状态，其次查消息/日志。

---

## 7. 并行

- 只有数据完全隔离时才 `t.Parallel()`。
- 共享 DB 行、共享账户、共享 mock 状态的测试不要并行。
- 并发幂等测试单独写，使用 `sync.WaitGroup` 或 barrier，不要用串行循环冒充并发。

---

## 8. Mock 与 DB

- HTTP 下游优先 `httptest.Server`。
- 接口依赖用 `gomock` 或项目已有 mock。
- 集成测试优先真实 DB/Redis（`testcontainers-go` 或项目已有容器）。
- `sqlmock` 只用于 SQL 层单测，不用于 API 集成测试。
- DB 断言只读；不要在测试里直接改生产表结构。

---

## 9. 环境与跳过

- 环境变量统一从 `os.Getenv` 读取。
- 缺少必要环境时：

```go
if os.Getenv("TEST_BASE_URL") == "" {
    t.Skip("TEST_BASE_URL not set")
}
```

- `t.Skip` 必须写原因，不能静默通过。
- 不在代码里写 token、密码、密钥。

---

## 10. 格式与静态检查

提交前必须通过：

```bash
gofmt -w .
go vet ./...
go test ./... -run '^$'
```

项目有 `golangci-lint` 时：

```bash
golangci-lint run ./...
```

---

## 11. 禁止事项

- 修改生产代码来让测试通过。
- 用空断言、`t.Skip`、`if err != nil { return }` 掩盖失败。
- 硬编码环境地址、token、租户 ID。
- 在测试之间共享可变状态。
- 用 `time.Sleep` 代替轮询。
- 引入未批准的新依赖。
