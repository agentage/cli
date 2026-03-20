import chalk from 'chalk';
import { type RunEvent } from '@agentage/core';

export const renderEvent = (event: RunEvent): void => {
  const { data } = event;

  if (data.type === 'output') {
    renderOutput(data.content, data.format);
    return;
  }

  if (data.type === 'state') {
    if (data.state === 'completed') {
      console.log(chalk.green('\nDone.'));
    } else if (data.state === 'failed') {
      console.log(chalk.red(`\nFailed: ${data.message || 'Unknown error'}`));
    } else if (data.state === 'input_required') {
      console.log(chalk.yellow('\nInput required.'));
    }
    return;
  }

  if (data.type === 'error') {
    console.error(chalk.red(`Error [${data.code}]: ${data.message}`));
    return;
  }

  if (data.type === 'input_required') {
    console.log(chalk.yellow(`\n${data.prompt}`));
    return;
  }

  if (data.type === 'result') {
    if (data.output) {
      console.log(
        typeof data.output === 'string' ? data.output : JSON.stringify(data.output, null, 2)
      );
    }
    return;
  }
};

const renderOutput = (content: unknown, format?: string): void => {
  if (!format || format === 'text' || format === 'markdown') {
    console.log(typeof content === 'string' ? content : JSON.stringify(content));
    return;
  }

  if (format === 'llm.delta') {
    const delta = content as { text?: string };
    if (delta.text) {
      process.stdout.write(delta.text);
    }
    return;
  }

  if (format === 'llm.thinking') {
    const thinking = content as { text?: string };
    if (thinking.text) {
      process.stdout.write(chalk.dim(thinking.text));
    }
    return;
  }

  if (format === 'llm.tool_call') {
    const call = content as { name?: string; input?: unknown };
    console.log(chalk.cyan(`> tool: ${call.name}(${JSON.stringify(call.input)})`));
    return;
  }

  if (format === 'llm.tool_result') {
    const result = content as { output?: unknown };
    const text = typeof result.output === 'string' ? result.output : JSON.stringify(result.output);
    const truncated = text.length > 200 ? text.slice(0, 200) + '...' : text;
    console.log(chalk.gray(`< result: ${truncated}`));
    return;
  }

  if (format === 'llm.usage') {
    const usage = content as { input?: number; output?: number };
    console.log(
      chalk.gray(
        `Tokens: ${(usage.input ?? 0).toLocaleString()} in / ${(usage.output ?? 0).toLocaleString()} out`
      )
    );
    return;
  }

  if (format === 'progress') {
    const progress = content as { percent?: number; message?: string };
    const pct = progress.percent !== undefined ? `[${progress.percent}%] ` : '';
    console.log(`${pct}${progress.message || ''}`);
    return;
  }

  if (format === 'json') {
    console.log(JSON.stringify(content, null, 2));
    return;
  }

  // Unknown format
  console.log(JSON.stringify(content));
};
