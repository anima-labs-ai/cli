/**
 * `am tail`'s query string is a wire contract with the server's
 * `/v1/events/stream` handler, which reads `request.query.channel` and
 * `request.query.agent_id`.
 *
 * It is worth its own test because a wrong name here fails in the worst
 * direction. `--agent` used to be sent as `agentId`; the server ignored the
 * unknown parameter and streamed the whole org, while the CLI printed the
 * requested agent back in its header line. Someone tailing one agent would
 * have read every agent's activity as that agent's, with nothing to suggest
 * the filter had not applied.
 */

import { describe, expect, test } from 'bun:test';
import { buildStreamUrl } from '../../commands/tail/index.js';

const API = 'https://api.useanima.sh';

function params(url: string): URLSearchParams {
  return new URL(url).searchParams;
}

describe('buildStreamUrl', () => {
  test('sends the agent filter as agent_id, the name the server reads', () => {
    const q = params(buildStreamUrl(API, { agent: 'agent_123' }));
    expect(q.get('agent_id')).toBe('agent_123');
    // The spelling that silently streamed the whole org.
    expect(q.has('agentId')).toBe(false);
  });

  test('sends the channel filter as channel', () => {
    expect(params(buildStreamUrl(API, { filter: 'email' })).get('channel')).toBe('email');
  });

  test('both filters compose', () => {
    const q = params(buildStreamUrl(API, { filter: 'vault', agent: 'agent_123' }));
    expect(q.get('channel')).toBe('vault');
    expect(q.get('agent_id')).toBe('agent_123');
  });

  test('no filters means no query string at all', () => {
    // An empty `agent_id=` would be a filter matching nothing rather than the
    // absent filter the user asked for.
    expect(buildStreamUrl(API, {})).toBe(`${API}/v1/events/stream`);
  });

  test('a path-mounted API URL keeps its path', () => {
    // `new URL('/v1/…', base)` would have replaced `/api` rather than extended
    // it, so only `tail` would break against a path-mounted deployment while
    // every oRPC command — which builds `${base}/v1` — kept working.
    expect(buildStreamUrl('https://example.test/api', { agent: 'a1' })).toBe(
      'https://example.test/api/v1/events/stream?agent_id=a1',
    );
  });

  test('a trailing slash on the API URL does not double up', () => {
    expect(buildStreamUrl('https://example.test/', {})).toBe(
      'https://example.test/v1/events/stream',
    );
  });
});
