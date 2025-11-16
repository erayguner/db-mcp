import crypto from 'crypto';
import { logger } from '../utils/logger.js';

/**
 * LRU Cache Entry with TTL support
 */
interface CacheEntry<T> {
  value: T;
  timestamp: number;
  size: number;
  hits: number;
  lastAccessed: number;
}

/**
 * Cache Statistics
 */
export interface CacheStats {
  totalHits: number;
  totalMisses: number;
  totalEvictions: number;
  hitRate: number;
  currentSize: number;
  maxSize: number;
  entryCount: number;
  averageHits: number;
}

/**
 * Query Cache Configuration
 */
export interface QueryCacheConfig {
  maxSize: number; // Maximum cache size in bytes (default: 100MB)
  ttl: number; // Time to live in milliseconds (default: 1 hour)
  maxEntries: number; // Maximum number of cache entries (default: 1000)
  enableCompression: boolean; // Enable value compression (default: false)
}

/**
 * LRU Cache with TTL for BigQuery query results
 *
 * Features:
 * - LRU (Least Recently Used) eviction policy
 * - TTL (Time To Live) for automatic expiration
 * - Size-based eviction when memory limit is reached
 * - Cache key generation from SQL queries
 * - Hit/miss ratio tracking
 * - Memory-efficient storage
 */
export class QueryCache<T = unknown> {
  private cache: Map<string, CacheEntry<T>>;
  private config: QueryCacheConfig;
  private stats: {
    hits: number;
    misses: number;
    evictions: number;
  };
  private currentSize: number;

  constructor(config?: Partial<QueryCacheConfig>) {
    this.config = {
      maxSize: config?.maxSize ?? 100 * 1024 * 1024, // 100MB
      ttl: config?.ttl ?? 60 * 60 * 1000, // 1 hour
      maxEntries: config?.maxEntries ?? 1000,
      enableCompression: config?.enableCompression ?? false,
    };

    this.cache = new Map();
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
    };
    this.currentSize = 0;

    logger.info('QueryCache initialized', {
      maxSize: `${(this.config.maxSize / 1024 / 1024).toFixed(2)}MB`,
      ttl: `${this.config.ttl / 1000}s`,
      maxEntries: this.config.maxEntries,
    });
  }

  /**
   * Generate cache key from SQL query
   * Uses SHA-256 hash for consistent, collision-resistant keys
   */
  generateKey(query: string, parameters?: unknown[]): string {
    const normalizedQuery = this.normalizeQuery(query);
    const keyData = parameters
      ? `${normalizedQuery}::${JSON.stringify(parameters)}`
      : normalizedQuery;

    return crypto.createHash('sha256').update(keyData).digest('hex');
  }

  /**
   * Normalize SQL query for consistent caching
   * - Removes extra whitespace
   * - Converts to lowercase
   * - Removes comments
   */
  private normalizeQuery(query: string): string {
    return query
      .toLowerCase()
      .replace(/--.*$/gm, '') // Remove single-line comments
      .replace(/\/\*[\s\S]*?\*\//g, '') // Remove multi-line comments
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
  }

  /**
   * Get value from cache
   */
  get(key: string): T | null {
    const entry = this.cache.get(key);

    if (!entry) {
      this.stats.misses++;
      return null;
    }

    // Check if entry has expired
    const now = Date.now();
    if (now - entry.timestamp > this.config.ttl) {
      logger.debug('Cache entry expired', { key: key.substring(0, 16) });
      this.delete(key);
      this.stats.misses++;
      return null;
    }

    // Update access statistics
    entry.hits++;
    entry.lastAccessed = now;
    this.stats.hits++;

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);

    logger.debug('Cache hit', {
      key: key.substring(0, 16),
      hits: entry.hits,
    });

    return entry.value;
  }

  /**
   * Set value in cache
   */
  set(key: string, value: T): void {
    const size = this.estimateSize(value);
    const now = Date.now();

    // Check if we need to evict entries
    while (
      (this.currentSize + size > this.config.maxSize ||
       this.cache.size >= this.config.maxEntries) &&
      this.cache.size > 0
    ) {
      this.evictLRU();
    }

    // Add new entry
    const entry: CacheEntry<T> = {
      value,
      timestamp: now,
      size,
      hits: 0,
      lastAccessed: now,
    };

    // Remove old entry if it exists
    if (this.cache.has(key)) {
      const oldEntry = this.cache.get(key)!;
      this.currentSize -= oldEntry.size;
    }

    this.cache.set(key, entry);
    this.currentSize += size;

    logger.debug('Cache set', {
      key: key.substring(0, 16),
      size: `${(size / 1024).toFixed(2)}KB`,
      totalSize: `${(this.currentSize / 1024 / 1024).toFixed(2)}MB`,
    });
  }

  /**
   * Delete entry from cache
   */
  delete(key: string): boolean {
    const entry = this.cache.get(key);
    if (entry) {
      this.currentSize -= entry.size;
      this.cache.delete(key);
      return true;
    }
    return false;
  }

  /**
   * Clear all entries from cache
   */
  clear(): void {
    this.cache.clear();
    this.currentSize = 0;
    logger.info('Cache cleared');
  }

  /**
   * Evict least recently used entry
   */
  private evictLRU(): void {
    // Get first entry (least recently used in our Map implementation)
    const firstKey = this.cache.keys().next().value;
    if (firstKey) {
      const entry = this.cache.get(firstKey)!;
      this.currentSize -= entry.size;
      this.cache.delete(firstKey);
      this.stats.evictions++;

      logger.debug('LRU eviction', {
        key: firstKey.substring(0, 16),
        size: `${(entry.size / 1024).toFixed(2)}KB`,
      });
    }
  }

  /**
   * Invalidate entries matching a pattern
   * Useful for invalidating all queries for a specific table/dataset
   */
  invalidate(pattern: RegExp | string): number {
    let count = 0;
    const regex = typeof pattern === 'string'
      ? new RegExp(pattern, 'i')
      : pattern;

    for (const [key, entry] of this.cache.entries()) {
      if (regex.test(key)) {
        this.currentSize -= entry.size;
        this.cache.delete(key);
        count++;
      }
    }

    if (count > 0) {
      logger.info('Cache invalidation', { pattern: pattern.toString(), count });
    }

    return count;
  }

  /**
   * Clean up expired entries
   */
  cleanup(): number {
    const now = Date.now();
    let count = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.config.ttl) {
        this.currentSize -= entry.size;
        this.cache.delete(key);
        count++;
      }
    }

    if (count > 0) {
      logger.info('Cache cleanup completed', { removedEntries: count });
    }

    return count;
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const totalRequests = this.stats.hits + this.stats.misses;
    const hitRate = totalRequests > 0
      ? (this.stats.hits / totalRequests) * 100
      : 0;

    const totalHits = Array.from(this.cache.values()).reduce(
      (sum, entry) => sum + entry.hits,
      0
    );
    const averageHits = this.cache.size > 0
      ? totalHits / this.cache.size
      : 0;

    return {
      totalHits: this.stats.hits,
      totalMisses: this.stats.misses,
      totalEvictions: this.stats.evictions,
      hitRate,
      currentSize: this.currentSize,
      maxSize: this.config.maxSize,
      entryCount: this.cache.size,
      averageHits,
    };
  }

  /**
   * Estimate size of a value in bytes
   */
  private estimateSize(value: unknown): number {
    try {
      // Rough estimation using JSON serialization
      const serialized = JSON.stringify(value);
      return serialized.length * 2; // UTF-16 characters are 2 bytes
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.warn('Failed to estimate cache entry size', { error: errorMsg });
      return 1024; // Default to 1KB
    }
  }

  /**
   * Get cache entry with metadata
   */
  getEntry(key: string): (CacheEntry<T> & { key: string }) | null {
    const entry = this.cache.get(key);
    if (!entry) {
      return null;
    }

    return {
      ...entry,
      key,
    };
  }

  /**
   * Get all cache keys
   */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Check if key exists in cache
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) {
      return false;
    }

    // Check expiration
    const now = Date.now();
    if (now - entry.timestamp > this.config.ttl) {
      this.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Get cache size in MB
   */
  getSizeMB(): number {
    return this.currentSize / 1024 / 1024;
  }

  /**
   * Get cache configuration
   */
  getConfig(): QueryCacheConfig {
    return { ...this.config };
  }
}
