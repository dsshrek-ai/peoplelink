// Shared dialogs: "Log contact" (journal entry) and "Message" (group email /
// text). Needs js/app.js. Each call builds its own <dialog>.

function makeDialog(labelledBy) {
  const dlg = document.createElement('dialog');
  dlg.setAttribute('aria-labelledby', labelledBy);
  document.body.appendChild(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  return dlg;
}

// ---- Log contact / edit a journal entry ----
// opts: { entry (to edit), onSaved() }
function openLogContact(person, opts) {
  opts = opts || {};
  const e = opts.entry || null;
  const dlg = makeDialog('lc-title');
  const pending = [];          // newly chosen photo files
  let photos = e ? e.Photos.slice() : [];

  function photoStrip() {
    return `${photos.map(ph => `<span class="jphoto"><img src="${escapeHtml(photoUrl(ph.Key, true))}" alt=""><button type="button" class="icon-btn" data-rm-photo="${ph.Id}" aria-label="Remove photo">✕</button></span>`).join('')}
      ${pending.map((f, i) => `<span class="jphoto pending"><span class="small">${escapeHtml(f.name)}</span><button type="button" class="icon-btn" data-rm-pending="${i}" aria-label="Remove photo">✕</button></span>`).join('')}`;
  }

  dlg.innerHTML = `<form class="dlg" novalidate>
    <h2 id="lc-title">${e ? 'Edit entry' : 'Log contact'} — ${escapeHtml(displayName(person))}</h2>
    <div class="row2">
      <div><label for="lc-date">Date</label><input type="date" id="lc-date" value="${escapeHtml(e ? e.Date : todayYmd())}" max="${addDaysYmd(todayYmd(), 1)}"></div>
      <div><label for="lc-kind">How</label><select id="lc-kind">${JOURNAL_KINDS.map(k => `<option value="${k.v}" ${(e ? e.Kind : 'call') === k.v ? 'selected' : ''}>${k.icon} ${k.label}</option>`).join('')}</select></div>
    </div>
    <label for="lc-body">What did you talk about?</label>
    <textarea id="lc-body" rows="4" placeholder="News, plans, things to remember…">${escapeHtml(e ? e.Body || '' : '')}</textarea>
    <label for="lc-follow">Follow up by <span class="muted">(optional)</span></label>
    <input type="date" id="lc-follow" value="${escapeHtml(e && e.FollowUpDate ? e.FollowUpDate : '')}">
    <label>Photos <span class="muted">(optional)</span></label>
    <div class="jphotos" id="lc-photos">${photoStrip()}</div>
    <label class="btn secondary small" style="margin-top:0.4rem">📷 Add photos<input type="file" id="lc-file" accept="image/*" multiple hidden></label>
    <p class="muted small" style="margin:0.5rem 0 0">Private to you — never shared or exported.</p>
    <div id="lc-err"></div>
    <div class="dlg-actions">
      ${e ? '<button type="button" class="btn danger" id="lc-del" style="margin-right:auto">Delete</button>' : ''}
      <button type="button" class="btn secondary" id="lc-cancel">Cancel</button>
      <button type="submit" class="btn" id="lc-save">Save</button>
    </div>
  </form>`;

  const strip = dlg.querySelector('#lc-photos');
  dlg.querySelector('#lc-file').addEventListener('change', ev => {
    pending.push(...ev.target.files);
    ev.target.value = '';
    strip.innerHTML = photoStrip();
  });
  strip.addEventListener('click', async ev => {
    const rp = ev.target.closest('[data-rm-pending]');
    if (rp) { pending.splice(Number(rp.dataset.rmPending), 1); strip.innerHTML = photoStrip(); return; }
    const rm = ev.target.closest('[data-rm-photo]');
    if (rm && confirm('Remove this photo?')) {
      try {
        await postAction('removeJournalPhoto', { id: Number(rm.dataset.rmPhoto) });
        photos = photos.filter(ph => ph.Id !== Number(rm.dataset.rmPhoto));
        strip.innerHTML = photoStrip();
        if (opts.onSaved) opts.onSaved();
      } catch (ex) {
        showStatus(errorText(ex, "Couldn't remove the photo."), true);
      }
    }
  });
  dlg.querySelector('#lc-cancel').addEventListener('click', () => dlg.close());
  const del = dlg.querySelector('#lc-del');
  if (del) del.addEventListener('click', async () => {
    if (!confirm('Delete this journal entry and its photos?')) return;
    try {
      await postAction('deleteJournalEntry', { id: e.Id });
      dlg.close();
      showStatus('Entry deleted.');
      if (opts.onSaved) opts.onSaved();
    } catch (ex) {
      showStatus(errorText(ex, "Couldn't delete it."), true);
    }
  });
  dlg.querySelector('form').addEventListener('submit', async ev => {
    ev.preventDefault();
    const btn = dlg.querySelector('#lc-save');
    const err = dlg.querySelector('#lc-err');
    err.innerHTML = '';
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      const res = await postAction('saveJournalEntry', {
        id: e ? e.Id : 0, personId: person.Id, today: todayYmd(),
        date: dlg.querySelector('#lc-date').value, kind: dlg.querySelector('#lc-kind').value,
        body: dlg.querySelector('#lc-body').value, followUpDate: dlg.querySelector('#lc-follow').value,
      });
      for (let i = 0; i < pending.length; i++) {
        btn.textContent = `Uploading photo ${i + 1} of ${pending.length}…`;
        try {
          await uploadJournalPhoto(res.Id, pending[i]);
        } catch (ex) {
          showStatus(`Saved, but ${pending[i].name} didn't upload: ${errorText(ex, ex.message)}`, true);
        }
      }
      dlg.close();
      showStatus(e ? 'Entry updated.' : `Logged contact with ${displayName(person)}.`);
      if (opts.onSaved) opts.onSaved();
    } catch (ex) {
      err.innerHTML = `<p class="err">${escapeHtml(errorText(ex, "Couldn't save."))}</p>`;
      btn.disabled = false;
      btn.textContent = 'Save';
    }
  });
  dlg.showModal();
}

// ---- Message a group (email or text from your own apps) ----
function openMessage(people, title) {
  const list = people.filter(p => p.Status === 'active');
  const dlg = makeDialog('msg-title');
  let mode = 'email';
  let bcc = true;
  const chosen = new Set(list.map(p => p.Id));

  function addressOf(p) {
    return mode === 'email' ? primaryEmail(p) : mobileNumber(p);
  }

  function render() {
    const reachable = list.filter(p => addressOf(p));
    const missing = list.length - reachable.length;
    const picked = reachable.filter(p => chosen.has(p.Id));
    const addrs = picked.map(addressOf);
    const batches = [];
    for (let i = 0; i < addrs.length; i += GROUP_TEXT_LIMIT) batches.push(addrs.slice(i, i + GROUP_TEXT_LIMIT));
    dlg.innerHTML = `<div class="dlg">
      <h2 id="msg-title">Message ${escapeHtml(title)}</h2>
      <div class="seg" role="group" aria-label="Email or text">
        <button type="button" data-mode="email" aria-pressed="${mode === 'email'}">✉️ Email</button>
        <button type="button" data-mode="text" aria-pressed="${mode === 'text'}">💬 Text</button>
      </div>
      ${mode === 'email' ? `
        <label class="inline"><input type="checkbox" id="m-bcc" ${bcc ? 'checked' : ''}> Use BCC (people won't see each other's addresses)</label>`
        : `<p class="muted small" style="margin:0.5rem 0">This opens a <strong>group text</strong> — everyone will see everyone's replies.</p>`}
      <div class="pick-list">${reachable.map(p => `
        <label><input type="checkbox" value="${p.Id}" ${chosen.has(p.Id) ? 'checked' : ''}> ${escapeHtml(displayName(p))} <span class="muted small">${escapeHtml(addressOf(p))}</span></label>`).join('')
        || `<p class="empty" style="padding:0.5rem">No one here has ${mode === 'email' ? 'an email address' : 'a phone number'}.</p>`}</div>
      ${missing ? `<p class="muted small">${missing} ${missing === 1 ? 'person has' : 'people have'} no ${mode === 'email' ? 'email address' : 'phone number'} and ${missing === 1 ? 'is' : 'are'} left out.</p>` : ''}
      ${mode === 'text' && batches.length > 1 ? `<p class="note small">That's ${addrs.length} people — more than most phones handle well in one group text. Send it in ${batches.length} batches below, or copy the numbers.</p>` : ''}
      <div class="dlg-actions">
        <button type="button" class="btn secondary" id="m-copy" ${addrs.length ? '' : 'disabled'}>📋 Copy ${mode === 'email' ? 'emails' : 'numbers'}</button>
        <button type="button" class="btn secondary" id="m-close">Close</button>
        ${mode === 'email'
          ? `<a class="btn${addrs.length ? '' : ' disabled'}" href="${addrs.length ? escapeHtml(groupMailUrl(addrs, bcc)) : '#'}">Open email (${addrs.length})</a>`
          : batches.map((b, i) => `<a class="btn" href="${escapeHtml(groupSmsUrl(b))}">${batches.length > 1 ? `Text batch ${i + 1} (${b.length})` : `Open Messages (${b.length})`}</a>`).join('')}
      </div>
    </div>`;
    dlg.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => { mode = b.dataset.mode; render(); }));
    const bc = dlg.querySelector('#m-bcc');
    if (bc) bc.addEventListener('change', () => { bcc = bc.checked; render(); });
    dlg.querySelectorAll('.pick-list input').forEach(i => i.addEventListener('change', () => {
      if (i.checked) chosen.add(Number(i.value)); else chosen.delete(Number(i.value));
      render();
    }));
    dlg.querySelector('#m-close').addEventListener('click', () => dlg.close());
    dlg.querySelector('#m-copy').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(addrs.join(mode === 'email' ? ', ' : ', '));
        showStatus(`Copied ${addrs.length} ${mode === 'email' ? 'email addresses' : 'numbers'}.`);
      } catch (ex) {
        prompt('Copy these:', addrs.join(', '));
      }
    });
  }
  render();
  dlg.showModal();
}
