# Build stage
# Pinned digest ensures reproducible builds; update with: docker pull node:22-alpine && docker inspect --format='{{index .RepoDigests 0}}' node:22-alpine
FROM node:22-alpine@sha256:968df39aedcea65eeb078fb336ed7191baf48f972b4479711397108be0966920 AS builder  # node:22-alpine
RUN apk upgrade --no-cache
WORKDIR /app
COPY package*.json ./
RUN npm ci --production=false
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Production stage
FROM node:22-alpine@sha256:968df39aedcea65eeb078fb336ed7191baf48f972b4479711397108be0966920  # node:22-alpine
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
