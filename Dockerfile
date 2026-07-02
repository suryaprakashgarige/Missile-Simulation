# Multi-stage Dockerfile for optimized production build
FROM node:20-alpine AS builder

WORKDIR /app

# Copy dependency definition files
COPY package*.json ./
COPY server/package*.json ./server/

# Install dependencies in the server directory (only production to minimize image size)
RUN npm ci --prefix server --only=production

# Copy application files (server code and client assets)
COPY server/ ./server/
COPY client/ ./client/

# Production runner stage
FROM node:20-alpine AS runner

WORKDIR /app

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Copy application code and dependencies from builder stage
COPY --from=builder /app /app

# Run as non-root user 'node' for security hardening
USER node

EXPOSE 3000

# Execute server
CMD ["node", "server/server.js"]
