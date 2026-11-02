import type { EmbedContext, LaunchDescriptor } from './types.js';

const messages: Record<string, string> = {
  INVALID_REQUEST: 'The embed request is invalid.', SESSION_REQUIRED: 'Sign in is required.',
  APP_FORBIDDEN: 'Access to this application is denied.', RESOURCE_FORBIDDEN: 'Access to this resource is denied.',
  PARENT_FORBIDDEN: 'This embedding relationship is not allowed.', CSRF_REJECTED: 'The request could not be verified.',
  CONTEXT_INVALID: 'The embed context is no longer available.', RATE_LIMITED: 'Too many embed requests.',
  CONFIG_INVALID: 'The integration configuration is unavailable.', DEPENDENCY_UNAVAILABLE: 'An integration dependency is unavailable.',
  ASSERTION_INVALID: 'The login assertion is invalid.', ASSERTION_EXPIRED: 'The login assertion expired.',
  USER_DISABLED: 'The account is disabled.', USER_UNMAPPED: 'The account is not linked.',
  ASSERTION_REPLAYED: 'The assertion has already been used.', RECEIVER_UNAVAILABLE: 'The receiving application is unavailable.',
  LAUNCH_TIMEOUT: 'The launch request timed out.', EMBED_TIMEOUT: 'The application did not confirm its session.',
  INSTANCE_DESTROYED: 'The embed instance was destroyed.', PROTOCOL_MISMATCH: 'The embed response is incompatible.',
  NETWORK_ERROR: 'The launch request could not be completed.', EMBED_FAILED: 'The embedded application reported a failure.',
  DATA_AGENT_UNAVAILABLE: 'Data Agent is unavailable.', DATA_AGENT_TOKEN_FAILED: 'Data Agent sign in could not be completed.',
  DATA_AGENT_IDENTITY_UNMAPPED: 'The Data Agent account is not linked.',
  DATA_AGENT_IDENTITY_MISMATCH: 'Data Agent did not confirm the expected account.',
};
export class EmbedError extends Error {
  readonly code: string;
  constructor(code: string) {
    const safeCode = Object.hasOwn(messages, code) ? code : 'EMBED_FAILED';
    super(messages[safeCode]); this.name = 'EmbedError'; this.code = safeCode;
  }
}
export const object = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x);
export const text = (x: unknown, max = 128): x is string => typeof x === 'string' && x.length > 0 && x.length <= max && /\S/.test(x) && !/[\u0000-\u001f\u007f]/.test(x);
export const identifier = (x: unknown): x is string => typeof x === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(x);
export const uuid = (x: unknown): x is string => typeof x === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(x);
export const exact = (x: Record<string, unknown>, keys: string[]): boolean => Object.keys(x).length === keys.length && keys.every(k => Object.hasOwn(x, k));
export function safeUrl(value: string, allowLocal = false, base?: string): URL {
  let u: URL;
  if (/[\s\\]/.test(value)) throw new EmbedError('PROTOCOL_MISMATCH');
  try { u = new URL(value, base); } catch { throw new EmbedError('PROTOCOL_MISMATCH'); }
  if (u.username || u.password || u.hash || u.search || !(u.protocol === 'https:' || (allowLocal && u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)))) throw new EmbedError('PROTOCOL_MISMATCH');
  return u;
}
export function origin(value: unknown, local = false): string {
  if (!text(value, 2048) || safeUrl(value, local).origin !== value) throw new EmbedError('PROTOCOL_MISMATCH');
  return value;
}
export function launch(value: unknown, expectedAppId: string, local: boolean): LaunchDescriptor {
  if (!object(value) || !exact(value, ['protocolVersion', 'instanceId', 'appId', 'method', 'actionUrl', 'targetOrigin', 'formFields', 'expiresAt']) || value.protocolVersion !== '1.0' || !uuid(value.instanceId) || !identifier(value.appId) || value.appId !== expectedAppId || value.method !== 'POST' || !text(value.actionUrl, 2048) || !object(value.formFields) || !exact(value.formFields, ['assertion']) || !text(value.formFields.assertion, 16384) || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value.formFields.assertion) || typeof value.expiresAt !== 'number' || !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= Date.now() / 1000) throw new EmbedError('PROTOCOL_MISMATCH');
  const target = origin(value.targetOrigin, local);
  if (safeUrl(value.actionUrl, local).origin !== target) throw new EmbedError('PROTOCOL_MISMATCH');
  return value as unknown as LaunchDescriptor;
}
export function context(value: unknown, local: boolean): EmbedContext {
  if (!object(value) || !exact(value, ['protocolVersion', 'requestId', 'instanceId', 'appId', 'embedderOrigin', 'landingPath']) || value.protocolVersion !== '1.0' || !uuid(value.requestId) || !uuid(value.instanceId) || !identifier(value.appId) || !text(value.landingPath, 2048) || !/^\/[A-Za-z0-9_./-]*$/.test(value.landingPath) || value.landingPath.startsWith('//') || value.landingPath.includes('..')) throw new EmbedError('PROTOCOL_MISMATCH');
  origin(value.embedderOrigin, local);
  return { ...value } as unknown as EmbedContext;
}
export interface Envelope { protocol: 'portal-embed'; version: '1.0'; type: string; requestId: string; instanceId: string; data: Record<string, unknown> }
export function envelope(value: unknown): Envelope | undefined {
  if (!object(value) || !exact(value, ['protocol', 'version', 'type', 'requestId', 'instanceId', 'data']) || value.protocol !== 'portal-embed' || value.version !== '1.0' || !uuid(value.requestId) || !uuid(value.instanceId) || !object(value.data)) return;
  const d = value.data;
  if (value.type === 'EMBED_READY' && exact(d, ['appId']) && identifier(d.appId) ||
      value.type === 'EMBED_REQUEST' && exact(d, ['appId', 'resourceId']) && identifier(d.appId) && identifier(d.resourceId) ||
      value.type === 'EMBED_GRANT' && exact(d, ['launch']) && object(d.launch) ||
      value.type === 'EMBED_ERROR' && exact(d, ['code', 'message']) && text(d.code) && text(d.message, 500) ||
      value.type === 'SESSION_EXPIRED' && exact(d, ['code']) && d.code === 'SESSION_REQUIRED') return value as unknown as Envelope;
}
export function message(type: string, requestId: string, instanceId: string, data: Record<string, unknown>): Envelope {
  return { protocol: 'portal-embed', version: '1.0', type, requestId, instanceId, data };
}
