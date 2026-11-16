const mongoose = require('mongoose');

const doorSchema = new mongoose.Schema({
    day: Number,
    title: String,
    content: String
});

const Door = mongoose.model('Door', doorSchema);

module.exports = Door;