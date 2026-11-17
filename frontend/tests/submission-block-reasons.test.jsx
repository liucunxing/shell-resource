import { expect, it } from "vitest";
import { submissionBlockReasons } from "../src/workbench/pages/EditorPage.jsx";
it("explains every submission blocker without treating unsaved changes as a blocker", () => {
  expect(submissionBlockReasons({ errors: ["预算未平衡，请处理后标记完成。", "其他预算原因不存在。"], operation: null })).toEqual(["预算未平衡，请处理后提交当前方案。", "其他预算原因不存在。"]);
  expect(submissionBlockReasons({ errors: [], operation: null })).toEqual([]);
  expect(submissionBlockReasons({ errors: [], operation: "save" })).toEqual(["正在保存，请稍候。"]);
});
