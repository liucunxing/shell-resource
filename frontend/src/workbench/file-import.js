function runImportWorker(payload, transfer = []) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("./file-import.worker.js", import.meta.url),
      { type: "module" },
    );
    const finish = () => worker.terminate();
    worker.onmessage = ({ data }) => {
      finish();
      if (data.error) reject(new Error(data.error));
      else resolve(data.preview);
    };
    worker.onerror = () => {
      finish();
      reject(new Error("文件解析失败，请重试。"));
    };
    try {
      worker.postMessage(payload, transfer);
    } catch (error) {
      finish();
      reject(error);
    }
  });
}

export const previewExcelInWorker = (kind, buffer, ...args) =>
  runImportWorker({ kind, buffer, args }, [buffer]);

export const parseReferenceInWorker = (text) =>
  runImportWorker({ kind: "reference", text });
