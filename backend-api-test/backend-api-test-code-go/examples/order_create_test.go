//go:build example

// 这是一个风格示例，不参与默认构建。
// 真实项目中请把 createOrder/assertOrderCount 等替换为项目 testkit 的实现。
package api_test

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

type createOrderRequest struct {
	Items []orderItem `json:"items"`
}

type orderItem struct {
	SKUId    string `json:"sku_id"`
	Quantity int    `json:"quantity"`
}

type orderResponse struct {
	ID     string `json:"id"`
	Status string `json:"status"`
	Code   string `json:"code"`
}

func TestCreateOrder(t *testing.T) {
	t.Parallel()

	cases := []struct {
		caseID     string
		name       string
		request    createOrderRequest
		wantStatus int
		wantCode   string
	}{
		{
			caseID: "TC-PA-ORD-001",
			name:   "最小合法输入创建订单成功",
			request: createOrderRequest{
				Items: []orderItem{{SKUId: "SKU-001", Quantity: 1}},
			},
			wantStatus: http.StatusCreated,
		},
		{
			caseID: "TC-PA-ORD-004",
			name:   "quantity=0 时拒绝下单",
			request: createOrderRequest{
				Items: []orderItem{{SKUId: "SKU-001", Quantity: 0}},
			},
			wantStatus: http.StatusBadRequest,
			wantCode:   "INVALID_QUANTITY",
		},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.caseID, func(t *testing.T) {
			t.Parallel()

			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()

			// createOrder 由项目 testkit 提供：负责 base URL、认证、JSON 编解码。
			resp, body := createOrder(t, ctx, tc.request)

			require.Equal(t, tc.wantStatus, resp.StatusCode, "case %s: unexpected status", tc.caseID)
			if tc.wantCode != "" {
				require.Equal(t, tc.wantCode, body.Code, "case %s: unexpected error code", tc.caseID)
			}

			switch tc.caseID {
			case "TC-PA-ORD-001":
				require.NotEmpty(t, body.ID, "case %s: order id should not be empty", tc.caseID)
				require.Equal(t, "CREATED", body.Status, "case %s: unexpected order status", tc.caseID)
				require.Equal(t, 1, countOrders(t, ctx, body.ID), "case %s: order row count", tc.caseID)
				require.Equal(t, 9, inventoryCount(t, ctx, "SKU-001"), "case %s: inventory should decrease", tc.caseID)
				t.Cleanup(func() {
					cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
					defer cleanupCancel()
					_ = deleteOrder(cleanupCtx, body.ID)
				})
			case "TC-PA-ORD-004":
				require.Equal(t, 0, countOrdersBySKU(t, ctx, "SKU-001"), "case %s: no order should be created", tc.caseID)
				require.Equal(t, 10, inventoryCount(t, ctx, "SKU-001"), "case %s: inventory should not change", tc.caseID)
			}
		})
	}
}
