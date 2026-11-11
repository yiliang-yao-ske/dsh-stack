# Python API 测试代码规范

适用于本目录的代码生成 Agent。项目有更具体约定时，以 `project_profile` 为准。

---

## 1. 目录与包

- 测试目录：`project_profile.test_layout`，默认 `tests/api`。
- 文件名：`test_<resource>_<action>.py`，例如 `test_order_create.py`。
- 一个文件只放一组相关接口的测试，不要把所有接口塞进一个文件。
- 共享 fixture 放 `conftest.py`；不要在测试文件之间互相 import 测试函数。

---

## 2. 命名与映射

- 测试函数：`test_<operation>_<case_id>`，例如：

```python
def test_create_order_tc_pa_ord_004(buyer_token):
    ...
```

- 参数化：

```python
@pytest.mark.parametrize(
    "case",
    CASES,
    ids=[c["case_id"] for c in CASES],
)
def test_create_order(case, buyer_token):
    ...
```

- 每个 case_id 必须有且只有一个 pytest 节点。
- `case_mapping.md` 中记录：

```text
TC-PA-ORD-004 -> tests/api/test_order_create.py::test_create_order[TC-PA-ORD-004]
```

---

## 3. HTTP 调用

- 优先复用项目已有 client/fixture，不重复造轮子。
- base URL 从环境变量读取，例如 `TEST_BASE_URL`。
- 每次请求设置超时：

```python
client = httpx.Client(base_url=base_url, timeout=30.0)
```

- 使用 `with httpx.Client(...) as client:` 或 fixture 管理生命周期。
- 失败日志包含：case_id、method、path、status、响应体（脱敏）。

---

## 4. 断言

- 使用 pytest 原生 `assert`，错误信息写清楚。
- 不只断言 `200`：至少包含状态码 + 关键业务字段/错误码。
- 结构体比较可用 `assert actual == expected` 或 `deepdiff`（如项目已有）。
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

- 每次运行生成唯一 `run_id`：

```python
run_id = uuid.uuid4().hex[:12]
```

- 使用 fixture 造数据，避免手工 SQL 散落在测试里。
- 创建的数据用 fixture `yield` 或 `addfinalizer` 清理：

```python
@pytest.fixture
def order(buyer_token):
    order_id = create_order(buyer_token)
    yield order_id
    delete_order(buyer_token, order_id)
```

- 不依赖执行顺序；不共享可变全局变量。
- 不写真实 PII、真实手机号、真实卡号。

---

## 6. 同步与异步

- 禁止用 `time.sleep` 作为唯一同步手段。
- 使用轮询 helper 或 `tenacity`：

```python
wait_until(lambda: get_order_status(order_id) == "PAID", timeout=30)
```

- 轮询要有超时和失败信息。
- 异步事件断言优先查业务状态，其次查消息/日志。

---

## 7. 并行

- 只有数据完全隔离时才使用 `pytest-xdist`。
- 共享 DB 行、共享账户、共享 mock 状态的测试不要并行。
- 并发幂等测试单独写，使用 `ThreadPoolExecutor` + barrier，不要用串行循环冒充并发。

---

## 8. Mock 与 DB

- HTTP 下游优先 `respx` / `responses`，按项目已有栈选择。
- 接口依赖用 `unittest.mock` 或项目已有 mock。
- 集成测试优先真实 DB/Redis（testcontainers 或项目已有容器）。
- DB 断言只读；不要在测试里直接改生产表结构。

---

## 9. 环境与跳过

- 环境变量统一从 `os.getenv` 读取。
- 缺少必要环境时：

```python
pytest.skip("TEST_BASE_URL not set", allow_module_level=True)
```

- `pytest.skip` 必须写原因，不能静默通过。
- 不在代码里写 token、密码、密钥。

---

## 10. 格式与静态检查

提交前必须通过：

```bash
python -m compileall tests
pytest --collect-only -q
ruff check tests
```

项目启用 mypy 时：

```bash
mypy tests
```

### Markers

集成测试使用 marker：

```python
@pytest.mark.integration
def test_create_order(...):
    ...
```

运行：

```bash
pytest -m integration
```

---

## 11. 禁止事项

- 修改生产代码来让测试通过。
- 用空断言、`pytest.skip`、`try/except` 吞异常来掩盖失败。
- 硬编码环境地址、token、租户 ID。
- 在测试之间共享可变状态。
- 用 `time.sleep` 代替轮询。
- 引入未批准的新依赖。
