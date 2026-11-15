# Databricks汇率只读探源（2026-11-15）

用户明确授权本次探源使用可用个人登录、跨catalog/schema；此授权不等于应用SP接入权限。使用现有ONEDATA-DBX-DEV登录，仅列元数据和查询汇率，未写源库、未改应用连接。

## 找到的对象与质量

通过system.information_schema.columns跨catalog按汇率表名/字段名检索，命中以下5个对象；不是对所有业务表内容的穷举。

| 对象 | 行数 | 月份范围 | 月份+币种对唯一键 | 无效汇率 |
|---|---:|---|---:|---:|
| prod.raw.t_fact_currency_exchange | 548 | 2019-01—2026-10 | 548 | 0 |
| dev.raw.t_fact_currency_exchange | 540 | 2019-01—2026-09 | 540 | 0 |
| onedataprodgen2.raw.t_fact_currency_exchange | 548 | 2019-01—2026-10 | 548 | 0 |
| dev.base.view_currency_exchange_usd_cny_hkd | 612 | 201001—202612 | 612 | 0 |
| onedataprodgen2.base.view_currency_exchange_usd_cny_hkd | 612 | 201001—202612 | 612 | 0 |

无效指ex_rate为空或不大于0。外部catalog onedataprodgen2是现有联邦查询来源；查询成功不代表应用SP已获授权。

## 字段和换算方向

raw：`month`（字符串YYYY-MM）、`currency`（币种）、`base_currency`（基准币种）、`ex_rate`（decimal）。base：`month_code`（整数YYYYMM）、`base_currency`、`currency`、`ex_rate decimal(20,10)`。可见结构没有实际/预算汇率类型列，也没有填充标记或来源更新时间列。

样例：prod.raw的2026-10记录为base_currency=USD、currency=CNY、ex_rate=6.6858；2026-09为6.7091。base中USD→USD为1。按这些币种及数量级，方向为1美元对应若干目标币：人民币金额÷CNY汇率=美元，美元金额×汇率=人民币。本轮手动除算方向无需反转；这些值是库中样例，不是外部市场实时报价。

## 不能把“有月份”当作该月已到数

2026年USD/CNY，prod.raw与onedataprodgen2.base在1—10月逐月一致（10月6.6858），但该base在11、12月继续为6.6858，而raw目前没有这两个月。结果表现为末月值延用，是否为视图填充需进一步核对源定义。

dev.base的7—12月均为6.7764，与prod.raw后续月份不同；例如10月是6.7764对6.6858。该开发副本不能直接作为最新生产汇率依据。不能把这个差异直接认定为“预算汇率与实际汇率”，因为表中无类型字段，未取得视图原SQL。

## 对当前工程的结论

1. 保留已确认的管理员统一参数：历史源费用÷historyInvestmentExchangeRate=USD，默认1；源已是USD时不再套CNY汇率。C3不转换，规划CNY不变。
2. 未来自动接表要按业务月份+源币种+USD匹配。原始费用需带月份；现在PG仅年度/累计宽表且没有费用月份，不能用最新月汇率准确重算全年费用。
3. 不用dev.base老副本或未来填充月份默认替代实际月汇率。若缺月应明确缺失；沿用上月、用平均或固定预算汇率需要另行确定。
4. 正式自动接入时仍需应用可读授权视图/同步表与SP认证；本次探源不改变应用取数链路。当前手动率已满足本期要求。

## 后续只需确认/补齐

- 自动换算时用实际月率还是固定/平均/预算率；现有4列不足以识别类型。
- 如果源端改发人民币，要同步提供费用月份与源币种；否则无法选定对应历史汇率。
- 核对base未来月份的填充规则，以及开发副本刷新机制。无需因此暂停当前默认1方案。

查询证据：字段检索01f1e0a0-d97c-138d-9f73-f3e371a7599f；质量01f1e0a1-204b-1a55-94ee-c5f697c4bce6；逐月对照01f1e0a1-5297-1417-abf5-4c589d6f5372。原始返回保存在忽略的output/fx-*-result.json，不提交凭据或业务明细。
