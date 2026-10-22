const $ = selector => document.querySelector(selector);
let format = 'mp3', busy = false;
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => $('#toast').hidden = true, 4000); }
$('.format-options').addEventListener('click', event => {
  const button = event.target.closest('[data-format]'); if (!button || busy) return;
  format = button.dataset.format;
  document.querySelectorAll('[data-format]').forEach(el => { const selected = el.dataset.format === format; el.classList.toggle('selected', selected); el.setAttribute('aria-pressed', selected); });
  $('#quality').innerHTML = format === 'mp3' ? '<option value="320">320 kbps</option><option value="192">192 kbps</option><option value="128">128 kbps</option>' : '<option value="1080">1080p</option><option value="720">720p</option><option value="360">360p</option>';
  $('#convert-button span').textContent = `Convert to ${format.toUpperCase()}`;
});
$('#paste').addEventListener('click', async () => {
  if (window.webkit?.messageHandlers?.pasteLink) {
    window.webkit.messageHandlers.pasteLink.postMessage(null);
    return;
  }
  try { $('#video-url').value = await navigator.clipboard.readText(); $('#video-url').focus(); }
  catch { toast('Use ⌘V or Ctrl+V to paste your link.'); $('#video-url').focus(); }
});
async function request(url, options) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(15000) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
  return data;
}
function setBusy(value) { busy = value; $('#convert-button').disabled = value; $('#quality').disabled = value; document.querySelectorAll('[data-format]').forEach(el => el.disabled = value); $('#convert-button span').textContent = value ? 'Working on your download…' : `Convert to ${format.toUpperCase()}`; }
function showProgress(job) {
  const labels = { queued: 'Getting things ready…', analyzing: 'Finding your video…', downloading: 'Downloading your video…', converting: 'Converting…', complete: 'Ready to download.' };
  $('#result').innerHTML = `<div class="result-title"><span>${escape(labels[job.status] || 'Working…')}</span><span>${Math.round(job.progress || 0)}%</span></div><div class="progress" role="progressbar" aria-label="Conversion progress" aria-valuenow="${Math.round(job.progress || 0)}" aria-valuemin="0" aria-valuemax="100"><div style="width:${job.progress || 0}%"></div></div><p>${escape(job.title || 'Checking availability. This can take a moment.')}</p>`;
}
$('#convert-form').addEventListener('submit', async event => {
  event.preventDefault(); if (busy) return;
  const result = $('#result'); result.hidden = false;
  setBusy(true); showProgress({ status: 'queued', progress: 0 });
  let activeId;
  try {
    const data = await request('/api/convert', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: $('#video-url').value.trim(), format, quality: $('#quality').value }) });
    activeId = data.id;
    let failures = 0;
    for (;;) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      let job;
      try { job = await request(`/api/jobs/${activeId}`); failures = 0; }
      catch (error) { if (++failures < 5) continue; throw error; }
      if (job.status === 'error') throw new Error(job.error);
      showProgress(job);
      if (job.status === 'complete') {
        result.insertAdjacentHTML('beforeend', `<a class="download-link" href="/api/jobs/${activeId}/download" download>Download ${format.toUpperCase()} <span>↓</span></a><p>Your file is available for one hour.</p>`);
        break;
      }
    }
  } catch (error) {
    result.innerHTML = `<div class="result-title">Conversion failed.</div><p class="error">${escape(error.name === 'TimeoutError' ? 'The server took too long to respond. Please try again.' : error.message)}</p>`;
  } finally { setBusy(false); }
});
