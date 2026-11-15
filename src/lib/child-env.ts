// The cli's own token never reaches a process it starts: npm, an author's script, the daemon.
export const childEnv = (env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv => {
  const copy = { ...env };
  delete copy['AGENTAGE_TOKEN'];
  return copy;
};
