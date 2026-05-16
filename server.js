const express = require("express");
const path = require("path");
const cors = require("cors");

// db
const connectDB = require("./config/db");

const app = express();

// cros
app.use(
  cors({
    origin: [
      "http://localhost:3000",
      "http://localhost:5173",
      "http://127.0.0.1:5000",
      "http://127.0.0.1:5173",
    ],
    credentials: true,
  }),
);

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*"); // watch it
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept",
  );
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, "public")));
app.use("/storage", express.static("storage"));

// connect to DB
connectDB();

// 4. Test Route
app.get("/ZPIwQUYMfd34yDIr", (req, res) => {
  res.status(202).json({
    success: true,
    error: "",
    message: "openCanvans: Server is running",
    time: new Date(),
  });
});

// route
app.use("/api/internal", require("./routes/api"));

// error route
app.use((req, res) => {
  console.log(
    `openCanvans: URL not Found || Requested URL - ${req.originalUrl} [${req.method}]`,
  );

  res.status(404).json({
    success: false,
    error: "404 - Not Found",
    message: "The requested URL was not found on this server.",
    time: new Date(),
  });
});

const port = process.env.PORT || 5000;

app.listen(port, "127.0.0.1", () => {
  console.log(
    `openCanvans: Server is listening on port ${port} [http://localhost:${port}]`,
  );
});
