import log from 'loglevel';
import chalk from 'chalk';
import updateNotifier from 'update-notifier';
import packageJson from '../package.json';
import BuilderProvider from './builders/BuilderProvider';
import handleInputOptions from './options/index';
import { getCliProgram, logo } from './helpers/cli-program';
import { isBghitappError } from './utils/error';
import { BghitappCliOptions } from './types';

const program = getCliProgram();

const { green, yellow, gray } = chalk;

function printShortHelp() {
  console.log(logo);
  console.log(`Usage: bghitapp [url] [options]\n`);
  console.log(`Options:`);
  console.log(`  --name <string>           Application name`);
  console.log(`  --icon <string>           Application icon`);
  console.log(`  --width <number>          Window width (default: 1200)`);
  console.log(`  --height <number>         Window height (default: 780)`);
  console.log(`  --use-local-file          Use local file packaging`);
  console.log(`  --fullscreen              Start in full screen`);
  console.log(`  --hide-title-bar          For Mac, hide title bar`);
  console.log(`  --multi-arch              For Mac, both Intel and M1`);
  console.log(
    `  --inject <files>          Inject local CSS/JS files into the page`,
  );
  console.log(`  --debug                   Debug build and more output`);
  console.log(
    `  --targets <string>        Build target format for your system`,
  );
  console.log(
    `  --splash <path_or_url>    Splash screen image (local path or URL)`,
  );
  console.log(
    `  --auto-splash             Auto-fetch og:image from target URL for splash`,
  );
  console.log(`  --offline                 Enable offline fallback page`);
  console.log(`  -v, --version             output the version number`);
  console.log(`  -h, --help                display help for command`);
  console.log(
    `\nRun ${yellow('"bghitapp --help"')} to see all available options.\n`,
  );
}

async function checkUpdateTips() {
  updateNotifier({ pkg: packageJson, updateCheckInterval: 1000 * 60 }).notify({
    isGlobal: true,
  });
}

program.action(async (url: string, options: BghitappCliOptions) => {
  try {
    await checkUpdateTips();

    if (!url) {
      printShortHelp();
      return;
    }

    console.log(logo);
    log.setDefaultLevel('info');
    log.setLevel('info');
    if (options.debug) {
      log.setLevel('debug');
    }

    const appOptions = await handleInputOptions(options, url);

    const builder = BuilderProvider.create(appOptions);
    await builder.prepare();
    await builder.build(url);
  } catch (error) {
    if (isBghitappError(error)) {
      console.error(chalk.red(error.message));
    } else if (error instanceof Error) {
      console.error(chalk.red(`✕ ${error.message}`));
      if (options?.debug && error.stack) {
        console.error(chalk.gray(error.stack));
      }
    } else {
      console.error(chalk.red(`✕ Unexpected error: ${String(error)}`));
    }
    process.exit(1);
  }
});

program.parseAsync().catch((error: unknown) => {
  if (error instanceof Error) {
    console.error(chalk.red(`✕ ${error.message}`));
  } else {
    console.error(chalk.red(`✕ Unexpected error: ${String(error)}`));
  }
  process.exit(1);
});
