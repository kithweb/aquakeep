// Простая точка входа сервера Express
const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { SocksProxyAgent } = require('socks-proxy-agent');
const { Pool } = require('pg');
const session = require('express-session');

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

// Session middleware (simple in-memory store — ok for single-instance small admin)
app.use(session({
    secret: process.env.SESSION_SECRET || 'change-me',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, httpOnly: true, maxAge: 1000 * 60 * 60 * 24 },
}));

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

// In-memory auth codes: code -> { userId, expiresAt }
const authCodes = new Map();

function genCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// Telegram handlers: /auth command and callback_query
if (bot) {
    // /auth command: generate 6-digit code, save with TTL 5 minutes, send to user
    bot.onText(/\/auth/, (msg) => {
        try {
            const code = genCode();
            const userId = msg.from && msg.from.id;
            const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes
            authCodes.set(code, { userId, expiresAt });
            // schedule cleanup
            setTimeout(() => authCodes.delete(code), 5 * 60 * 1000 + 1000);
            bot.sendMessage(msg.chat.id, `Ваш код для входа в админку: ${code}\nОн действителен 5 минут.`);
        } catch (err) {
            console.error('Error in /auth handler:', err);
        }
    });

    // Handle callback queries for status changes (callback_data: status:<id>:<status>)
    bot.on('callback_query', async (q) => {
        try {
            const data = q.data || '';
            if (!data.startsWith('status:')) {
                await bot.answerCallbackQuery(q.id, { text: 'Unknown action' });
                return;
            }
            const parts = data.split(':');
            const id = parts[1];
            const newStatus = parts[2];
            if (!id || !newStatus) {
                await bot.answerCallbackQuery(q.id, { text: 'Invalid data' });
                return;
            }

            // Update DB
            const client = await pool.connect();
            try {
                const upd = await client.query('UPDATE orders SET status=$1 WHERE id=$2 RETURNING *', [newStatus, id]);
                if (upd.rowCount === 0) {
                    await bot.answerCallbackQuery(q.id, { text: 'Order not found', show_alert: true });
                } else {
                    const order = upd.rows[0];
                    // edit original message to include new status
                    const chatId = q.message.chat.id;
                    const messageId = q.message.message_id;
                    const itemsText = (order.items || []).map(i => `${i.qty}×${i.id || i.name || ''}`).join('\n');
                    const text = `Заказ #${order.id}\nИмя: ${order.name || '-'}\nТелефон: ${order.phone || '-'}\nСумма: ${order.total || 0} ₽\nТовары:\n${itemsText}\nСтатус: ${order.status}`;
                    const keyboard = { inline_keyboard: [[
                        { text: 'Mark processed', callback_data: `status:${order.id}:processed` },
                        { text: 'Agree', callback_data: `status:${order.id}:agreed` }
                    ]] };
                    await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, reply_markup: keyboard });
                    await bot.answerCallbackQuery(q.id, { text: 'Статус обновлён' });
                }
            } finally {
                client.release();
            }
        } catch (err) {
            console.error('callback_query handler error:', err);
            try { await bot.answerCallbackQuery(q.id, { text: 'Ошибка', show_alert: true }); } catch(e){}
        }
    });
}

// Статические файлы из папки public
app.use(express.static(path.join(__dirname, 'public')));

// --- Admin / Orders API ---
app.get('/api/admin/check', (req, res) => {
    res.json({ authorized: !!(req.session && req.session.admin) });
});

app.post('/api/admin/auth', async (req, res) => {
    const { code } = req.body || {};
    if (!code) return res.status(400).json({ success: false, error: 'no_code' });
    const entry = authCodes.get(code);
    if (!entry) return res.status(401).json({ success: false, error: 'invalid_code' });
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
        authCodes.delete(code);
        return res.status(401).json({ success: false, error: 'expired' });
    }
    // valid
    req.session.admin = true;
    req.session.tgUserId = entry.userId;
    authCodes.delete(code);
    res.json({ success: true });
});

app.post('/api/admin/logout', (req, res) => {
    if (req.session) {
        req.session.destroy(() => {});
    }
    res.json({ success: true });
});

function requireAdmin(req, res, next) {
    if (req.session && req.session.admin) return next();
    return res.status(401).json({ success: false, error: 'unauthorized' });
}

app.get('/api/orders', requireAdmin, async (req, res) => {
    const client = await pool.connect();
    try {
        const q = await client.query('SELECT id, created_at, name, phone, items, total, utm_source, utm_medium, utm_campaign, status FROM orders ORDER BY created_at DESC');
        res.json(q.rows);
    } catch (err) {
        console.error('GET /api/orders error:', err);
        res.status(500).json({ success: false, error: 'db_error' });
    } finally {
        client.release();
    }
});

app.post('/api/orders/:id/status', requireAdmin, async (req, res) => {
    const id = req.params.id;
    const { status } = req.body || {};
    const allowed = ['new','processed','agreed'];
    if (!allowed.includes(status)) return res.status(400).json({ success: false, error: 'invalid_status' });
    const client = await pool.connect();
    try {
        const upd = await client.query('UPDATE orders SET status=$1 WHERE id=$2 RETURNING *', [status, id]);
        if (upd.rowCount === 0) return res.status(404).json({ success: false, error: 'not_found' });
        const order = upd.rows[0];
        res.json({ success: true, order });
    } catch (err) {
        console.error('POST /api/orders/:id/status error:', err);
        res.status(500).json({ success: false, error: 'db_error' });
    } finally {
        client.release();
    }
});

// Простой POST /api/order — логируем тело и отвечаем success
app.post('/api/order', async (req, res) => {
    console.log('New order received:', JSON.stringify(req.body));
    const { name, phone, items, total, utm_source, utm_medium, utm_campaign } = req.body || {};

    let client;
    try {
        client = await pool.connect();
        const insertQuery = `INSERT INTO orders (name, phone, items, total, utm_source, utm_medium, utm_campaign)
            VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`;
        // Преобразуем items в JSON только если это непустой массив
        const itemsJson = (Array.isArray(items) && items.length) ? JSON.stringify(items) : null;
        const values = [name || null, phone || null, itemsJson, total || 0, utm_source || null, utm_medium || null, utm_campaign || null];
        const result = await client.query(insertQuery, values);
        const newId = result.rows[0].id;


        // Try to send Telegram notification if bot configured
        if (bot && process.env.CHAT_ID) {
            try {
                const itemsText = (items || []).map(i => `${i.qty}×${i.id}`).join('\n');
                const text = `Новый заказ #${newId}\nИмя: ${name || '-'}\nТелефон: ${phone || '-'}\nСумма: ${total || 0} ₽\nТовары:\n${itemsText}\nСтатус: ${'new'}`;
                const keyboard = {
                    inline_keyboard: [[
                        { text: 'Mark processed', callback_data: `status:${newId}:processed` },
                        { text: 'Agree', callback_data: `status:${newId}:agreed` }
                    ]]
                };
                await bot.sendMessage(process.env.CHAT_ID, text, { reply_markup: keyboard });
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
