const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const fs = require('fs-extra');
require('dotenv').config();

const fileRoutes = require('./routes/files');
const { authenticateToken } = require('./middleware/auth');

const app = express();

// Ensure upload directory exists
const uploadDir = process.env.UPLOAD_DIR || './uploads';
fs.ensureDirSync(uploadDir);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/files', authenticateToken, fileRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', service: 'file-service' });
});

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/distributed-storage', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('File Service: Connected to MongoDB'))
.catch(err => console.error('File Service: MongoDB connection error:', err));

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
  console.log(`File Service running on port ${PORT}`);
});

