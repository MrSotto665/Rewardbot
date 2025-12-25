const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const app = express();

// Environment Variables
const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGO_URI = process.env.MONGO_URI; 
const ADMIN_ID = Number(process.env.ADMIN_ID); 
// Render এ সাধারণত RENDER_EXTERNAL_URL ভেরিয়েবলটি থাকে
const MINI_APP_URL = process.env.RENDER_EXTERNAL_URL || 'https://your-bot-name.onrender.com/';

const bot = new Telegraf(BOT_TOKEN);

// ১. এক্সপ্রেস সেটিংস (Mini App হোস্টিং)
app.use(express.static('public'));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ২. ডাটাবেস কানেকশন
mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ Connected to MongoDB'))
    .catch(err => console.log('❌ DB Error:', err));

const User = mongoose.model('User', new mongoose.Schema({
    userId: { type: Number, unique: true },
    firstName: String,
    partnerId: { type: Number, default: null },
    status: { type: String, default: 'idle' },
    matchLimit: { type: Number, default: 10 }, 
    referrals: { type: Number, default: 0 },
    lastClaimed: { type: Date, default: null }
}));

// ৩. স্টার্ট ও রেফারেল লজিক
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
                    bot.telegram.sendMessage(referrer.userId, `🎉 Someone joined via your link! You received +20 matches.`).catch(e => {});
                }
            }
            await user.save();
        }

        const welcomeMsg = `👋 <b>Welcome to Secret Dating Bot!</b>\n\n🎁 Your Balance: ${userId === ADMIN_ID ? 'Unlimited' : user.matchLimit + ' Matches'} left.`;
        
        ctx.reply(welcomeMsg, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: "🚀 Open Mini App", web_app: { url: MINI_APP_URL } }]
                ],
                keyboard: [['🔍 Find Partner'], ['👤 My Status', '👫 Refer & Earn'], ['❌ Stop Chat']],
                resize_keyboard: true
            }
        });
    } catch (err) { console.error("Start Error:", err); }
});

// ৪. পার্টনার খোঁজা
bot.hears('🔍 Find Partner', async (ctx) => {
    try {
        const userId = ctx.from.id;
        const user = await User.findOne({ userId });
        const isAdmin = userId === ADMIN_ID;

        if (!isAdmin && user.matchLimit <= 0) {
            return ctx.reply('❌ <b>Limit Over!</b>\n\nRefer friends to get 20 matches per invite.');
        }

        if (user.status === 'chatting') return ctx.reply('❌ Already in a chat!');
        await User.updateOne({ userId }, { status: 'searching' });
        
        ctx.reply(`🔎 Searching for a partner...`, Markup.keyboard([['❌ Stop Search']]).resize());

        const partner = await User.findOne({ userId: { $ne: userId }, status: 'searching' });
        if (partner) {
            if (!isAdmin) await User.updateOne({ userId }, { $inc: { matchLimit: -1 } });
            if (partner.userId !== ADMIN_ID) await User.updateOne({ userId: partner.userId }, { $inc: { matchLimit: -1 } });
            
            await User.updateOne({ userId }, { status: 'chatting', partnerId: partner.userId });
            await User.updateOne({ userId: partner.userId }, { status: 'chatting', partnerId: userId });
            
            const menu = Markup.keyboard([['🔍 Find Partner'], ['👤 My Status', '👫 Refer & Earn'], ['❌ Stop Chat']]).resize();
            ctx.reply('✅ Partner found! Start chatting...', menu);
            bot.telegram.sendMessage(partner.userId, '✅ Partner found! Start chatting...', menu).catch(e => {});
        }
    } catch (err) { console.error("Match Error:", err); }
});

// ৫. টেক্সট ও চ্যাটিং ফিল্টার
bot.on('text', async (ctx, next) => {
    try {
        const text = ctx.message.text;
        const userId = ctx.from.id;
        const isAdmin = userId === ADMIN_ID;

        if (text.startsWith('/broadcast ') && isAdmin) {
            const msg = text.replace('/broadcast ', '').trim();
            const all = await User.find({});
            all.forEach(u => bot.telegram.sendMessage(u.userId, msg).catch(async (e) => {
                if (e.description && e.description.includes('blocked')) {
                    await User.deleteOne({ userId: u.userId });
                }
            }));
            return ctx.reply('✅ Broadcast sent.');
        }

        if (['🔍 Find Partner', '👤 My Status', '👫 Refer & Earn', '❌ Stop Chat', '❌ Stop Search', '/start'].includes(text)) return next();

        const user = await User.findOne({ userId });
        if (!isAdmin) {
            const filter = /(https?:\/\/[^\s]+)|(www\.[^\s]+)|(t\.me\/[^\s]+)|(@[^\s]+)/gi;
            if (filter.test(text)) return ctx.reply('⚠️ Links/Usernames are blocked!');
        }

        if (user && user.status === 'chatting' && user.partnerId) {
            bot.telegram.sendMessage(user.partnerId, text).catch(e => ctx.reply('⚠️ Partner left.'));
        }
    } catch (err) { console.error("Text Error:", err); }
});

// ৬. প্রোফাইল ও স্ট্যাটাস
bot.hears('👤 My Status', async (ctx) => {
    const user = await User.findOne({ userId: ctx.from.id });
    ctx.reply(`👤 <b>Profile:</b>\nName: ${user.firstName}\nMatches: ${ctx.from.id === ADMIN_ID ? 'Unlimited' : user.matchLimit}`, { parse_mode: 'HTML' });
});

bot.hears('👫 Refer & Earn', async (ctx) => {
    const user = await User.findOne({ userId: ctx.from.id });
    const refLink = `https://t.me/${ctx.botInfo.username}?start=${ctx.from.id}`;
    ctx.reply(`👫 <b>Refer & Earn</b>\n\nInvite friends and get <b>+20 Matches</b>!\n\nYour Link: ${refLink}\nReferrals: ${user.referrals}`, { parse_mode: 'HTML' });
});

// ৭. চ্যাট বন্ধ করা
bot.hears('❌ Stop Chat', async (ctx) => {
    const user = await User.findOne({ userId: ctx.from.id });
    if (user.partnerId) {
        await User.updateOne({ userId: user.partnerId }, { status: 'idle', partnerId: null });
        bot.telegram.sendMessage(user.partnerId, '❌ Partner ended the chat.').catch(e => {});
    }
    await User.updateOne({ userId: ctx.from.id }, { status: 'idle', partnerId: null });
    ctx.reply('❌ Chat ended.');
});

// ৮. সার্ভার স্টার্ট
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    bot.launch();
});

bot.catch((err) => console.error('⚠️ Global Error:', err));
