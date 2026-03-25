// Простая точка входа сервера Express
const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { SocksProxyAgent } = require('socks-proxy-agent');

// Initialize Telegram bot (optional)
let bot = null;
if (process.env.BOT_TOKEN) {
    try {
        if (process.env.PROXY_URL) {
            const agent = new SocksProxyAgent(process.env.PROXY_URL);
            bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true, request: { agent } });
            console.log('Telegram bot initialized with proxy', process.env.PROXY_URL);
        } else {
            bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
            console.log('Telegram bot initialized without proxy');
        }
    } catch (err) {
        console.error('Failed to initialize Telegram bot:', err);
        bot = null;
    }
} else {
    console.log('BOT_TOKEN not provided; Telegram notifications disabled');
}

const app = express();

app.use(cors());
app.use(express.json());

// Статические файлы из папки public
app.use(express.static(path.join(__dirname, 'public')));

// Простой POST /api/order — логируем тело и отвечаем success
app.post('/api/order', async (req, res) => {
        console.log('New order received:', JSON.stringify(req.body));
        // здесь позже будет логика сохранения/уведомлений

        // Try to send Telegram notification if bot configured
        if (bot && process.env.CHAT_ID) {
            try {
                const order = req.body || {};
                const itemsText = (order.items || []).map(i => `${i.qty}×${i.id}`).join('\n');
                const text = `Новый заказ\nИмя: ${order.name || '-'}\nТелефон: ${order.phone || '-'}\nСумма: ${order.total || 0} ₽\nТовары:\n${itemsText}`;
                await bot.sendMessage(process.env.CHAT_ID, text);
            } catch (err) {
                console.error('Telegram send error:', err);
            }
        }

        res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server started on port ${PORT}`);
});

module.exports = app;
