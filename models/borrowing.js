const mongoose = require('mongoose');
const Member = require('./member');
const Book = require('./book');

const borrowingSchema = new mongoose.Schema({
  member: {
    type: mongoose.Schema.Types.ObjectId,
    ref: Member.modelName,
    required: true,
  },
  book: {
    type: mongoose.Schema.Types.ObjectId,
    ref: Book.modelName,
    required: true,
  },
  borrowDate: { type: Date, default: Date.now },
  returnDate: { type: Date },
  returned: { type: Boolean, default: false },
});

module.exports = mongoose.model('Borrowing', borrowingSchema);
