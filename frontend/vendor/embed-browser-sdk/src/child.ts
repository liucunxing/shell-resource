import type { EmbedChild, EmbedContext, EmbedRequest, LaunchDescriptor, RuntimeOptions } from './types.js';
import { EmbedError, context as validateContext, envelope, launch, message } from './protocol.js';
import { FrameInstance, runtime } from './runtime.js';
import { DataAgentChildBridge } from './data-agent-child.js';

export function createEmbedChild(input: EmbedContext, options: RuntimeOptions = {}): EmbedChild {
  const env = runtime(options), win = env.win;
  const context = validateContext(input, env.local);
  if (win.parent === win) throw new EmbedError('CONTEXT_INVALID');
  let destroyed = false;
  const vendor = new DataAgentChildBridge(win, context);
  const pagehide = (): void => vendor.stop('INSTANCE_DESTROYED');
  win.addEventListener('pagehide', pagehide);
  const instances = new Set<FrameInstance>();
  const pending = new Map<string, { resolve: (launch: LaunchDescriptor) => void; reject: (error: EmbedError) => void; appId: string; cleanup: () => void }>();
  function post(type: string, data: Record<string, unknown>, requestId = context.requestId): void {
    if (destroyed) throw new EmbedError('INSTANCE_DESTROYED');
    win.parent.postMessage(message(type, requestId, context.instanceId, data), context.embedderOrigin);
  }
  const receive = (event: MessageEvent): void => {
    if (vendor.receive(event)) return;
    if (event.source === win.parent && event.origin === context.embedderOrigin) {
      const msg = envelope(event.data);
      if (!msg || msg.instanceId !== context.instanceId) return;
      const waiter = pending.get(msg.requestId);
      if (!waiter || (msg.type !== 'EMBED_GRANT' && msg.type !== 'EMBED_ERROR')) return;
      pending.delete(msg.requestId); waiter.cleanup();
      if (msg.type === 'EMBED_ERROR') waiter.reject(new EmbedError(msg.data.code as string));
      else {
        try { waiter.resolve(launch(msg.data.launch, waiter.appId, env.local)); }
        catch { waiter.reject(new EmbedError('PROTOCOL_MISMATCH')); }
      }
      return;
    }
    // Nested receivers may report only their own readiness/errors. They cannot request a third level.
    for (const instance of instances) instance.accept(event);
  };
  win.addEventListener('message', receive);
  return {
    launchDataAgent(question = '', signal?: AbortSignal) { return vendor.launch(question, signal); },
    notifyReady() { post('EMBED_READY', { appId: context.appId }); },
    notifyError(code: string) { const error = new EmbedError(code); post('EMBED_ERROR', { code: error.code, message: error.message }); },
    notifySessionExpired() { vendor.stop('SESSION_REQUIRED'); post('SESSION_EXPIRED', { code: 'SESSION_REQUIRED' }); },
    embedApp(request: EmbedRequest) {
      if (destroyed) throw new EmbedError('INSTANCE_DESTROYED');
      if (instances.size >= 8) throw new EmbedError('RATE_LIMITED');
      const instance = new FrameInstance(request, env, (requestId, signal) => new Promise((resolve, reject) => {
        const abort = (): void => { pending.delete(requestId); reject(new EmbedError('INSTANCE_DESTROYED')); };
        signal.addEventListener('abort', abort, { once: true });
        pending.set(requestId, { resolve, reject, appId: request.appId, cleanup: () => signal.removeEventListener('abort', abort) });
        post('EMBED_REQUEST', { appId: request.appId, resourceId: request.resourceId }, requestId);
      }), completed => {
        instances.delete(completed);
        const waiter = pending.get(completed.requestId);
        waiter?.cleanup(); pending.delete(completed.requestId);
      });
      instances.add(instance); return instance;
    },
    destroy() {
      if (destroyed) return; destroyed = true;
      vendor.stop('INSTANCE_DESTROYED');
      win.removeEventListener('pagehide', pagehide);
      win.removeEventListener('message', receive);
      for (const instance of [...instances]) instance.destroy();
      for (const waiter of pending.values()) { waiter.cleanup(); waiter.reject(new EmbedError('INSTANCE_DESTROYED')); }
      pending.clear();
    },
  };
}
export { EmbedError } from './protocol.js';
export type { EmbedChild, EmbedContext, EmbedInstance, EmbedRequest, RuntimeOptions, DataAgentLaunch } from './types.js';
