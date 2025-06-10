const mongoose = require('mongoose');

const bookSchema = new mongoose.Schema({
  title: { type: String, required: true },
  author: { type: String, required: true },
  category: { type: String },
  isbn: { type: String, unique: true },
  availableCopies: { type: Number, default: 1 },
});

module.exports = mongoose.model('Book', bookSchema);
