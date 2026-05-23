const mongoose = require("mongoose");

const videoSchema = new mongoose.Schema(
    {userID:{
        
        type: String,
        default: "",
  },
    contentId: {
      type: String,
      required: true,
      unique: true,
      index: true, // Speeds up lookups when querying by UUID
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
      index: true, // Useful for filtering working queues or stuck jobs
    },
    hasAudio: {
      type: Boolean,
      default: false,
    },
    // NEW: Analytical Metadata
    metadata: {
      duration: { type: Number, default: 0 }, // In seconds
      size: { type: Number, default: 0 }, // Original file size in bytes
      codec: { type: String, default: "" }, // Input codec (e.g., av1, h264)
    },
    // NEW: Granular track tracking for variant checkpoints
    availableResolutions: {
      type: [String],
      enum: ["2160p", "1440p", "1080p", "720p", "480p", "360p", "240p", "144p"],
      default: [],
    },
    errorReason: {
      type: String,
      default: "",
    },
  },
  { timestamps: true },
);

// Pre-delete file cleanup middleware || Automatically removes the storage directories if you execute `videoDoc.deleteOne()`
videoSchema.pre("deleteOne", { document: true, query: false }, function (next) {
  const fs = require("fs");
  try {
    if (fs.existsSync(this.outputPath)) {
      fs.rmSync(this.outputPath, { recursive: true, force: true });
      console.log(`Cleaned up HLS directory: ${this.outputPath}`);
    }
  } catch (err) {
    console.error(
      "Failed to delete local video directory during schema cleanup:",
      err,
    );
  }
  next();
});

module.exports = mongoose.model("Video", videoSchema);
