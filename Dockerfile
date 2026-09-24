FROM node:20-bookworm-slim

WORKDIR /app

# Install native dependencies required for webrtc / media / native builds
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy package descriptors
COPY package*.json ./

# Install production dependencies
RUN npm install --omit=dev

# Copy application code
COPY . .

# Ensure upload directory and public directories exist
RUN mkdir -p uploads public/widget

EXPOSE 5000

ENV NODE_ENV=production
ENV PORT=5000

CMD ["node", "server.js"]
