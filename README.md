## AquaKeep — запуск и деплой

Краткие инструкции по локальному запуску, сборке через Docker Compose и деплою на VPS.

### Локально (разработка)

1. Скопируйте пример окружения и заполните значения:

```bash
cp .env.example .env
# затем отредактируйте .env и внесите реальные значения
```

2. Установите зависимости и запустите в режиме разработки (требуется Node.js):

```bash
npm install
npm run dev
```

Сервер по умолчанию слушает порт из `PORT` (в `.env`), обычно 3000.

### Docker Compose (локально или на сервере)

Сборка и запуск всех сервисов (app + postgres):

```bash
# если у вас новая версия Docker (рекомендуется)
docker compose up -d --build

# или старый синтаксис
# docker-compose up -d --build
```

Проверить логи:

```bash
docker compose logs -f app
docker compose logs -f db
```

Остановить и удалить контейнеры и тома:

```bash
docker compose down -v
```

### Деплой на VPS (Ubuntu 24.04)

Пример простого рабочего процесса для сервера:

1. Подготовьте сервер (однократные шаги):

```bash
# обновить систему
sudo apt update && sudo apt upgrade -y
# установить Docker и Docker Compose (инструкция на официальном сайте)
# пример (скрипт установки Docker):
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
# добавить пользователя в группу docker (чтобы не запускать sudo docker)
sudo usermod -aG docker $USER
# перезайдите в сессию или выполните: newgrp docker
```

2. Клонировать репозиторий на сервер и запустить:

```bash
git clone https://github.com/kithweb/aquakeep.git
cd aquakeep
cp .env.example .env
# отредактируйте .env (BOT_TOKEN, CHAT_ID, POSTGRES credentials)
docker compose up -d --build
```

3. Для мониторинга и автозапуска можно использовать `docker compose` + systemd unit или настроить `watchtower`/CI.

### Переменные окружения

Файл `.env.example` содержит все необходимые переменные. Основные:

- `PORT` — порт приложения (например, 3000)
- `DATABASE_URL` — URL PostgreSQL, например `postgresql://user:pass@db:5432/aquakeep`
- `SESSION_SECRET` — секрет для `express-session`
- `ADMIN_PASSWORD` — пароль для админ-страниц (если используется)
- `BOT_TOKEN` — токен Telegram-бота
- `CHAT_ID` — ID чата или пользователя, куда бот отправляет уведомления

Не храните секреты в публичных репозиториях. Используйте секреты CI/CD или хранилище секретов для продакшна.

### Полезные команды

- Установить зависимости: `npm install`
- Запустить dev: `npm run dev`
- Сборка Docker: `docker compose build`
- Поднять инфраструктуру: `docker compose up -d`
- Просмотреть логи: `docker compose logs -f app`

Если хотите, добавлю раздел с примерами API (POST /api/order) и инструкцией по настройке Telegram (как получить BOT_TOKEN и CHAT_ID).