
const admin = require('firebase-admin');

// Firebase初期化
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL,
});
const db = admin.database();

// nihonbashi 3物件のiCal URL
const PROPERTIES = [
  {
    prop: 'ohana',
    hi: 0,
    airbnb: 'https://www.airbnb.jp/calendar/ical/1573706910935710002.ics?t=180f2e0d3cb5401e95085715f0071006',
  },
  {
    prop: 'yahiro',
    hi: 1,
    airbnb: 'https://www.airbnb.jp/calendar/ical/1569400351992603857.ics?t=312664c3e3454bc194ac9bd40d20da64',
  },
  {
    prop: 'nikko',
    hi: 2,
    airbnb: 'https://www.airbnb.jp/calendar/ical/1485933977584978407.ics?t=f676d6098c6548aea2a617c2e7c07358',
  },
];

// iCalをパース（Reservedのみ取得）
function parseIcal(text) {
  return text.split('BEGIN:VEVENT').slice(1).map(b => {
    const m = b.match(/DTEND[^:\r\n]*:(\d{8})/) || b.match(/DTEND[^:\r\n]*:(\d{8})T/);
    const sm = b.match(/SUMMARY:(.+)/);
    if (!m) return null;
    const summary = sm ? sm[1].trim() : '';
    if (!summary.toLowerCase().includes('reserved')) return null;
    const ds = b.match(/DTSTART[^:\r\n]*:(\d{8})/);
    if (!ds) return null;
    const startRaw = ds[1].slice(0, 8);
    const endRaw = m[1].slice(0, 8);
    const startDate = new Date(startRaw.slice(0,4)+'-'+startRaw.slice(4,6)+'-'+startRaw.slice(6,8));
    const endDate = new Date(endRaw.slice(0,4)+'-'+endRaw.slice(4,6)+'-'+endRaw.slice(6,8));
    const diffDays = (endDate - startDate) / (1000*60*60*24);
    if (diffDays < 2) return null; // 1泊未満は除外
    const d = new Date(endRaw.slice(0,4) + '-' + endRaw.slice(4,6) + '-' + endRaw.slice(6,8) + 'T00:00:00Z');
    d.setDate(d.getDate() - 1);
    return {
      date: d.toISOString().slice(0, 10),
      summary,
      source: 'airbnb',
    };
  }).filter(Boolean);
}

async function syncProperty(prop) {
  console.log(`Syncing ${prop.prop}...`);
  try {
    const res = await fetch(prop.airbnb, { timeout: 15000 });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (!text.includes('BEGIN:VCALENDAR')) throw new Error('Not iCal data');

    const events = parseIcal(text);
    console.log(`  ${prop.prop}: ${events.length}件取得`);

    // Firebaseに保存
    await db.ref(`${prop.prop}/icalCache`).set({
      events,
      updatedAt: new Date().toISOString(),
    });

    // 既存のシフトと照合して新しいシフトを追加
    const shiftsSnap = await db.ref(`${prop.prop}/shifts`).once('value');
    const shifts = shiftsSnap.val() || {};
    const settingsSnap = await db.ref(`${prop.prop}/settings`).once('value');
    const settings = settingsSnap.val() || {};
    const staff = settings.staff || [];

    let added = 0;
    for (const ev of events) {
      const exists = Object.values(shifts).find(s => s.hi === prop.hi && s.date === ev.date && !s.confirmed);
      if (!exists) {
        const id = `shift_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const votes = {};
        staff.forEach(s => votes[s] = '');
        await db.ref(`${prop.prop}/shifts/${id}`).set({
          hi: prop.hi,
          date: ev.date,
          ts: '10:00',
          te: '14:00',
          votes,
          confirmed: false,
          fromAirbnb: true,
          guestName: ev.summary,
          source: 'airbnb',
          ci: false,
          lo: false,
          eci: false,
        });
        added++;
      }
    }
    console.log(`  ${prop.prop}: ${added}件のシフトを新規作成`);
  } catch (err) {
    console.error(`  ${prop.prop} エラー:`, err.message);
  }
}

async function main() {
  console.log('iCal同期開始:', new Date().toISOString());
  for (const prop of PROPERTIES) {
    await syncProperty(prop);
  }
  console.log('iCal同期完了');
  process.exit(0);
}

main();
