const mongoose = require("mongoose");

const VideoSchema = new mongoose.Schema({
  contentId: {
    type: String,
    required: true,
    unique: true,
  },
  originalName: {
    type: String,
    required: true,
  },
  videoUrl: {
    type: String,
    required: true,
  },
  outputPath: {
    type: String,
    required: true,
  },
  status: {
    type: String,
    enum: ["processing", "completed", "failed"],
    default: "processing",
  },
  hasAudio: {
    type: Boolean,
    default: false,
  },
  errorReason: {
    type: String,
    default: "",
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("Video", VideoSchema);
