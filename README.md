# Distributed File Storage System

A distributed file storage system built to demonstrate system design concepts including microservices architecture, API Gateway, caching, event-driven architecture, authentication, API design, and containerization.

## System Design Concepts Demonstrated

1. **Microservices Architecture**: Separate services for authentication and file storage
2. **API Gateway**: Single entry point for all client requests with routing, rate limiting, and caching
3. **Caching**: Redis for token caching, user session caching, and response caching
4. **Event-Driven Architecture**: Kafka for publishing and consuming events (user events, file events)
5. **Rate Limiting**: Redis-backed rate limiting to protect services
6. **RESTful API Design**: Clean API endpoints following REST principles
7. **Authentication & Authorization**: JWT-based authentication system with Redis token blacklisting
8. **Containerization**: Docker-based deployment for all services
9. **Service Communication**: Inter-service communication patterns
10. **Scalability**: Designed to scale horizontally

## Architecture

```
┌─────────────┐
│   Frontend  │ (React + Material-UI)
│   (Port 8080)│
└──────┬──────┘
       │
┌──────▼──────────────────────────────────┐
│      API Gateway (Port 3000)            │
│  - Request Routing                      │
│  - Rate Limiting (Redis)                │
│  - Response Caching (Redis)             │
│  - JWT Verification                     │
│  - Event Publishing (Kafka)             │
└──────┬──────────────────────────────────┘
       │
       ├──────────────┬──────────────┐
       │              │              │
┌──────▼──────┐  ┌────▼─────┐  ┌────▼─────┐
│ Auth Service│  │File Service│  │ Database │
│ (Port 3001) │  │(Port 3002)│  │ (MongoDB)│
└─────────────┘  └───────────┘  └──────────┘
       │              │
       └──────┬───────┘
              │
    ┌─────────▼─────────┐
    │  Redis (Port 6379) │
    │  - Caching         │
    │  - Rate Limiting  │
    └────────────────────┘
              │
    ┌─────────▼─────────┐
    │  Kafka (Port 9092) │
    │  - Event Streaming │
    └────────────────────┘
```

## Services

### 1. API Gateway (Port 3000)
- **Request Routing**: Routes requests to appropriate microservices
- **Rate Limiting**: Redis-backed rate limiting (100 requests per 15 minutes per IP)
- **Response Caching**: Caches GET requests for 5 minutes using Redis
- **JWT Verification**: Validates tokens and caches user information
- **Token Blacklisting**: Supports token revocation via Redis
- **Event Publishing**: Publishes events to Kafka for user actions and file operations
- **Request Throttling**: Slows down requests after 50 requests in 15 minutes

### 2. Auth Service (Port 3001)
- User registration
- User login
- JWT token generation
- Token validation

### 3. File Service (Port 3002)
- File upload
- File download
- File listing
- File deletion
- File metadata management

### 4. Redis (Port 6379)
- **Token Caching**: Caches JWT tokens and user information
- **Response Caching**: Caches API responses for faster retrieval
- **Rate Limiting Store**: Stores rate limit counters
- **Session Management**: Manages user sessions

### 5. Kafka (Port 9092)
- **Event Streaming**: Publishes and consumes events
- **Topics**:
  - `user-events`: User login, registration events
  - `file-events`: File upload, delete events
- **Event-Driven Architecture**: Enables decoupled communication between services

### 6. Frontend (Port 8080)
- User authentication UI
- File management dashboard
- Modern, responsive design
- Communicates only with API Gateway

## Getting Started

### Prerequisites
- Docker and Docker Compose
- Node.js 18+ (for local development)

### Running with Docker

```bash
docker-compose up --build
```

This will start:
- Frontend: http://localhost:8080
- API Gateway: http://localhost:3000
- Auth Service: http://localhost:3001 (internal)
- File Service: http://localhost:3002 (internal)
- MongoDB: localhost:27017
- Redis: localhost:6379
- Kafka: localhost:9092
- Zookeeper: (internal, required by Kafka)

### Local Development

#### Auth Service
```bash
cd auth-service
npm install
npm run dev
```

#### File Service
```bash
cd file-service
npm install
npm run dev
```

#### Frontend
```bash
cd frontend
npm install
npm start
```

## API Endpoints

All endpoints are accessed through the API Gateway at `http://localhost:3000`

### Auth Endpoints (via API Gateway)
- `POST /api/auth/register` - Register new user (publishes USER_REGISTERED event)
- `POST /api/auth/login` - Login user (publishes USER_LOGIN_ATTEMPT event)
- `GET /api/auth/verify` - Verify JWT token

### File Endpoints (via API Gateway, requires authentication)
- `POST /api/files/upload` - Upload file (publishes FILE_UPLOADED event, cached)
- `GET /api/files` - List all files (cached for 5 minutes)
- `GET /api/files/:id` - Get file by ID (cached for 5 minutes)
- `GET /api/files/:id/download` - Download file
- `DELETE /api/files/:id` - Delete file (publishes FILE_DELETED event)

### Gateway Endpoints
- `GET /health` - Health check endpoint (shows gateway, Redis status)

## Technology Stack

- **Frontend**: React, Material-UI, Axios
- **API Gateway**: Node.js, Express, http-proxy-middleware
- **Backend Services**: Node.js, Express
- **Database**: MongoDB
- **Caching**: Redis
- **Message Broker**: Kafka (with Zookeeper)
- **Authentication**: JWT
- **Rate Limiting**: express-rate-limit with Redis store
- **Containerization**: Docker, Docker Compose

## Features

### API Gateway Features
- ✅ Request routing to microservices
- ✅ JWT token verification and caching
- ✅ Response caching (5-minute TTL for GET requests)
- ✅ Rate limiting (100 requests per 15 minutes per IP)
- ✅ Request throttling (delays after 50 requests)
- ✅ Event publishing to Kafka
- ✅ Health check endpoint

### Redis Usage
- Token blacklisting support
- User information caching (1-hour TTL)
- API response caching (5-minute TTL)
- Rate limiting counters

### Kafka Events
- **user-events** topic:
  - `USER_LOGIN_ATTEMPT`: Published on successful login
  - `USER_REGISTERED`: Published on user registration
- **file-events** topic:
  - `FILE_UPLOADED`: Published on file upload
  - `FILE_DELETED`: Published on file deletion

## Environment Variables

### API Gateway
- `PORT`: Gateway port (default: 3000)
- `AUTH_SERVICE_URL`: Auth service URL (default: http://auth-service:3001)
- `FILE_SERVICE_URL`: File service URL (default: http://file-service:3002)
- `REDIS_URL`: Redis connection URL (default: redis://redis:6379)
- `KAFKA_BROKERS`: Kafka broker addresses (default: kafka:29092)
- `JWT_SECRET`: JWT secret key (must match auth-service)

