import type { HostOptions } from './types.js';
import type { FrameInstance } from './runtime.js';
import { EmbedError, object } from './protocol.js';
import { DATA_AGENT_TIMEOUT_MS, dataAgentEnvelope, dataAgentLaunch, dataAgentMessage } from './data-agent.js';

/** Isolated vendor bridge. No assertions, vendor API keys, or email are accepted from messages. */
export class DataAgentHostBridge {
  private pending = new Map<FrameInstance, Map<string, { cancel: (code?: string) => void }>>();
  private seen = new Map<FrameInstance, Set<string>>();
  private expired = new WeakSet<FrameInstance>();
  constructor(private handler: HostOptions['dataAgentLaunch'], private registered: (instance: FrameInstance) => boolean) {}

  accept(event: MessageEvent, instance: FrameInstance): boolean {
    const msg = dataAgentEnvelope(event.data);
    if (!msg || !this.registered(instance) || instance.state !== 'READY' ||
        event.source !== instance.window || event.origin !== instance.targetOrigin ||
        msg.instanceId !== instance.instanceId) return false;
    const pending = this.pending.get(instance) ?? new Map();
    if (msg.type === 'CANCEL') { pending.get(msg.requestId)?.cancel(); return true; }
    if (msg.type !== 'REQUEST') return true;
    const target = instance.window, origin = instance.targetOrigin, parentId = instance.instanceId;
    const epoch = instance.navigationVersion;
    if (!target || !origin || !parentId) return true;
    const current = (): boolean => this.registered(instance) && instance.state === 'READY' &&
      instance.window === target && instance.targetOrigin === origin && instance.navigationVersion === epoch;
    const error = (code: string): void => {
      if (current()) target.postMessage(dataAgentMessage('ERROR', msg.requestId, parentId,
        { code: new EmbedError(code).code }), origin);
    };
    if (this.expired.has(instance)) { error('SESSION_REQUIRED'); return true; }
    const previous = this.seen.get(instance) ?? new Set<string>();
    this.seen.set(instance, previous); this.pending.set(instance, pending);
    if (previous.has(msg.requestId)) return true;
    if (previous.size >= 256 || pending.size >= 8) { error('RATE_LIMITED'); return true; }
    previous.add(msg.requestId);
    if (!this.handler) { error('CONFIG_INVALID'); return true; }
    const controller = new AbortController();
    const cleanup = (): void => { clearTimeout(timer); pending.delete(msg.requestId); };
    const cancel = (code?: string): void => {
      if (controller.signal.aborted) return;
      controller.abort(); cleanup(); if (code) error(code);
    };
    const timer = setTimeout(() => cancel('LAUNCH_TIMEOUT'), DATA_AGENT_TIMEOUT_MS);
    pending.set(msg.requestId, { cancel });
    void Promise.resolve().then(() => {
      if (controller.signal.aborted || !current()) throw new EmbedError('INSTANCE_DESTROYED');
      return this.handler!({ parentInstanceId: parentId, question: msg.data.question as string }, controller.signal);
    }).then(result => {
      if (controller.signal.aborted || !current() || this.expired.has(instance)) return;
      const grant = dataAgentLaunch(result);
      target.postMessage(dataAgentMessage('GRANT', msg.requestId, parentId, { ...grant }), origin);
    }).catch(reason => {
      // Host/index are independently bundled entry points: their Error classes
      // need not have identical constructors. The local catalogue sanitizes codes.
      if (!controller.signal.aborted) error(object(reason) && typeof reason.code === 'string' ? reason.code : 'NETWORK_ERROR');
    }).finally(cleanup);
    return true;
  }
  cancel(instance: FrameInstance, code?: string): void {
    for (const request of [...(this.pending.get(instance)?.values() ?? [])]) request.cancel(code);
    this.pending.delete(instance);
  }
  expire(instance: FrameInstance): void {
    this.cancel(instance, 'SESSION_REQUIRED'); this.expired.add(instance);
  }
  remove(instance: FrameInstance): void {
    this.cancel(instance); this.seen.delete(instance);
  }
}
