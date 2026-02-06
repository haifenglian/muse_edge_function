## 电商数据

Cube视图：dwd_ecommerce_products_view

**增量同步**：使用 `updated_at` 作为游标（来自 `dwd_media_asset_storage_mapping.updated_at`）。sync_state 存 `cube_ecommerce_last_updated_at`，每次拉取 `updated_at > 游标` 且 **status = 'success'** 且 **stored_url 非空** 的数据，拉完后更新游标为本批 `max(updated_at)`。

**数据结构**：Cube JOIN 返回已展开结构，一行对应一张图（一个 mapping 记录），`stored_url` 为转存后的图片 URL。

**流程分离**：同步与主体识别分两步执行。先完成 Cube → Supabase 数据同步，主体识别由独立任务/脚本在同步后的数据上执行，不在同步过程中调用。

```shell
views:
  - name: dwd_ecommerce_products_view
    title: Dwd Ecommerce Products View
    cubes:
      - join_path: dwd_ecommerce_products
        includes:
          - ingested_at
          - crawled_at
          - product_id
          - list_url
          - site
          - rank
          - brand
          - category_path
          - url
          - product_name
          - price
          - variants
          - material
          - badges
          - product_details
          - spec
          - images
          - crawl_status
          - error_reason
          - id
          - source_name
          - count

      - join_path: dwd_ecommerce_products.dwd_media_asset_storage_mapping
        includes:
          - table_name
          - asset_type
          - origin_url
          - stored_url
          - position
          - status
          - attempts
          - error_message
          - created_at
          - updated_at

```


## ai_match（supabase）

# 数据字段说明表
| 字段名 | 类型 | 说明 | 必要性 |
| ---- | ---- | ---- | ---- |
| id | STRING | 自动生成UUID | - |
| source_table | STRING | 来源表名：ods_social_media/ods_fans/ods_fashion_media/ods_ecommerce/ods_brand | 因为5张表是独立的表，各自的id只在本表内唯一，不同表之间id可能重复。 |
| source_id | STRING | 来源表的id（外键） | 关联来源表的唯一键，统计时需要JOIN获取source_name/fetch_time |
| source_name | - | - | - |
| standard_product_id | STRING | 匹配到的standard_products.id（外键） | 核心匹配结果，关联标准商品库 |
| confidence | FLOAT64 | 匹配置信度，0-1 | 阿里云图搜返回的置信度，用于筛选可信匹配 |
| crop_image | STRING | 本次匹配中，所使用的AI识别主体图的转存url | 测试和前端要求展示时需要用到 |
| create_time | TIMESTAMPTZ | 自动生成 | 审核 |
| category_id | - | 存储经过主体识别prompt的品类编号 | - |
| image_index | - | 记录是图片数组的第几张图片 | - |

