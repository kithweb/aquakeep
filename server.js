// Простая точка входа сервера Express
const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { SocksProxyAgent } = require('socks-proxy-agent');
const { Pool } = require('pg');

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

// Setup Postgres pool
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Ensure orders table exists
async function ensureSchema() {
    const create = `
    CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
        name TEXT,
        phone TEXT,
        items JSONB,
        total INTEGER,
        status TEXT DEFAULT 'new',
        utm_source TEXT,
        utm_medium TEXT,
        utm_campaign TEXT
    );`;
    try {
        await pool.query(create);
        console.log('Ensured orders table exists');
    } catch (err) {
        console.error('Failed to ensure DB schema:', err);
        throw err;
    }
}

// Статические файлы из папки public
app.use(express.static(path.join(__dirname, 'public')));

// Простой POST /api/order — логируем тело и отвечаем success
app.post('/api/order', async (req, res) => {
    console.log('New order received:', JSON.stringify(req.body));
    const { name, phone, items, total, utm_source, utm_medium, utm_campaign } = req.body || {};

    let client;
    try {
        client = await pool.connect();
        const insertQuery = `INSERT INTO orders (name, phone, items, total, utm_source, utm_medium, utm_campaign)
            VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`;
        const values = [name || null, phone || null, items || null, total || 0, utm_source || null, utm_medium || null, utm_campaign || null];
        const result = await client.query(insertQuery, values);
        const newId = result.rows[0].id;

        // Try to send Telegram notification if bot configured
        if (bot && process.env.CHAT_ID) {
            try {
                const itemsText = (items || []).map(i => `${i.qty}×${i.id}`).join('\n');
                const text = `Новый заказ #${newId}\nИмя: ${name || '-'}\nТелефон: ${phone || '-'}\nСумма: ${total || 0} ₽\nТовары:\n${itemsText}`;
                await bot.sendMessage(process.env.CHAT_ID, text);
            } catch (err) {
                console.error('Telegram send error:', err);
            }
        }

        res.json({ success: true, id: newId });
    } catch (err) {
        console.error('Order save error:', err);
        res.status(500).json({ success: false, error: 'internal_error' });
    } finally {
        if (client) client.release();
    }
});

const PORT = process.env.PORT || 3000;

async function init() {
    try {
        // If DATABASE_URL is not set, pool will throw on queries. Ensure schema only when pool configured.
        if (process.env.DATABASE_URL) {
            await ensureSchema();
        } else {
            console.warn('DATABASE_URL not set — skipping schema ensure');
        }

        app.listen(PORT, () => {
            console.log(`Server started on port ${PORT}`);
        });
    } catch (err) {
        console.error('Failed to start server:', err);
        process.exit(1);
    }
}

init();

// Graceful shutdown
async function shutdown() {
    console.log('Shutting down...');
    try {
        await pool.end();
        console.log('Postgres pool closed');
    } catch (err) {
        console.error('Error closing Postgres pool:', err);
    }
    process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = app;
