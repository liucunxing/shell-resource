import { afterEach, expect, it, vi } from "vitest";
import { updateInsightGeneration } from "../src/workbench/pages/InsightPanel.jsx";
import { ApiError, request } from "../src/workbench/api.js";

afterEach(() => vi.unstubAllGlobals());
it("keeps the server problem number on an Insight failure", async () => {
  const id = "a".repeat(32);
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ code: 502, msg: "分析失败", data: null }),
          { status: 502, headers: { "X-Insight-Request-ID": id } },
        ),
      ),
  );
  await expect(request("/insights/generate")).rejects.toMatchObject({
    message: "分析失败",
    requestId: id,
    status: 502,
  });
});
it("does not display malformed or missing problem numbers", () => {
  expect(new ApiError("失败", 502, "<script>").requestId).toBe("");
  expect(new ApiError("失败", 502).requestId).toBe("");
});

it("shows the problem number while preserving the previous result", () => {
  const record = { summary: "原结果" };
  const state = updateInsightGeneration(
    { record },
    { type: "failed", message: "分析失败", requestId: "a".repeat(32) },
  );
  expect(state.record).toBe(record);
  expect(state.failure).toBe("分析失败（问题编号：" + "a".repeat(32) + "）");
});
