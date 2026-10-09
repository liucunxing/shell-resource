"""Reproduce explicitly synthetic acceptance fixtures. Never calls a model."""
from copy import deepcopy
import statistics
from pathlib import Path

from insight_pack import DIMENSIONS, InsightPack, write_json

ROOT = Path(__file__).resolve().parents[1]


def fact(key, label, value, unit="", period="2027计划", note=""):
    return {"id": key, "label": label, "value": value, "unit": unit, "period": period, "source": "合成验收样例，非生产数据", "note": note}


def base_evidence():
    evidence = {
        "schema_version": "1.0", "scope": {"id": "demo-owner-mkt", "label": "MKT · 本人全部 Initiative", "role": "owner"},
        "planning_year": 2027, "data_version": "synthetic-baseline-v1",
        "provenance": {"kind": "synthetic", "description": "人工构造的能力包验收样例；部分数值沿用讨论截图，四象限队列与规则为合成数据。不能作为客户数据分析或模型实测。"},
        "facts": [
            fact("budget", "负责预算", 1962000, "CNY"), fact("allocated", "经销商分配", 1926964, "CNY"),
            fact("other", "其他预算安排", 35036, "CNY", note="无法分配到经销商，后续用途尚待落实"), fact("gap", "未解释差额", 0, "CNY"),
            fact("low-yield", "1100 历史整体 Yield", 6.29, "multiple", "2025全年", "授权只读汇总；不提供跨部门资源明细"),
            fact("low-plan", "1100 本范围计划投入", 51000, "CNY"),
            fact("high-yield", "800 历史整体 Yield", 25.67, "multiple", "2025全年", "授权只读汇总"), fact("high-plan", "800 本范围计划投入", 53000, "CNY"),
            fact("top-plan", "900 本范围计划投入", 92000, "CNY"), fact("top-share", "900 占经销商分配", 92000/1926964, "ratio"),
            fact("top-history", "900 本范围历史资源", 30000, "CNY", "2025全年"), fact("top-growth", "900 计划较历史增加", 92000/30000-1, "ratio", "2027计划 / 2025实际", "跨年参考，非同比，不构成因果判断"),
            fact("vol", "900 Vol 同比", -0.10, "ratio", "2025全年 / 2024全年"), fact("c3", "900 C3 同比", -0.01, "ratio", "2025全年 / 2024全年"),
            fact("overlap", "多项安排经销商数", 57, "count"), fact("top-overlap", "900 涉及 Initiative 数", 3, "count"),
            fact("target", "2027 业务目标", None, note="未提供未来销量和 C3 目标"),
            fact("cohort", "四象限可比队列", "同 Sector、同资源类型的合成队列：10家，8家历史可比，2家缺历史", period="2025历史 / 2027计划"),
            fact("rules", "业务判断标准", None, note="未提供集中度或投入合理性阈值"),
        ],
        "datasets": [],
        "check_constraints": [
            {"dimension_id": "low_yield", "allowed_statuses": ["observed"], "reason": "历史Yield和计划金额可做事实分析，未来目标仅限制收益预测"},
            {"dimension_id": "high_yield", "allowed_statuses": ["observed"], "reason": "历史Yield和计划金额可做事实分析，不预设投入不足"},
            {"dimension_id": "concentration", "allowed_statuses": ["observed"], "reason": "能确认头部占比，无阈值仅作事实分析"},
            {"dimension_id": "overlap", "allowed_statuses": ["observed"], "reason": "叠加事实存在，不能直接认定重复投入"},
            {"dimension_id": "trend", "allowed_statuses": ["review", "observed"], "reason": "可陈述完整经营变化，历史经营下降同时计划显著增长可具体复核，但不推断因果"},
            {"dimension_id": "completeness", "allowed_statuses": ["clear", "observed"], "reason": "仅金额已平衡，其他安排不等于到经销商"},
        ],
    }
    def dataset(key, kind, title, refs, rows, **kwargs):
        value = {"id": key, "kind": kind, "title": title, "scope_id": evidence["scope"]["id"], "unit": "CNY", "period": "2027计划", "note": "", "fact_ids": refs, "rows": rows}
        value.update(kwargs)
        return value
    evidence["datasets"].append(dataset("900-compare", "comparison", "900 历史资源与计划投入", ["top-history", "top-plan", "top-growth"], [{"id":"history","label":"2025实际资源","value":30000}, {"id":"plan","label":"2027计划投入","value":92000}], period="2025实际 / 2027计划", note="本范围跨年参考，非同比；年份、实际/计划属性不同。"))
    evidence["datasets"].append(dataset("budget-mix", "composition", "预算去向", ["budget","allocated","other"], [{"id":"dealers","label":"经销商分配","value":1926964}, {"id":"other","label":"其他预算安排","value":35036}], denominator=1962000, note="分母为负责预算；其他安排35,036全部属于无法分配到经销商，不视为已到经销商。"))
    evidence["datasets"].append(dataset("top-dealers", "ranked_bar", "部分集中对象（验收示例）", ["top-plan","high-plan","low-plan","allocated"], [{"id":"900","label":"900","value":92000},{"id":"800","label":"800","value":53000},{"id":"1100","label":"1100","value":51000}], denominator=1926964, note="本例仅列三个讨论对象，非完整Top3排名；占比分母为全部经销商分配，未提供异常阈值。"))
    points = [{"id":key,"label":key,"x":x,"y":y} for key,x,y in [("100",6.5,25000),("200",10.2,30000),("300",12.8,42000),("500",16,68000),("800",25.67,53000),("900",11.1,92000),("1100",6.29,51000),("1200",19.4,44000)]]
    cut_x = statistics.median(row["x"] for row in points)
    cut_y = statistics.median(row["y"] for row in points)
    for row in points:
        row["group"] = ("历史Yield高" if row["x"] > cut_x else "历史Yield低" if row["x"] < cut_x else "历史Yield分界") + " / " + ("计划投入高" if row["y"] > cut_y else "计划投入低" if row["y"] < cut_y else "计划投入分界")
    evidence["datasets"].append(dataset("yield-plan", "quadrant", "历史整体 Yield × 本范围计划投入", ["cohort","target"], points,
        period="2025历史 / 2027计划", note="完整的合成可比队列；横轴为已授权整体历史Yield，纵轴为本范围计划金额，不能当作未来收益预测。",
        x={"label":"历史整体 Yield","unit":"multiple","period":"2025全年","cutoff":cut_x,"cutoff_method":"median"},
        y={"label":"本范围计划投入","unit":"CNY","period":"2027计划","cutoff":cut_y,"cutoff_method":"median"},
        population_count=10, excluded_count=2, cohort_label="同 Sector / 同资源类型 · 合成队列", cutoff_note="以完整入图队列中位数作相对分组，不是业务风险阈值；落在分界线上保留边界归属。"))
    evidence["datasets"].append(dataset("yield-table", "table", "历史与计划参考明细", ["low-yield","low-plan","high-yield","high-plan"], [{"id":"1100","dealer":"1100","yield":6.29,"plan":51000},{"id":"800","dealer":"800","yield":25.67,"plan":53000}], columns=[{"key":"dealer","label":"经销商","unit":""},{"key":"yield","label":"2025整体Yield","unit":"multiple"},{"key":"plan","label":"2027本范围计划","unit":"CNY"}], period="2025历史 / 2027计划", note="历史整体Yield与本范围计划金额的口径不同；数据不足时显示缺失而非零。"))
    return evidence


def block(key, kind, title, body, status, dims, refs, dataset=None):
    return {"id":key,"kind":kind,"title":title,"body":body,"status":status,"dimension_ids":dims,"fact_ids":refs,"dataset_id":dataset}


def base_result(preset):
    checks = [
        ("low_yield","observed","1100 历史Yield为6.29，计划投入51,000。",["low-yield","low-plan","target"]),
        ("high_yield","observed","800 历史Yield为25.67，计划投入53,000。",["high-yield","high-plan","target"]),
        ("concentration","observed","900 占经销商分配4.77%；未提供异常阈值。",["top-share","rules"]),
        ("overlap","observed","57家涉及多项安排；叠加本身不代表重复投入。",["overlap","top-overlap"]),
        ("trend","review","900 的计划增幅与历史表现需要结合业务目标解释。",["top-growth","vol","c3","target"]),
        ("completeness","clear","金额已平衡；其他安排35,036仍需落实用途。",["budget","allocated","other","gap"]),
    ]
    result = {"schema_version":"1.0","preset_id":preset,"headline":"900 计划投入增长与历史经营变化值得一并查看","summary":"预算金额已平衡；未来投入与历史表现需要一起解释。","blocks":[],"checks":[{"dimension_id":dim,"status":status,"summary":text,"fact_ids":refs} for dim,status,text,refs in checks],"limitations":["仅使用本次授权证据；没有2027经营预测，不推断未来收益或因果。"]}
    if preset == "comprehensive":
        result["blocks"] = [block("focus-900","finding","900：计划投入明显高于历史参考","2027计划92,000，相比2025实际30,000增加206.67%；同期口径的历史Vol与C3同比均下降。建议补充2027目标和投放用途，再判断投入是否匹配。","review",["trend"],["top-plan","top-history","top-growth","vol","c3"],"900-compare"), block("yield-context","note","Yield 保留为观察线索","现有高低排名不足以证明投入过多或不足。","observed",["low_yield","high_yield"],["low-yield","high-yield","target"])]
    elif preset == "quadrant":
        result["headline"] = "用相对位置圈定复核对象"
        result["summary"] = "同一可比队列中观察历史Yield与计划投入；象限位置不直接生成增投或减投建议。"
        result["blocks"] = [block("quadrant-view","visual","历史整体 Yield × 计划投入","按上游分组查看历史与计划相对位置；中位数不代表业务阈值。","observed",["low_yield","high_yield"],["cohort","target"],"yield-plan")]
    else:
        result["headline"] = "预算已平衡，其他安排需要持续跟踪"
        result["summary"] = "经销商分配与其他预算安排分开展示，金额找平不等于全部到经销商。"
        result["blocks"] = [block("mix-view","visual","预算安排的去向","其他预算安排35,036，需要后续落实用途。","observed",["completeness"],["budget","allocated","other"],"budget-mix"),block("rank-view","visual","讨论对象的投入规模","占比只陈述集中度，不把排序当作异常阈值。","observed",["concentration","overlap"],["top-plan","low-plan","high-plan","allocated"],"top-dealers")]
    return result


def create_examples():
    catalog = {"examples": []}
    labels = {"baseline":"关注案例 · 合成", "healthy":"无突出事项 · 合成", "missing":"待补充信息 · 合成", "overspend":"预算超额 · 合成"}
    pack = InsightPack(ROOT)
    for scene in labels:
        evidence = base_evidence()
        evidence["data_version"] = "synthetic-" + scene + "-v2"
        facts = {row["id"]:row for row in evidence["facts"]}
        facts["cohort"]["value"] = "选定同 Sector / 同资源类型的合成子队列10家：8家有可比历史，2家缺历史；不代表全范围分配对象数"
        facts["overlap"]["note"] = "57为当前全部授权范围的叠加对象数，统计范围大于10家四象限子队列，不作子队列计数。"
        for dataset in evidence["datasets"]:
            if dataset["kind"] == "quadrant":
                dataset["title"] = "选定子队列：历史整体 Yield × 本范围计划投入"
                dataset["cohort_label"] = "选定同 Sector / 同资源类型合成子队列（非全范围）"
                dataset["note"] += " 本图完整覆盖选定10家子队列的8家可比对象，不能泛化到全范围；57家叠加统计属于更大的全部授权范围。"

        if scene == "healthy":
            facts["target"]["value"] = "合成目标已提供，既定投入用途与目标一致"
            facts["target"]["note"] = "假设情景，不代表已获得客户目标"
            facts["rules"]["value"] = "合成已确认规则检查通过"
            facts["rules"]["note"] = "仅用于演示通过状态"
            facts["other"]["note"] = "合成用途已明确，仍属于其他安排"
            facts["top-history"]["value"] = 90000
            facts["top-growth"]["value"] = 92000/90000-1
            facts["vol"]["value"], facts["c3"]["value"] = .05, .06
            evidence["datasets"][0]["rows"][0]["value"] = 90000
            for row in evidence["check_constraints"]:
                row["allowed_statuses"] = ["clear","observed"]
                row["reason"] = "合成目标、口径与规则齐全，按给定规则检查通过"
        if scene == "missing":
            for key in ("low-yield","high-yield","top-history","top-growth","vol","c3"):
                facts[key]["value"] = None
                facts[key]["note"] = "缺少可比历史，不填零"
            facts["cohort"]["value"] = "历史资料未提供，不能绘制四象限"
            evidence["datasets"] = [row for row in evidence["datasets"] if row["kind"] not in {"quadrant","comparison"}]
            for dataset in evidence["datasets"]:
                if dataset["id"] == "yield-table":
                    for row in dataset["rows"]:
                        row["yield"] = None
            for row in evidence["check_constraints"]:
                if row["dimension_id"] in {"low_yield", "high_yield", "trend"}:
                    row["allowed_statuses"] = ["limited"]
                    row["reason"] = "待补充2025 Yield以及2024/2025 Vol或C3完整年度对，补充后可分析历史相对位置和经营变化"
        if scene == "overspend":
            facts["allocated"]["value"] = 1981964
            facts["gap"]["value"] = -55000
            facts["top-share"]["value"] = 92000/1981964
            evidence["facts"].extend([fact("arranged","已安排总额",2017000,"CNY"),fact("arranged-ratio","总安排占预算",2017000/1962000,"ratio")])
            evidence["datasets"] = [row for row in evidence["datasets"] if row["id"] != "budget-mix"]
            for dataset in evidence["datasets"]:
                if dataset["id"] == "top-dealers":
                    dataset["denominator"] = 1981964
            evidence["datasets"].append({"id":"budget-over","kind":"comparison","title":"预算与已安排金额","scope_id":evidence["scope"]["id"],"unit":"CNY","period":"2027计划","note":"已安排包含经销商与其他安排；超额55,000，不截断为100%。","fact_ids":["budget","arranged","gap","arranged-ratio"],"rows":[{"id":"budget","label":"负责预算","value":1962000},{"id":"arranged","label":"已安排合计","value":2017000}]})
            evidence["check_constraints"][-1] = {"dimension_id":"completeness","allowed_statuses":["review"],"reason":"总安排超过预算55,000，必须显著呈现","required_focus":True}
        item = {"id":scene,"label":labels[scene],"evidence":scene+".evidence.json","results":{}}
        pack.validate_evidence(evidence)
        write_json(ROOT/"examples"/item["evidence"],evidence)
        for preset in ("comprehensive","quadrant","structure"):
            result = base_result(preset)
            if scene == "healthy":
                result.update(headline="本轮没有需要优先展开的事项",summary="在本例已提供的目标与规则下，六维检查没有识别出突出事项。",blocks=[],limitations=["合成验收场景，不代表客户真实规则或模型实测。"])
                for check in result["checks"]:
                    check.update(status="clear",summary="按已提供的合成目标与规则检查通过。",fact_ids=["rules","target","budget","gap"])
                if preset == "quadrant":
                    result["blocks"] = [block("quiet-quadrant","visual","历史与计划的相对分布","保留图形供观察，不制造异常结论。","observed",["low_yield","high_yield"],["cohort","target"],"yield-plan")]
                if preset == "structure":
                    result["blocks"] = [block("quiet-mix","visual","预算去向","金额已平衡，其他安排仍单独列示。","observed",["completeness"],["budget","allocated","other"],"budget-mix")]
            if scene == "missing":
                result.update(headline="目前只能确认预算金额已平衡",summary="预算去向与叠加事实可核对；历史比较待补充具体经营字段。",blocks=[block("missing-note","note","历史比较待补充信息","补充2025 Yield与2024、2025全年 Vol或C3后，可比较历史相对位置及经营变化。","limited",["low_yield","high_yield","trend"],["cohort"])],limitations=["缺失值不视为零；不绘制无证据的四象限。"])
                for check in result["checks"]:
                    if check["dimension_id"] in {"low_yield", "high_yield", "trend"}:
                        check.update(status="limited",summary="补充2025 Yield及2024/2025全年 Vol或C3后可做历史比较。",fact_ids=["cohort"])
                if preset == "quadrant":
                    result["blocks"].append(block("missing-table","visual","可核对的当前计划","补充2025 Yield后可比较历史与计划相对位置，当前只核对计划金额。","limited",["low_yield","high_yield"],["low-plan","high-plan"],"yield-table"))
                if preset == "structure":
                    result["blocks"].append(block("available-mix","visual","已有预算去向","能够核对金额，但尚不能判断业务合理性。","clear",["completeness"],["budget","allocated","other"],"budget-mix"))
            if scene == "overspend":
                result["headline"] = "已安排超出预算 55,000"
                result["summary"] = "总安排占预算102.80%；优先核对超额，再查看其他分析。"
                result["blocks"] = [block("required-budget","finding","预算超额需要优先核对","负责预算1,962,000，已安排2,017,000，未解释差额为−55,000。","review",["completeness"],["budget","arranged","gap","arranged-ratio"],"budget-over")] + [row for row in result["blocks"] if row["dataset_id"] != "budget-mix"]
                result["checks"][-1].update(status="review",summary="超额55,000；安排占预算102.80%。",fact_ids=["budget","arranged","gap","arranged-ratio"])
                result["checks"][2]["summary"] = "头部占比仅作事实参考，未提供异常阈值。"
            pack.validate_result(result,evidence,preset)
            item["results"][preset] = scene+"."+preset+".json"
            write_json(ROOT/"examples"/item["results"][preset],result)
        catalog["examples"].append(item)
    write_json(ROOT/"examples/catalog.json",catalog)
    print("PASS: 4 synthetic evidence sets + 12 authored result examples")


if __name__ == "__main__":
    create_examples()
