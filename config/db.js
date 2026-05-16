const mongoose = require("mongoose");

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGOURI, {});

    console.log("openCanvans: db Connected ✅");
  } catch (error) {
    console.log("openCanvans: db not Connected ❌");
    console.log(error);
  }
};

module.exports = connectDB;
