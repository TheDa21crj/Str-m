const multer = require("multer");
const { v4: uuidv4 } = require("uuid");
const fs = require("fs");
const path = require("path");
const { exec, spawn } = require("child_process");

// model
const video = require("../../model/video");

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

  // FIXED: Simplified and robust ffprobe entry request to capture all stream properties cleanly
  const probeCmd = `ffprobe -v error -show_entries stream=codec_name,codec_type -show_entries format=duration,size -of json "${videoPath}"`;

  exec(probeCmd, async (probeErr, stdout) => {
    if (probeErr) {
      console.error("Probing error:", probeErr);
      return res.status(500).json({ error: "Failed to analyze video file." });
    }

    let hasAudio = false;
    let duration = 0;
    let size = req.file.size || 0;
    let codec = "";

    try {
      const probeData = JSON.parse(stdout);

      if (probeData.streams) {
        // FIXED: Deterministic check for an audio track using standard codec_type property
        hasAudio = probeData.streams.some(
          (stream) => stream.codec_type === "audio",
        );

        // Find the video codec profile name
        const videoStream = probeData.streams.find(
          (stream) => stream.codec_type === "video",
        );
        if (videoStream) {
          codec = videoStream.codec_name;
        }
      }

      if (probeData.format) {
        duration = parseFloat(probeData.format.duration) || 0;
        size = parseInt(probeData.format.size) || size;
      }
    } catch (e) {
      console.error("Failed to parse ffprobe JSON data:", e);
    }

    console.log(`Audio detected status: ${hasAudio}`);

    const resolutions = [
      "2160p",
      "1440p",
      "1080p",
      "720p",
      "480p",
      "360p",
      "240p",
      "144p",
    ];
    const totalVariants = resolutions.length;
    const videoUrl = `http://127.0.0.1:5000/storage/m3u8Data/${contentId}/master.m3u8`;

    let videoDoc;
    try {
      videoDoc = await video.create({
        userID: req.body.userID || "",
        contentId,
        originalName: req.file.originalname,
        videoUrl,
        outputPath,
        status: "processing",
        hasAudio,
        metadata: { duration, size, codec },
        availableResolutions: [],
      });
      console.log(
        `Database record created for ${contentId} (Status: processing)`,
      );
    } catch (dbErr) {
      console.error("Failed to create video record in DB:", dbErr);
      return res.status(500).json({ error: "Database initialization failed." });
    }

    for (let i = 0; i < totalVariants; i++) {
      const variantDir = path.join(outputPath, `v${i}`);
      if (!fs.existsSync(variantDir)) {
        fs.mkdirSync(variantDir, { recursive: true });
      }
    }

    const streamMap = hasAudio
      ? "v:0,a:0 v:1,a:1 v:2,a:2 v:3,a:3 v:4,a:4 v:5,a:5 v:6,a:6 v:7,a:7"
      : "v:0 v:1 v:2 v:3 v:4 v:5 v:6 v:7";

    const ffmpegArgs = [
      "-i",
      videoPath,
      "-preset",
      "superfast",
      "-g",
      "48",
      "-sc_threshold",
      "0",
    ];

    for (let i = 0; i < totalVariants; i++) {
      ffmpegArgs.push("-map", "0:v:0");
    }

    if (hasAudio) {
      for (let i = 0; i < totalVariants; i++) {
        ffmpegArgs.push("-map", "0:a:0");
      }
    }

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
      "h264_videotoolbox",
    );

    // FIXED: Ensured configurations cleanly apply the audio codec parameters instead of -an strip flag
    if (hasAudio) {
      ffmpegArgs.push("-c:a", "aac", "-ar", "48000", "-async", "1");
    } else {
      ffmpegArgs.push("-an");
    }

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

    console.log("Starting Hardware-Accelerated FFmpeg processing...");

    res.status(202).json({
      success: true,
      error: "",
      message: { videoUrl, contentId },
      time: new Date(),
    });

    const ffmpegProcess = spawn("ffmpeg", ffmpegArgs);

    ffmpegProcess.stderr.on("data", (data) => {
      console.log(`FFmpeg Log: ${data.toString()}`);
    });

    ffmpegProcess.on("close", async (code) => {
      if (code !== 0) {
        console.error(`FFmpeg process exited with error code ${code}`);
        await video.updateOne(
          { contentId },
          {
            status: "failed",
            errorReason: `Transcoding failed with exit code ${code}`,
          },
        );
        return;
      }

      console.log("Processing completed successfully.");
      await video.updateOne(
        { contentId },
        {
          status: "completed",
          availableResolutions: resolutions,
        },
      );
    });

    ffmpegProcess.on("error", async (err) => {
      console.error("Failed to start FFmpeg process:", err);
      await video.updateOne(
        { contentId },
        {
          status: "failed",
          errorReason: err.message,
        },
      );
    });
  });
};

exports.upload = upload;
