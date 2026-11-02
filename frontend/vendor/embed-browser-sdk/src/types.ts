export type InstanceState = 'CREATED' | 'LAUNCHING' | 'POSTING' | 'WAITING_READY' | 'READY' | 'ERROR' | 'DESTROYED';
export interface LaunchDescriptor {
  protocolVersion: '1.0'; instanceId: string; appId: string; method: 'POST';
  actionUrl: string; targetOrigin: string; formFields: { assertion: string }; expiresAt: number;
}
export interface EmbedContext {
  protocolVersion: '1.0'; requestId: string; instanceId: string; appId: string;
  embedderOrigin: string; landingPath: string;
}
export interface EmbedRequest { appId: string; resourceId: string; container: HTMLElement; title?: string }
export interface ReadyInfo { requestId: string; instanceId: string; appId: string }
export interface EmbedEvents {
  ready: ReadyInfo;
  error: import('./protocol.js').EmbedError;
  sessionExpired: { code: 'SESSION_REQUIRED'; requestId: string; instanceId: string };
}
export interface EmbedInstance {
  readonly requestId: string;
  readonly instanceId: string | undefined;
  readonly state: InstanceState;
  readonly ready: Promise<ReadyInfo>;
  on<K extends keyof EmbedEvents>(type: K, listener: (event: EmbedEvents[K]) => void): () => void;
  destroy(): void;
}
export interface RuntimeOptions {
  /** Only literal localhost/127.0.0.1/[::1] HTTP is accepted when explicitly enabled. */
  allowLoopbackHttp?: boolean;
  launchTimeoutMs?: number;
  readyTimeoutMs?: number;
  /** Useful for applications owning a separate browsing context and isolated tests. */
  window?: Window;
}
export interface CsrfToken { headerName: string; token: string }
export interface DataAgentLaunch { iframeUrl: string; targetOrigin: string }
export interface DataAgentLaunchRequest { parentInstanceId: string; question: string }
export interface HostOptions extends RuntimeOptions {
  launchEndpoint?: string;
  destroyEndpoint?: string;
  csrf?: (signal?: AbortSignal) => Promise<CsrfToken>;
  fetch?: typeof fetch;
  /** Vendor-specific server-side token exchange; never a generic JWT launch. */
  dataAgentLaunch?: (request: DataAgentLaunchRequest, signal: AbortSignal) => Promise<DataAgentLaunch>;
}
export interface EmbedHost { embedApp(request: EmbedRequest): EmbedInstance; destroy(): void }
export interface EmbedChild extends EmbedHost {
  launchDataAgent(question?: string, signal?: AbortSignal): Promise<DataAgentLaunch>;
  notifyReady(): void;
  notifyError(code: string, message?: string): void;
  notifySessionExpired(): void;
}
