import type { RunEvent } from '@agentage/core';

export type ShellExec = (
  command: string,
  options?: { signal?: AbortSignal; timeoutMs?: number; cwd?: string }
) => AsyncIterable<RunEvent>;

export interface ActionProgress {
  step: string;
  detail?: string;
}
