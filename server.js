// Простая точка входа сервера Express
const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();

app.use(cors());
app.use(express.json());

// Статические файлы из папки public
app.use(express.static(path.join(__dirname, 'public')));

// Простой POST /api/order — логируем тело и отвечаем success
app.post('/api/order', (req, res) => {
    console.log('New order received:', JSON.stringify(req.body));
    // здесь позже будет логика сохранения/уведомлений
    res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server started on port ${PORT}`);
});

module.exports = app;
