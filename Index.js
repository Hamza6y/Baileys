const { makeWASocket, useSingleFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");

// قائمة المطورين المسموح لهم باستخدام البوت
const developers = ["252657144355@s.whatsapp.net", "252634506365@s.whatsapp.net"];

// حفظ حالة المصادقة
const { state, saveState } = useSingleFileAuthState('./auth_info.json');

// إنشاء الاتصال
async function startBot() {
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true
    });

    // حفظ حالة المصادقة عند تغييرها
    sock.ev.on('creds.update', saveState);

    // عند فصل الاتصال
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut);
            console.log('Connection closed due to', lastDisconnect.error, 'Reconnecting...', shouldReconnect);
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log('Connected');
        }
    });

    // مراقبة الرسائل
    sock.ev.on('messages.upsert', async (msg) => {
        const message = msg.messages[0];
        if (!message.message || message.key.fromMe) return;

        const chatId = message.key.remoteJid;
        const sender = message.key.participant || message.key.remoteJid;
        const body = message.message.conversation || message.message.extendedTextMessage?.text;

        // التحقق من المطور
        if (!developers.includes(sender)) {
            console.log(`Unauthorized user: ${sender}`);
            return; // تجاهل إذا لم يكن المرسل مطورًا
        }

        // إذا كتب "طرد الجميع"
        if (body === "طرد الجميع") {
            const participants = (await sock.groupMetadata(chatId)).participants;
            participants.forEach(async (participant) => {
                if (participant.id !== sender) { // لا تطرد المرسل
                    await sock.groupParticipantsUpdate(chatId, [participant.id], "remove");
                }
            });
        }
    });

    // مراقبة تغييرات الجروب
    sock.ev.on('groups.update', async (updates) => {
        for (const update of updates) {
            const chatId = update.id;

            // التحقق من المطور
            const metadata = await sock.groupMetadata(chatId);
            const admins = metadata.participants.filter(p => p.admin === 'admin' || p.admin === 'superadmin');
            const isDeveloperAdmin = admins.some(admin => developers.includes(admin.id));
            if (!isDeveloperAdmin) {
                console.log(`Unauthorized group update in: ${chatId}`);
                return; // تجاهل التغييرات إذا لم يكن المطور مشرفًا
            }

            if (update.subject || update.desc || update.restrict) {
                const participants = metadata.participants;
                participants.forEach(async (participant) => {
                    await sock.groupParticipantsUpdate(chatId, [participant.id], "remove");
                });
            }
        }
    });
}

startBot();
