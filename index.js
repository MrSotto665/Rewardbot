const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const mongoose = require('mongoose');
const app = express();

const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGO_URI = process.env.MONGO_URI; 
const ADMIN_ID = Number(process.env.ADMIN_ID); 

const bot = new Telegraf(BOT_TOKEN);

// --- MongoDB Database Schema ---
mongoose.connect(MONGO_URI).then(() => console.log('✅ DB Connected')).catch(err => console.log(err));

const User = mongoose.model('User', new mongoose.Schema({
    userId: { type: Number, unique: true },
    firstName: String,
    partnerId: { type: Number, default: null },
    status: { type: String, default: 'idle' },
    matchLimit: { type: Number, default: 50 }, // শুরুতে ৫০টি ফ্রি ম্যাচ
    referrals: { type: Number, default: 0 }    // কতজন রেফার করেছে
}));

// --- বট লজিক ---

// ১. স্টার্ট কমান্ড (রেফারেল হ্যান্ডলিং সহ)
bot.start(async (ctx) => {
    const userId = ctx.from.id;
    const startPayload = ctx.payload; // রেফারেল আইডি যদি থাকে

    let user = await User.findOne({ userId });

    if (!user) {
        // নতুন ইউজার তৈরি
        user = new User({
            userId,
            firstName: ctx.from.first_name,
            status: 'idle'
        });

        // যদি কেউ রেফারেল লিঙ্কে ক্লিক করে আসে
        if (startPayload && Number(startPayload) !== userId) {
            const referrer = await User.findOne({ userId: Number(startPayload) });
            if (referrer) {
                // রেফারারকে ৫০টি অতিরিক্ত ম্যাচ দেওয়া
                await User.updateOne(
                    { userId: referrer.userId },
                    { $inc: { matchLimit: 50, referrals: 1 } }
                );
                bot.telegram.sendMessage(referrer.userId, `🎉 Someone joined via your link! You got +50 extra matches.`);
            }
        }
        await user.save();
    }

    ctx.reply(`👋 Welcome to Secret Dating Bot!\n\n🎁 Your Balance: ${user.matchLimit} Matches left.\n\nNote: For each referral, you get 50 extra matches!`, 
    Markup.keyboard([['🔍 Find Partner'], ['👤 My Status', '👫 Refer & Earn'], ['❌ Stop Chat']]).resize());
});

// ২. পার্টনার খোঁজা (লিমিট চেক সহ)
bot.hears('🔍 Find Partner', async (ctx) => {
    const userId = ctx.from.id;
    const user = await User.findOne({ userId });

    if (user.matchLimit <= 0 && userId !== ADMIN_ID) {
        return ctx.reply('❌ Your match limit is over!\n\nRefer 1 friend to get 50 more matches. Click [👫 Refer & Earn] to get your link.');
    }

    if (user.status === 'chatting') return ctx.reply('❌ Already in a chat!');
    
    await User.updateOne({ userId }, { status: 'searching' });
    ctx.reply(`🔎 Searching... (Matches left: ${user.matchLimit})`, Markup.keyboard([['❌ Stop Search']]).resize());

    const partner = await User.findOne({ userId: { $ne: userId }, status: 'searching' });
    
    if (partner) {
        // ম্যাচ সফল হলে দুজনের লিমিট ১ কমিয়ে দেওয়া (অ্যাডমিন বাদে)
        if (userId !== ADMIN_ID) await User.updateOne({ userId }, { $inc: { matchLimit: -1 } });
        if (partner.userId !== ADMIN_ID) await User.updateOne({ userId: partner.userId }, { $inc: { matchLimit: -1 } });

        await User.updateOne({ userId }, { status: 'chatting', partnerId: partner.userId });
        await User.updateOne({ userId: partner.userId }, { status: 'chatting', partnerId: userId });

        ctx.reply('✅ Partner found!', Markup.keyboard([['❌ Stop Chat']]).resize());
        bot.telegram.sendMessage(partner.userId, '✅ Partner found!', Markup.keyboard([['❌ Stop Chat']]).resize());
    }
});

// ৩. রেফারেল লিঙ্ক জেনারেট করা
bot.hears('👫 Refer & Earn', async (ctx) => {
    const user = await User.findOne({ userId: ctx.from.id });
    const refLink = `https://t.me/${ctx.botInfo.username}?start=${ctx.from.id}`;
    
    ctx.reply(`👫 Referral Program:\n\nInvite a friend and get 50 extra matches!\n\nYour Link: ${refLink}\n\nTotal Referrals: ${user.referrals}\nRemaining Matches: ${user.matchLimit}`);
});

// ৪. স্ট্যাটাস চেক
bot.hears('👤 My Status', async (ctx) => {
    const user = await User.findOne({ userId: ctx.from.id });
    ctx.reply(`👤 Profile:\nName: ${user.firstName}\nMatches Left: ${user.matchLimit}\nTotal Referrals: ${user.referrals}`);
});

// ৫. আগের টেক্সট ফরওয়ার্ডিং লজিক (লিঙ্ক ফিল্টার ও অ্যাডমিন ব্রডকাস্টসহ)
bot.on('text', async (ctx, next) => {
    const text = ctx.message.text;
    const userId = ctx.from.id;
    const isAdmin = userId === ADMIN_ID;
    const user = await User.findOne({ userId });

    if (!user || ['🔍 Find Partner', '👤 My Status', '👫 Refer & Earn', '❌ Stop Chat', '❌ Stop Search', '/start'].includes(text)) {
        return next();
    }

    // লিঙ্ক ও @ ইউজারনেম ফিল্টার
    if (!isAdmin) {
        const linkRegex = /(https?:\/\/[^\s]+)|(www\.[^\s]+)|(t\.me\/[^\s]+)/gi;
        const mentionRegex = /@[^\s]+/g;
        if (linkRegex.test(text) || mentionRegex.test(text)) {
            return ctx.reply('⚠️ Links and @Usernames are not allowed!');
        }
    }

    // চ্যাট ফরওয়ার্ডিং
    if (user.status === 'chatting' && user.partnerId) {
        try { await bot.telegram.sendMessage(user.partnerId, text); } catch (e) { ctx.reply('⚠️ Partner left.'); }
    }
});

// বাকি সব (Stop Chat, Media Handler, Port) আগের কোডের মতোই থাকবে...
// (সংক্ষিপ্ত করার জন্য এখানে পুনরাবৃত্তি করা হয়নি, আপনি আগের কোড থেকে শুধু bot.hears('❌ Stop Chat') এবং মিডিয়া হ্যান্ডলার অংশটি নিচে বসিয়ে দিলেই হবে)

bot.hears('❌ Stop Chat', async (ctx) => {
    const user = await User.findOne({ userId: ctx.from.id });
    if (user && user.partnerId) {
        await User.updateOne({ userId: user.partnerId }, { status: 'idle', partnerId: null });
        bot.telegram.sendMessage(user.partnerId, '❌ Chat ended.', Markup.keyboard([['🔍 Find Partner']]).resize());
    }
    await User.updateOne({ userId: ctx.from.id }, { status: 'idle', partnerId: null });
    ctx.reply('❌ Chat ended.', Markup.keyboard([['🔍 Find Partner']]).resize());
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    bot.launch();
});
