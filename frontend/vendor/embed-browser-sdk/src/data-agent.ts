import type { DataAgentLaunch } from './types.js';
import { EmbedError, exact, object, origin, uuid } from './protocol.js';

export const DATA_AGENT_TIMEOUT_MS = 30_000;
export type DataAgentType = 'REQUEST' | 'GRANT' | 'ERROR' | 'CANCEL';
export interface DataAgentEnvelope {
  protocol: 'portal-data-agent'; version: '1.0'; type: DataAgentType;
  requestId: string; instanceId: string; data: Record<string, unknown>;
}
export function question(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 2000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
}
/** Dedicated vendor URL validator. Generic JWT descriptors still forbid all queries. */
export function dataAgentLaunch(value: unknown): DataAgentLaunch {
  if (!object(value) || !exact(value, ['iframeUrl', 'targetOrigin']) ||
      typeof value.iframeUrl !== 'string' || value.iframeUrl.length > 65536 ||
      /[\s\\]/.test(value.iframeUrl) || /%(?![0-9a-f]{2})/i.test(value.iframeUrl)) throw new EmbedError('PROTOCOL_MISMATCH');
  const target = origin(value.targetOrigin, false);
  let url: URL;
  try { url = new URL(value.iframeUrl); } catch { throw new EmbedError('PROTOCOL_MISMATCH'); }
  if (url.origin !== target || url.protocol !== 'https:' || url.username || url.password ||
      value.iframeUrl.includes('#') || !value.iframeUrl.startsWith(`${target}/admin/chat?`) ||
      url.pathname !== '/admin/chat') throw new EmbedError('PROTOCOL_MISMATCH');
  const params = url.searchParams;
  const keys = [...params.keys()];
  if (keys.length < 2 || keys.length > 3 || new Set(keys).size !== keys.length ||
      keys.some(key => !['token', 'space', 'ask'].includes(key))) throw new EmbedError('PROTOCOL_MISMATCH');
  const token = params.get('token'), space = params.get('space'), ask = params.get('ask');
  if (!token || token.length > 16000 || /[\s\u0000-\u001f\u007f]/.test(token) ||
      !space || space.length > 128 || /[\s\u0000-\u001f\u007f]/.test(space) ||
      (ask !== null && !question(ask))) throw new EmbedError('PROTOCOL_MISMATCH');
  return { iframeUrl: value.iframeUrl, targetOrigin: target };
}
export function dataAgentEnvelope(value: unknown): DataAgentEnvelope | undefined {
  if (!object(value) || !exact(value, ['protocol', 'version', 'type', 'requestId', 'instanceId', 'data']) ||
      value.protocol !== 'portal-data-agent' || value.version !== '1.0' || !uuid(value.requestId) ||
      !uuid(value.instanceId) || !object(value.data)) return;
  const data = value.data;
  if (value.type === 'REQUEST' && exact(data, ['question']) && question(data.question) ||
      value.type === 'GRANT' && exact(data, ['iframeUrl', 'targetOrigin']) &&
        typeof data.iframeUrl === 'string' && typeof data.targetOrigin === 'string' ||
      value.type === 'ERROR' && exact(data, ['code']) && typeof data.code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(data.code) ||
      value.type === 'CANCEL' && exact(data, [])) return value as unknown as DataAgentEnvelope;
}
export function dataAgentMessage(type: DataAgentType, requestId: string, instanceId: string,
  data: Record<string, unknown>): DataAgentEnvelope {
  return { protocol: 'portal-data-agent', version: '1.0', type, requestId, instanceId, data };
}
