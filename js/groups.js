// The create / edit group dialog, shared by groups.html and group.html.
// Needs a <dialog id="group-dlg"> on the page.

const GROUP_ICONS = ['', '👪', '🏠', '⛪', '🎵', '💼', '🎓', '⚽', '🍽️', '✈️', '❤️', '⭐'];

function openGroupDialog(group, onSaved) {
  const g = group || { Name: '', Description: '', Color: GROUP_COLORS[0], Icon: '' };
  const dlg = document.getElementById('group-dlg');
  dlg.innerHTML = `<form class="dlg" id="gform" novalidate>
    <h2>${group ? 'Edit group' : 'New group'}</h2>
    <label for="g-name">Name</label>
    <input type="text" id="g-name" maxlength="100" value="${escapeHtml(g.Name)}" placeholder="Family, Neighbors, Choir…" required>
    <label for="g-desc">Description <span class="muted">(optional)</span></label>
    <textarea id="g-desc" rows="2" style="min-height:3rem">${escapeHtml(g.Description || '')}</textarea>
    <label>Color</label>
    <div class="swatches">${GROUP_COLORS.map(c => `
      <label class="swatch"><input type="radio" name="g-color" value="${c}" ${c === (g.Color || GROUP_COLORS[0]) ? 'checked' : ''} aria-label="${c}"><span style="background:${c}"></span></label>`).join('')}</div>
    <label for="g-icon">Icon <span class="muted">(optional)</span></label>
    <select id="g-icon">${GROUP_ICONS.map(i => `<option value="${i}" ${i === (g.Icon || '') ? 'selected' : ''}>${i || 'None'}</option>`).join('')}</select>
    <div id="g-err"></div>
    <div class="dlg-actions">
      <button type="button" class="btn secondary" id="g-cancel">Cancel</button>
      <button type="submit" class="btn">Save</button>
    </div>
  </form>`;
  dlg.querySelector('#g-cancel').addEventListener('click', () => dlg.close());
  dlg.querySelector('#gform').addEventListener('submit', async e => {
    e.preventDefault();
    const name = dlg.querySelector('#g-name').value.trim();
    const err = dlg.querySelector('#g-err');
    if (!name) { err.innerHTML = '<p class="err">Give the group a name.</p>'; return; }
    try {
      const res = await postAction('saveGroup', {
        id: group ? group.Id : 0,
        name,
        description: dlg.querySelector('#g-desc').value,
        color: (dlg.querySelector('input[name="g-color"]:checked') || {}).value || '',
        icon: dlg.querySelector('#g-icon').value,
      });
      dlg.close();
      onSaved(res.Id);
    } catch (ex) {
      err.innerHTML = `<p class="err">${escapeHtml(errorText(ex, "Couldn't save the group."))}</p>`;
    }
  });
  dlg.showModal();
  dlg.querySelector('#g-name').focus();
}
