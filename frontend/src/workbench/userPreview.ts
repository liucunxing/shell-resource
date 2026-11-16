// A page-local view selection. Authentication credentials are never replaced.
let previewEmail = "";
let previewEpoch = 0;

export const getPreviewUserEmail = (): string => previewEmail;
export const getPreviewEpoch = (): number => previewEpoch;

export function setPreviewUserEmail(email: string): void {
  previewEmail = email.trim().toLowerCase();
  previewEpoch += 1;
}

export function assertPreviewResponseCurrent(epoch: number): void {
  if (epoch !== previewEpoch) throw new Error("用户视角已切换，请重新加载。");
}
