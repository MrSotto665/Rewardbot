const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const mongoose = require('mongoose');
const app = express();

// --- কনফিগারেশন ---
const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGO_URI = process.env.MONGO_URI; // <password> এর জায়গায় আপনার পাসওয়ার্ড দিন
const ADMIN_ID = process.env.ADMIN_ID // আপনার টেলিগ্রাম আইডি এখানে দিন

const bot = new Telegraf(BOT_TOKEN);

// --- MongoDB সেটআপ ---
mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ MongoDB Connected!'))
    .catch(err => console.log('❌ MongoDB Connection Error:', err));

const User = mongoose.model('User', new mongoose.Schema({
    userId: { type: Number, unique: true },
    firstName: String,
    username: String,
    email: String,
    wallet: String,
    step: { type: String, default: 'start' }
}));

// --- বট লজিক ---

// ১. স্টার্ট কমান্ড
bot.start(async (ctx) => {
    const userId = ctx.from.id;
    await User.findOneAndUpdate(
        { userId },
        { firstName: ctx.from.first_name, status: 'idle', partnerId: null },
        { upsert: true }
    );
    
    ctx.reply(`👋 Welcome to Random Dating Bot!\n\nFind new people anonymously and start chatting.`, 
    Markup.keyboard([['🔍 Find Partner'], ['👤 My Status', '❌ Stop Chat']]).resize());
});

bot.on('text', async (ctx, next) => {
    const text = ctx.message.text;
    const userId = ctx.from.id;
    const user = await User.findOne({ userId });

    if (!user) return;

    // --- অ্যাডমিন ব্রডকাস্ট ফিচার (আগের মতোই কাজ করবে) ---
    if (text.startsWith('/broadcast ') && userId === ADMIN_ID) {
        const broadcastMsg = text.replace('/broadcast ', '');
        const allUsers = await User.find({});
        let successCount = 0;
        for (const u of allUsers) {
            try {
                await bot.telegram.sendMessage(u.userId, broadcastMsg);
                successCount++;
            } catch (e) {}
        }
        return ctx.reply(`📢 Sent to ${successCount} users.`);
    }

    // --- ডেটিং ফিচার সমুহ ---

    // পার্টনার খোঁজা শুরু
    if (text === '🔍 Find Partner') {
        if (user.status === 'chatting') return ctx.reply('❌ You are already in a chat!');
        
        await User.updateOne({ userId }, { status: 'searching' });
        ctx.reply('🔎 Searching for a random partner... please wait.', Markup.keyboard([['❌ Stop Search']]).resize());

        // অন্য কেউ সার্চ করছে কি না দেখা
        const partner = await User.findOne({ 
            userId: { $ne: userId }, 
            status: 'searching' 
        });

        if (partner) {
            // দুজনকে কানেক্ট করা
            await User.updateOne({ userId }, { status: 'chatting', partnerId: partner.userId });
            await User.updateOne({ userId: partner.userId }, { status: 'chatting', partnerId: userId });

            ctx.reply('✅ Partner found! You can now send messages anonymously.', Markup.keyboard([['❌ Stop Chat']]).resize());
            bot.telegram.sendMessage(partner.userId, '✅ Partner found! Say hi to your stranger.', Markup.keyboard([['❌ Stop Chat']]).resize());
        }
        return;
    }

    // সার্চ বন্ধ করা
    if (text === '❌ Stop Search') {
        await User.updateOne({ userId }, { status: 'idle' });
        return ctx.reply('🔍 Search stopped.', Markup.keyboard([['🔍 Find Partner']]).resize());
    }

    // চ্যাট বন্ধ করা
    if (text === '❌ Stop Chat') {
        if (user.status === 'chatting' && user.partnerId) {
            const partnerId = user.partnerId;
            await User.updateOne({ userId }, { status: 'idle', partnerId: null });
            await User.updateOne({ userId: partnerId }, { status: 'idle', partnerId: null });

            ctx.reply('❌ Chat ended.', Markup.keyboard([['🔍 Find Partner']]).resize());
            bot.telegram.sendMessage(partnerId, '❌ Your partner ended the chat.', Markup.keyboard([['🔍 Find Partner']]).resize());
        } else {
            ctx.reply('You are not in a chat.');
        }
        return;
    }

    // ইউজার স্ট্যাটাস দেখা
    if (text === '👤 My Status') {
        return ctx.reply(`Name: ${user.firstName}\nStatus: ${user.status.toUpperCase()}`);
    }

    // --- চ্যাট মেসেজ ফরওয়ার্ডিং লজিক ---
    // যদি ইউজার চ্যাটিং অবস্থায় থাকে এবং কোনো বাটন না টিপে তবে তার মেসেজ পার্টনারের কাছে যাবে
    if (user.status === 'chatting' && user.partnerId) {
        try {
            await bot.telegram.sendMessage(user.partnerId, text);
        } catch (e) {
            ctx.reply('⚠️ Error: Could not deliver message. Your partner might have blocked the bot.');
        }
    } else {
        ctx.reply('⚠️ You are not connected to anyone. Click "🔍 Find Partner" to start.');
    }
});

// Render Health Check
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Dating Bot is Live!'));
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    bot.launch();
});

