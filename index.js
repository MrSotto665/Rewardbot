const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const mongoose = require('mongoose');
const app = express();

// Environment Variables
const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGO_URI = process.env.MONGO_URI; 
const ADMIN_ID = Number(process.env.ADMIN_ID); 

const bot = new Telegraf(BOT_TOKEN);

// Database Connection
mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ Connected to MongoDB'))
    .catch(err => console.log('❌ DB Error:', err));

// User Schema
const User = mongoose.model('User', new mongoose.Schema({
    userId: { type: Number, unique: true },
    firstName: String,
    partnerId: { type: Number, default: null },
    status: { type: String, default: 'idle' },
    matchLimit: { type: Number, default: 10 }, // New users get 10 matches
    referrals: { type: Number, default: 0 },
    lastClaimed: { type: Date, default: null }
}));

// Main Menu Keyboard
const mainMenu = Markup.keyboard([
    ['🔍 Find Partner'],
    ['👤 My Status', '👫 Refer & Earn'],
    ['❌ Stop Chat']
]).resize();

// 1. Start & Referral Logic
bot.start(async (ctx) => {
    try {
        const userId = ctx.from.id;
        const startPayload = ctx.payload;
        let user = await User.findOne({ userId });

        if (!user) {
            console.log(`🆕 [NEW USER] ${ctx.from.first_name} joined.`);
            user = new User({ userId, firstName: ctx.from.first_name, matchLimit: 10 });
            
            // Referral Check
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
        ctx.reply(welcomeMsg, { parse_mode: 'HTML', ...mainMenu });
    } catch (err) { console.error("Start Error:", err); }
});

// 2. Finding Partner Logic
bot.hears('🔍 Find Partner', async (ctx) => {
    try {
        const userId = ctx.from.id;
        const user = await User.findOne({ userId });
        const isAdmin = userId === ADMIN_ID;

        // Check Match Limit
        if (!isAdmin && user.matchLimit <= 0) {
            return ctx.reply('❌ <b>Your match limit is over!</b>\n\nClick the link below to visit, then click <b>Verify</b> to get 5 matches:', {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard([
                    [Markup.button.url('🔗 Open Link 1', 'https://otieu.com/4/9382477'), Markup.button.callback('✅ Verify 1', 'verify_1')],
                    [Markup.button.url('🔗 Open Link 2', 'https://www.profitableratecpm.com/k8hkwgsm3z?key=2cb2941afdb3af8f1ca4ced95e61e00f'), Markup.button.callback('✅ Verify 2', 'verify_2')]
                ])
            });
        }

        if (user.status === 'chatting') return ctx.reply('❌ Already in a chat!');
        
        await User.updateOne({ userId }, { status: 'searching' });
        
        ctx.reply(`🔎 Searching for a partner...`, Markup.keyboard([
            ['❌ Stop Search'],
            ['👤 My Status', '👫 Refer & Earn']
        ]).resize());

        // Matchmaking
        const partner = await User.findOne({ userId: { $ne: userId }, status: 'searching' });
        if (partner) {
            if (!isAdmin) await User.updateOne({ userId }, { $inc: { matchLimit: -1 } });
            if (partner.userId !== ADMIN_ID) await User.updateOne({ userId: partner.userId }, { $inc: { matchLimit: -1 } });
            
            await User.updateOne({ userId }, { status: 'chatting', partnerId: partner.userId });
            await User.updateOne({ userId: partner.userId }, { status: 'chatting', partnerId: userId });
            
            ctx.reply('✅ Partner found! Start chatting...', mainMenu);
            bot.telegram.sendMessage(partner.userId, '✅ Partner found! Start chatting...', mainMenu).catch(e => {});
        }
    } catch (err) { console.error("Match Error:", err); }
});

// 3. Link Verification (Reward: 5 matches)
bot.action(/verify_/, async (ctx) => {
    try {
        const userId = ctx.from.id;
        const user = await User.findOne({ userId });
        const today = new Date().setHours(0, 0, 0, 0);

        if (user.lastClaimed && new Date(user.lastClaimed).getTime() === today) {
            return ctx.answerCbQuery('❌ Already claimed today!', { show_alert: true });
        }

        await User.updateOne({ userId }, { $inc: { matchLimit: 5 }, $set: { lastClaimed: new Date(today) } });
        ctx.answerCbQuery('✅ 5 Matches Added!');
        ctx.editMessageText('🎉 <b>Bonus Added!</b> You got +5 matches. You can use these links again tomorrow.', { parse_mode: 'HTML' });
    } catch (err) { console.error("Verify Error:", err); }
});

// 4. Message Handling
bot.on('text', async (ctx, next) => {
    try {
        const text = ctx.message.text;
        const userId = ctx.from.id;
        const user = await User.findOne({ userId });
        if (!user) return;

        // Admin Broadcast
        if (text.startsWith('/broadcast ') && userId === ADMIN_ID) {
            const msg = text.replace('/broadcast ', '').trim();
            const all = await User.find({});
            all.forEach(u => bot.telegram.sendMessage(u.userId, msg).catch(e => {}));
            return ctx.reply('✅ Broadcast sent.');
        }

        if (['🔍 Find Partner', '👤 My Status', '👫 Refer & Earn', '❌ Stop Chat', '❌ Stop Search', '/start'].includes(text)) return next();

        // Spam Filter
        if (userId !== ADMIN_ID) {
            const filter = /(https?:\/\/[^\s]+)|(www\.[^\s]+)|(t\.me\/[^\s]+)|(@[^\s]+)/gi;
            if (filter.test(text)) return ctx.reply('⚠️ Links and @usernames are blocked!');
        }

        // Chat Forwarding
        if (user.status === 'chatting' && user.partnerId) {
            bot.telegram.sendMessage(user.partnerId, text).catch(e => ctx.reply('⚠️ Partner left.'));
        }
    } catch (err) { console.error("Text Error:", err); }
});

// 5. Status & Referrals
bot.hears('👫 Refer & Earn', async (ctx) => {
    try {
        const user = await User.findOne({ userId: ctx.from.id });
        const refLink = `https://t.me/${ctx.botInfo.username}?start=${ctx.from.id}`;
        ctx.reply(`👫 <b>Referral Program</b>\n\n` +
          `Invite your friends and earn rewards!\n\n` +
          `🎁 <b>Reward:</b> You will get <b>+20 Matches for each friend</b> who joins using your link.\n\n` +
          `🔗 <b>Your Invite Link:</b>\n${refLink}\n\n` +
          `📊 <b>Your Stats:</b>\n` +
          `• Total Referrals: ${user.referrals || 0}\n` +
          `• Remaining Matches: ${user.matchLimit}`, { parse_mode: 'HTML' });
    } catch (err) { console.error("Referral Error:", err); }
});

bot.hears('👤 My Status', async (ctx) => {
    try {
        const user = await User.findOne({ userId: ctx.from.id });
        ctx.reply(`👤 <b>Profile:</b>\nName: ${user.firstName}\nMatches Left: ${ctx.from.id === ADMIN_ID ? 'Unlimited' : user.matchLimit}`, { parse_mode: 'HTML' });
    } catch (err) { console.error("Status Error:", err); }
});

// 6. Stop Search/Chat
bot.hears('❌ Stop Chat', async (ctx) => {
    try {
        const user = await User.findOne({ userId: ctx.from.id });
        if (user && user.partnerId) {
            await User.updateOne({ userId: user.partnerId }, { status: 'idle', partnerId: null });
            bot.telegram.sendMessage(user.partnerId, '❌ Partner ended the chat.', mainMenu).catch(e => {});
        }
        await User.updateOne({ userId: ctx.from.id }, { status: 'idle', partnerId: null });
        ctx.reply('❌ Chat ended.', mainMenu);
    } catch (err) { console.error("StopChat Error:", err); }
});

bot.hears('❌ Stop Search', async (ctx) => {
    try {
        await User.updateOne({ userId: ctx.from.id }, { status: 'idle' });
        ctx.reply('🔍 Search stopped.', mainMenu);
    } catch (err) { console.error("StopSearch Error:", err); }
});

// Server Setup
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Active'));
app.listen(PORT, () => { console.log(`Server Live`); bot.launch(); });

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
