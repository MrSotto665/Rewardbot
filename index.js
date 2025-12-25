const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const mongoose = require('mongoose');
const app = express();

const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGO_URI = process.env.MONGO_URI; 
const ADMIN_ID = Number(process.env.ADMIN_ID); 

const bot = new Telegraf(BOT_TOKEN);

mongoose.connect(MONGO_URI).then(() => console.log('✅ Connected to MongoDB')).catch(err => console.log('❌ DB Error:', err));

const User = mongoose.model('User', new mongoose.Schema({
    userId: { type: Number, unique: true },
    firstName: String,
    partnerId: { type: Number, default: null },
    status: { type: String, default: 'idle' },
    matchLimit: { type: Number, default: 50 },
    referrals: { type: Number, default: 0 },
    lastClaimed: { type: Date, default: null }
}));

// ১. স্টার্ট ও রেফারেল লজিক (Console Log সহ)
bot.start(async (ctx) => {
    const userId = ctx.from.id;
    const startPayload = ctx.payload;
    let user = await User.findOne({ userId });

    if (!user) {
        console.log(`🆕 [NEW USER] ${ctx.from.first_name} (ID: ${userId}) joined.`);
        user = new User({ userId, firstName: ctx.from.first_name });
        if (startPayload && Number(startPayload) !== userId) {
            const referrer = await User.findOne({ userId: Number(startPayload) });
            if (referrer) {
                await User.updateOne({ userId: referrer.userId }, { $inc: { matchLimit: 50, referrals: 1 } });
                bot.telegram.sendMessage(referrer.userId, `🎉 Someone joined via your link! You got +50 matches.`);
                console.log(`🔗 [REFERRAL] ${ctx.from.first_name} joined via ${referrer.firstName}.`);
            }
        }
        await user.save();
    }
    const welcomeMsg = `👋 Welcome to Secret Dating Bot!\n\n🎁 Your Balance: ${userId === ADMIN_ID ? 'Unlimited' : user.matchLimit + ' Matches'} left.`;
    ctx.reply(welcomeMsg, Markup.keyboard([['🔍 Find Partner'], ['👤 My Status', '👫 Refer & Earn'], ['❌ Stop Chat']]).resize());
});

// ২. পার্টনার খোঁজা
bot.hears('🔍 Find Partner', async (ctx) => {
    const userId = ctx.from.id;
    const user = await User.findOne({ userId });
    const isAdmin = userId === ADMIN_ID;

    if (!isAdmin && user.matchLimit <= 0) {
        return ctx.reply('❌ Your match limit is over!\n\nVisit these links to get 5+5 matches (Once daily):', Markup.inlineKeyboard([
            [Markup.button.url('🔗 Link 1', 'https://otieu.com/4/9382477'), Markup.button.callback('✅ Verify 1', 'verify_1')],
            [Markup.button.url('🔗 Link 2', 'https://www.profitableratecpm.com/k8hkwgsm3z?key=2cb2941afdb3af8f1ca4ced95e61e00f'), Markup.button.callback('✅ Verify 2', 'verify_2')]
        ]));
    }

    if (user.status === 'chatting') return ctx.reply('❌ Already in a chat!');
    await User.updateOne({ userId }, { status: 'searching' });
    ctx.reply(`🔎 Searching...`, Markup.keyboard([['❌ Stop Search']]).resize());

    const partner = await User.findOne({ userId: { $ne: userId }, status: 'searching' });
    if (partner) {
        if (!isAdmin) await User.updateOne({ userId }, { $inc: { matchLimit: -1 } });
        if (partner.userId !== ADMIN_ID) await User.updateOne({ userId: partner.userId }, { $inc: { matchLimit: -1 } });
        await User.updateOne({ userId }, { status: 'chatting', partnerId: partner.userId });
        await User.updateOne({ userId: partner.userId }, { status: 'chatting', partnerId: userId });
        console.log(`✅ [CONNECTION] ${ctx.from.first_name} <--> ${partner.firstName}`);
        const menu = Markup.keyboard([['🔍 Find Partner'], ['👤 My Status', '👫 Refer & Earn'], ['❌ Stop Chat']]).resize();
        ctx.reply('✅ Partner found!', menu);
        bot.telegram.sendMessage(partner.userId, '✅ Partner found!', menu);
    }
});

// ৩. লিঙ্ক ভেরিফাই লজিক
bot.action(/verify_/, async (ctx) => {
    const user = await User.findOne({ userId: ctx.from.id });
    const today = new Date().setHours(0, 0, 0, 0);
    if (user.lastClaimed && new Date(user.lastClaimed).getTime() === today) {
        return ctx.answerCbQuery('❌ Already claimed today!', { show_alert: true });
    }
    await User.updateOne({ userId: ctx.from.id }, { $inc: { matchLimit: 5 }, $set: { lastClaimed: new Date(today) } });
    ctx.answerCbQuery('✅ 5 Matches Added!');
    ctx.editMessageText('🎉 Bonus Added! You got +5 matches. You can use these links again tomorrow.');
});

// ৪. টেক্সট ও ব্রডকাস্ট হ্যান্ডলার
bot.on('text', async (ctx, next) => {
    const text = ctx.message.text;
    const userId = ctx.from.id;
    const isAdmin = userId === ADMIN_ID;
    const user = await User.findOne({ userId });

    if (!user) return;

    if (text.startsWith('/broadcast ') && isAdmin) {
        const msg = text.replace('/broadcast ', '').trim();
        const all = await User.find({});
        all.forEach(u => bot.telegram.sendMessage(u.userId, msg).catch(e => {}));
        return ctx.reply('✅ Text Broadcast sent.');
    }

    if (['🔍 Find Partner', '👤 My Status', '👫 Refer & Earn', '❌ Stop Chat', '❌ Stop Search', '/start'].includes(text)) return next();

    if (!isAdmin) {
        const filter = /(https?:\/\/[^\s]+)|(www\.[^\s]+)|(t\.me\/[^\s]+)|(@[^\s]+)/gi;
        if (filter.test(text)) return ctx.reply('⚠️ Links and @usernames are blocked!');
    }

    if (user.status === 'chatting' && user.partnerId) {
        bot.telegram.sendMessage(user.partnerId, text).catch(e => ctx.reply('⚠️ Partner left.'));
    }
});

// ৫. মিডিয়া হ্যান্ডলার
bot.on(['photo', 'video', 'sticker', 'voice', 'audio'], async (ctx) => {
    const userId = ctx.from.id;
    const isAdmin = userId === ADMIN_ID;
    const user = await User.findOne({ userId });

    const caption = ctx.message.caption || "";
    if (isAdmin && caption.startsWith('/broadcast')) {
        const cleanCaption = caption.replace('/broadcast', '').trim();
        const all = await User.find({});
        all.forEach(u => ctx.copyMessage(u.userId, { caption: cleanCaption }).catch(e => {}));
        return ctx.reply('✅ Media Broadcast sent.');
    }

    if (isAdmin && user && user.status === 'chatting' && user.partnerId) {
        return ctx.copyMessage(user.partnerId);
    }
    ctx.reply('⚠️ Only text messages are allowed for safety!');
});

// ৬. স্ট্যাটাস ও রেফারেল (বিস্তারিত তথ্য সহ)
bot.hears('👫 Refer & Earn', async (ctx) => {
    const user = await User.findOne({ userId: ctx.from.id });
    const refLink = `https://t.me/${ctx.botInfo.username}?start=${ctx.from.id}`;
    const msg = `👫 **Referral Program:**\n\n` +
                `Invite a friend and get 50 extra matches!\n\n` +
                `Your Link: ${refLink}\n\n` +
                `Total Referrals: ${user.referrals}\n` +
                `Remaining Matches: ${ctx.from.id === ADMIN_ID ? 'Unlimited' : user.matchLimit}`;
    ctx.reply(msg, { parse_mode: 'Markdown' });
});

bot.hears('👤 My Status', async (ctx) => {
    const user = await User.findOne({ userId: ctx.from.id });
    const statusMsg = `👤 **Profile:**\n` +
                      `Name: ${user.firstName}\n` +
                      `Matches Left: ${ctx.from.id === ADMIN_ID ? 'Unlimited' : user.matchLimit}\n` +
                      `Total Referrals: ${user.referrals}`;
    ctx.reply(statusMsg, { parse_mode: 'Markdown' });
});

// ৭. চ্যাট ও সার্চ বন্ধ করা
bot.hears('❌ Stop Chat', async (ctx) => {
    const user = await User.findOne({ userId: ctx.from.id });
    const menu = Markup.keyboard([['🔍 Find Partner'], ['👤 My Status', '👫 Refer & Earn']]).resize();
    if (user && user.partnerId) {
        await User.updateOne({ userId: user.partnerId }, { status: 'idle', partnerId: null });
        bot.telegram.sendMessage(user.partnerId, '❌ Partner ended the chat.', menu);
    }
    await User.updateOne({ userId: ctx.from.id }, { status: 'idle', partnerId: null });
    ctx.reply('❌ Chat ended.', menu);
});

bot.hears('❌ Stop Search', async (ctx) => {
    await User.updateOne({ userId: ctx.from.id }, { status: 'idle' });
    ctx.reply('🔍 Search stopped.', Markup.keyboard([['🔍 Find Partner'], ['👤 My Status', '👫 Refer & Earn']]).resize());
});

const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Active'));
app.listen(PORT, () => { console.log(`Server started`); bot.launch(); });

