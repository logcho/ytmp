import http from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, createReadStream } from 'node:fs';
import { mkdir, readdir, stat, rm } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const root = dirname(fileURLToPath(import.meta.url));
const downloads = process.env.DOWNLOADS_DIR || join(root, '.downloads');
const executable = process.env.YT_DLP_PATH || (existsSync(join(root, '.venv/bin/yt-dlp')) ? join(root, '.venv/bin/yt-dlp') : 'yt-dlp');
const jobs = new Map();
const children = new Set();
const common = ['--ignore-config', '--no-playlist', '--no-warnings', '--js-runtimes', 'node', '--socket-timeout', '25', '--retries', '2'];

export function normalizeYouTubeUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Paste a valid YouTube video link.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) throw new Error('Paste a valid YouTube video link.');
  const host = url.hostname.toLowerCase();
  let id;
  if (host === 'youtu.be') id = url.pathname.slice(1).split('/')[0];
  else if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(host)) {
    id = url.pathname === '/watch' ? url.searchParams.get('v') : /^\/(?:shorts|embed|live)\/([^/]+)/.exec(url.pathname)?.[1];
  }
  if (!id || !/^[\w-]{11}$/.test(id)) throw new Error('Use a YouTube video, Shorts, or youtu.be link.');
  return `https://www.youtube.com/watch?v=${id}`;
}

export function conversionArgs(format, quality) {
  if (format === 'mp3' && ['128', '192', '320'].includes(quality)) return ['-f', 'bestaudio/best', '-x', '--audio-format', 'mp3', '--audio-quality', `${quality}K`];
  if (format === 'mp4' && ['360', '720', '1080'].includes(quality)) return ['-f', `bv*[height<=${quality}][ext=mp4][vcodec^=avc1]+ba[ext=m4a]/b[height<=${quality}][ext=mp4]`, '--merge-output-format', 'mp4', '--remux-video', 'mp4'];
  throw new Error('Choose a supported format and quality.');
}

function run(args, onLine, timeout = 120000) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [...common, ...args], { cwd: root, env: process.env, detached: process.platform !== 'win32' });
    children.add(child);
    const stopChild = () => {
      try { process.platform === 'win32' ? child.kill('SIGKILL') : process.kill(-child.pid, 'SIGKILL'); } catch {}
    };
    let output = '', errors = '', pending = '';
    const timer = setTimeout(() => { stopChild(); reject(new Error('Conversion timed out. Try a shorter video.')); }, timeout);
    child.stdout.on('data', data => {
      if (onLine) { pending += data.toString(); const lines = pending.split(/\r?\n/); pending = lines.pop(); lines.forEach(onLine); }
      else { output += data; if (output.length > 4e6) stopChild(); }
    });
    child.stderr.on('data', data => { errors = (errors + data).slice(-6000); });
    child.on('error', error => { clearTimeout(timer); reject(new Error(error.code === 'ENOENT' ? 'yt-dlp is not installed. Follow the setup instructions in README.md.' : error.message)); });
    child.on('close', code => {
      children.delete(child);
      clearTimeout(timer);
      if (code === 0) resolve(output);
      else reject(new Error(errors.includes('Sign in') || errors.includes('bot') ? 'YouTube requires sign-in for this video. Try another publicly available video.' : errors.includes('ffmpeg') ? 'FFmpeg is required for conversion. Install it and restart the server.' : errors.includes('Private video') ? 'This video is private.' : errors.includes('unavailable') ? 'This video is unavailable.' : 'Could not process this video. It may be restricted, or YouTube may be blocking requests.'));
    });
  });
}

async function convert(job) {
  const directory = join(downloads, job.id);
  try {
    job.status = 'analyzing';
    const info = JSON.parse(await run(['--dump-single-json', '--skip-download', '--', job.url]));
    if (info.is_live || !info.duration || info.duration > 7200) throw new Error('Choose a finished video under two hours long.');
    job.title = info.title || 'YouTube video';
    job.duration = info.duration;
    job.thumbnail = `https://i.ytimg.com/vi/${info.id}/hqdefault.jpg`;
    await mkdir(directory, { recursive: true });
    job.status = 'downloading';
    await run([...conversionArgs(job.format, job.quality), '--max-filesize', '500M', '--newline', '--progress-template', 'download:PROGRESS:%(progress._percent_str)s', '-o', join(directory, 'media.%(ext)s'), '--', job.url], line => {
      const match = /PROGRESS:\s*([\d.]+)%/.exec(line);
      if (match) job.progress = Math.min(95, Number(match[1]) * .95);
      if (line.includes('[ExtractAudio]') || line.includes('[Merger]') || line.includes('[VideoRemuxer]')) { job.status = 'converting'; job.progress = 97; }
    }, 20 * 60 * 1000);
    const expected = `media.${job.format}`;
    if (!(await readdir(directory)).includes(expected)) throw new Error('The video could not be converted to the selected format.');
    job.file = join(directory, expected);
    job.size = (await stat(job.file)).size;
    job.status = 'complete'; job.progress = 100;
  } catch (error) { job.status = 'error'; job.error = error.message; await rm(directory, { recursive: true, force: true }); }
  job.finished = Date.now();
}

function json(res, status, data) { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); }
async function body(req) {
  let text = '';
  for await (const chunk of req) { text += chunk; if (text.length > 8192) throw new Error('Request too large.'); }
  try { return JSON.parse(text); } catch { throw new Error('Invalid request.'); }
}

export const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/api/health') {
      return json(res, 200, { status: 'ok', downloader: existsSync(executable) ? 'installed' : 'check-path' });
    }
    if (req.method === 'POST' && url.pathname === '/api/convert') {
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return json(res, 403, { error: 'Request origin is not allowed.' });
      const input = await body(req);
      const videoUrl = normalizeYouTubeUrl(input.url);
      conversionArgs(input.format, String(input.quality));
      if ([...jobs.values()].filter(j => !['complete', 'error'].includes(j.status)).length >= 2) return json(res, 429, { error: 'Two conversions are already running. Please try again shortly.' });
      const job = { id: randomUUID(), url: videoUrl, format: input.format, quality: String(input.quality), status: 'queued', progress: 0, created: Date.now() };
      jobs.set(job.id, job); void convert(job);
      return json(res, 202, { id: job.id });
    }
    const match = /^\/api\/jobs\/([a-f0-9-]+)(\/download)?$/.exec(url.pathname);
    if (req.method === 'GET' && match) {
      const job = jobs.get(match[1]);
      if (!job) return json(res, 404, { error: 'This download has expired. Convert the link again.' });
      if (match[2]) {
        if (job.status !== 'complete') return json(res, 409, { error: 'Your file is not ready yet.' });
        const filename = `${job.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').slice(0, 140) || 'video'}.${job.format}`;
        res.writeHead(200, { 'Content-Type': job.format === 'mp3' ? 'audio/mpeg' : 'video/mp4', 'Content-Length': job.size, 'Content-Disposition': `attachment; filename="download.${job.format}"; filename*=UTF-8''${encodeURIComponent(filename).replace(/['()]/g, c => '%' + c.charCodeAt(0).toString(16))}` });
        const stream = createReadStream(job.file); stream.on('error', () => res.destroy()); stream.pipe(res); return;
      }
      const { file, ...data } = job; return json(res, 200, data);
    }
    if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed.' });
    const files = { '/': ['index.html', 'text/html'], '/styles.css': ['styles.css', 'text/css'], '/app.js': ['app.js', 'text/javascript'] };
    const file = files[url.pathname];
    if (!file) return json(res, 404, { error: 'Not found.' });
    res.writeHead(200, { 'Content-Type': `${file[1]}; charset=utf-8` });
    createReadStream(join(root, 'public', file[0])).pipe(res);
  } catch (error) { if (!res.headersSent) json(res, 400, { error: error.message }); else res.destroy(); }
});

const cleanup = setInterval(async () => {
  for (const [id, job] of jobs) if (job.finished && Date.now() - job.finished > 3600000) { jobs.delete(id); await rm(join(downloads, id), { recursive: true, force: true }); }
}, 60000); cleanup.unref();

export function stopConversions() {
  clearInterval(cleanup);
  for (const child of children) {
    try { process.platform === 'win32' ? child.kill('SIGKILL') : process.kill(-child.pid, 'SIGKILL'); } catch {}
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  server.listen(Number(process.env.PORT || 3000), '127.0.0.1', () => console.log(`Offbeat is ready at http://localhost:${server.address().port}`));
}
