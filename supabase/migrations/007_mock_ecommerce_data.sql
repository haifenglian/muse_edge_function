-- 模拟电商数据，用于测试主体识别消费功能

-- 清空现有模拟数据（可选）
-- DELETE FROM public.ecommerce_subject_tasks WHERE product_id LIKE 'MOCK_%';

INSERT INTO public.ecommerce_subject_tasks (product_id, product_name, image_url, position, status)
VALUES
  -- 商品 1: 运动鞋（多图）
  ('MOCK_PROD_001', 'Nike Air Max 270 运动跑鞋 透气缓震男女休闲鞋', 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=800', 0, 'pending'),
  ('MOCK_PROD_001', 'Nike Air Max 270 运动跑鞋 透气缓震男女休闲鞋', 'https://images.unsplash.com/photo-1606107557195-0e29a4b5b4aa?w=800', 1, 'pending'),
  ('MOCK_PROD_001', 'Nike Air Max 270 运动跑鞋 透气缓震男女休闲鞋', 'https://images.unsplash.com/photo-1600185365483-26d7a4cc7519?w=800', 2, 'pending'),

  -- 商品 2: 手提包
  ('MOCK_PROD_002', 'COACH 蔻驰 女士手提包 真皮单肩包 托特包', 'https://images.unsplash.com/photo-1584917865442-de89df76afd3?w=800', 0, 'pending'),
  ('MOCK_PROD_002', 'COACH 蔻驰 女士手提包 真皮单肩包 托特包', 'https://images.unsplash.com/photo-1590874103328-eac38a683ce7?w=800', 1, 'pending'),

  -- 商品 3: 耳机
  ('MOCK_PROD_003', 'Sony WH-1000XM5 无线降噪耳机 头戴式蓝牙耳机', 'https://images.unsplash.com/photo-1618366712010-f4ae9c647dcb?w=800', 0, 'pending'),

  -- 商品 4: 手表
  ('MOCK_PROD_004', 'Apple Watch Series 9 智能手表 GPS蜂窝双网', 'https://images.unsplash.com/photo-1546868871-7041f2a55e12?w=800', 0, 'pending'),
  ('MOCK_PROD_004', 'Apple Watch Series 9 智能手表 GPS蜂窝双网', 'https://images.unsplash.com/photo-1579586337278-3befd40fd17a?w=800', 1, 'pending'),

  -- 商品 5: 太阳镜
  ('MOCK_PROD_005', 'Ray-Ban 雷朋 男士太阳镜 偏光驾驶镜', 'https://images.unsplash.com/photo-1511499767150-a48a237f0083?w=800', 0, 'pending'),

  -- 商品 6: 咖啡机
  ('MOCK_PROD_006', 'Delonghi 德龙 全自动咖啡机 家用意式浓缩', 'https://images.unsplash.com/photo-1517668808822-9ebb02f2a0e6?w=800', 0, 'pending'),

  -- 商品 7: 玩具（多图，测试一图多主体场景）
  ('MOCK_PROD_007', 'LEGO 乐高 积木 机械组 跑车模型', 'https://images.unsplash.com/photo-1587654780291-39c9404d746b?w=800', 0, 'pending'),
  ('MOCK_PROD_007', 'LEGO 乐高 积木 机械组 跑车模型', 'https://images.unsplash.com/photo-1559827260-dc66d52bef19?w=800', 1, 'pending'),

  -- 商品 8: 化妆品
  ('MOCK_PROD_008', 'Estee Lauder 雅诗兰黛 小棕瓶精华 50ml', 'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=800', 0, 'pending'),

  -- 商品 9: 服饰
  ('MOCK_PROD_009', 'UNIQLO 优衣库 男士摇粒绒拉链开衫', 'https://images.unsplash.com/photo-1596755094514-f87e34085b2c?w=800', 0, 'pending'),

  -- 商品 10: 手机壳
  ('MOCK_PROD_010', 'Spigen 手机壳 iPhone 15 Pro Max 防摔保护套', 'https://images.unsplash.com/photo-1601784551446-20c9e07cdbdb?w=800', 0, 'pending'),
  ('MOCK_PROD_010', 'Spigen 手机壳 iPhone 15 Pro Max 防摔保护套', 'https://images.unsplash.com/photo-1605236453806-6ff36851218e?w=800', 1, 'pending')
ON CONFLICT (product_id, position) DO NOTHING;

-- 验证插入结果
SELECT
  status,
  COUNT(*) as count
FROM public.ecommerce_subject_tasks
WHERE product_id LIKE 'MOCK_%'
GROUP BY status;
