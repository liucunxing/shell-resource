import type { EmbedEvents, EmbedInstance, EmbedRequest, InstanceState, LaunchDescriptor, ReadyInfo, RuntimeOptions } from './types.js';
import { EmbedError, envelope, identifier, launch, object, type Envelope } from './protocol.js';

export interface Runtime {
  win: Window; local: boolean; launchMs: number; readyMs: number;
}
export function runtime(options: RuntimeOptions): Runtime {
  const win = options.window ?? window;
  const launchMs = options.launchTimeoutMs ?? 10_000, readyMs = options.readyTimeoutMs ?? 15_000;
  if (![launchMs, readyMs].every(t => Number.isSafeInteger(t) && t > 0 && t <= 300_000)) throw new EmbedError('INVALID_REQUEST');
  return { win, local: options.allowLoopbackHttp === true, launchMs, readyMs };
}
export type LaunchProvider = (requestId: string, signal: AbortSignal) => Promise<LaunchDescriptor>;
/** Keeps only non-secret launch metadata after submitting the temporary form. */
export class FrameInstance implements EmbedInstance {
  readonly requestId: string;
  readonly ready: Promise<ReadyInfo>;
  private resolve!: (info: ReadyInfo) => void;
  private reject!: (error: EmbedError) => void;
  private currentState: InstanceState = 'CREATED';
  private id?: string;
  private target?: string;
  private iframe: HTMLIFrameElement | undefined;
  private form: HTMLFormElement | undefined;
  private timer?: ReturnType<typeof setTimeout>;
  private listeners = new Map<keyof EmbedEvents, Set<(event: never) => void>>();
  readonly abort = new AbortController();
  constructor(readonly request: EmbedRequest, readonly env: Runtime, private provider: LaunchProvider, private terminal: (instance: FrameInstance) => void) {
    if (!identifier(request.appId) || !identifier(request.resourceId) || !request.container || request.container.ownerDocument !== env.win.document) throw new EmbedError('INVALID_REQUEST');
    this.requestId = env.win.crypto.randomUUID();
    this.ready = new Promise((resolve, reject) => { this.resolve = resolve; this.reject = reject; });
    // Consumers may choose events instead of the promise; rejection remains observable to awaiters.
    void this.ready.catch(() => undefined);
    queueMicrotask(() => void this.start());
  }
  get state(): InstanceState { return this.currentState; }
  get instanceId(): string | undefined { return this.id; }
  get window(): Window | null | undefined { return this.iframe?.contentWindow; }
  get targetOrigin(): string | undefined { return this.target; }
  on<K extends keyof EmbedEvents>(type: K, listener: (event: EmbedEvents[K]) => void): () => void {
    if (this.currentState === 'DESTROYED') return () => undefined;
    const set = this.listeners.get(type) ?? new Set();
    this.listeners.set(type, set); set.add(listener as (event: never) => void);
    return () => set.delete(listener as (event: never) => void);
  }
  private emit<K extends keyof EmbedEvents>(type: K, value: EmbedEvents[K]): void {
    if (this.currentState === 'DESTROYED') return;
    for (const callback of [...(this.listeners.get(type) ?? [])]) {
      if (this.state === 'DESTROYED') break;
      try { callback(value as never); } catch { /* One consumer callback must not break cleanup or other instances. */ }
    }
  }
  private setTimer(ms: number, code: string): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.fail(new EmbedError(code)), ms);
  }
  private async start(): Promise<void> {
    if (this.currentState !== 'CREATED') return;
    this.currentState = 'LAUNCHING'; this.setTimer(this.env.launchMs, 'LAUNCH_TIMEOUT');
    try {
      const descriptor = launch(await this.provider(this.requestId, this.abort.signal), this.request.appId, this.env.local);
      if (this.abort.signal.aborted) return;
      this.id = descriptor.instanceId; this.target = descriptor.targetOrigin;
      this.currentState = 'POSTING';
      const doc = this.env.win.document;
      this.iframe = doc.createElement('iframe');
      this.iframe.name = `portal-embed-${this.requestId}`;
      this.iframe.title = this.request.title ?? this.request.appId;
      // Browser form-post receivers require an Origin header; no-referrer can turn it into "null".
      this.iframe.referrerPolicy = 'strict-origin-when-cross-origin';
      this.iframe.setAttribute('sandbox', 'allow-forms allow-scripts allow-same-origin allow-downloads');
      this.iframe.dataset.embedInstanceId = descriptor.instanceId;
      this.request.container.append(this.iframe);
      this.form = doc.createElement('form');
      this.form.method = 'POST'; this.form.action = descriptor.actionUrl;
      this.form.enctype = 'application/x-www-form-urlencoded'; this.form.target = this.iframe.name;
      this.form.hidden = true;
      const input = doc.createElement('input'); input.type = 'hidden'; input.name = 'assertion'; input.value = descriptor.formFields.assertion;
      this.form.append(input); doc.body.append(this.form);
      this.currentState = 'WAITING_READY'; this.setTimer(this.env.readyMs, 'EMBED_TIMEOUT');
      try { this.form.submit(); } finally { input.value = ''; this.form.remove(); this.form = undefined; }
    } catch (error) {
      if (!this.abort.signal.aborted) this.fail(error instanceof EmbedError ? error : new EmbedError('NETWORK_ERROR'));
    }
  }
  accept(event: MessageEvent): Envelope | undefined {
    if (!this.id || !this.iframe || this.currentState === 'ERROR' || this.currentState === 'DESTROYED' || event.source !== this.iframe.contentWindow || event.origin !== this.target) return;
    if (object(event.data) && event.data.protocol === 'portal-embed' && event.data.instanceId === this.id && event.data.requestId === this.requestId && event.data.version !== '1.0') {
      this.fail(new EmbedError('PROTOCOL_MISMATCH')); return;
    }
    const msg = envelope(event.data);
    if (!msg || msg.instanceId !== this.id) return;
    if (msg.type === 'EMBED_REQUEST') return this.currentState === 'READY' ? msg : undefined;
    if (msg.requestId !== this.requestId) return;
    if (msg.type === 'EMBED_READY' && msg.data.appId === this.request.appId && this.currentState === 'WAITING_READY') {
      if (this.timer) clearTimeout(this.timer);
      this.currentState = 'READY';
      const info = { instanceId: this.id, requestId: this.requestId, appId: this.request.appId };
      this.resolve(info); this.emit('ready', info);
    } else if (msg.type === 'EMBED_ERROR') {
      this.fail(new EmbedError(msg.data.code as string));
    } else if (msg.type === 'SESSION_EXPIRED' && this.currentState === 'READY') {
      this.emit('sessionExpired', { code: 'SESSION_REQUIRED', instanceId: this.id, requestId: this.requestId });
    }
    return;
  }
  private cleanup(): void {
    if (this.timer) clearTimeout(this.timer);
    this.abort.abort();
    this.form?.remove(); this.form = undefined;
    this.iframe?.remove(); this.iframe = undefined;
  }
  fail(error: EmbedError): void {
    if (this.currentState === 'ERROR' || this.currentState === 'DESTROYED') return;
    this.currentState = 'ERROR'; this.cleanup(); this.reject(error); this.emit('error', error);
    this.listeners.clear(); this.terminal(this);
  }
  destroy(): void {
    if (this.currentState === 'DESTROYED') return;
    this.currentState = 'DESTROYED'; this.cleanup(); this.reject(new EmbedError('INSTANCE_DESTROYED'));
    this.listeners.clear(); this.terminal(this);
  }
}
