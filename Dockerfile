FROM node:18-alpine

WORKDIR /app

# Копируем package файлы first для кэширования
COPY package*.json ./

# Устанавливаем зависимости
RUN npm install --production

# Копируем исходный код
COPY . .

# Создаем папку avatars если не существует
RUN mkdir -p avatars

# Открываем порт
EXPOSE 3000

# Запускаем приложение
CMD ["node", "server.js"]
