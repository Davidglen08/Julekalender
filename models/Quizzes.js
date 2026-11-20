const mongoose = require('mongoose');

const doorSchema = new mongoose.Schema({
    day: Number,
    question: String,
    options: [String],      // hvis det er flervalg
    answer: String
});

const Quizzes = mongoose.model('Quizzes', doorSchema);

module.exports = Quizzes;