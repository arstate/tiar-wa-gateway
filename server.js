const express = require('express');
const qrcode = require('qrcode');
const pino = require('pino');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason
} = require('@whiskeysockets/baileys');

const app = express();
app.use(express.json());

// GANTI DENGAN URL WEB CRM TIAR PROPERTY ANDA
const CRM_WEBHOOK_URL = 'https://tiar-leads.vercel.app/api/webhook/fonnte';

let currentQR = null;
let isConnected = false;
let waSock = null;

async function startWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('./session_data');

  waSock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false
  });

  waSock.ev.on('creds.update', saveCreds);

  waSock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      currentQR = await qrcode.toDataURL(qr);
      isConnected = false;
      console.log('[WA] QR Code siap di-scan!');
    }

    if (connection === 'close') {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      isConnected = false;
      console.log('[WA] Koneksi terputus. Reconnecting:', shouldReconnect);
      if (shouldReconnect) {
        startWhatsApp();
      }
    } else if (connection === 'open') {
      currentQR = null;
      isConnected = true;
      console.log('[WA] WhatsApp Admin Terhubung Sukses!');
    }
  });

  // MENANGKAP SEMUA PESAN (PESAN MASUK PROSPEK & PESAN BALASAN ADMIN DARI HP)
  waSock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (!msg.message) continue;

      const remoteJid = msg.key.remoteJid;
      if (remoteJid.includes('@g.us')) continue; // Abaikan pesan grup WA

      const phone = remoteJid.replace('@s.whatsapp.net', '');
      const isFromMe = msg.key.fromMe || false; // TRUE jika diketik admin di HP fisik
      const pushName = msg.pushName || (isFromMe ? 'Admin Tiar Property' : 'Prospek WhatsApp');

      const textMessage =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        '';

      if (!textMessage.trim()) continue;

      console.log(`[CHAT WA] ${isFromMe ? 'ADMIN' : 'PROSPEK'} (${phone}): ${textMessage}`);

      // Teruskan pesan ke Webhook CRM Tiar Property
      try {
        await fetch(CRM_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sender: phone,
            name: pushName,
            message: textMessage,
            fromMe: isFromMe,
            source: 'baileys-cloud'
          })
        });
      } catch (err) {
        console.error('[FORWARD ERROR]', err.message);
      }
    }
  });
}

app.get('/', (req, res) => {
  if (isConnected) {
    return res.send(`
      <div style="font-family:sans-serif; text-align:center; padding:50px;">
        <h2 style="color:#16a34a;">🟢 WhatsApp Gateway Terhubung Aktif!</h2>
        <p>Pesan masuk prospek dan balasan admin dari HP otomatis masuk ke Web CRM Tiar Property.</p>
      </div>
    `);
  }

  if (currentQR) {
    return res.send(`
      <div style="font-family:sans-serif; text-align:center; padding:30px;">
        <h2>📲 Scan QR Code dengan WhatsApp Admin</h2>
        <p>Buka WA di HP > Perangkat Tertaut > Tautkan Perangkat</p>
        <img src="${currentQR}" style="border: 4px solid #333; border-radius: 8px; width: 280px;" />
        <p style="color:gray; font-size:12px;">Refresh halaman jika QR kedaluwarsa.</p>
      </div>
    `);
  }

  return res.send(`
    <div style="font-family:sans-serif; text-align:center; padding:50px;">
      <h3>⏳ Sedang Menyiapkan Koneksi WhatsApp...</h3>
      <p>Silakan refresh dalam beberapa detik.</p>
    </div>
  `);
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server berjalan di port ${PORT}`);
  startWhatsApp();
});
