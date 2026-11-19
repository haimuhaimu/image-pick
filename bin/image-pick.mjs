#!/usr/bin/env node
import { resolve, dirname, join } from 'node:path';
import { realpath } from 'node:fs/promises';
import { loadAlbum } from '../src/manifest.mjs';
import { createAlbumServer } from '../src/server.mjs';
import { readFeedback } from '../src/review-store.mjs';
import { readHandoff } from '../src/handoff.mjs';
import { loadReviewContext } from '../src/review-context.mjs';

const usage = `ImagePick — local image selection and feedback (Node.js 22+)

Usage:
  image-pick validate path/to/album.json
  image-pick serve path/to/album.json [--port 4180] [--reviews path] [--context path]
  image-pick feedback path/to/album.json [--reviews path] [--since submission-id]
  image-pick handoff path/to/album.json --submission id --digest sha256 [--reviews path]
  image-pick --help

The server binds only to 127.0.0.1. Image files remain read-only.
Feedback receipts are independent snapshots; baseline is separate from local verdicts.
`;

async function main(args) {
  if (args.length === 1 && ['help', '--help'].includes(args[0])) { process.stdout.write(usage); return; }
  const [command, input, ...options] = args;
  if (!['validate', 'serve', 'feedback', 'handoff'].includes(command) || !input || input.startsWith('--')) throw new Error('Use --help for usage');
  const allowed = command === 'serve' ? ['--reviews', '--port', '--context'] : command === 'feedback' ? ['--reviews', '--since'] : command === 'handoff' ? ['--reviews', '--submission', '--digest'] : [];
  const parsed = new Map();
  for (let i = 0; i < options.length; i += 2) {
    const flag = options[i], value = options[i + 1];
    if (!allowed.includes(flag) || parsed.has(flag) || !value || value.startsWith('--')) throw new Error('Unknown, duplicate or incomplete option');
    parsed.set(flag, value);
  }
  const portText = parsed.get('--port') ?? '4180';
  if (command === 'handoff' && (!parsed.has('--submission') || !parsed.has('--digest'))) throw new Error('Handoff requires both --submission and --digest; never substitute the latest receipt');
  if (!/^\d{1,5}$/.test(portText) || Number(portText) > 65535) throw new Error('Port must be an integer from 0 to 65535');
  const manifestPath = await realpath(resolve(input));
  const { album, images } = await loadAlbum(manifestPath);
  const reviewsDirectory = resolve(parsed.get('--reviews') ?? join(dirname(manifestPath), '.image-pick', 'reviews'));
  if (command === 'validate') { process.stdout.write(`${JSON.stringify(album)}\n`); return; }
  if (command === 'feedback') {
    const feedback = await readFeedback(album, reviewsDirectory, parsed.get('--since') ?? null);
    process.stdout.write(`${JSON.stringify(feedback)}\n`); return;
  }
  if (command === 'handoff') {
    const handoff = await readHandoff(album, reviewsDirectory, parsed.get('--submission'), parsed.get('--digest'));
    process.stdout.write(`${JSON.stringify(handoff)}\n`); return;
  }
  // Fail startup on corrupt prior evidence rather than displaying an empty state.
  await readFeedback(album, reviewsDirectory);
  const reviewContext=parsed.has('--context') ? await loadReviewContext({contextPath:resolve(parsed.get('--context')),manifestPath,album,reviewsDirectory}) : null;
  const server = createAlbumServer({ album, images, reviewsDirectory, reviewContext });
  await new Promise((resolveListening, rejectListening) => {
    server.once('error', rejectListening); server.listen(Number(portText), '127.0.0.1', resolveListening);
  });
  process.stdout.write(`${JSON.stringify({ url: `http://127.0.0.1:${server.address().port}/`, albumId: album.id, manifestDigest: album.manifestDigest, reviewsDirectory })}\n`);
  const stop = () => { server.close(() => { process.exitCode = 0; }); server.closeIdleConnections(); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}

main(process.argv.slice(2)).catch(error => {
  const message = error.code ? `Operation failed (${error.code})` : error.message;
  process.stderr.write(`image-pick: ${String(message).replace(/[\r\n]/g, ' ')}\n`); process.exitCode = 1;
});
