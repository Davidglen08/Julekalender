const mongoose = require('mongoose');

const quizSchema = new mongoose.Schema({
  _id: String,
  createdAt: Date,
  questions: [
    {
      id: Number,
      type: { type: String },   // må skrives slik, siden "type" er et reservert ord i Mongoose
      question: String,
      options: [String],
      video_url: String,
      correct_answer: String
    }
  ]
});

module.exports = mongoose.model('Quizzes', quizSchema, 'quizzes');