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

# Install production dependencies only (excludes devDeps like esbuild/tsx)
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Security: run as non-root
RUN addgroup -g 1001 -S mcp && adduser -S mcp -u 1001 -G mcp
USER mcp

COPY --from=builder --chown=mcp:mcp /app/dist ./dist

ENV NODE_ENV=production
ENV MCP_TRANSPORT=http
ENV MCP_HTTP_PORT=8080
ENV MCP_HTTP_HOST=0.0.0.0
ENV MCP_ENABLE_PROMPTS=true
ENV MCP_ENABLE_SESSIONS=true
ENV MCP_ENABLE_COMPRESSION=true
ENV MCP_ENABLE_ANOMALY_DETECTION=true

EXPOSE 8080

CMD ["node", "dist/index.js"]
