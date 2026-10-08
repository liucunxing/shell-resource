import allocationExcel from "./domain/excel.js";
import adminExcel from "./domain/admin-excel.js";

self.onmessage = async ({ data }) => {
  try {
    if (data.kind === "reference") {
      self.postMessage({ preview: JSON.parse(data.text) });
      return;
    }
    const preview =
      data.kind === "admin"
        ? await adminExcel.previewImport(data.buffer, ...data.args)
        : await allocationExcel.previewImport(data.buffer, ...data.args);
    self.postMessage({ preview });
  } catch (error) {
    self.postMessage({
      error: error.message || "文件解析失败，请重试。",
    });
  }
};
