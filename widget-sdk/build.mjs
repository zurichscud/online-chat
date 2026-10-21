import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { build, context } from 'esbuild';

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(packageDir, 'dist');
const publicWidget = path.join(packageDir, '..', 'public', 'widget.js');
const pkg = JSON.parse(await readFile(path.join(packageDir, 'package.json'), 'utf8'));

const banner = {
  js: [
    '/*!',
    ` * 拾光客服 · 可嵌入在线聊天组件 v${pkg.version}`,
    ' * 由 widget-sdk 构建生成，请勿直接修改 public/widget.js。',
    ' * 用法：<script src="https://your-host/widget.js" defer data-server="https://your-host"></script>',
    ' */',
  ].join('\n'),
};

const shared = {
  bundle: true,
  target: ['es2019'],
  charset: 'utf8',
  legalComments: 'inline',
  loader: { '.css': 'text' },
  banner,
  logLevel: 'info',
};

async function buildAll() {
  await mkdir(distDir, { recursive: true });

  await build({
    ...shared,
    entryPoints: [path.join(packageDir, 'src/index.ts')],
    format: 'iife',
    outfile: path.join(distDir, 'widget.js'),
  });

  await build({
    ...shared,
    entryPoints: [path.join(packageDir, 'src/index.ts')],
    format: 'iife',
    minify: true,
    outfile: path.join(distDir, 'widget.min.js'),
  });

  await build({
    ...shared,
    entryPoints: [path.join(packageDir, 'src/sdk.ts')],
    format: 'esm',
    outfile: path.join(distDir, 'widget.esm.js'),
  });

  await copyFile(path.join(distDir, 'widget.js'), publicWidget);
  console.log(`[widget-sdk] copied widget.js -> ${path.relative(packageDir, publicWidget)}`);
}

async function watch() {
  await mkdir(distDir, { recursive: true });
  const ctx = await context({
    ...shared,
    entryPoints: [path.join(packageDir, 'src/index.ts')],
    format: 'iife',
    outfile: path.join(distDir, 'widget.js'),
    plugins: [
      {
        name: 'copy-to-public',
        setup(build) {
          build.onEnd(async (result) => {
            if (result.errors.length > 0) return;
            await copyFile(path.join(distDir, 'widget.js'), publicWidget);
            console.log('[widget-sdk] rebuilt public/widget.js');
          });
        },
      },
    ],
  });
  await ctx.watch();
  console.log('[widget-sdk] watching src/, press Ctrl+C to stop');
}

if (process.argv.includes('--watch')) {
  await watch();
} else {
  await buildAll();
}
