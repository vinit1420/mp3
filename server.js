const express = require('express');
const mongoose = require('mongoose');
require('dotenv').config();

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true })); 

// connect to Mongo
const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/mp3';
mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('Mongo error:', err));

// import routes
const homeRoute = require('./routes/home');
const indexRoute = require('./routes/index');
const usersRoute = require('./routes/users');
const tasksRoute = require('./routes/tasks');

// mount routes
app.use('/', homeRoute);
app.use('/', indexRoute);
app.use('/api/users', usersRoute);
app.use('/api/tasks', tasksRoute);

// fallback 404 (JSON!)
app.use((req, res) => {
  res.status(404).json({
    message: 'Endpoint not found',
    data: null
  });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
