import { type InvokeEvent } from '@agentage/core';
import { loadConfig } from '../daemon/config.js';

const baseUrl = (): string => `http://localhost:${loadConfig().daemon.port}`;

const parseSse = (text: string): InvokeEvent[] =>
  text
    .split('\n\n')
    .filter((chunk) => chunk.startsWith('data: '))
    .map((chunk) => JSON.parse(chunk.slice(6)) as InvokeEvent);

export const invokeAction = async <O>(
  name: string,
  input: unknown,
  capabilities: string[]
): Promise<O> => {
  const res = await fetch(`${baseUrl()}/api/actions/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-capabilities': capabilities.join(','),
    },
    body: JSON.stringify({ input }),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => '')}`);
  }
  const events = parseSse(await res.text());
  const last = events.at(-1);
  if (!last) throw new Error('action returned no events');
  if (last.type === 'error') {
    throw new Error(`${last.code}: ${last.message}`);
  }
  if (last.type !== 'result') {
    throw new Error(`unexpected last event: ${last.type}`);
  }
  return last.data as O;
};
