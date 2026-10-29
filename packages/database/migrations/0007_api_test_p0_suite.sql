-- P0 用例已从 testcases/p0 拆到 testcases 下，每个模块一条 suite
-- 旧聚合套件 p0-core：没有执行记录就删除，有记录则停用
DELETE FROM api_test_suites s
WHERE s.key = 'p0-core'
  AND NOT EXISTS (SELECT 1 FROM api_test_runs r WHERE r.suite_id = s.id);

UPDATE api_test_suites SET enabled = false WHERE key = 'p0-core';

INSERT INTO api_test_suites (id, key, name, path)
VALUES
  ('01900000-0000-7000-8000-000000000403', 'v3-auth', '认证', 'testcases/v3_认证'),
  ('01900000-0000-7000-8000-000000000404', 'v3-home', '首页推荐', 'testcases/v3_首页'),
  ('01900000-0000-7000-8000-000000000405', 'v3-shop', '商城商品', 'testcases/v3_商城'),
  ('01900000-0000-7000-8000-000000000406', 'v3-search', '商品搜索', 'testcases/v3_搜索'),
  ('01900000-0000-7000-8000-000000000407', 'cart', '购物车', 'testcases/购物车'),
  ('01900000-0000-7000-8000-000000000408', 'address', '地址', 'testcases/v3_address'),
  ('01900000-0000-7000-8000-000000000409', 'checkout', '结算', 'testcases/checkout/v3_checkout'),
  ('01900000-0000-7000-8000-00000000040a', 'saleorder', '订单', 'testcases/checkout/v3_saleorder'),
  ('01900000-0000-7000-8000-00000000040b', 'webhook', '支付回调', 'testcases/webhook'),
  ('01900000-0000-7000-8000-00000000040c', 'refund', '退款售后', 'testcases/refund'),
  ('01900000-0000-7000-8000-00000000040d', 'voucher', '优惠券', 'testcases/kado/客户端券接口'),
  ('01900000-0000-7000-8000-00000000040e', 'marketing', '营销权益', 'testcases/营销权益'),
  ('01900000-0000-7000-8000-00000000040f', 'basic', '基础接口', 'testcases/基础'),
  ('01900000-0000-7000-8000-000000000410', 'config', '配置', 'testcases/配置')
ON CONFLICT (key) DO NOTHING;
