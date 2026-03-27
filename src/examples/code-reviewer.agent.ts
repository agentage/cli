import { agent } from '@agentage/core';

export default agent({
  name: 'code-reviewer',
  description: 'Reviews code for quality issues',
  model: 'claude-sonnet-4-6',
  tools: ['read', 'glob', 'grep'],
  prompt: `You are a senior code reviewer.
Focus on correctness, performance, and readability.
Always cite file:line when reporting issues.`,
});
