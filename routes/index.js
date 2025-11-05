// routes/index.js
const express = require('express');
const router = express.Router();

router.get('/api', (req, res) => {
  res.status(200).json({
    message: 'Llama.io API root',
    data: null
  });
});

module.exports = router;
