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

app.use(express.json());
app.use(express.static('public'));

mongoose.connect(MONGO_URI).then(() => console.log('✅ DB Connected')).catch(err => console.error(err));

const User = mongoose.model('User', new mongoose.Schema({
    userId: { type: Number, unique: true },
    firstName: String,
    partnerId: { type: Number, default: null },
    status: { type: String, default: 'idle' },
    matchLimit: { type: Number, default: 10 },
    referrals: { type: Number, default: 0 },
    lastClaimed: { type: Date, default: null }
}));

// --- Socket.io Logic ---
io.on('connection', (socket) => {
    socket.on('join', (userId) => {
        socket.join(userId.toString());
    });

    socket.on('send_msg', async (data) => {
        const user = await User.findOne({ userId: data.senderId });
        if (user && user.partnerId) {
            // পার্টনারের মিনি অ্যাপে পাঠানো
            io.to(user.partnerId.toString()).emit('receive_msg', { text: data.text });
            // পার্টনারের টেলিগ্রাম বটেও ব্যাকআপ হিসেবে পাঠানো
            bot.telegram.sendMessage(user.partnerId, `📩: ${data.text}`).catch(() => {});
        }
    });
});

// --- Bot Logic ---
bot.start(async (ctx) => {
    const userId = ctx.from.id;
    const startPayload = ctx.payload;
    let user = await User.findOne({ userId });

    if (!user) {
        user = new User({ userId, firstName: ctx.from.first_name });
        if (startPayload && Number(startPayload) !== userId) {
            await User.updateOne({ userId: Number(startPayload) }, { $inc: { matchLimit: 20, referrals: 1 } });
            bot.telegram.sendMessage(startPayload, "🎉 Someone joined! +20 Matches added.").catch(()=>{});
        }
        await user.save();
    }

    const appUrl = process.env.RENDER_EXTERNAL_URL || 'https://your-app.onrender.com';
    ctx.reply(`👋 Welcome ${user.firstName}!\nBalance: ${user.matchLimit} Matches`, {
        parse_mode: 'HTML',
        ...Markup.keyboard([['🔍 Find Partner'], ['👤 My Status', '👫 Refer & Earn'], ['❌ Stop Chat']]).resize(),
        reply_markup: {
            inline_keyboard: [[{ text: "🚀 Open Dating App", web_app: { url: appUrl } }]],
            keyboard: [['🔍 Find Partner'], ['👤 My Status', '👫 Refer & Earn'], ['❌ Stop Chat']],
            resize_keyboard: true
        }
    });
});

bot.hears('🔍 Find Partner', async (ctx) => {
    const user = await User.findOne({ userId: ctx.from.id });
    if (user.matchLimit <= 0 && ctx.from.id !== ADMIN_ID) return ctx.reply("❌ Limit Over!");
    
    await User.updateOne({ userId: ctx.from.id }, { status: 'searching' });
    ctx.reply("🔎 Searching...");

    const partner = await User.findOne({ userId: { $ne: ctx.from.id }, status: 'searching' });
    if (partner) {
        await User.updateMany({ userId: { $in: [ctx.from.id, partner.userId] } }, { status: 'chatting' });
        await User.updateOne({ userId: ctx.from.id }, { partnerId: partner.userId, $inc: { matchLimit: -1 } });
        await User.updateOne({ userId: partner.userId }, { partnerId: ctx.from.id, $inc: { matchLimit: -1 } });
        
        const msg = "✅ Partner found! You can chat here or in Mini App.";
        ctx.reply(msg);
        bot.telegram.sendMessage(partner.userId, msg);
        io.to(ctx.from.id.toString()).emit('match_found');
        io.to(partner.userId.toString()).emit('match_found');
    }
});

bot.on('text', async (ctx) => {
    const user = await User.findOne({ userId: ctx.from.id });
    if (user && user.partnerId && user.status === 'chatting') {
        io.to(user.partnerId.toString()).emit('receive_msg', { text: ctx.message.text });
        bot.telegram.sendMessage(user.partnerId, ctx.message.text).catch(()=>{});
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on ${PORT}`);
    bot.launch();
});
