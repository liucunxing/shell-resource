import type { DataAgentLaunch, EmbedContext } from './types.js';
import { EmbedError } from './protocol.js';
import { DATA_AGENT_TIMEOUT_MS, dataAgentEnvelope, dataAgentLaunch, dataAgentMessage, question } from './data-agent.js';

export class DataAgentChildBridge {
  private pending = new Map<string, { resolve: (value: DataAgentLaunch) => void; reject: (error: EmbedError) => void; cancel: (code: string) => void; cleanup: () => void }>();
  private unavailable?: string;
  constructor(private win: Window, private context: EmbedContext) {}
  launch(input = '', signal?: AbortSignal): Promise<DataAgentLaunch> {
    if (this.unavailable) return Promise.reject(new EmbedError(this.unavailable));
    if (!question(input)) return Promise.reject(new EmbedError('INVALID_REQUEST'));
    if (signal?.aborted) return Promise.reject(new EmbedError('INSTANCE_DESTROYED'));
    if (this.pending.size >= 8) return Promise.reject(new EmbedError('RATE_LIMITED'));
    const id = this.win.crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const cleanup = (): void => {
        clearTimeout(timer); signal?.removeEventListener('abort', abort); this.pending.delete(id);
      };
      const cancel = (code: string): void => {
        if (!this.pending.has(id)) return;
        cleanup();
        try {
          this.win.parent.postMessage(dataAgentMessage('CANCEL', id, this.context.instanceId, {}), this.context.embedderOrigin);
        } finally { reject(new EmbedError(code)); }
      };
      const abort = (): void => cancel('INSTANCE_DESTROYED');
      const timer = setTimeout(() => cancel('LAUNCH_TIMEOUT'), DATA_AGENT_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, cancel, cleanup });
      signal?.addEventListener('abort', abort, { once: true });
      try {
        this.win.parent.postMessage(dataAgentMessage('REQUEST', id, this.context.instanceId, { question: input }), this.context.embedderOrigin);
      } catch {
        cleanup(); reject(new EmbedError('NETWORK_ERROR'));
      }
    });
  }
  receive(event: MessageEvent): boolean {
    if (event.source !== this.win.parent || event.origin !== this.context.embedderOrigin) return false;
    const msg = dataAgentEnvelope(event.data);
    if (!msg || msg.instanceId !== this.context.instanceId || !['GRANT', 'ERROR'].includes(msg.type)) return false;
    const waiter = this.pending.get(msg.requestId);
    if (!waiter) return true;
    waiter.cleanup();
    if (msg.type === 'ERROR') waiter.reject(new EmbedError(msg.data.code as string));
    else {
      try { waiter.resolve(dataAgentLaunch(msg.data)); }
      catch { waiter.reject(new EmbedError('PROTOCOL_MISMATCH')); }
    }
    return true;
  }
  stop(code: string): void {
    this.unavailable = code;
    for (const request of [...this.pending.values()]) request.cancel(code);
  }
}
