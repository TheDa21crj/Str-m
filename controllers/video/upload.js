const { exec, spawn } = require("child_process");

// file
const fs = require("fs");
const path = require("path");
const multer = require("multer");

// id
const { v4: uuidv4 } = require("uuid");

// model
const video = require("../../model/video");

// appwrite
const sdk = require("node-appwrite");
const { Client, Storage, ID, Permission, Role } = require("node-appwrite");
const { InputFile } = require("node-appwrite/file");

// Initialize Client and increase timeout thresholds to prevent dropped network pipes during large chunk transmissions
const client = new Client()
  .setEndpoint("https://cloud.appwrite.io/v1")
  .setProject(process.env.PROJECT_ID)
  .setKey(process.env.SECRET_KEY);

// FIX: Corrected casing from setTIMEOUT to setTimeout
if (typeof client.setTimeout === "function") {
  client.setTimeout(300000); // 5-minute timeout window
} else {
  // Fallback fallback if your specific SDK version handles it natively via properties
  client.timeout = 300000;
}

const storage = new Storage(client);

// Simple utility function to handle exponential delays during retries
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Enhanced recursive directory uploader featuring a retry policy and progressive backoff
 * to handle transient network issues or 499 client-dropped sockets natively.
 */
const uploadDirectoryToAppwrite = async (localDirPath, baseAppwritePath) => {
  const entries = fs.readdirSync(localDirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullLocalPath = path.join(localDirPath, entry.name);
    const relativeAppwritePath = `${baseAppwritePath}/${entry.name}`;

    if (entry.isDirectory()) {
      await uploadDirectoryToAppwrite(fullLocalPath, relativeAppwritePath);
    } else if (entry.isFile()) {
      if (!fs.existsSync(fullLocalPath)) continue;

      const maxRetries = 3;
      let attempt = 0;
      let success = false;

      while (attempt < maxRetries && !success) {
        try {
          await storage.createFile(
            process.env.BUCKET_ID,
            ID.unique(),
            InputFile.fromPath(fullLocalPath, relativeAppwritePath),
            [
              Permission.read(Role.any()),
              Permission.update(Role.users()),
              Permission.delete(Role.users()),
            ],
          );

          console.log(
            `Successfully synced to Appwrite: ${relativeAppwritePath}`,
          );
          success = true;
        } catch (uploadErr) {
          attempt++;
          console.warn(
            `⚠️ Appwrite upload attempt ${attempt} failed for ${entry.name}. Code: ${uploadErr.code}. Reason: ${uploadErr.message}`,
          );

          if (attempt >= maxRetries) {
            console.error(
              `❌ Permanent failure uploading ${entry.name} after ${maxRetries} attempts.`,
            );
            throw uploadErr; // Propagate exception to fail the overarching sync step cleanly
          }

          const backoffTime = attempt * 2000;
          console.log(
            `Retrying ${entry.name} in ${backoffTime / 1000} seconds...`,
          );
          await delay(backoffTime);
        }
      }
    }
  }
};

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
        hasAudio = probeData.streams.some(
          (stream) => stream.codec_type === "audio",
        );

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

    const videoUrl = `${client.config.endpoint}/storage/buckets/${process.env.BUCKET_ID}/files?search=${contentId}`;

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

      console.log(
        "Local processing completed. Starting Appwrite Cloud Bucket Upload Synchronization...",
      );

      try {
        // Core Execution: Begin syncing directory structural payload directly into Appwrite Cloud Storage
        await uploadDirectoryToAppwrite(outputPath, `m3u8Data/${contentId}`);
        console.log(
          "Appwrite Storage upload synchronization completed successfully.",
        );

        // Update record status to completed only if the storage synchronization succeeds without permanent crashes
        await video.updateOne(
          { contentId },
          {
            status: "completed",
            availableResolutions: resolutions,
          },
        );

        // Cleanup: Clear local workspace files to preserve space on the app container
        fs.rmSync(outputPath, { recursive: true, force: true });
        if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
      } catch (uploadError) {
        console.error(
          "Failed to sync transcoded files to Appwrite Storage after retry sequences:",
          uploadError,
        );
        await video.updateOne(
          { contentId },
          {
            status: "failed",
            errorReason:
              "Transcoded asset pipeline failed to synchronize onto Cloud Storage.",
          },
        );
      }
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
