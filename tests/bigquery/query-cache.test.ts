import { QueryCache } from '../../src/bigquery/query-cache';

describe('QueryCache', () => {
  let cache: QueryCache;

  beforeEach(() => {
    cache = new QueryCache({
      maxSize: 1024 * 1024, // 1MB
      ttl: 1000, // 1 second for testing
      maxEntries: 10,
    });
  });

  describe('generateKey', () => {
    it('should generate consistent keys for identical queries', () => {
      const query = 'SELECT * FROM users WHERE id = 1';
      const key1 = cache.generateKey(query);
      const key2 = cache.generateKey(query);
      expect(key1).toBe(key2);
    });

    it('should generate different keys for different queries', () => {
      const query1 = 'SELECT * FROM users WHERE id = 1';
      const query2 = 'SELECT * FROM users WHERE id = 2';
      const key1 = cache.generateKey(query1);
      const key2 = cache.generateKey(query2);
      expect(key1).not.toBe(key2);
    });

    it('should normalize whitespace in queries', () => {
      const query1 = 'SELECT * FROM users';
      const query2 = 'SELECT   *   FROM   users';
      const key1 = cache.generateKey(query1);
      const key2 = cache.generateKey(query2);
      expect(key1).toBe(key2);
    });

    it('should handle parameters in key generation', () => {
      const query = 'SELECT * FROM users WHERE id = ?';
      const key1 = cache.generateKey(query, [1]);
      const key2 = cache.generateKey(query, [2]);
      expect(key1).not.toBe(key2);
    });
  });

  describe('get/set', () => {
    it('should store and retrieve values', () => {
      const key = 'test-key';
      const value = { id: 1, name: 'Test' };

      cache.set(key, value);
      const retrieved = cache.get(key);

      expect(retrieved).toEqual(value);
    });

    it('should return null for non-existent keys', () => {
      const result = cache.get('non-existent');
      expect(result).toBeNull();
    });

    it('should handle expired entries', async () => {
      const key = 'test-key';
      const value = { id: 1 };

      cache.set(key, value);

      // Wait for TTL to expire
      await new Promise(resolve => setTimeout(resolve, 1100));

      const result = cache.get(key);
      expect(result).toBeNull();
    });

    it('should update LRU order on access', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');

      // Access key1 to make it more recently used
      cache.get('key1');

      const keys = cache.keys();
      expect(keys[keys.length - 1]).toBe('key1');
    });
  });

  describe('LRU eviction', () => {
    it('should evict least recently used entries when full', () => {
      const smallCache = new QueryCache({
        maxSize: 100,
        maxEntries: 3,
      });

      smallCache.set('key1', 'value1');
      smallCache.set('key2', 'value2');
      smallCache.set('key3', 'value3');
      smallCache.set('key4', 'value4'); // Should evict key1

      expect(smallCache.has('key1')).toBe(false);
      expect(smallCache.has('key4')).toBe(true);
    });

    it('should evict based on size limit', () => {
      const smallCache = new QueryCache({
        maxSize: 200,
        maxEntries: 100,
      });

      // Each string is roughly 2 bytes per character
      smallCache.set('key1', 'x'.repeat(50));
      smallCache.set('key2', 'x'.repeat(50));
      smallCache.set('key3', 'x'.repeat(50)); // Should trigger eviction

      const stats = smallCache.getStats();
      expect(stats.entryCount).toBeLessThan(3);
    });
  });

  describe('invalidate', () => {
    it('should invalidate entries matching a pattern', () => {
      cache.set('users:1', { id: 1 });
      cache.set('users:2', { id: 2 });
      cache.set('products:1', { id: 1 });

      const count = cache.invalidate(/^users:/);

      expect(count).toBe(2);
      expect(cache.has('users:1')).toBe(false);
      expect(cache.has('users:2')).toBe(false);
      expect(cache.has('products:1')).toBe(true);
    });

    it('should handle string patterns', () => {
      cache.set('test-key-1', 'value1');
      cache.set('test-key-2', 'value2');
      cache.set('other-key', 'value3');

      const count = cache.invalidate('test-key');

      expect(count).toBe(2);
      expect(cache.has('other-key')).toBe(true);
    });
  });

  describe('cleanup', () => {
    it('should remove expired entries', async () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 1100));

      const removed = cache.cleanup();

      expect(removed).toBe(2);
      expect(cache.keys().length).toBe(0);
    });
  });

  describe('stats', () => {
    it('should track cache hits and misses', () => {
      cache.set('key1', 'value1');

      cache.get('key1'); // Hit
      cache.get('key2'); // Miss
      cache.get('key1'); // Hit

      const stats = cache.getStats();

      expect(stats.totalHits).toBe(2);
      expect(stats.totalMisses).toBe(1);
      expect(stats.hitRate).toBeCloseTo(66.67, 1);
    });

    it('should calculate hit rate correctly', () => {
      cache.set('key1', 'value1');

      for (let i = 0; i < 10; i++) {
        cache.get('key1');
      }

      const stats = cache.getStats();
      expect(stats.hitRate).toBe(100);
    });

    it('should track cache size', () => {
      cache.set('key1', { data: 'x'.repeat(100) });

      const stats = cache.getStats();
      expect(stats.currentSize).toBeGreaterThan(0);
      expect(stats.currentSize).toBeLessThanOrEqual(stats.maxSize);
    });
  });

  describe('clear', () => {
    it('should remove all entries', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');

      cache.clear();

      expect(cache.keys().length).toBe(0);
      expect(cache.getSizeMB()).toBe(0);
    });
  });

  describe('has', () => {
    it('should return true for existing keys', () => {
      cache.set('key1', 'value1');
      expect(cache.has('key1')).toBe(true);
    });

    it('should return false for non-existent keys', () => {
      expect(cache.has('non-existent')).toBe(false);
    });

    it('should return false for expired keys', async () => {
      cache.set('key1', 'value1');

      await new Promise(resolve => setTimeout(resolve, 1100));

      expect(cache.has('key1')).toBe(false);
    });
  });
});
