const mongoose = require('mongoose');

const borrowingSchema = new mongoose.Schema({
  member: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Member',
    required: true,
  },
  book: { type: mongoose.Schema.Types.ObjectId, ref: 'Book', required: true },
  borrowDate: { type: Date, default: Date.now },
  returnDate: { type: Date },
  returned: { type: Boolean, default: false },
});

module.exports = mongoose.model('Borrowing', borrowingSchema);
