#!/usr/bin/env bun

import { Command } from 'commander';
import chalk from 'chalk';
import { createAddCommand } from './commands/add';
import { createGoCommand } from './commands/go';
import { createInitCommand } from './commands/init';
import { createListCommand } from './commands/list';
import { createPrCommand } from './commands/pr';
import { createPruneCommand } from './commands/prune';
import { createRemoveCommand } from './commands/remove';
import { createSelfUpdateCommand } from './commands/self-update';
import { createShellInitCommand } from './commands/shell-init';
import { createSyncCommand } from './commands/sync';
import { checkForUpdates } from './utils';

// Read version from package.json at build time
const packageJson = await import('../package.json');

const program = new Command();

program
  .name('grove')
  .description('Grove is a Git worktree management tool')
  .version(packageJson.version);

// Add all commands
program.addCommand(createAddCommand());
program.addCommand(createGoCommand());
program.addCommand(createInitCommand());
program.addCommand(createListCommand());
program.addCommand(createPrCommand());
program.addCommand(createPruneCommand());
program.addCommand(createRemoveCommand());
program.addCommand(createSelfUpdateCommand());
program.addCommand(createShellInitCommand());
program.addCommand(createSyncCommand());

// Handle unknown commands
program.on('command:*', () => {
  console.error(chalk.red('Invalid command:'), program.args.join(' '));
  console.log(chalk.yellow('See --help for a list of available commands.'));
  process.exit(1);
});

// Error handling
process.on('uncaughtException', (error) => {
  console.error(chalk.red('Uncaught Exception:'), error.message);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error(chalk.red('Unhandled Rejection at:'), promise, chalk.red('reason:'), reason);
  process.exit(1);
});

// Parse command line arguments
await program.parseAsync();

// If no command is provided, show help
if (!process.argv.slice(2).length) {
  program.outputHelp();
}

// Check for updates after command execution, but skip for certain commands/flags
const args = process.argv.slice(2);
const skipUpdateCheck =
  args.includes('--version') ||
  args.includes('-V') ||
  args.includes('--help') ||
  args.includes('-h') ||
  args.includes('self-update') ||
  args.includes('shell-init') ||
  args.length === 0;

if (!skipUpdateCheck) {
  await checkForUpdates(packageJson.version);
}