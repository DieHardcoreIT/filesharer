FROM node:26-alpine AS production

ENV NODE_ENV=production
WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

# Keep application files read-only while allowing runtime data to be written.
RUN addgroup -S appgroup && adduser -S appuser -G appgroup && \
    mkdir -p uploads metadata tmp_chunks && \
    chown -R appuser:appgroup . && \
    chmod a-w *.js package*.json && \
    chmod -R a-w public views

USER appuser
EXPOSE 3000
CMD ["node", "server.js"]
