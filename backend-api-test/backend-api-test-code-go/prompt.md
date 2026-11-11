# Go API 测试代码生成：机械执行规程

## 0. 你的角色

你是流水线执行器，不是作者。

消息末尾的“输入清单”给出本次要处理的 yml（N 个）。**每个 yml 生成一个自包含的测试套件**，
不同 yml 之间不得合并、不得共用文件。测试逻辑固定在 `template/suite.go.tmpl`；
你只做：校验模板 → 运行生成器 → 复制 go.mod → 格式化编译 → 报告。

## 1. 固定路径

```
ROOT=/Users/mac/code/dsh-stack
CODE=$ROOT/backend-api-test/backend-api-test-code-go
OUT=$ROOT/backend-api-prompt-test/out
```

即使会话的工作目录不同，也使用上面的绝对路径。

## 2. 输入

| 文件 | 用途 |
|---|---|
| `$CODE/prompt.md` | 本文件 |
| `$CODE/template/go.mod` | 固定模块定义 |
| `$CODE/template/suite.go.tmpl` | 自包含套件模板（夹具 + runner + 用例表占位） |
| `$CODE/template/MANIFEST.sha256` | `go.mod` 与 `suite.go.tmpl` 的哈希 |
| `$CODE/gen/gen.mjs` | 每个 yml 生成一个 Go 文件 |
| 消息末尾的“输入清单” | N 个 yml 的绝对路径，由插件在运行时扫描 `cases/` 得到 |

## 3. 产物

```
$OUT/go.mod
$OUT/<scenario>/<scenario>_test.go     每个 yml 一个，共 N 个
```

每个 `<scenario>_test.go` 都自带配置、HTTP、断言、runner 和用例表；套件之间互不依赖。
多写任何文件都算违规。

## 4. 步骤（按序；任一步失败立即停止）

### 4.1 校验模板未被改动

```bash
cd "$CODE/template" && shasum -a 256 -c MANIFEST.sha256
```

必须两行都是 `OK`。出现 `FAILED`：停止，报告文件名。

### 4.2 核对输入清单

- N ≥ 1；清单为空：停止并报告“没有 yml 输入”。
- 每个路径存在；每个 yml 必须有 `scenario` 与 `endpoint.method/path`。
- `scenario` 必须是小写字母、数字、连字符，且互不重复。
- 用例的 oracle 完整性由 `gen.mjs` 硬校验：`code != 0` 的 case 必须有
  `message_contains`（稳定子串）或显式 `message_any: true`；`baseline` 只允许
  `create`；`verify_tenant` 只允许布尔值。生成器报这些错时，停止并报告 case id。
- `as: dept_admin` 的 case 在 `ACCOUNT_TEST_DEPT_ADMIN_ACCOUNT_ID` 未设置时由模板
  `t.Skip`，这是唯一允许的 skip；不得为了跑绿而删 case 或改身份。
- 不符合：停止，报告文件与缺失的键。

### 4.3 生成

```bash
node "$CODE/gen/gen.mjs" --out-dir "$OUT" <清单中的每个路径>
```

期望 stdout 恰好 N 行，形如：

```
contract: 6 cases -> .../out/contract/contract_test.go
parameter: 21 cases -> .../out/parameter/parameter_test.go
```

行数或 slug 不符：停止并报告实际输出。
生成器报 `未知键` / `未知类型` / `case id 重复` / `scenario 重复` / `缺少 message_contains` /
`baseline` / `verify_tenant`：停止，原样贴出错误与文件路径。

### 4.4 复制 go.mod

```bash
mkdir -p "$OUT" && cp "$CODE/template/go.mod" "$OUT/"
```

### 4.5 格式化

```bash
cd "$OUT" && gofmt -w . && gofmt -l .
```

`gofmt -l .` 必须无输出。

### 4.6 静态检查

```bash
cd "$OUT" && go vet ./... && go test -run '^$' ./...
```

### 4.7 实跑（仅当调用方已提供环境变量）

必需：`ACCOUNT_TEST_TENANT_ID`、`ACCOUNT_TEST_TENANT_ADMIN_ACCOUNT_ID`。
可选：`ACCOUNT_TEST_BASE_URL`、`ACCOUNT_TEST_DEPT_ADMIN_ACCOUNT_ID`、
`ACCOUNT_TEST_PLATFORM_ADMIN_ACCOUNT_ID`、`ACCOUNT_TEST_GATEWAY_SECRET`、
`ACCOUNT_TEST_RUN_ID`、`ACCOUNT_TEST_TIMEZONE`（须与服务一致）。

```bash
cd "$OUT"
export GOCACHE="${GOCACHE:-$PWD/.gocache}"
export GOTMPDIR="${GOTMPDIR:-$PWD/.gotmp}"
go test ./... -v
```

环境未提供：**不得声称验收通过**，报告 `run: unverified` 并写明缺少哪些变量。
不要用 `t.Skip`、改期望或删用例绕过；模板对可选身份的 skip 除外。

### 4.8 变异检查（仅当 4.7 通过）

只翻转 `WantCode` 只能证明状态码断言是活的，不能证明字段/文案断言不是空转。
对每个 suite、每个可用变异，`go test` 必须 FAIL；全部 suite 都要跑，不能只取第一个。

```bash
cd "$OUT"
export GOCACHE="${GOCACHE:-$PWD/.gocache}"
export GOTMPDIR="${GOTMPDIR:-$PWD/.gotmp}"
command -v perl >/dev/null || { echo "缺少 perl"; exit 1; }
failed=0
for suite in */; do
  slug=${suite%/}
  src="$slug/${slug}_test.go"
  [ -f "$src" ] || continue
  applicable=0
  for mutation in wantcode message field; do
    rm -rf .mutation && cp -R "$slug" .mutation
    case "$mutation" in
      wantcode) perl -0pi -e 's/WantCode: 0/WantCode: 1/g' ".mutation/${slug}_test.go" ;;
      message)  perl -0pi -e 's/MessageContains: "[^"]+"/MessageContains: "__mutated__"/' ".mutation/${slug}_test.go" ;;
      field)    perl -0pi -e 's/ApproxDays: intptr\(\d+\)/ApproxDays: intptr(1)/' ".mutation/${slug}_test.go" ;;
    esac
    if cmp -s "$src" ".mutation/${slug}_test.go"; then
      echo "MUTATION-NOT-APPLICABLE $slug $mutation"
      continue
    fi
    applicable=$((applicable + 1))
    if go test "./.mutation" -run TestSuite -count=1 >/dev/null 2>&1; then
      echo "MUTATION-SURVIVED $slug $mutation"
      failed=1
    else
      echo "MUTATION-KILLED $slug $mutation"
    fi
  done
  if [ "$applicable" -eq 0 ]; then
    echo "NO-MUTATION-APPLICABLE $slug"
    failed=1
  fi
done
rm -rf .mutation "$OUT/.gocache" "$OUT/.gotmp"
[ "$failed" -eq 0 ] || { echo "断言空转"; exit 1; }
```

全部输出必须是 `MUTATION-KILLED`；出现 `MUTATION-SURVIVED`、`NO-MUTATION-APPLICABLE`
或命令失败：停止并报告 suite 与变异名。

### 4.9 敏感信息检查

```bash
grep -RE 'kmcp_[A-Za-z0-9_-]{43}' "$OUT" && echo LEAK || true
```

必须没有 `LEAK`。

## 5. 生成物约束

每个 `<scenario>_test.go` = `suite.go.tmpl` 的固定内容 + `apiCases` 字面量，只允许：

1. 文件头注释与 `package <scenario 去掉连字符>`；
2. 模板中的夹具与 `TestSuite`；
3. `var apiCases = []apiCase{...}`。

禁止出现模板之外的函数、字符串拼接、HTTP 调用、环境变量读取。
发现即视为异常，停止并报告，不得手改。

`*/logs/`、`.gocache/`、`.gotmp/`、`.mutation/` 是运行产物，不计入生成物；
`.mutation` 与缓存在 4.8 结束时删除。

## 6. 禁止

- 修改 `template/`、`gen/`、`cases/` 下的 yml。
- 合并不同 yml 的用例，或把两个 yml 写进同一个文件。
- 改 `scenario`、改包名、改文件名规则。
- 在生成文件里补逻辑。
- 新增 Go 依赖或联网。
- 打印完整 `token` / `secret`。
- 用 `t.Skip` 掩盖断言失败；唯一例外是模板对未配置的可选身份（dept_admin）的 skip。

## 7. 失败处理

| 现象 | 动作 |
|---|---|
| 模板哈希不符 | 停，报告文件名 |
| 清单为空 / 缺 scenario / 缺 endpoint | 停，报告文件与键 |
| 生成器条数或 slug 不符 | 停，贴 stdout |
| 编译失败 | 停，贴第一条错误与行号 |
| 实跑失败（连接/401） | 判为环境问题，报告 base_url 与身份变量 |
| 实跑失败（断言） | 报告 suite、case id、字段、期望、实际 |
| 变异仍 PASS | 停，报告“断言空转” |

不要用 `t.Skip`、改期望、删用例来让测试变绿。

## 8. 验收清单

- [ ] `MANIFEST.sha256` 两行 `OK`
- [ ] 生成器输出的行数 = 清单里的 yml 数
- [ ] 产物 = `out/go.mod` + N 个 `<scenario>/<scenario>_test.go`
- [ ] `gofmt -l` 无输出；`go vet` 与编译通过
- [ ] 提供环境时 `go test ./...` 全部通过；未提供时报告 `run: unverified`，不得声明通过
- [ ] 每个可用变异都 `MUTATION-KILLED`，且每个 suite 至少一个可用变异
- [ ] 负向 case 的 `message_contains` 覆盖率 100%（或显式 `message_any`）
- [ ] create case 的 `baseline: create` 覆盖率 100%
- [ ] 无 43 位明文 token

## 9. 报告格式

```
suites: N
- contract: 6 cases -> out/contract/contract_test.go
- parameter: 21 cases -> out/parameter/parameter_test.go
checks:
  manifest: ok
  gofmt: ok
  vet: ok
  compile: ok
  run: passed | unverified (reason)
  mutation: all-killed | unverified
  secret-scan: ok
quality:
  negative-with-message: X/Y
  create-with-baseline: X/Y
notes: <仅写异常或环境差异>
```
