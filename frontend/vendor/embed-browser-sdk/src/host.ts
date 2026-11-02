import type { CsrfToken, EmbedHost, EmbedRequest, HostOptions, LaunchDescriptor } from './types.js';
import { EmbedError, exact, launch, message, object, safeUrl, text } from './protocol.js';
import { FrameInstance, runtime } from './runtime.js';
import { DataAgentHostBridge } from './data-agent-host.js';

export function createEmbedHost(options: HostOptions = {}): EmbedHost {
  const env = runtime(options), win = env.win;
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  function sameOrigin(path: string): string {
    const url = safeUrl(path, env.local, win.location.href);
    if (url.origin !== win.location.origin) throw new EmbedError('INVALID_REQUEST');
    return url.href;
  }
  const launchUrl = sameOrigin(options.launchEndpoint ?? '/api/embed/launch');
  const destroyUrl = sameOrigin(options.destroyEndpoint ?? '/api/embed/instances').replace(/\/$/, '');
  const csrfUrl = sameOrigin('/api/auth/csrf');
  const csrf = options.csrf ?? (async (signal?: AbortSignal): Promise<CsrfToken> => {
    const response = await fetcher(csrfUrl, { credentials: 'same-origin', cache: 'no-store', redirect: 'error', ...(signal ? { signal } : {}) });
    if (!response.ok) throw new EmbedError('CSRF_REJECTED');
    return await response.json() as CsrfToken;
  });
  async function headers(signal?: AbortSignal): Promise<Record<string, string>> {
    const result = await csrf(signal);
    if (!object(result) || !text(result.headerName) || !/^X-[A-Za-z0-9-]+$/i.test(result.headerName) || !text(result.token, 4096)) throw new EmbedError('CSRF_REJECTED');
    return { 'Content-Type': 'application/json', [result.headerName]: result.token };
  }
  const instances = new Set<FrameInstance>();
  const vendor = new DataAgentHostBridge(options.dataAgentLaunch, instance => instances.has(instance));
  const nested = new Map<FrameInstance, Map<string, AbortController>>();
  const seen = new Map<FrameInstance, Set<string>>();
  let destroyed = false;
  async function request(appId: string, resourceId: string, requestId: string, signal: AbortSignal, parentInstanceId?: string): Promise<LaunchDescriptor> {
    const h = await headers(signal);
    if (signal.aborted) throw new EmbedError('INSTANCE_DESTROYED');
    const response = await fetcher(launchUrl, { method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers: h, signal, body: JSON.stringify({ appId, resourceId, requestId, ...(parentInstanceId ? { parentInstanceId } : {}) }) });
    const body: unknown = await response.json();
    if (!response.ok) throw new EmbedError(object(body) && typeof body.code === 'string' ? body.code : response.status === 401 ? 'SESSION_REQUIRED' : 'NETWORK_ERROR');
    if (!object(body) || !exact(body, ['code', 'requestId', 'data']) || body.code !== 'OK' || body.requestId !== requestId) throw new EmbedError('PROTOCOL_MISMATCH');
    return launch(body.data, appId, env.local);
  }
  function terminal(instance: FrameInstance): void {
    if (!instances.delete(instance)) return;
    vendor.remove(instance);
    for (const controller of nested.get(instance)?.values() ?? []) controller.abort();
    nested.delete(instance); seen.delete(instance);
    if (instance.instanceId) void headers().then(h => fetcher(`${destroyUrl}/${encodeURIComponent(instance.instanceId!)}`, { method: 'DELETE', credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers: h, keepalive: true })).catch(() => undefined);
  }
  const receive = (event: MessageEvent): void => {
    for (const instance of instances) {
      if (vendor.accept(event, instance)) return;
      const msg = instance.accept(event);
      if (!msg || msg.type !== 'EMBED_REQUEST') continue;
      const previous = seen.get(instance) ?? new Set<string>();
      const pending = nested.get(instance) ?? new Map<string, AbortController>();
      seen.set(instance, previous); nested.set(instance, pending);
      const targetWindow = instance.window, targetOrigin = instance.targetOrigin, parentId = instance.instanceId;
      if (!targetWindow || !targetOrigin || !parentId || previous.has(msg.requestId)) return;
      const sendError = (code: string): void => {
        const error = new EmbedError(code);
        if (instances.has(instance)) targetWindow.postMessage(message('EMBED_ERROR', msg.requestId, parentId, { code: error.code, message: error.message }), targetOrigin);
      };
      if (previous.size >= 256 || pending.size >= 8) { sendError('RATE_LIMITED'); return; }
      previous.add(msg.requestId);
      const controller = new AbortController(); pending.set(msg.requestId, controller);
      const timer = setTimeout(() => { controller.abort(); sendError('LAUNCH_TIMEOUT'); }, env.launchMs);
      void request(msg.data.appId as string, msg.data.resourceId as string, msg.requestId, controller.signal, parentId).then(descriptor => {
        if (!controller.signal.aborted && instances.has(instance) && instance.state === 'READY') targetWindow.postMessage(message('EMBED_GRANT', msg.requestId, parentId, { launch: descriptor }), targetOrigin);
      }).catch(error => {
        if (!controller.signal.aborted) sendError(error instanceof EmbedError ? error.code : 'NETWORK_ERROR');
      }).finally(() => { clearTimeout(timer); pending.delete(msg.requestId); });
      return;
    }
  };
  win.addEventListener('message', receive);
  return {
    embedApp(input: EmbedRequest) {
      if (destroyed) throw new EmbedError('INSTANCE_DESTROYED');
      if (instances.size >= 32) throw new EmbedError('RATE_LIMITED');
      const instance = new FrameInstance(input, env, (id, signal) => request(input.appId, input.resourceId, id, signal), terminal);
      instance.on('sessionExpired', () => vendor.expire(instance));
      instance.onNavigation(() => vendor.cancel(instance));
      instances.add(instance); return instance;
    },
    destroy() {
      if (destroyed) return; destroyed = true;
      win.removeEventListener('message', receive);
      for (const instance of [...instances]) instance.destroy();
    },
  };
}
export { EmbedError } from './protocol.js';
export type { HostOptions, EmbedHost, EmbedInstance, EmbedRequest, LaunchDescriptor, DataAgentLaunch, DataAgentLaunchRequest } from './types.js';
