const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const redis = require('redis');
const { Kafka } = require('kafkajs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const slowDown = require('express-slow-down');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Redis client setup
const redisClient = redis.createClient({
  url: process.env.REDIS_URL || 'redis://redis:6379'
});

redisClient.on('error', (err) => console.error('Redis Client Error', err));
redisClient.on('connect', () => console.log('Redis Client Connected'));

(async () => {
  try {
    await redisClient.connect();
  } catch (error) {
    console.error('Redis connection error:', error);
  }
})();

// Kafka setup
const kafka = new Kafka({
  clientId: 'api-gateway',
  brokers: process.env.KAFKA_BROKERS ? process.env.KAFKA_BROKERS.split(',') : ['kafka:29092']
});

const producer = kafka.producer();
const consumer = kafka.consumer({ groupId: 'api-gateway-group' });

(async () => {
  try {
    await producer.connect();
    console.log('Kafka Producer Connected');
    
    await consumer.connect();
    await consumer.subscribe({ topic: 'user-events', fromBeginning: false });
    await consumer.subscribe({ topic: 'file-events', fromBeginning: false });
    
    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        console.log(`Received message from ${topic}:`, message.value.toString());
      },
    });
  } catch (error) {
    console.error('Kafka connection error:', error);
  }
})();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Custom Redis store for rate limiting
class RedisStore {
  constructor(client) {
    this.client = client;
  }

  async increment(key) {
    try {
      const count = await this.client.incr(key);
      if (count === 1) {
        await this.client.expire(key, 900); // 15 minutes
      }
      return { totalHits: count };
    } catch (error) {
      console.error('Redis increment error:', error);
      return { totalHits: 1 };
    }
  }

  async decrement(key) {
    try {
      await this.client.decr(key);
    } catch (error) {
      console.error('Redis decrement error:', error);
    }
  }

  async resetKey(key) {
    try {
      await this.client.del(key);
    } catch (error) {
      console.error('Redis resetKey error:', error);
    }
  }
}

// Rate limiting middleware
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisStore(redisClient),
});

const speedLimiter = slowDown({
  windowMs: 15 * 60 * 1000,
  delayAfter: 50,
  delayMs: 500
});

app.use(limiter);
app.use(speedLimiter);

// JWT verification middleware
const verifyToken = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    // Check Redis cache for token
    const cachedToken = await redisClient.get(`token:${token}`);
    if (cachedToken === 'blacklisted') {
      return res.status(401).json({ error: 'Token has been revoked' });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production');
    
    // Cache user info in Redis
    const userKey = `user:${decoded.userId}`;
    const cachedUser = await redisClient.get(userKey);
    
    if (!cachedUser) {
      // Cache user info for 1 hour
      await redisClient.setEx(userKey, 3600, JSON.stringify(decoded));
    }
    
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};

// Cache middleware
const cacheMiddleware = async (req, res, next) => {
  if (req.method !== 'GET') {
    return next();
  }

  const cacheKey = `cache:${req.originalUrl}:${req.user?.userId || 'anonymous'}`;
  
  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return res.json(JSON.parse(cached));
    }
    
    // Store original json function
    const originalJson = res.json.bind(res);
    res.json = function(data) {
      // Cache for 5 minutes
      redisClient.setEx(cacheKey, 300, JSON.stringify(data));
      return originalJson(data);
    };
    
    next();
  } catch (error) {
    next();
  }
};

// Event publishing helper
const publishEvent = async (topic, event) => {
  try {
    await producer.send({
      topic,
      messages: [{
        key: event.userId || 'system',
        value: JSON.stringify({
          ...event,
          timestamp: new Date().toISOString()
        })
      }]
    });
  } catch (error) {
    console.error(`Error publishing to ${topic}:`, error);
  }
};

// Service URLs
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://auth-service:3001';
const FILE_SERVICE_URL = process.env.FILE_SERVICE_URL || 'http://file-service:3002';

// Health check
app.get('/health', async (req, res) => {
  const redisStatus = redisClient.isOpen ? 'connected' : 'disconnected';
  res.json({ 
    status: 'OK', 
    service: 'api-gateway',
    redis: redisStatus,
    timestamp: new Date().toISOString()
  });
});

// Auth service proxy
const authProxy = createProxyMiddleware({
  target: AUTH_SERVICE_URL,
  changeOrigin: true,
  pathRewrite: {
    '^/api/auth': '/api/auth'
  },
  selfHandleResponse: false,
  onProxyRes: async (proxyRes, req, res) => {
    // Publish events for successful login/register
    if (req.method === 'POST' && req.path.includes('/login') && proxyRes.statusCode === 200) {
      // Publish event based on request (user details will be in response, but we publish async)
      setImmediate(async () => {
        await publishEvent('user-events', {
          type: 'USER_LOGIN_ATTEMPT',
          email: req.body?.email,
          timestamp: new Date().toISOString()
        });
      });
    }
    
    if (req.method === 'POST' && req.path.includes('/register') && proxyRes.statusCode === 201) {
      setImmediate(async () => {
        await publishEvent('user-events', {
          type: 'USER_REGISTERED',
          username: req.body?.username,
          email: req.body?.email,
          timestamp: new Date().toISOString()
        });
      });
    }
  }
});

// File service proxy
const fileProxy = createProxyMiddleware({
  target: FILE_SERVICE_URL,
  changeOrigin: true,
  pathRewrite: {
    '^/api/files': '/api/files'
  },
  onProxyRes: async (proxyRes, req, res) => {
    // Publish file events
    if (req.method === 'POST' && req.path.includes('/upload') && proxyRes.statusCode === 201) {
      setImmediate(async () => {
        await publishEvent('file-events', {
          type: 'FILE_UPLOADED',
          userId: req.user?.userId,
          filename: req.file?.originalname || req.body?.filename,
          timestamp: new Date().toISOString()
        });
      });
    }
    
    if (req.method === 'DELETE' && proxyRes.statusCode === 200) {
      setImmediate(async () => {
        await publishEvent('file-events', {
          type: 'FILE_DELETED',
          userId: req.user?.userId,
          fileId: req.params.id,
          timestamp: new Date().toISOString()
        });
      });
    }
  }
});

// Routes
app.use('/api/auth', authProxy);
app.use('/api/files', verifyToken, cacheMiddleware, fileProxy);

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM signal received: closing HTTP server');
  await redisClient.quit();
  await producer.disconnect();
  await consumer.disconnect();
  process.exit(0);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`API Gateway running on port ${PORT}`);
});

