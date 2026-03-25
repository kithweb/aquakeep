FROM node:18-alpine

# Create app directory
WORKDIR /app

# Install dependencies (copy package files first for cache)
COPY package.json package-lock.json* ./
RUN npm install --production

# Copy app sources
COPY . .

# Expose application port
EXPOSE 3000

# Start the app
CMD ["npm", "start"]
