const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const mongoose = require('mongoose');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGO_URI = process.env.MONGO_URI; 
const ADMIN_ID = Number(process.env.ADMIN_ID); 

const bot = new Telegraf(BOT_TOKEN);

// Database Connection
mongoose.connect(MONGO_URI).then(() => console.log('✅ Connected to MongoDB')).catch(err => console.log('❌ DB Error:', err));

// User Model
const User = mongoose.model('User', new mongoose.Schema({
    userId: { type: Number, unique: true },
    firstName: String,
    partnerId: { type: Number, default: null },
    status: { type: String, default: 'idle' },
    matchLimit: { type: Number, default: 10 },
    referrals: { type: Number, default: 0 },
    lastClaimed: { type: Date, default: null },
    socketId: { type: String, default: null } // Web connection ID
}));

// --- Web Server Config ---
app.use(express.static(path.join(__dirname)));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// --- Socket.io Logic (For 1v1 Chat) ---
io.on('connection', (socket) => {
    socket.on('join', async (userId) => {
        if (!userId) return;
        await User.updateOne({ userId: Number(userId) }, { socketId: socket.id });
        console.log(`🌐 User ${userId} connected via Web`);
    });

    socket.on('send_msg', async (data) => {
        const { senderId, text } = data;
        const user = await User.findOne({ userId: Number(senderId) });
        
        if (user && user.partnerId) {
            const partner = await User.findOne({ userId: user.partnerId });
            
            // ১. যদি পার্টনার ওয়েব অ্যাপে থাকে তবে সকেট দিয়ে পাঠাও
            if (partner.socketId) {
                io.to(partner.socketId).emit('receive_msg', { text });
            } 
            // ২. সকেট না থাকলে টেলিগ্রামে মেসেজ পাঠাও
            bot.telegram.sendMessage(partner.userId, `💬 (Web) ${text}`).catch(e => {});
        }
    });

    socket.on('disconnect', async () => {
        await User.updateOne({ socketId: socket.id }, { socketId: null });
    });
});

// --- Telegram Bot Logic ---

// স্টার্ট ও রেফারেল
bot.start(async (ctx) => {
    try {
        const userId = ctx.from.id;
        const startPayload = ctx.payload;
        let user = await User.findOne({ userId });

        if (!user) {
            user = new User({ userId, firstName: ctx.from.first_name, matchLimit: 10 });
            if (startPayload && Number(startPayload) !== userId) {
                const referrer = await User.findOne({ userId: Number(startPayload) });
                if (referrer) {
                    await User.updateOne({ userId: referrer.userId }, { $inc: { matchLimit: 20, referrals: 1 } });
                    bot.telegram.sendMessage(referrer.userId, `🎉 Someone joined! You received +20 matches.`).catch(e => {});
                }
            }
            await user.save();
        }
        ctx.reply(`👋 Welcome ${user.firstName}!\n🎁 Matches: ${user.matchLimit}`, {
            ...Markup.keyboard([['🔍 Find Partner'], ['👤 My Status', '👫 Refer & Earn'], ['❌ Stop Chat']]).resize()
        });
    } catch (err) { console.error("Start Error:", err); }
});

// পার্টনার খোঁজা (Optimized for Web & Bot)
bot.hears('🔍 Find Partner', async (ctx) => {
    try {
        const userId = ctx.from.id;
        const user = await User.findOne({ userId });

        if (userId !== ADMIN_ID && user.matchLimit <= 0) return ctx.reply('❌ No matches left!');
        if (user.status === 'chatting') return ctx.reply('❌ Already chatting!');

        await User.updateOne({ userId }, { status: 'searching' });
        ctx.reply(`🔎 Searching...`);

        const partner = await User.findOne({ userId: { $ne: userId }, status: 'searching' });
        if (partner) {
            await User.updateOne({ userId }, { status: 'chatting', partnerId: partner.userId });
            await User.updateOne({ userId: partner.userId }, { status: 'chatting', partnerId: userId });
            
            const msg = '✅ Partner found! Start chatting...';
            ctx.reply(msg);
            bot.telegram.sendMessage(partner.userId, msg).catch(e => {});

            // যদি তারা ওয়েব অ্যাপে থাকে তবে তাদের স্ক্রিন চেঞ্জ করে দাও
            if (user.socketId) io.to(user.socketId).emit('match_found');
            if (partner.socketId) io.to(partner.socketId).emit('match_found');
        }
    } catch (err) { console.error("Match Error:", err); }
});

// মেসেজ ফরওয়ার্ডিং লজিক (Bot to Partner)
bot.on('text', async (ctx, next) => {
    const user = await User.findOne({ userId: ctx.from.id });
    if (user && user.status === 'chatting' && user.partnerId) {
        const partner = await User.findOne({ userId: user.partnerId });
        
        // ১. পার্টনার যদি ওয়েব অ্যাপে থাকে
        if (partner.socketId) {
            io.to(partner.socketId).emit('receive_msg', { text: ctx.message.text });
        } 
        // ২. পার্টনার যদি টেলিগ্রামে থাকে
        bot.telegram.sendMessage(partner.userId, ctx.message.text).catch(e => ctx.reply('⚠️ Partner left.'));
        return;
    }
    next();
});

// স্টপ চ্যাট
bot.hears('❌ Stop Chat', async (ctx) => {
    const user = await User.findOne({ userId: ctx.from.id });
    if (user && user.partnerId) {
        await User.updateOne({ userId: user.partnerId }, { status: 'idle', partnerId: null });
        bot.telegram.sendMessage(user.partnerId, '❌ Partner ended the chat.').catch(e => {});
        // ওয়েব অ্যাপে থাকলে সিগন্যাল পাঠানো
        const partner = await User.findOne({ userId: user.partnerId });
        if (partner.socketId) io.to(partner.socketId).emit('chat_ended');
    }
    await User.updateOne({ userId: ctx.from.id }, { status: 'idle', partnerId: null });
    ctx.reply('❌ Chat ended.');
});

// Server Start
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    bot.launch();
});
