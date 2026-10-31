import { type InstallPlan, type InstallResult } from '../../core/installer/installer.js';

const line = (label: string, value: string): string => `${label.padEnd(10)} ${value}`;

const plural = (count: number): string =>
  count === 0 ? 'no plugins' : `${count} plugin${count === 1 ? '' : 's'}`;

const npmReason = (plan: InstallPlan): string => {
  if (plan.npm === 'ci') return 'the lock matches package.json';
  return plan.lock === null ? 'no lock yet' : 'the lock does not match package.json';
};

const npmText = (plan: InstallPlan): string => {
  if (plan.npm === null) return plan.reuse ? 'skipped, tree already installed' : 'skipped';
  return `${plan.npm} --ignore-scripts (${npmReason(plan)})`;
};

export const planLines = (label: string, plan: InstallPlan): string[] => {
  const names = Object.keys(plan.install);
  const width = Math.max(0, ...names.map((name) => name.length));
  return [
    line('dry run', 'nothing written'),
    line('profile', label),
    line('registry', plan.registry),
    line('plugins', plan.pluginsDir),
    line('install', plural(names.length)),
    ...names.map((name) => `  ${name.padEnd(width)}  ${plan.install[name] ?? ''}`),
    line('npm', npmText(plan)),
    line('tree', plan.tree ?? 'named from the lock npm writes'),
  ];
};

export const installLine = (result: InstallResult): string => {
  const how = result.reused ? 'reused' : result.npm ? `npm ${result.npm}` : 'npm skipped';
  return line('install', `${plural(result.count)} in tree ${result.tree} (${how})`);
};
