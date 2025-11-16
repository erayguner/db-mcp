# Multi-stage build for optimized production image
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY src ./src

# Build TypeScript
RUN npm run build

# Production stage
FROM node:18-alpine

WORKDIR /app

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production && \
    npm cache clean --force

# Copy built application
COPY --from=builder /app/dist ./dist

# Create logs directory (for production file logging only)
# Note: All logs write to stderr for MCP protocol compatibility
RUN mkdir -p logs && chown nodejs:nodejs logs

# Switch to non-root user
USER nodejs

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "console.log('healthy')" || exit 1

# Use dumb-init to handle signals properly (SIGTERM/SIGINT)
# Ensures graceful shutdown per MCP best practices
ENTRYPOINT ["dumb-init", "--"]

# Start application
# Logs write to stderr, stdout reserved for MCP JSON-RPC protocol
CMD ["node", "dist/index.js"]

# Expose port (though MCP uses stdio, useful for health checks)
EXPOSE 8080

# Labels
LABEL org.opencontainers.image.title="GCP BigQuery MCP Server"
LABEL org.opencontainers.image.description="MCP Server with Workload Identity Federation"
LABEL org.opencontainers.image.version="1.0.0"
LABEL org.opencontainers.image.authors="Hive Mind Collective"
