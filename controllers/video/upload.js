const multer = require("multer");
const { v4: uuidv4 } = require("uuid");
const path = require("path");
const fs = require("fs");
const { exec } = require("child_process");

const upload = async (req, res, next) => {
  console.log("openCanvans: Uploading Video... ");

  const contentId = uuidv4();
  const videoPath = req.file.path;
  const outputPath = `./storage/m3u8Data/${contentId}`;
  const hlsPath = `${outputPath}/index.m3u8`;

  if (!fs.existsSync(outputPath)) {
    fs.mkdirSync(outputPath, { recursive: true });
  }

  console.log("videoPath - ", videoPath);
  console.log("outputPath - ", outputPath);
  console.log("hlsPath - ", hlsPath);

  // ffmpeg -- for 1 video qulality
  // const ffmpegCommand = `ffmpeg -i ${videoPath} -codec:v libx264 -codec:a aac -hls_time 5 -hls_playlist_type vod -hls_segment_filename "${outputPath}/segment%03d.ts" -start_number 0 ${hlsPath}`;

  // working - multiple segments for same video
  // const ffmpegCommand = `ffmpeg -i ${videoPath} \
  // -preset fast -g 48 -sc_threshold 0 \
  // -map 0:v -map 0:v -map 0:v -map 0:v -map 0:v -map 0:v -map 0:v -map 0:v \
  // -s:v:0 3840x2160 -b:v:0 20M \
  // -s:v:1 2560x1440 -b:v:1 12M \
  // -s:v:2 1920x1080 -b:v:2 5M \
  // -s:v:3 1280x720  -b:v:3 2.5M \
  // -s:v:4 854x480   -b:v:4 1M \
  // -s:v:5 640x360   -b:v:5 750k \
  // -s:v:6 426x240   -b:v:6 400k \
  // -s:v:7 256x144   -b:v:7 200k \
  // -c:v libx264 \
  // -f hls -hls_time 10 -hls_playlist_type vod \
  // -master_pl_name master.m3u8 \
  // -hls_segment_filename "${outputPath}/v%v/segment%03d.ts" \
  // -var_stream_map "v:0 v:1 v:2 v:3 v:4 v:5 v:6 v:7" \
  // ${outputPath}/v%v/index.m3u8`;

  // 2. Check for Audio Stream using ffprobe
  const probeCmd = `ffprobe -v error -select_streams a -show_entries stream=index -of csv=p=0 ${videoPath}`;

  // no queue because of POC, not to be used in production
  // exec(ffmpegCommand, (error, stdout, stderr) => {
  //   if (error) {
  //     console.log(`exec error: ${error}`);

  //     res.status(202).json({
  //       success: false,
  //       error: "",
  //       message: { videoUrl: "", contentId },
  //       time: new Date(),
  //     });
  //   }
  //   console.log(`stdout: ${stdout}`);
  //   console.log(`stderr: ${stderr}`);

  //   const videoUrl = `http://localhost:8000/storage/m3u8Data/${contentId}/index.m3u8`;

  //   res.status(202).json({
  //     success: true,
  //     error: "",
  //     message: { videoUrl, contentId },
  //     time: new Date(),
  //   });
  // });

  exec(probeCmd, (probeErr, stdout) => {
    if (probeErr) {
      console.error("Probing error:", probeErr);
      return res.status(500).json({ error: "Failed to analyze video file." });
    }

    const hasAudio = stdout.trim().length > 0;

    const videoMaps = "-map 0:v ".repeat(8);

    const audioMaps = hasAudio ? "-map 0:a ".repeat(8) : "";

    const streamMap = hasAudio
      ? "v:0,a:0 v:1,a:1 v:2,a:2 v:3,a:3 v:4,a:4 v:5,a:5 v:6,a:6 v:7,a:7"
      : "v:0 v:1 v:2 v:3 v:4 v:5 v:6 v:7";

    const audioCodec = hasAudio ? "-c:a aac -ar 48000" : "-an";

    // 4. Construct the Final FFmpeg Command
    const ffmpegCommand = `ffmpeg -i ${videoPath} \
            -preset fast -g 48 -sc_threshold 0 \
            ${videoMaps} ${audioMaps} \
            -s:v:0 3840x2160 -b:v:0 20M \
            -s:v:1 2560x1440 -b:v:1 12M \
            -s:v:2 1920x1080 -b:v:2 5M \
            -s:v:3 1280x720  -b:v:3 2.5M \
            -s:v:4 854x480   -b:v:4 1M \
            -s:v:5 640x360   -b:v:5 750k \
            -s:v:6 426x240   -b:v:6 400k \
            -s:v:7 256x144   -b:v:7 200k \
            -c:v libx264 ${audioCodec} \
            -f hls -hls_time 10 -hls_playlist_type vod \
            -master_pl_name master.m3u8 \
            -hls_segment_filename "${outputPath}/v%v/segment%03d.ts" \
            -var_stream_map "${streamMap}" \
            ${outputPath}/v%v/index.m3u8`;

    console.log("Starting FFmpeg processing...");

    exec(ffmpegCommand, (execErr, stdout, stderr) => {
      if (execErr) {
        console.error(`FFmpeg Error: ${execErr.message}`);
        // return ensures we don't try to send another response later
        return res.status(500).json({
          success: false,
          error: "",
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
  });
};

exports.upload = upload;
