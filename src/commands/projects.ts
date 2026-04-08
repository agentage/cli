import { type Command } from 'commander';
import { resolve } from 'node:path';
import chalk from 'chalk';
import {
  loadProjects,
  addProject,
  removeProject,
  discoverProjects,
  getWorktrees,
  pruneClones,
} from '../projects/projects.js';

export const registerProjects = (program: Command): void => {
  const cmd = program.command('projects').description('Manage tracked projects');

  cmd
    .command('list', { isDefault: true })
    .description('List tracked projects')
    .option('--json', 'JSON output')
    .action((opts: { json?: boolean }) => {
      listProjects(opts.json ?? false);
    });

  cmd
    .command('add <path>')
    .description('Add a project by path')
    .action((path: string) => {
      handleAdd(path);
    });

  cmd
    .command('remove <name>')
    .description('Remove a project by name')
    .action((name: string) => {
      handleRemove(name);
    });

  cmd
    .command('discover [path]')
    .description('Discover git projects in a directory')
    .action((path?: string) => {
      handleDiscover(path);
    });

  cmd
    .command('info <name>')
    .description('Show project details')
    .option('--json', 'JSON output')
    .action((name: string, opts: { json?: boolean }) => {
      handleInfo(name, opts.json ?? false);
    });

  cmd
    .command('prune')
    .description('Remove stale cloned repositories')
    .option('--days <number>', 'Max age in days', '30')
    .action((opts: { days: string }) => {
      handlePrune(parseInt(opts.days, 10));
    });
};

const listProjects = (jsonMode: boolean): void => {
  const projects = loadProjects();

  if (projects.length === 0) {
    if (jsonMode) {
      console.log(JSON.stringify([], null, 2));
    } else {
      console.log(chalk.gray('No projects tracked.'));
      console.log(chalk.dim('Run `agentage projects discover <path>` to find projects.'));
    }
    process.exit(0);
    return;
  }

  const enriched = projects.map((p) => ({
    ...p,
    worktrees: getWorktrees(p.path).length,
  }));

  if (jsonMode) {
    console.log(JSON.stringify(enriched, null, 2));
    process.exit(0);
    return;
  }

  const nameWidth = Math.max(12, ...enriched.map((p) => p.name.length)) + 2;
  const pathWidth = Math.max(12, ...enriched.map((p) => p.path.length)) + 2;
  const sourceWidth = 14;

  console.log(
    chalk.bold('NAME'.padEnd(nameWidth)) +
      chalk.bold('PATH'.padEnd(pathWidth)) +
      chalk.bold('SOURCE'.padEnd(sourceWidth)) +
      chalk.bold('WORKTREES')
  );

  for (const p of enriched) {
    const source = p.discovered ? 'discovered' : 'manual';
    console.log(
      p.name.padEnd(nameWidth) +
        chalk.gray(p.path.padEnd(pathWidth)) +
        source.padEnd(sourceWidth) +
        String(p.worktrees)
    );
  }

  console.log(chalk.dim(`\n${enriched.length} projects`));
  process.exit(0);
};

const handleAdd = (path: string): void => {
  const absPath = resolve(path);
  try {
    const project = addProject(absPath);
    console.log(chalk.green(`Added project: ${project.name} (${project.path})`));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(chalk.red(`Failed to add project: ${message}`));
    process.exitCode = 1;
  }
  process.exit(0);
};

const handleRemove = (name: string): void => {
  const removed = removeProject(name);
  if (removed) {
    console.log(chalk.green(`Removed project: ${name}`));
  } else {
    console.error(chalk.red(`Project not found: ${name}`));
    process.exitCode = 1;
  }
  process.exit(0);
};

const handleDiscover = (path?: string): void => {
  const resolvedPath = resolve(path ?? process.cwd());
  const before = loadProjects();
  const after = discoverProjects(resolvedPath);
  const newProjects = after.filter((p) => !before.some((b) => b.path === p.path));

  if (newProjects.length === 0) {
    console.log(chalk.gray('No new projects discovered.'));
  } else {
    console.log(chalk.green(`Discovered ${newProjects.length} new project(s):`));
    for (const p of newProjects) {
      console.log(`  ${p.name} ${chalk.gray(p.path)}`);
    }
  }
  process.exit(0);
};

const handleInfo = (name: string, jsonMode: boolean): void => {
  const projects = loadProjects();
  const project = projects.find((p) => p.name === name);

  if (!project) {
    console.error(chalk.red(`Project not found: ${name}`));
    process.exitCode = 1;
    process.exit(0);
    return;
  }

  const worktrees = getWorktrees(project.path);

  if (jsonMode) {
    console.log(JSON.stringify({ ...project, worktrees }, null, 2));
    process.exit(0);
    return;
  }

  console.log(`Name:       ${project.name}`);
  console.log(`Path:       ${project.path}`);
  console.log(`Source:     ${project.discovered ? 'discovered' : 'manual'}`);

  if (worktrees.length > 0) {
    console.log(`Worktrees:`);
    for (const wt of worktrees) {
      console.log(`  ${wt.branch} ${chalk.gray('→')} ${wt.path}`);
    }
  } else {
    console.log(`Worktrees:  ${chalk.gray('none')}`);
  }

  process.exit(0);
};

const handlePrune = (days: number): void => {
  const removed = pruneClones(days);

  if (removed.length === 0) {
    console.log(chalk.gray('Nothing to prune.'));
  } else {
    console.log(chalk.green(`Pruned ${removed.length} stale clone(s):`));
    for (const p of removed) {
      console.log(`  ${chalk.gray(p)}`);
    }
  }
  process.exit(0);
};
