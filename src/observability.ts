// Telemetry for the CLI, through @agentage/observability. A real dependency here: `agentage` is
// installed once, globally. It is inert until OTEL_EXPORTER_OTLP_ENDPOINT names a collector, and
// every line it writes goes to stderr - stdout stays the machine-readable channel (`--json`).

export const CLI_SERVICE = 'agentage-cli';

// Guarded even though the kit is a dependency: a half-installed global must degrade to a working
// CLI, never to a stack trace on every command.
export const startObservability = async (service: string): Promise<void> => {
  // The kit (1.0.0) announces an enabled tracer with one console.log, which would land in a
  // `--json` payload. Divert stdout to stderr while it boots; drop this once the kit writes that
  // line to stderr itself.
  const stdoutWrite = process.stdout.write;
  process.stdout.write = process.stderr.write.bind(process.stderr) as typeof process.stdout.write;
  try {
    if (!process.env['OTEL_SERVICE_NAME']) process.env['OTEL_SERVICE_NAME'] = service;
    await import('@agentage/observability/bootstrap');
  } catch (err) {
    if (process.env['AGENTAGE_DEBUG']) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(`[agentage] observability off: ${reason}`); // stderr: never corrupt stdout
    }
  } finally {
    process.stdout.write = stdoutWrite;
  }
};
