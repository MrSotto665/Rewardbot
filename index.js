const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const mongoose = require('mongoose');
const app = express();

const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGO_URI = process.env.MONGO_URI; 
const ADMIN_ID = Number(process.env.ADMIN_ID); // Ensure it's a number

const bot = new Telegraf(BOT_TOKEN);

// --- MongoDB Database Schema ---
mongoose.connect(MONGO_URI).then(() => console.log('✅ DB Connected')).catch(err => console.log(err));

const User = mongoose.model('User', new mongoose.Schema({
    userId: { type: Number, unique: true },
    firstName: String,
    partnerId: { type: Number, default: null },
    status: { type: String, default: 'idle' },
    matchLimit: { type: Number, default: 50 }, 
    referrals: { type: Number, default: 0 }
}));

// --- ১. স্টার্ট কমান্ড ও রেফারেল ---
bot.start(async (ctx) => {
    const userId = ctx.from.id;
    const startPayload = ctx.payload;

    let user = await User.findOne({ userId });

    if (!user) {
        user = new User({ userId, firstName: ctx.from.first_name });
        if (startPayload && Number(startPayload) !== userId) {
            const referrer = await User.findOne({ userId: Number(startPayload) });
            if (referrer) {
                await User.updateOne({ userId: referrer.userId }, { $inc: { matchLimit: 50, referrals: 1 } });
                bot.telegram.sendMessage(referrer.userId, `🎉 Someone joined via your link! +50 matches added.`);
            }
        }
        await user.save();
    }

    ctx.reply(`👋 Welcome to Secret Dating Bot!\n\n🎁 Balance: ${userId === ADMIN_ID ? 'Unlimited' : user.matchLimit + ' Matches'} left.`, 
    Markup.keyboard([['🔍 Find Partner'], ['👤 My Status', '👫 Refer & Earn'], ['❌ Stop Chat']]).resize());
});

// --- ২. পার্টনার খোঁজা (Admin Unlimited) ---
bot.hears('🔍 Find Partner', async (ctx) => {
    const userId = ctx.from.id;
    const user = await User.findOne({ userId });
    const isAdmin = userId === ADMIN_ID;

    if (!isAdmin && user.matchLimit <= 0) {
        return ctx.reply('❌ Limit over! Refer 1 friend to get 50 more matches.');
    }

    if (user.status === 'chatting') return ctx.reply('❌ Already in a chat!');
    
    await User.updateOne({ userId }, { status: 'searching' });
    ctx.reply(`🔎 Searching... ${isAdmin ? '(Admin Mode)' : '(Left: ' + user.matchLimit + ')'}`, Markup.keyboard([['❌ Stop Search']]).resize());

    const partner = await User.findOne({ userId: { $ne: userId }, status: 'searching' });
    
    if (partner) {
        // Limit deduction (Skip for Admin)
        if (!isAdmin) await User.updateOne({ userId }, { $inc: { matchLimit: -1 } });
        if (partner.userId !== ADMIN_ID) await User.updateOne({ userId: partner.userId }, { $inc: { matchLimit: -1 } });

        await User.updateOne({ userId }, { status: 'chatting', partnerId: partner.userId });
        await User.updateOne({ userId: partner.userId }, { status: 'chatting', partnerId: userId });

        console.log(`✅ [CONNECTION] ${ctx.from.first_name} <--> ${partner.firstName}`);

        const menu = Markup.keyboard([['🔍 Find Partner'], ['👤 My Status', '👫 Refer & Earn'], ['❌ Stop Chat']]).resize();
        ctx.reply('✅ Partner found! Start chatting...', menu);
        bot.telegram.sendMessage(partner.userId, '✅ Partner found! Start chatting...', menu);
    }
});

// --- ৩. টেক্সট হ্যান্ডলার (Broadcast, Link Filter, Forwarding) ---
bot.on('text', async (ctx, next) => {
    const text = ctx.message.text;
    const userId = ctx.from.id;
    const isAdmin = userId === ADMIN_ID;
    const user = await User.findOne({ userId });

    if (!user) return;

    // Broadcast
    if (text.startsWith('/broadcast ') && isAdmin) {
        const msg = text.replace('/broadcast ', '');
        const users = await User.find({});
        users.forEach(u => bot.telegram.sendMessage(u.userId, `📢 **Admin Message:**\n\n${msg}`).catch(e => {}));
        return ctx.reply('✅ Broadcast Sent!');
    }

    if (['🔍 Find Partner', '👤 My Status', '👫 Refer & Earn', '❌ Stop Chat', '❌ Stop Search', '/start'].includes(text)) return next();

    // Link & Username Filter (Except Admin)
    if (!isAdmin) {
        const filter = /(https?:\/\/[^\s]+)|(www\.[^\s]+)|(t\.me\/[^\s]+)|(@[^\s]+)/gi;
        if (filter.test(text)) return ctx.reply('⚠️ Links and @Usernames are blocked!');
    }

    // Forwarding
    if (user.status === 'chatting' && user.partnerId) {
        bot.telegram.sendMessage(user.partnerId, text).catch(e => ctx.reply('⚠️ Partner left.'));
    }
});

// --- ৪. মিডিয়া হ্যান্ডলার (Admin Only) ---
bot.on(['photo', 'video', 'sticker', 'voice'], async (ctx) => {
    const userId = ctx.from.id;
    const user = await User.findOne({ userId });
    if (userId === ADMIN_ID && user.status === 'chatting' && user.partnerId) {
        return ctx.copyMessage(user.partnerId); // Admin can send anything
    }
    ctx.reply('⚠️ Media is blocked for safety!');
});

// --- ৫. বাটন লজিক (Status, Refer, Stop) ---
bot.hears('👫 Refer & Earn', async (ctx) => {
    const refLink = `https://t.me/${ctx.botInfo.username}?start=${ctx.from.id}`;
    ctx.reply(`👫 Invite friends & get 50 matches!\nYour Link: ${refLink}`);
});

bot.hears('👤 My Status', async (ctx) => {
    const user = await User.findOne({ userId: ctx.from.id });
    ctx.reply(`👤 Name: ${user.firstName}\nMatches: ${ctx.from.id === ADMIN_ID ? 'Unlimited' : user.matchLimit}`);
});

bot.hears('❌ Stop Chat', async (ctx) => {
    const user = await User.findOne({ userId: ctx.from.id });
    if (user.partnerId) {
        await User.updateOne({ userId: user.partnerId }, { status: 'idle', partnerId: null });
        bot.telegram.sendMessage(user.partnerId, '❌ Partner ended the chat.', Markup.keyboard([['🔍 Find Partner'], ['👤 My Status', '👫 Refer & Earn']]).resize());
    }
    await User.updateOne({ userId: ctx.from.id }, { status: 'idle', partnerId: null });
    ctx.reply('❌ Chat ended.', Markup.keyboard([['🔍 Find Partner'], ['👤 My Status', '👫 Refer & Earn']]).resize());
});

bot.hears('❌ Stop Search', async (ctx) => {
    await User.updateOne({ userId: ctx.from.id }, { status: 'idle' });
    ctx.reply('🔍 Search stopped.', Markup.keyboard([['🔍 Find Partner'], ['👤 My Status', '👫 Refer & Earn']]).resize());
});

const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot Active'));
app.listen(PORT, () => { console.log('Server Live'); bot.launch(); });
