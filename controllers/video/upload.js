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

  // Expanded probe command to fetch format information like size, duration, and codec name
  const probeCmd = `ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -show_entries format=duration,size -select_streams a -show_entries stream=index -of json "${videoPath}"`;

  exec(probeCmd, async (probeErr, stdout) => {
    if (probeErr) {
      console.error("Probing error:", probeErr);
      return res.status(500).json({ error: "Failed to analyze video file." });
    }

    let hasAudio = false;
    let duration = 0;
    let size = req.file.size || 0; // Fallback to multer size if ffprobe fails
    let codec = "";

    try {
      const probeData = JSON.parse(stdout);
      // Check if audio streams exist
      hasAudio =
        probeData.streams &&
        probeData.streams.some(
          (stream) => stream.index !== undefined && !stream.codec_name,
        );
      // Re-evaluate audio if the index check is strict, or fallback to checking stream characteristics
      hasAudio =
        (stdout.includes('"index"') &&
          stdout.toLowerCase().includes("audio")) ||
        (probeData.streams && probeData.streams.length > 1);

      // Better JSON structural parsing for metadata
      if (probeData.format) {
        duration = parseFloat(probeData.format.duration) || 0;
        size = parseInt(probeData.format.size) || size;
      }
      const videoStream =
        probeData.streams &&
        probeData.streams.find((s) => s.codec_name && s.codec_name !== "aac");
      if (videoStream) {
        codec = videoStream.codec_name;
      }
    } catch (e) {
      console.error("Failed to parse ffprobe JSON data:", e);
    }

    // Define all targeted resolutions
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

    // 2. Initialize the MongoDB Record with 'processing' status
    let videoDoc;
    try {
      videoDoc = await video.create({
        userID: req.body.userID || "", // Expecting userID from request body if available
        contentId,
        originalName: req.file.originalname,
        videoUrl,
        outputPath,
        status: "processing",
        hasAudio,
        metadata: { duration, size, codec },
        availableResolutions: [], // Empty until processing is complete
      });
      console.log(
        `Database record created for ${contentId} (Status: processing)`,
      );
    } catch (dbErr) {
      console.error("Failed to create video record in DB:", dbErr);
      return res.status(500).json({ error: "Database initialization failed." });
    }

    // Pre-create the directory structure for all 8 variant streams
    for (let i = 0; i < totalVariants; i++) {
      const variantDir = path.join(outputPath, `v${i}`);
      if (!fs.existsSync(variantDir)) {
        fs.mkdirSync(variantDir, { recursive: true });
      }
    }

    // Map video and audio indexes smoothly across all 8 variants
    const streamMap = hasAudio
      ? "v:0,a:0 v:1,a:1 v:2,a:2 v:3,a:3 v:4,a:4 v:5,a:5 v:6,a:6 v:7,a:7"
      : "v:0 v:1 v:2 v:3 v:4 v:5 v:6 v:7";

    // Optimized FFmpeg arguments configuration
    const ffmpegArgs = [
      "-i",
      videoPath,
      "-preset",
      "superfast", // Keeps execution fast across 8 streams
      "-g",
      "48",
      "-sc_threshold",
      "0",
    ];

    // Explicitly clone primary video track to 8 separate internal slots
    for (let i = 0; i < totalVariants; i++) {
      ffmpegArgs.push("-map", "0:v:0");
    }

    // Explicitly clone audio track to 8 slots if present
    if (hasAudio) {
      for (let i = 0; i < totalVariants; i++) {
        ffmpegArgs.push("-map", "0:a:0");
      }
    }

    // Build scaled layers targeting all 8 resolutions with proper aspect preservation
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
      "h264_videotoolbox", // Hardware Acceleration Engine
    );

    if (hasAudio) {
      ffmpegArgs.push("-c:a", "aac", "-ar", "48000", "-async", "1");
    } else {
      ffmpegArgs.push("-an");
    }

    // Packaging execution flags to segment master list targets
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

    // Immediately respond to client with 202 Accepted status
    // This stops HTTP timeouts since transcoding takes time
    res.status(202).json({
      success: true,
      error: "",
      message: { videoUrl, contentId },
      time: new Date(),
    });

    const ffmpegProcess = spawn("ffmpeg", ffmpegArgs);

    ffmpegProcess.stderr.on("data", (data) => {
      // Optional: Reduce logging noise in production if needed
      console.log(`FFmpeg Log: ${data.toString()}`);
    });

    ffmpegProcess.on("close", async (code) => {
      if (code !== 0) {
        console.error(`FFmpeg process exited with error code ${code}`);

        // 3. Update DB record on Failure
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

      // 4. Update DB record on Success
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

      // 5. Update DB record on Process Spawning Error
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
