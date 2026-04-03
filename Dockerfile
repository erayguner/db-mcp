# Build stage
FROM node:22-alpine AS builder
RUN apk upgrade --no-cache
WORKDIR /app
COPY package*.json ./
RUN npm ci --production=false
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Production stage
FROM node:22-alpine
RUN apk upgrade --no-cache
WORKDIR /app

# Security: run as non-root
RUN addgroup -g 1001 -S mcp && adduser -S mcp -u 1001 -G mcp
USER mcp

COPY --from=builder --chown=mcp:mcp /app/dist ./dist
COPY --from=builder --chown=mcp:mcp /app/node_modules ./node_modules
COPY --from=builder --chown=mcp:mcp /app/package.json ./

ENV NODE_ENV=production
ENV MCP_TRANSPORT=http
ENV MCP_HTTP_PORT=8080

EXPOSE 8080

CMD ["node", "dist/index.js"]
