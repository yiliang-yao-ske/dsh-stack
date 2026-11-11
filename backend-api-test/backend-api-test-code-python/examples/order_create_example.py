# 这是一个风格示例，不参与默认收集（文件名以 _example.py 结尾）。
# 真实项目中请把 client / buyer_token / count_orders 等替换为项目 testkit 的实现。

import uuid

import pytest


CASES = [
    {
        "case_id": "TC-PA-ORD-001",
        "name": "最小合法输入创建订单成功",
        "body": {"items": [{"sku_id": "SKU-001", "quantity": 1}]},
        "want_status": 201,
        "want_code": None,
    },
    {
        "case_id": "TC-PA-ORD-004",
        "name": "quantity=0 时拒绝下单",
        "body": {"items": [{"sku_id": "SKU-001", "quantity": 0}]},
        "want_status": 400,
        "want_code": "INVALID_QUANTITY",
    },
]


@pytest.mark.integration
@pytest.mark.parametrize("case", CASES, ids=[c["case_id"] for c in CASES])
def test_create_order(case, client, buyer_token, request):
    run_id = uuid.uuid4().hex[:12]

    response = client.post(
        "/v1/orders",
        json=case["body"],
        headers={"Authorization": f"Bearer {buyer_token}", "X-Run-Id": run_id},
    )
    body = response.json()

    assert response.status_code == case["want_status"], (
        f"{case['case_id']}: unexpected status, body={body}"
    )
    if case["want_code"]:
        assert body.get("code") == case["want_code"], (
            f"{case['case_id']}: unexpected error code, body={body}"
        )

    if case["case_id"] == "TC-PA-ORD-001":
        order_id = body["id"]
        assert body["status"] == "CREATED", f"{case['case_id']}: unexpected status"
        assert count_orders(order_id) == 1, f"{case['case_id']}: order row count"
        assert inventory_count("SKU-001") == 9, f"{case['case_id']}: inventory"
        request.addfinalizer(lambda: delete_order(order_id))
    elif case["case_id"] == "TC-PA-ORD-004":
        assert count_orders_by_sku("SKU-001") == 0, f"{case['case_id']}: no order should be created"
        assert inventory_count("SKU-001") == 10, f"{case['case_id']}: inventory should not change"
