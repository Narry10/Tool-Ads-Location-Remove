const FIREBASE = globalThis.ADS_FOX_CONFIG?.firebase;
if (!FIREBASE?.apiKey || !FIREBASE?.projectId || !FIREBASE?.authPage) {
  throw new Error('Missing extension config. Run: npm run build:extension');
}

const STORAGE_KEYS = ['profiles', 'defaultProfileId', 'pendingActionDraft', 'firebaseSession'];
const ACTIONS = {
  campaign: [['pause', 'Pause'], ['enable', 'Enable'], ['remove', 'Remove'], ['other', 'Other']],
  location: [['exclude', 'Exclude'], ['remove', 'Remove'], ['other', 'Other']]
};

document.addEventListener('DOMContentLoaded', async () => {
  const $ = (id) => document.getElementById(id);
  const costInput = $('cost');
  const convValueInput = $('convValue');
  const profileSelect = $('profileSelect');
  const statusMsg = $('statusMsg');
  const resultsContainer = $('resultsContainer');
  const failedList = $('failedList');
  const draftContainer = $('draftContainer');
  const draftList = $('draftList');
  const batchAction = $('batchAction');
  const batchNote = $('batchNote');
  const draftBadge = $('draftBadge');
  const draftEmpty = $('draftEmpty');

  const defaultProfiles = [
    { id: '1', name: 'USD', cost: '1', convValue: '0.59' },
    { id: '2', name: 'VND', cost: '26000', convValue: '0.59' }
  ];
  let profiles = [];
  let defaultProfileId = '1';
  let currentProfileId = '1';
  let pendingDraft = null;
  let session = null;
  let statusTimer;

  const storage = {
    get: (keys) => new Promise((resolve) => chrome.storage.local.get(keys, resolve)),
    set: (value) => new Promise((resolve) => chrome.storage.local.set(value, resolve)),
    remove: (keys) => new Promise((resolve) => chrome.storage.local.remove(keys, resolve))
  };

  const parseInput = (value) => {
    if (typeof value !== 'string') return Number.parseFloat(value);
    let normalized = value.trim();
    const lastDot = normalized.lastIndexOf('.');
    const lastComma = normalized.lastIndexOf(',');
    if (lastComma > lastDot) {
      const lastPart = normalized.split(',').at(-1);
      normalized = lastPart.length === 3 ? normalized.replace(/,/g, '') : normalized.replace(/\./g, '').replace(',', '.');
    } else if (lastDot > lastComma) {
      const lastPart = normalized.split('.').at(-1);
      normalized = lastPart.length === 3 ? normalized.replace(/\./g, '') : normalized.replace(/,/g, '');
    }
    return Number.parseFloat(normalized);
  };

  const showStatus = (message, color = '#188038', sticky = false) => {
    clearTimeout(statusTimer);
    statusMsg.textContent = message;
    statusMsg.style.color = color;
    if (!sticky) statusTimer = setTimeout(() => { statusMsg.textContent = ''; }, 3500);
  };

  const saveProfiles = () => storage.set({ profiles, defaultProfileId });
  const renderProfiles = () => {
    profileSelect.textContent = '';
    profiles.forEach((profile) => {
      const option = document.createElement('option');
      option.value = profile.id;
      option.textContent = profile.name + (profile.id === defaultProfileId ? ' (Default)' : '');
      profileSelect.appendChild(option);
    });
    profileSelect.value = currentProfileId;
  };
  const loadProfile = (id) => {
    const profile = profiles.find((item) => item.id === id);
    if (profile) { costInput.value = profile.cost; convValueInput.value = profile.convValue; }
  };

  const actionOptions = (entityType, selected) => ACTIONS[entityType].map(([value, label]) =>
    `<option value="${value}"${value === selected ? ' selected' : ''}>${label}</option>`).join('');

  const switchTab = (tabId) => {
    document.querySelectorAll('.tab-btn').forEach((button) => button.classList.toggle('active', button.dataset.tab === tabId));
    document.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.toggle('active', panel.id === tabId));
  };

  const persistDraft = () => storage.set({ pendingActionDraft: pendingDraft });
  const renderDraft = () => {
    if (!pendingDraft?.items?.length) {
      draftContainer.classList.add('hidden');
      draftEmpty.classList.remove('hidden');
      draftBadge.classList.add('hidden');
      draftBadge.textContent = '0';
      return;
    }
    draftContainer.classList.remove('hidden');
    draftEmpty.classList.add('hidden');
    const campaignCount = new Set(pendingDraft.items.map((item) => item.campaignId || item.campaignName)).size;
    draftBadge.textContent = campaignCount;
    draftBadge.classList.remove('hidden');
    $('draftCount').textContent = pendingDraft.items.length;
    $('draftDate').textContent = new Date(pendingDraft.createdAt).toLocaleString();
    batchAction.innerHTML = '<option value="pause">Pause CAM</option><option value="enable">Enable CAM</option><option value="exclude">Exclude location</option><option value="remove">Remove</option><option value="other">Other</option>';
    draftList.textContent = '';
    pendingDraft.items.forEach((item, index) => {
      const row = document.createElement('tr');
      const name = document.createElement('td');
      name.textContent = item.entityType === 'location'
        ? `${item.locationName} (CAM: ${item.campaignName || 'Unknown'})`
        : item.campaignName;
      const actionCell = document.createElement('td');
      const select = document.createElement('select');
      select.innerHTML = actionOptions(item.entityType, item.actionType);
      select.addEventListener('change', () => { pendingDraft.items[index].actionType = select.value; persistDraft(); });
      actionCell.appendChild(select);
      const noteCell = document.createElement('td');
      const note = document.createElement('textarea');
      note.value = item.note || '';
      note.placeholder = 'Custom note';
      note.addEventListener('input', () => { pendingDraft.items[index].note = note.value; persistDraft(); });
      noteCell.appendChild(note);
      row.append(name, actionCell, noteCell);
      draftList.appendChild(row);
    });
  };

  const renderSession = () => {
    $('authLabel').textContent = session?.email || 'Chưa đăng nhập';
    $('authBtn').textContent = session ? 'Đăng xuất' : 'Đăng nhập';
    $('loginGate').classList.toggle('hidden', Boolean(session));
    $('toolContent').classList.toggle('hidden', !session);
  };

  const login = async () => {
    const redirectUri = chrome.identity.getRedirectURL('firebase');
    const url = `${FIREBASE.authPage}?redirect_uri=${encodeURIComponent(redirectUri)}`;
    const callbackUrl = await chrome.identity.launchWebAuthFlow({ url, interactive: true });
    if (!callbackUrl) throw new Error('Đăng nhập đã bị hủy.');
    const hash = new URL(callbackUrl).hash.slice(1);
    const data = new URLSearchParams(hash);
    if (!data.get('idToken') || !data.get('refreshToken')) throw new Error('Firebase không trả về token hợp lệ.');
    session = Object.fromEntries(data.entries());
    session.expiresAt = Number(session.expiresAt);
    await storage.set({ firebaseSession: session });
    renderSession();
    showStatus(`Đã đăng nhập: ${session.email}`);
  };

  const refreshSession = async () => {
    if (!session?.refreshToken) throw new Error('Bạn cần đăng nhập trước.');
    if (session.idToken && session.expiresAt > Date.now() + 60_000) return session.idToken;
    const response = await fetch(`https://securetoken.googleapis.com/v1/token?key=${FIREBASE.apiKey}`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: session.refreshToken })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'Phiên đăng nhập đã hết hạn.');
    session = { ...session, idToken: data.id_token, refreshToken: data.refresh_token, uid: data.user_id, expiresAt: Date.now() + Number(data.expires_in) * 1000 };
    await storage.set({ firebaseSession: session });
    return session.idToken;
  };

  const firestoreValue = (value) => {
    if (value === null || value === undefined) return { nullValue: null };
    if (typeof value === 'boolean') return { booleanValue: value };
    if (typeof value === 'number') return { doubleValue: value };
    if (Array.isArray(value)) return { arrayValue: { values: value.map(firestoreValue) } };
    if (typeof value === 'object') return { mapValue: { fields: firestoreFields(value) } };
    return { stringValue: String(value) };
  };
  const firestoreFields = (object) => Object.fromEntries(Object.entries(object).map(([key, value]) => [key, firestoreValue(value)]));
  const documentUrl = (path) => `https://firestore.googleapis.com/v1/projects/${FIREBASE.projectId}/databases/(default)/documents/${path}`;

  const ensureUser = async (token) => {
    const response = await fetch(documentUrl(`users/${session.uid}`), { headers: { Authorization: `Bearer ${token}` } });
    if (response.ok) return;
    if (response.status !== 404) throw new Error('Không thể kiểm tra Firebase user profile.');
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Ho_Chi_Minh';
    const create = await fetch(documentUrl(`users/${session.uid}`), {
      method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: firestoreFields({ email: session.email, timezone, digestTime: '22:45', notificationsEnabled: true, notificationChannel: 'discord', createdAt: new Date().toISOString() }) })
    });
    if (!create.ok) throw new Error('Không thể tạo Firebase user profile.');
  };

  const stableHash = (text) => {
    let hash = 2166136261;
    for (const char of text) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
    return (hash >>> 0).toString(36);
  };

  const localDateIso = (date = new Date()) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en', {
      year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  };

  const saveDraft = async () => {
    if (!pendingDraft?.items?.length) return;
    if (!session) { showStatus('Hãy đăng nhập trước khi lưu.', '#d93025', true); await login(); }
    const token = await refreshSession();
    await ensureUser(token);
    const confirmedAt = new Date().toISOString();
    const actionDate = localDateIso();
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Ho_Chi_Minh';

    const campaignGroups = Object.values(pendingDraft.items.reduce((groups, item) => {
      const key = item.campaignId || item.campaignName;
      if (!groups[key]) groups[key] = { campaignId: item.campaignId, campaignName: item.campaignName, items: [] };
      groups[key].items.push(item);
      return groups;
    }, {}));

    for (const group of campaignGroups) {
      const actionId = `${pendingDraft.batchId}_${stableHash(group.campaignId || group.campaignName)}`;
      const countries = [...new Map(group.items
        .filter((item) => item.entityType === 'location')
        .map((item) => [item.locationId || item.locationName, {
          id: item.locationId,
          name: item.locationName,
          actionType: item.actionType,
          note: item.note || '',
          metrics: item.metrics
        }])).values()];
      const actionTypes = [...new Set(group.items.map((item) => item.actionType))];
      const notes = [...new Set(group.items.map((item) => item.note?.trim()).filter(Boolean))];
      const payload = {
        schemaVersion: 2,
        ownerId: session.uid, batchId: pendingDraft.batchId,
        entityType: 'campaign',
        scopeType: countries.length ? 'locations' : 'campaign',
        actionType: actionTypes.length === 1 ? actionTypes[0] : 'mixed',
        actionTypes,
        note: notes.length === 1 ? notes[0] : '',
        campaignId: group.campaignId || null,
        campaignName: group.campaignName || 'Unknown',
        countries,
        countryNames: countries.map((country) => country.name),
        customerId: pendingDraft.customerId || null, sourceUrl: pendingDraft.sourceUrl,
        thresholds: pendingDraft.thresholds,
        profileName: pendingDraft.profileName, actionDate, timezone, confirmedAt
      };
      const response = await fetch(documentUrl(`users/${session.uid}/actions/${actionId}`), {
        method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: firestoreFields(payload) })
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error?.message || `Không thể lưu ${group.campaignName}.`);
      }
    }
    await storage.remove('pendingActionDraft');
    pendingDraft = null;
    renderDraft();
    showStatus('Đã lưu action vào Firebase!', '#188038', true);
  };

  const executeAction = async (doTick) => {
    if (!session) return showStatus('Bạn cần đăng nhập Firebase trước.', '#d93025', true);
    const costThreshold = parseInput(costInput.value);
    const convValueThreshold = parseInput(convValueInput.value);
    if (!Number.isFinite(costThreshold) || !Number.isFinite(convValueThreshold)) return showStatus('Threshold không hợp lệ.', '#d93025');
    showStatus('Analyzing data…', '#1a73e8', true);
    resultsContainer.classList.add('hidden'); failedList.textContent = '';
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url?.startsWith('https://ads.google.com/')) return showStatus('Hãy mở trang Google Ads trước.', '#d93025', true);

    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    await new Promise((resolve) => setTimeout(resolve, 120));
    chrome.tabs.sendMessage(tab.id, { action: 'highlight', costThreshold, convValueThreshold, doTick }, async (response) => {
      if (chrome.runtime.lastError || !response || response.status !== 'success') return showStatus('Không tìm thấy bảng dữ liệu. Hãy reload Google Ads.', '#d93025', true);
      const items = response.items || [];
      if (!items.length) return showStatus('Great! No targets missed.', '#188038', true);
      items.forEach((item) => {
        const row = document.createElement('tr');
        [item.displayName, item.metrics.costText || '-', item.metrics.convText || '-', item.metrics.allConvText || '-'].forEach((text) => { const cell = document.createElement('td'); cell.textContent = text; row.appendChild(cell); });
        failedList.appendChild(row);
      });
      resultsContainer.classList.remove('hidden');
      showStatus(`Found ${items.length} targets.${doTick ? ' Auto-ticked.' : ''}`, '#188038', true);
      if (doTick) {
        const profile = profiles.find((item) => item.id === currentProfileId);
        pendingDraft = {
          batchId: crypto.randomUUID(), createdAt: new Date().toISOString(), sourceUrl: tab.url,
          customerId: response.context.customerId, profileName: profile?.name || '',
          thresholds: { cost: costThreshold, convValue: convValueThreshold },
          items: items.map((item) => ({ ...item, actionType: item.entityType === 'location' ? 'exclude' : 'pause', note: '' }))
        };
        await persistDraft(); renderDraft(); switchTab('draftTab');
      }
    });
  };

  const stored = await storage.get(STORAGE_KEYS);
  profiles = stored.profiles || defaultProfiles;
  defaultProfileId = stored.defaultProfileId || profiles[0].id;
  if (!profiles.some((profile) => profile.id === defaultProfileId)) defaultProfileId = profiles[0].id;
  currentProfileId = defaultProfileId;
  pendingDraft = stored.pendingActionDraft || null;
  session = stored.firebaseSession || null;
  if (session) {
    try {
      await refreshSession();
    } catch {
      session = null;
      await storage.remove('firebaseSession');
    }
  }
  renderProfiles(); loadProfile(currentProfileId); renderDraft(); renderSession();
  switchTab(pendingDraft?.items?.length ? 'draftTab' : 'quickTab');

  document.querySelectorAll('.tab-btn').forEach((button) => button.addEventListener('click', () => switchTab(button.dataset.tab)));
  profileSelect.addEventListener('change', (event) => { currentProfileId = event.target.value; loadProfile(currentProfileId); });
  $('newProfileBtn').addEventListener('click', async () => { const name = prompt('Enter new profile name:'); if (!name?.trim()) return; const id = Date.now().toString(); profiles.push({ id, name: name.trim(), cost: costInput.value, convValue: convValueInput.value }); currentProfileId = id; await saveProfiles(); renderProfiles(); showStatus('Profile created!'); });
  $('delProfileBtn').addEventListener('click', async () => { if (profiles.length <= 1) return alert('Cannot delete the last profile.'); if (!confirm('Delete this profile?')) return; profiles = profiles.filter((profile) => profile.id !== currentProfileId); if (defaultProfileId === currentProfileId) defaultProfileId = profiles[0].id; currentProfileId = profiles[0].id; await saveProfiles(); renderProfiles(); loadProfile(currentProfileId); });
  $('setDefaultBtn').addEventListener('click', async () => { defaultProfileId = currentProfileId; await saveProfiles(); renderProfiles(); showStatus('Set as default profile!'); });
  $('saveBtn').addEventListener('click', async () => { const profile = profiles.find((item) => item.id === currentProfileId); if (profile) { profile.cost = costInput.value; profile.convValue = convValueInput.value; await saveProfiles(); showStatus('Profile config saved!'); } });
  $('highlightBtn').addEventListener('click', () => executeAction(false));
  $('tickBtn').addEventListener('click', () => executeAction(true));
  $('addManualBtn').addEventListener('click', async () => {
    const campaignName = $('manualCampaign').value.trim();
    const countries = [...new Set($('manualCountries').value
      .split(/[,;\n]+/)
      .map((country) => country.trim())
      .filter(Boolean))];
    let actionType = $('manualAction').value;
    const note = $('manualNote').value.trim();
    if (!campaignName) return showStatus('Hãy nhập tên Campaign.', '#d93025', true);
    const entityType = countries.length ? 'location' : 'campaign';
    if (!ACTIONS[entityType].some(([value]) => value === actionType)) actionType = 'other';
    const campaignId = `manual-${stableHash(campaignName.toLowerCase())}`;
    const newItems = countries.length
      ? countries.map((country) => ({
          entityType: 'location', displayName: country,
          campaignId, campaignName,
          locationId: `manual-${stableHash(country.toLowerCase())}`,
          locationName: country,
          metrics: {}, actionType, note
        }))
      : [{
          entityType: 'campaign', displayName: campaignName,
          campaignId, campaignName,
          locationId: null, locationName: null,
          metrics: {}, actionType, note
        }];
    if (!pendingDraft) {
      const profile = profiles.find((item) => item.id === currentProfileId);
      pendingDraft = {
        batchId: crypto.randomUUID(), createdAt: new Date().toISOString(),
        sourceUrl: 'manual', customerId: null,
        profileName: profile?.name || 'Manual',
        thresholds: {}, items: []
      };
    }
    pendingDraft.items.push(...newItems);
    await persistDraft();
    renderDraft();
    switchTab('draftTab');
    $('manualCampaign').value = '';
    $('manualCountries').value = '';
    $('manualNote').value = '';
    showStatus(`Đã thêm ${campaignName} vào draft.`);
  });
  const handleAuth = async () => {
    try {
      if (session) {
        session = null;
        await storage.remove('firebaseSession');
        renderSession();
      } else {
        await login();
      }
    } catch (error) {
      showStatus(error.message, '#d93025', true);
    }
  };
  $('authBtn').addEventListener('click', handleAuth);
  $('gateLoginBtn').addEventListener('click', handleAuth);
  $('applyBatchBtn').addEventListener('click', async () => { if (!pendingDraft) return; pendingDraft.items.forEach((item) => { const valid = ACTIONS[item.entityType].some(([value]) => value === batchAction.value); item.actionType = valid ? batchAction.value : (item.entityType === 'location' ? 'exclude' : 'pause'); item.note = batchNote.value; }); await persistDraft(); renderDraft(); });
  $('discardDraftBtn').addEventListener('click', async () => { if (!confirm('Bỏ toàn bộ draft hiện tại?')) return; pendingDraft = null; await storage.remove('pendingActionDraft'); renderDraft(); });
  $('confirmDraftBtn').addEventListener('click', async () => { try { $('confirmDraftBtn').disabled = true; showStatus('Đang lưu Firebase…', '#1a73e8', true); await saveDraft(); switchTab('quickTab'); } catch (error) { showStatus(error.message, '#d93025', true); } finally { $('confirmDraftBtn').disabled = false; } });
});
