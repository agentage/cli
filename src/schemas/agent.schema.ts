import { z } from 'zod';

export const agentYamlSchema = z.object({
  name: z.string().min(1),
  model: z.string().default('gpt-4'),
  instructions: z.string().min(1),
  tools: z.array(z.string()).optional().default([]),
  variables: z.record(z.string()).optional().default({}),
});

export type AgentYaml = z.infer<typeof agentYamlSchema>;
