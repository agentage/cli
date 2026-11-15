import { type SetupDeps } from './commands/auth/setup.js';
import { runDaemonRestart, runDaemonStatus, runDaemonStop } from './commands/daemon/daemon.js';
import { cliInstaller } from './commands/daemon/installer.js';
import { runDaemon } from './commands/daemon/run.js';
import { signedInAccount } from './commands/extension/account.js';
import { runExtensionBuild, runExtensionCheck } from './commands/extension/build.js';
import { runExtensionCreate } from './commands/extension/create.js';
import { runExtensionDoctor } from './commands/extension/doctor.js';
import { runExtensionInstall } from './commands/extension/install.js';
import { loadKitTool } from './commands/extension/kit-tool.js';
import { runExtensionList } from './commands/extension/list.js';
import { runExtensionRelease } from './commands/extension/release.js';
import { runExtensionRemove, terminalIo } from './commands/extension/remove.js';
import { runExtensionSetup } from './commands/extension/setup.js';
import { runExtensionDown, runExtensionToken, runExtensionUp } from './commands/extension/up.js';
import { runStatus, statusDeps } from './commands/status/status.js';
import { runUpdate } from './commands/update/update.js';
import { npmMajor, prepareManifest, prepareNpm } from './core/installer/npm.js';
import { ensureSignedIn, signOut } from './lib/auth/sign-in.js';
import { ensureDaemon } from './lib/daemon/daemon-client.js';
import { openMarket } from './lib/net/market.js';
import { refreshUpdateCache, updateHint } from './lib/update/update-cache.js';
import { type ProgramDeps } from './program.js';

const setupDeps: SetupDeps = {
  ensureSignedIn: (signInOpts) => ensureSignedIn(signInOpts),
  signOut: () => signOut(),
  printStatus: (opts) => runStatus(opts, statusDeps(false)),
  startDaemon: () => ensureDaemon(),
};

// What a profile edit reaches: npm, and the account it syncs with when signed in.
const editDeps = { npm: () => prepareNpm(), npmMajor: () => npmMajor(), account: signedInAccount };

const installer = () =>
  cliInstaller({
    npm: () => prepareNpm(),
    manifest: () => prepareManifest(),
    market: () => openMarket(),
  });

export const defaultDeps: ProgramDeps = {
  setup: (opts) => runExtensionSetup(opts, { ...setupDeps, ...editDeps }),
  status: (opts) => runStatus(opts),
  update: (opts) => runUpdate(opts),
  extensionInstall: (opts) =>
    runExtensionInstall(opts, {
      ...editDeps,
      manifest: () => prepareManifest(),
      market: openMarket(),
    }),
  extensionRemove: (opts) => runExtensionRemove(opts, { ...editDeps, io: terminalIo() }),
  extensionList: (opts) => runExtensionList(opts, openMarket()),
  extensionDoctor: (opts) => runExtensionDoctor(opts),
  extensionCreate: (opts) => runExtensionCreate(opts),
  extensionCheck: (opts) => runExtensionCheck(opts),
  extensionBuild: (opts) => runExtensionBuild(opts),
  extensionRelease: (opts) => runExtensionRelease(opts),
  extensionUp: (opts) => runExtensionUp(opts),
  extensionDown: (opts) => runExtensionDown(opts),
  extensionToken: (opts) => runExtensionToken(opts),
  daemon: {
    status: () => runDaemonStatus(),
    stop: () => runDaemonStop(),
    restart: () => runDaemonRestart(),
    run: () => runDaemon({ installer }),
  },
  kitTool: loadKitTool,
  updateHint,
  refreshUpdateCache: () => refreshUpdateCache(),
  writeOut: (text) => void process.stdout.write(text),
  writeErr: (text) => void process.stderr.write(text),
};
