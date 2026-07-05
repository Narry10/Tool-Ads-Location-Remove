import { useEffect, useMemo, useState } from 'react';
import {
  browserLocalPersistence,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signOut
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  updateDoc,
  writeBatch
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { auth, db, functions, googleProvider } from './firebase';

const DEFAULT_SETTINGS = {
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Ho_Chi_Minh',
  digestTime: '22:45',
  notificationsEnabled: true,
  notificationChannel: 'discord',
  webhookConfigured: false
};

const ACTION_LABELS = {
  pause: 'Pause', enable: 'Enable', remove: 'Remove', exclude: 'Exclude', other: 'Other', mixed: 'Mixed'
};

const safeDocumentPart = (value) => String(value || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 90);

async function migrateLegacyActions(uid, documents) {
  const legacy = documents.filter((item) => item.data().schemaVersion !== 2);
  if (!legacy.length) return false;
  const groups = Object.values(legacy.reduce((result, item) => {
    const data = item.data();
    const key = `${data.batchId || data.actionDate}|${data.campaignId || data.campaignName}`;
    if (!result[key]) result[key] = [];
    result[key].push(item);
    return result;
  }, {}));

  for (const group of groups) {
    const records = group.map((item) => ({ id: item.id, ...item.data() }));
    const first = records[0];
    const countries = records.filter((item) => item.entityType === 'location').map((item) => ({
      id: item.locationId || item.locationName,
      name: item.locationName,
      actionType: item.actionType,
      note: item.note || '',
      metrics: item.metrics || {}
    }));
    const actionTypes = [...new Set(records.map((item) => item.actionType).filter(Boolean))];
    const notes = [...new Set(records.map((item) => item.note?.trim()).filter(Boolean))];
    const targetId = `campaign_${safeDocumentPart(first.batchId || first.actionDate)}_${safeDocumentPart(first.campaignId || first.campaignName)}`;
    const targetRef = doc(db, 'users', uid, 'actions', targetId);
    const batch = writeBatch(db);
    batch.set(targetRef, {
      schemaVersion: 2,
      ownerId: first.ownerId,
      batchId: first.batchId,
      entityType: 'campaign',
      scopeType: countries.length ? 'locations' : 'campaign',
      actionType: actionTypes.length === 1 ? actionTypes[0] : 'mixed',
      actionTypes,
      note: notes.length === 1 ? notes[0] : '',
      campaignId: first.campaignId || null,
      campaignName: first.campaignName || 'Unknown',
      countries,
      countryNames: countries.map((country) => country.name),
      customerId: first.customerId || null,
      sourceUrl: first.sourceUrl || null,
      thresholds: first.thresholds || {},
      profileName: first.profileName || '',
      actionDate: first.actionDate,
      timezone: first.timezone,
      confirmedAt: first.confirmedAt,
      migratedAt: new Date().toISOString()
    });
    group.forEach((item) => { if (item.id !== targetId) batch.delete(item.ref); });
    await batch.commit();
  }
  return true;
}

function ExtensionAuth() {
  const [message, setMessage] = useState('Đăng nhập để kết nối extension với ADS-FOX Reminder.');
  const params = new URLSearchParams(window.location.search);
  const redirectUri = params.get('redirect_uri');

  const connect = async () => {
    let callback;
    try { callback = new URL(redirectUri); } catch { callback = null; }
    if (callback?.protocol !== 'https:' || !callback.hostname.endsWith('.chromiumapp.org') || callback.pathname !== '/firebase') {
      setMessage('Callback URL của extension không hợp lệ.');
      return;
    }
    try {
      setMessage('Đang đăng nhập…');
      const result = await signInWithPopup(auth, googleProvider);
      const idToken = await result.user.getIdToken(true);
      const token = result.user.refreshToken;
      if (!token) throw new Error('Không nhận được refresh token.');
      const payload = new URLSearchParams({
        idToken,
        refreshToken: token,
        uid: result.user.uid,
        email: result.user.email || '',
        displayName: result.user.displayName || '',
        expiresAt: String(Date.now() + 55 * 60 * 1000)
      });
      window.location.replace(`${redirectUri}#${payload.toString()}`);
    } catch (error) {
      setMessage(error.message || 'Không thể đăng nhập.');
    }
  };

  return <main className="auth-card">
    <div className="brand-mark">AF</div>
    <h1>Kết nối ADS-FOX</h1>
    <p>{message}</p>
    <button className="primary" onClick={connect}>Tiếp tục với Google</button>
  </main>;
}

function Dashboard({ user }) {
  const [actions, setActions] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [filters, setFilters] = useState({ date: '', type: '', search: '' });
  const [busy, setBusy] = useState(true);
  const [notice, setNotice] = useState('');
  const [activeTab, setActiveTab] = useState('reminders');
  const [webhookDraft, setWebhookDraft] = useState('');
  const [testingWebhook, setTestingWebhook] = useState(false);

  const load = async () => {
    setBusy(true);
    try {
      const actionQuery = query(
        collection(db, 'users', user.uid, 'actions'),
        orderBy('confirmedAt', 'desc'),
        limit(500)
      );
      let snapshot = await getDocs(actionQuery);
      if (await migrateLegacyActions(user.uid, snapshot.docs)) snapshot = await getDocs(actionQuery);
      setActions(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
      const profileRef = doc(db, 'users', user.uid);
      const profile = await getDoc(profileRef);
      if (profile.exists()) {
        const data = profile.data();
        setSettings({ ...DEFAULT_SETTINGS, ...data, webhookConfigured: Boolean(data.discordWebhookUrl) });
      }
      else await setDoc(profileRef, { ...DEFAULT_SETTINGS, email: user.email, createdAt: new Date().toISOString() });
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { load(); }, [user.uid]);

  const visibleActions = useMemo(() => actions.filter((action) => {
    if (filters.date && action.actionDate !== filters.date) return false;
    const scopeType = action.scopeType || (action.entityType === 'location' ? 'locations' : 'campaign');
    if (filters.type && scopeType !== filters.type) return false;
    const countryText = (action.countryNames || action.countries?.map((country) => country.name) || [action.locationName]).filter(Boolean).join(' ');
    const haystack = `${action.campaignName || ''} ${countryText} ${action.note || ''}`.toLowerCase();
    return haystack.includes(filters.search.toLowerCase());
  }), [actions, filters]);

  const saveSettings = async (event) => {
    event.preventDefault();
    await setDoc(doc(db, 'users', user.uid), {
      timezone: 'Asia/Ho_Chi_Minh',
      digestTime: '22:45',
      notificationsEnabled: settings.notificationsEnabled,
      notificationChannel: 'discord',
      email: user.email,
      updatedAt: new Date().toISOString()
    }, { merge: true });
    setNotice('Đã lưu cấu hình reminder.');
  };

  const saveWebhook = async (event) => {
    event.preventDefault();
    const value = webhookDraft.trim();
    if (!/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/[A-Za-z0-9._-]+$/.test(value)) {
      setNotice('Discord webhook URL không hợp lệ.');
      return;
    }
    await setDoc(doc(db, 'users', user.uid), {
      discordWebhookUrl: value,
      notificationChannel: 'discord',
      webhookUpdatedAt: new Date().toISOString()
    }, { merge: true });
    setSettings((current) => ({ ...current, discordWebhookUrl: value, webhookConfigured: true }));
    setWebhookDraft('');
    setNotice('Đã lưu Discord webhook riêng cho tài khoản này.');
  };

  const removeWebhook = async () => {
    if (!window.confirm('Xóa Discord webhook của tài khoản này?')) return;
    await updateDoc(doc(db, 'users', user.uid), {
      discordWebhookUrl: deleteField(), webhookUpdatedAt: new Date().toISOString()
    });
    setSettings((current) => ({ ...current, discordWebhookUrl: '', webhookConfigured: false }));
    setNotice('Đã xóa Discord webhook.');
  };

  const testWebhook = async () => {
    setTestingWebhook(true);
    try {
      const trigger = httpsCallable(functions, 'testDiscordWebhook');
      const result = await trigger();
      setNotice(`Discord test thành công: ${result.data.actionCount} campaign trong report hôm nay.`);
    } catch (error) {
      setNotice(error.message || 'Không thể gửi Discord test.');
    } finally {
      setTestingWebhook(false);
    }
  };

  const editAction = async (action) => {
    const isLocationAction = action.scopeType === 'locations' || action.entityType === 'location';
    const allowed = isLocationAction
      ? ['exclude', 'remove', 'other']
      : ['pause', 'enable', 'remove', 'other'];
    const actionType = window.prompt(`Action type (${allowed.join(', ')}):`, action.actionType)?.toLowerCase();
    if (!actionType) return;
    if (!allowed.includes(actionType)) {
      setNotice(`Action không hợp lệ. Chỉ chấp nhận: ${allowed.join(', ')}.`);
      return;
    }
    const note = window.prompt('Note:', action.note || '');
    if (note === null) return;
    const countries = (action.countries || []).map((country) => ({ ...country, actionType, note }));
    const update = { actionType, actionTypes: [actionType], note, countries, updatedAt: new Date().toISOString() };
    await updateDoc(doc(db, 'users', user.uid, 'actions', action.id), update);
    setActions((items) => items.map((item) => item.id === action.id ? { ...item, ...update } : item));
  };

  const removeAction = async (action) => {
    if (!window.confirm(`Xóa action “${action.campaignName}”?`)) return;
    await deleteDoc(doc(db, 'users', user.uid, 'actions', action.id));
    setActions((items) => items.filter((item) => item.id !== action.id));
  };

  return <div className="app-shell">
    <header>
      <div><span className="brand-mark small">AF</span><strong>ADS-FOX Reminder</strong></div>
      <div className="user"><span>{user.displayName || user.email}</span><button className="ghost" onClick={() => signOut(auth)}>Đăng xuất</button></div>
    </header>
    <main>
      <section className="hero">
        <div><p className="eyebrow">ACTION HISTORY</p><h1>Những việc bạn đã xử lý</h1><p>Theo dõi campaign và location từ Quick Tick, không còn phải nhớ bằng… trí nhớ.</p></div>
        <div className="stat"><b>{visibleActions.length}</b><span>actions hiển thị</span></div>
      </section>

      {notice && <div className="notice" onClick={() => setNotice('')}>{notice}</div>}

      <nav className="web-tabs" aria-label="Quản lý reminder">
        <button className={activeTab === 'reminders' ? 'active' : ''} onClick={() => setActiveTab('reminders')}>Nhắc nhở</button>
        <button className={activeTab === 'webhook' ? 'active' : ''} onClick={() => setActiveTab('webhook')}>Discord Webhook</button>
        <button className={activeTab === 'schedule' ? 'active' : ''} onClick={() => setActiveTab('schedule')}>Lịch chạy</button>
      </nav>

      {activeTab === 'reminders' && <section className="panel tab-content">
        <div className="toolbar">
          <h2>Lịch sử action</h2>
          <div className="filters">
            <input type="date" value={filters.date} onChange={(e) => setFilters({ ...filters, date: e.target.value })} />
            <select value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value })}><option value="">Tất cả</option><option value="campaign">CAM</option><option value="locations">Có quốc gia</option></select>
            <input placeholder="Tìm CAM, location, note…" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} />
          </div>
        </div>
        {busy ? <p className="empty">Đang tải…</p> : visibleActions.length === 0 ? <p className="empty">Chưa có action phù hợp.</p> :
          <div className="table-wrap"><table><thead><tr><th>Ngày</th><th>Campaign</th><th>Quốc gia</th><th>Action</th><th>Note</th><th></th></tr></thead>
          <tbody>{visibleActions.map((action) => <tr key={action.id}>
            <td>{action.actionDate}</td>
            <td><b>{action.campaignName}</b></td>
            <td>{(action.countryNames || action.countries?.map((country) => country.name) || [action.locationName]).filter(Boolean).join(', ') || '—'}</td>
            <td><b>{ACTION_LABELS[action.actionType] || action.actionType}</b></td>
            <td>{action.note || (action.countries || []).filter((country) => country.note).map((country) => `${country.name}: ${country.note}`).join('; ') || '—'}</td>
            <td className="row-actions"><button onClick={() => editAction(action)}>Sửa</button><button className="danger" onClick={() => removeAction(action)}>Xóa</button></td>
          </tr>)}</tbody></table></div>}
      </section>}

      {activeTab === 'webhook' && <section className="panel tab-content config-panel">
        <div className="config-copy">
          <p className="eyebrow">DELIVERY</p>
          <h2>Discord Webhook riêng</h2>
          <p>Mỗi Firebase UID có đúng một webhook. URL được che trên giao diện và chỉ Function dùng để gửi report của chính user đó.</p>
          <div className={`config-status ${settings.webhookConfigured ? 'ready' : ''}`}>
            <span></span>{settings.webhookConfigured ? 'Webhook đã được cấu hình' : 'Chưa có webhook'}
          </div>
        </div>
        <form className="config-form" onSubmit={saveWebhook}>
          <label>Webhook URL
            <input type="password" autoComplete="off" value={webhookDraft} onChange={(e) => setWebhookDraft(e.target.value)} placeholder={settings.webhookConfigured ? '•••••••••••••••• (nhập URL mới để thay)' : 'https://discord.com/api/webhooks/…'} />
          </label>
          <p className="field-help">Không dán webhook vào source code hoặc gửi công khai. Nếu URL đã lộ, hãy regenerate trong Discord.</p>
          <div className="config-actions">
            <button className="primary" type="submit">Lưu webhook</button>
            <button className="ghost" type="button" disabled={!settings.webhookConfigured || testingWebhook} onClick={testWebhook}>{testingWebhook ? 'Đang gửi…' : 'Gửi test ngay'}</button>
            {settings.webhookConfigured && <button className="danger-button" type="button" onClick={removeWebhook}>Xóa webhook</button>}
          </div>
        </form>
      </section>}

      {activeTab === 'schedule' && <section className="panel tab-content config-panel">
        <div className="config-copy">
          <p className="eyebrow">SCHEDULE</p>
          <h2>Thời gian gửi report</h2>
          <p>Firebase Function chạy lúc 22:45 mỗi ngày theo giờ Việt Nam, dù server được đặt tại Mỹ.</p>
        </div>
        <form className="config-form schedule-form" onSubmit={saveSettings}>
          <label>Timezone<input value="Asia/Ho_Chi_Minh" disabled /></label>
          <label>Giờ chạy<input type="time" value="22:45" disabled /></label>
          <label className="toggle"><input type="checkbox" checked={settings.notificationsEnabled} onChange={(e) => setSettings({ ...settings, notificationsEnabled: e.target.checked })} /> Bật gửi report tự động</label>
          <button className="primary">Lưu lịch chạy</button>
        </form>
      </section>}
    </main>
  </div>;
}

export default function App() {
  const [user, setUser] = useState(undefined);
  useEffect(() => {
    setPersistence(auth, browserLocalPersistence).catch(() => {});
    return onAuthStateChanged(auth, setUser);
  }, []);

  if (window.location.pathname === '/extension-auth') return <ExtensionAuth />;
  if (user === undefined) return <main className="auth-card"><p>Đang tải…</p></main>;
  if (!user) return <main className="auth-card"><div className="brand-mark">AF</div><h1>ADS-FOX Reminder</h1><p>Đăng nhập để quản lý action và reminder cá nhân.</p><button className="primary" onClick={() => signInWithPopup(auth, googleProvider)}>Đăng nhập với Google</button></main>;
  return <Dashboard user={user} />;
}
