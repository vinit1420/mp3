// models/task.js
const mongoose = require('mongoose');

const TaskSchema = new mongoose.Schema({
  name: {
    type: String,
    default: ""
  },
  description: {
    type: String,
    default: ""
  },
  deadline: {
    type: Date
  },
  completed: {
    type: Boolean,
    default: false
  },
  assignedUser: {
    // user _id as string
    type: String,
    default: ""
  },
  assignedUserName: {
    type: String,
    default: "unassigned"
  },
  dateCreated: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Task', TaskSchema);
