import { type Command } from 'commander';

const COMMANDS = [
  'run',
  'agents',
  'runs',
  'machines',
  'status',
  'login',
  'logout',
  'logs',
  'daemon',
  'whoami',
  'config',
  'completions',
  'init',
];

const generateBash = (): string => {
  const cmds = COMMANDS.join(' ');
  return `_agentage() {
  local cur prev commands
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  commands="${cmds}"

  if [[ \${COMP_CWORD} -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "\${commands}" -- "\${cur}") )
    return 0
  fi

  case "\${prev}" in
    agents)
      COMPREPLY=( $(compgen -W "--refresh --all --json" -- "\${cur}") )
      ;;
    runs)
      COMPREPLY=( $(compgen -W "--all --json --filter --last" -- "\${cur}") )
      ;;
    status)
      COMPREPLY=( $(compgen -W "--add-dir --remove-dir --json" -- "\${cur}") )
      ;;
    machines)
      COMPREPLY=( $(compgen -W "--json" -- "\${cur}") )
      ;;
    login)
      COMPREPLY=( $(compgen -W "--hub --token" -- "\${cur}") )
      ;;
    whoami)
      COMPREPLY=( $(compgen -W "--json" -- "\${cur}") )
      ;;
    config)
      COMPREPLY=( $(compgen -W "list set" -- "\${cur}") )
      ;;
    completions)
      COMPREPLY=( $(compgen -W "bash zsh fish" -- "\${cur}") )
      ;;
    init)
      COMPREPLY=( $(compgen -W "--hub --name --dir --no-login" -- "\${cur}") )
      ;;
    daemon)
      COMPREPLY=( $(compgen -W "start stop restart status" -- "\${cur}") )
      ;;
  esac
  return 0
}
complete -F _agentage agentage
`;
};

const generateZsh = (): string => {
  const cmds = COMMANDS.map((c) => `'${c}:${c} command'`).join('\n    ');
  return `#compdef agentage

_agentage() {
  local -a commands
  commands=(
    ${cmds}
  )

  _arguments -C \\
    '1:command:->cmd' \\
    '*::arg:->args'

  case $state in
    cmd)
      _describe 'command' commands
      ;;
  esac
}

_agentage "$@"
`;
};

const generateFish = (): string => {
  const lines = COMMANDS.map(
    (c) => `complete -c agentage -n '__fish_use_subcommand' -a '${c}' -d '${c} command'`
  );
  return lines.join('\n') + '\n';
};

export const registerCompletions = (program: Command): void => {
  const cmd = program.command('completions').description('Generate shell completions');

  cmd
    .command('bash')
    .description('Generate bash completions')
    .action(() => {
      console.log(generateBash());
    });

  cmd
    .command('zsh')
    .description('Generate zsh completions')
    .action(() => {
      console.log(generateZsh());
    });

  cmd
    .command('fish')
    .description('Generate fish completions')
    .action(() => {
      console.log(generateFish());
    });
};
