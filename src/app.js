const express = require('express');
const mongoose = require('mongoose');

const app = express();

if (process.env.NODE_ENV === 'development') {
  console.log(' Development mode enabled');
}

module.exports = app;