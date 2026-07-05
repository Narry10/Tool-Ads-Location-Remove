const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions');
const { digestWindow } = require('./time');
const { DiscordWebhookAdapter } = require('./notifications');
const config = require('./config');

initializeApp();
const db = getFirestore();
const notifier = new DiscordWebhookAdapter();

function actionFromDocument(actionDoc) {
  const action = actionDoc.data();
  return {
    actionId: actionDoc.id,
    entityType: action.entityType,
    scopeType: action.scopeType || (action.entityType === 'location' ? 'locations' : 'campaign'),
    actionType: action.actionType,
    campaignId: action.campaignId || null,
    campaignName: action.campaignName || null,
    countries: action.countries || (action.locationName ? [{
      id: action.locationId || action.locationName,
      name: action.locationName,
      actionType: action.actionType,
      note: action.note || ''
    }] : []),
    note: action.note || ''
  };
}

async function getDailyActions(userRef, localDate) {
  const snapshot = await userRef.collection('actions').where('actionDate', '==', localDate).get();
  return snapshot.docs.map(actionFromDocument);
}

exports.createDailyDigests = onSchedule({
  schedule: config.digestCron,
  region: config.region,
  timeZone: config.digestTimezone,
  retryCount: 1,
  memory: '256MiB'
}, async () => {
  const now = new Date();
  const users = await db.collection('users').where('notificationsEnabled', '==', true).get();

  for (const userDoc of users.docs) {
    const user = userDoc.data();
    const timezone = config.digestTimezone;
    const digestTime = config.digestTime;
    const { localDate } = digestWindow(now, timezone, digestTime, 24 * 60);
    if (!localDate) continue;

    const digestRef = userDoc.ref.collection('digests').doc(localDate);
    if ((await digestRef.get()).exists) continue;

    const actions = await getDailyActions(userDoc.ref, localDate);
    if (!actions.length || !user.discordWebhookUrl) continue;

    let delivery;
    try {
      delivery = await notifier.send({ uid: userDoc.id, ...user }, { localDate, actions });
    } catch (error) {
      logger.error('Discord digest delivery failed', { uid: userDoc.id, error: error.message });
      delivery = { status: 'failed', deliveryRef: null, error: error.message.slice(0, 300) };
    }
    await digestRef.create({
      ownerId: userDoc.id,
      localDate,
      timezone,
      digestTime,
      status: delivery.status,
      deliveryRef: delivery.deliveryRef,
      error: delivery.error || null,
      actionCount: actions.length,
      actions,
      createdAt: FieldValue.serverTimestamp()
    }).catch((error) => {
      if (error.code !== 6 && error.code !== 'already-exists') throw error;
    });
  }
  logger.info('Daily digest scan completed', { usersScanned: users.size });
});

exports.testDiscordWebhook = onCall({ region: config.region, cors: true }, async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Bạn cần đăng nhập trước.');
  const userRef = db.collection('users').doc(request.auth.uid);
  const userDoc = await userRef.get();
  if (!userDoc.exists) throw new HttpsError('not-found', 'Không tìm thấy cấu hình user.');
  const user = userDoc.data();
  if (!user.discordWebhookUrl) throw new HttpsError('failed-precondition', 'Bạn chưa lưu Discord webhook.');
  const timezone = user.timezone || 'Asia/Ho_Chi_Minh';
  const { localDate } = digestWindow(new Date(), timezone, user.digestTime || '23:00', 24 * 60);
  const actions = await getDailyActions(userRef, localDate);
  try {
    const delivery = await notifier.send({ uid: userDoc.id, ...user }, { localDate, actions }, { isTest: true });
    return { ok: true, actionCount: actions.length, deliveryRef: delivery.deliveryRef };
  } catch (error) {
    logger.error('Discord webhook test failed', { uid: request.auth.uid, error: error.message });
    throw new HttpsError('internal', 'Discord từ chối webhook. Hãy kiểm tra URL hoặc tạo webhook mới.');
  }
});
