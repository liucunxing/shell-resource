import { expect, it } from "vitest";
import { submissionBlockReasons } from "../src/workbench/pages/EditorPage.jsx";
it("explains every submission blocker without treating unsaved changes as a blocker", () => {
  expect(submissionBlockReasons({ errors: ["预算未平衡，请处理后标记完成。", "请填写原因"], needsReason: true, operation: null })).toEqual(["预算未平衡，请处理后提交当前方案。", "请填写原因", "请填写本版变更原因。"]);
  expect(submissionBlockReasons({ errors: [], needsReason: false, operation: null })).toEqual([]);
  expect(submissionBlockReasons({ errors: [], needsReason: false, operation: "save" })).toEqual(["正在保存，请稍候。"]);
});
