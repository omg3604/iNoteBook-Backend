const mongoose = require('mongoose');
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });

// URL for using Mongo db Compass
// const mongoURI= 'mongodb://localhost:27017/inotebook'

// URL for using Mongo db Atlas
const mongoURI= process.env.CYCLIC_DB_URL

// connecting to monogodb
const connectToMongo = ()=>{
    mongoose.connect(mongoURI, ()=>{
        console.log("connnected to mongo successfully!");
    })
}

module.exports = connectToMongo;