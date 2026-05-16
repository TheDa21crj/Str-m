const express = require("express");
const router = express.Router();

// Test Route
router.get("/", (req, res) => {
  res.status(202).json({
    success: true,
    error: "",
    message: "openCanvans: API Home 🏡",
    time: new Date(),
  });
});

// route
router.use("/video", require("./video/upload.js"));

// Route not found
router.use((req, res, next) => {
  console.log("openCanvans: API URL not Found || Requested URL -  " + req.url);

  return res.status(404).json({
    success: false,
    error: "",
    message: "openCanvans: 404 Not Found",
    time: new Date(),
  });
});

module.exports = router;
