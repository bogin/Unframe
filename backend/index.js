require('dotenv').config();
const express = require('express');
const cors = require('cors');
const routes = require('./routes/index');
const validateDatabaseConnection = require('./db/postgres.db.connection');
const googleService = require('./services/google.service');
const syncQueue = require('./services/queue');
const etlService = require('./services/etl.service');
const { connectToMongoDB } = require('./db/mongo.connection');

async function startServer() {
  const isMongoDbConnected = await connectToMongoDB();
  if (!isMongoDbConnected) {
    throw new Error('Mongo Database connection failed');
  }
  console.log('Mongo Database connected successfully');

  const isDbConnected = await validateDatabaseConnection();
  if (!isDbConnected) throw new Error('Database connection failed');

  const app = express();

  const port = process.env.PORT || 3000;

  app.use(express.json());
  app.use(cors({
    origin: 'http://localhost:8080'
  }));
  app.use('/', routes);

  const errorHandler = (err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ message: err.message });
  };

  app.use(errorHandler);

  const server = app.listen(port, () => {
    console.log(`API Server running on port ${port}`);
  });

  await Promise.all([
    googleService.initialize(),
    etlService.initialize(),
    syncQueue.initialize()
  ]);


  googleService.on('authenticated', async (auth) => {
    await etlService.setAuth(auth);
    syncQueue.setInitialized(true);
  });

  return server;
}

process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received. Shutting down gracefully...');
  process.exit(0);
});

startServer().catch(error => {
  console.error('Fatal error during startup:');
  process.exit(1);
});