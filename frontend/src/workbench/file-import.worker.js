self.onmessage = async ({ data }) => {
  try {
    if (data.kind === "reference") {
      self.postMessage({ preview: JSON.parse(data.text) });
      return;
    }
    if (!["admin", "allocation", "directory"].includes(data.kind)) {
      throw new Error("不支持此文件操作，请重新选择文件。");
    }
    // Keep workbook logic and ExcelJS out of the UI graph and JSON-only tasks.
    const { default: excel } =
      data.kind === "admin"
        ? await import("./domain/admin-excel.js")
        : await import("./domain/excel.js");
    if (data.operation === "export") {
      const bytes =
        data.kind === "directory"
          ? await excel.exportDealerDirectory(...data.args)
          : await excel.exportWorkbook(...data.args);
      const buffer =
        bytes instanceof ArrayBuffer
          ? bytes
          : bytes.buffer.slice(
              bytes.byteOffset,
              bytes.byteOffset + bytes.byteLength,
            );
      self.postMessage({ bytes: buffer }, [buffer]);
      return;
    }
    if (data.kind === "directory") throw new Error("经销商目录仅支持导出。");
    const preview = await excel.previewImport(data.buffer, ...data.args);
    self.postMessage({ preview });
  } catch (error) {
    self.postMessage({
      error: error.message || "文件解析失败，请重试。",
    });
  }
};
