const multer = require("multer");
const { v4: uuidv4 } = require("uuid");
const path = require("path");
const fs = require("fs");
const { exec, spawn } = require("child_process");

const upload = async (req, res, next) => {
  console.log("openCanvans: Uploading Video... ");

  if (!req.file) {
    return res.status(400).json({ success: false, error: "No file uploaded." });
  }

  const contentId = uuidv4();
  const videoPath = req.file.path;
  const outputPath = path.resolve(`./storage/m3u8Data/${contentId}`);

  if (!fs.existsSync(outputPath)) {
    fs.mkdirSync(outputPath, { recursive: true });
  }

  console.log("videoPath - ", videoPath);
  console.log("outputPath - ", outputPath);

  const probeCmd = `ffprobe -v error -select_streams a -show_entries stream=index -of csv=p=0 "${videoPath}"`;

  exec(probeCmd, (probeErr, stdout) => {
    if (probeErr) {
      console.error("Probing error:", probeErr);
      return res.status(500).json({ error: "Failed to analyze video file." });
    }

    const hasAudio = stdout.trim().length > 0;
    const totalVariants = 8;

    // Pre-create variant directories (v0 to v7)
    for (let i = 0; i < totalVariants; i++) {
      const variantDir = path.join(outputPath, `v${i}`);
      if (!fs.existsSync(variantDir)) {
        fs.mkdirSync(variantDir, { recursive: true });
      }
    }

    const streamMap = hasAudio
      ? "v:0,a:0 v:1,a:1 v:2,a:2 v:3,a:3 v:4,a:4 v:5,a:5 v:6,a:6 v:7,a:7"
      : "v:0 v:1 v:2 v:3 v:4 v:5 v:6 v:7";

    // Base FFmpeg args
    const ffmpegArgs = [
      "-i",
      videoPath,
      "-preset",
      "fast",
      "-g",
      "48",
      "-sc_threshold",
      "0",
    ];

    // FIX: Map the single input stream (0:v:0) exactly 8 times
    // This populates the internal streams so var_stream_map can find v:0 through v:7
    for (let i = 0; i < totalVariants; i++) {
      ffmpegArgs.push("-map", "0:v:0");
    }

    // Map the audio stream 8 times if it exists
    if (hasAudio) {
      for (let i = 0; i < totalVariants; i++) {
        ffmpegArgs.push("-map", "0:a:0");
      }
    }

    // Apply the video filters explicitly targeting each generated stream index
    ffmpegArgs.push(
      "-filter:v:0",
      "scale=3840:2160:force_original_aspect_ratio=decrease,pad=3840:2160:(ow-iw)/2:(oh-ih)/2",
      "-b:v:0",
      "20M",
      "-filter:v:1",
      "scale=2560:1440:force_original_aspect_ratio=decrease,pad=2560:1440:(ow-iw)/2:(oh-ih)/2",
      "-b:v:1",
      "12M",
      "-filter:v:2",
      "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2",
      "-b:v:2",
      "5M",
      "-filter:v:3",
      "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2",
      "-b:v:3",
      "2.5M",
      "-filter:v:4",
      "scale=854:480:force_original_aspect_ratio=decrease,pad=854:480:(ow-iw)/2:(oh-ih)/2",
      "-b:v:4",
      "1M",
      "-filter:v:5",
      "scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2",
      "-b:v:5",
      "750k",
      "-filter:v:6",
      "scale=426:240:force_original_aspect_ratio=decrease,pad=426:240:(ow-iw)/2:(oh-ih)/2",
      "-b:v:6",
      "400k",
      "-filter:v:7",
      "scale=256:144:force_original_aspect_ratio=decrease,pad=256:144:(ow-iw)/2:(oh-ih)/2",
      "-b:v:7",
      "200k",
      "-c:v",
      "libx264",
    );

    if (hasAudio) {
      ffmpegArgs.push("-c:a", "aac", "-ar", "48000", "-async", "1");
    } else {
      ffmpegArgs.push("-an");
    }

    // Append HLS Packaging parameters
    ffmpegArgs.push(
      "-f",
      "hls",
      "-hls_time",
      "10",
      "-hls_playlist_type",
      "vod",
      "-master_pl_name",
      "master.m3u8",
      "-hls_segment_filename",
      `${outputPath}/v%v/segment%03d.ts`,
      "-var_stream_map",
      streamMap,
      `${outputPath}/v%v/index.m3u8`,
    );

    console.log("Starting FFmpeg processing via spawn...");

    const ffmpegProcess = spawn("ffmpeg", ffmpegArgs);

    ffmpegProcess.stderr.on("data", (data) => {
      console.log(`FFmpeg Log: ${data.toString()}`);
    });

    ffmpegProcess.on("close", (code) => {
      if (code !== 0) {
        console.error(`FFmpeg process exited with error code ${code}`);
        return res.status(500).json({
          success: false,
          error: `Transcoding failed with exit code ${code}`,
          message: { videoUrl: "", contentId },
          time: new Date(),
        });
      }

      console.log("Processing completed successfully.");
      const videoUrl = `http://127.0.0.1:5000/storage/m3u8Data/${contentId}/master.m3u8`;

      return res.status(202).json({
        success: true,
        error: "",
        message: { videoUrl, contentId },
        time: new Date(),
      });
    });

    ffmpegProcess.on("error", (err) => {
      console.error("Failed to start FFmpeg process:", err);
      return res.status(500).json({
        success: false,
        error: err.message,
        message: { videoUrl: "", contentId },
        time: new Date(),
      });
    });
  });
};

exports.upload = upload;
