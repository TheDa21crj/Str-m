const express = require("express");

const multer = require("multer");
const { v4: uuidv4 } = require("uuid");
const path = require("path");
const fs = require("fs");
const { exec } = require("child_process");

const router = express.Router();

// controllers
const uploadController = require("./../../controllers/video/upload.js");

// error
// const { check } = require("express-validator");

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "./storage/rawFiles");
  },
  filename: function (req, file, cb) {
    cb(null, file.fieldname + "-" + uuidv4() + path.extname(file.originalname));
  },
});

// multer configuration
const upload = multer({ storage: storage });

router.post("/upload", upload.single("file"), uploadController.upload);

module.exports = router;
