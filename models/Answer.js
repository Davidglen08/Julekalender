const mongoose = require('mongoose');

const answerSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    day: { type: Number, min: 1, max: 24, required: true },
    answer: { type: String, required: true, trim: true },
    correct: { type: Boolean, default: null }, // null = ikke vurdert ennå
    isWinner: { type: Boolean, default: false }
  },
  { timestamps: true }
);

// Én bruker kan bare svare én gang per luke
answerSchema.index({ user: 1, day: 1 }, { unique: true });

module.exports = mongoose.model('Answer', answerSchema);