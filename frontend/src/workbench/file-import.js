function runFileWorker(payload, transfer = []) {
  return new Promise((resolve, reject) => {
    if (typeof Worker === "undefined") {
      reject(
        new Error(
          "当前浏览器不支持后台文件处理，请使用最新版 Edge 或 Chrome。",
        ),
      );
      return;
    }
    const worker = new Worker(
      new URL("./file-import.worker.js", import.meta.url),
      { type: "module" },
    );
    const finish = () => worker.terminate();
    worker.onmessage = ({ data }) => {
      finish();
      if (data.error) reject(new Error(data.error));
      else resolve(data.bytes ?? data.preview);
    };
    worker.onerror = () => {
      finish();
      reject(new Error("文件处理失败，请重试。"));
    };
    worker.onmessageerror = worker.onerror;
    try {
      worker.postMessage(payload, transfer);
    } catch (error) {
      finish();
      reject(error);
    }
  });
}

export const previewExcelInWorker = (kind, buffer, ...args) =>
  runFileWorker({ kind, buffer, args }, [buffer]);

export const exportExcelInWorker = (kind, ...args) =>
  runFileWorker({ operation: "export", kind, args });

export const parseReferenceInWorker = (text) =>
  runFileWorker({ kind: "reference", text });
