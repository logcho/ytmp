import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeYouTubeUrl, conversionArgs, server } from '../server.mjs';

test('normalizes supported YouTube links and discards extra query parameters', () => {
  for (const url of ['https://youtu.be/jNQXAC9IVRw?t=1', 'https://www.youtube.com/watch?v=jNQXAC9IVRw&list=bad', 'https://youtube.com/shorts/jNQXAC9IVRw', 'https://m.youtube.com/embed/jNQXAC9IVRw']) assert.equal(normalizeYouTubeUrl(url), 'https://www.youtube.com/watch?v=jNQXAC9IVRw');
});
test('rejects arbitrary hosts, credentials, ports, playlists, and malformed IDs', () => {
  for (const url of ['https://example.com/watch?v=jNQXAC9IVRw','https://youtube.com.evil.test/watch?v=jNQXAC9IVRw','https://youtube.com@localhost/watch?v=jNQXAC9IVRw','file:///etc/passwd','https://youtube.com:8080/watch?v=jNQXAC9IVRw','https://youtube.com/playlist?list=123','https://youtu.be/123','not a URL']) assert.throws(() => normalizeYouTubeUrl(url));
});
test('constrains conversion settings and MP4 codecs', () => {
  assert.ok(conversionArgs('mp3', '320').includes('320K'));
  assert.ok(conversionArgs('mp4', '1080').some(arg => arg.includes('height<=1080') && arg.includes('avc1')));
  for (const [format, quality] of [['wav','320'],['mp3','999'],['mp4','320']]) assert.throws(() => conversionArgs(format, quality));
});
test('serves the app, rejects invalid jobs, and protects mutation origin', async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base)).status, 200);
  assert.equal((await fetch(`${base}/api/jobs/abc`)).status, 404);
  const invalid = await fetch(`${base}/api/convert`, { method: 'POST', body: JSON.stringify({ url: 'https://example.com', format: 'mp3', quality: '320' }) });
  assert.equal(invalid.status, 400);
  const crossOrigin = await fetch(`${base}/api/convert`, { method: 'POST', headers: { Origin: 'https://evil.example' }, body: '{}' });
  assert.equal(crossOrigin.status, 403);
  assert.equal((await fetch(`${base}/server.mjs`)).status, 404);
});
after(() => server.close());
