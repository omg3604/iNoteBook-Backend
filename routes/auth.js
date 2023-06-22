const express = require('express');
const User = require('../models/User');
const UserVerify = require('../models/UserVerify');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const JWT_SECRET = "Omis&agood&boy";
const fetchUser = require('../middleware/fetchUser');

require('dotenv').config();
const nodemailer = require('nodemailer');
const { google } = require("googleapis");
const OAuth2 = google.auth.OAuth2;

const createTransporter = async () => {
  const oauth2Client = new OAuth2(
    process.env.REACT_APP_CLIENT_ID,
    process.env.REACT_APP_CLIENT_SECRET,
    "https://developers.google.com/oauthplayground"
  );

  oauth2Client.setCredentials({
    refresh_token: process.env.REACT_APP_REFRESH_TOKEN
  });

  const accessToken = await new Promise((resolve, reject) => {
    oauth2Client.getAccessToken((err, token) => {
      if (err) {
        reject("Failed to create access token :(");
      }
      resolve(token);
    });
  });

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      type: "OAuth2",
      user: process.env.REACT_APP_EMAIL,
      accessToken,
      clientId: process.env.REACT_APP_CLIENT_ID,
      clientSecret: process.env.REACT_APP_CLIENT_SECRET,
      refreshToken: process.env.REACT_APP_REFRESH_TOKEN
    },
    tls: {
      rejectUnauthorized: false
    }
  });
  
  return transporter;
};


// ENDPOINT1:  Create a user using : POST "/api/auth/createuser". No login required

router.post('/createuser', [
  body('name', 'Name must consists of minimum 2 characters').isLength({ min: 2 }),
  body('email', 'Enter a valid Email').isEmail(),
  body('password', 'Password must consists of minimum 6 characters').isLength({ min: 6 }),
], async (req, res) => {
  // if there are errors, return bad request and the errors
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    success = false;
    return res.status(500).json({ success, error: errors.array() });
  }
  try {
    // Check whether user with same email exists already
    let user = await User.findOne({ email: req.body.email });
    if (user) {
      success = false;
      return res.status(400).json({ success, error: "Sorry, User with this email already exists." })
    }
    // if no user with same email exists then create user with the given email and details
    // Encrypting the password using bcryptjs package
    const salt = await bcrypt.genSalt(10);
    const secPass = await bcrypt.hash(req.body.password, salt);

    // Creating the user
    user = await User.create({
      name: req.body.name,
      email: req.body.email,
      password: secPass,
      verified: false,
    });

    const data = {
      user: {
        id: user.id
      }
    }

    const result = {
      _id : user.id,
      email : user.email
    }

    // Email otp verification process
    sendOTPVerificationMail(result , res); 

    // // generating authentication token
    // const authToken = jwt.sign(data, JWT_SECRET);

    // // res.json(user);
    // // sending auth token as response
    // success = true;
    // return res.json({ success, authToken });

  } catch (error) {
    console.error(error.message);
    success = false;
    return res.status(500).json({ success, error: "Internal Server Error" });
  }
})

const sendOTPVerificationMail = async ({_id , email}, res) =>{
  try{
    const otp = `${Math.floor(1000 + Math.random() * 9000)}`;

    // Mail Options
    const mailOptions = {
      from : process.env.REACT_APP_EMAIL,
      to: email,
      subject: "Verify Your Email",
      html: `<p>Enter <strong>${otp}</strong> in the iNoteBook application to verify your email address and complete the signup process.</p>
      <p> This code <strong>expires in 1 hour</strong>.</p>`,
    };

    // Hashing the otp to store in db
    const salt = await bcrypt.genSalt(10);
    const hashedOTP = await bcrypt.hash(otp, salt);

    // Saving the Verification details in db
    const newUserVerify = await UserVerify.create({
      userId : _id,
      otp: hashedOTP,
      createdAt: Date.now(),
      expiresAt: Date.now() + 3600000,
    })
    console.log(newUserVerify);

    // Sending the mail to the user
    let emailTransporter = await createTransporter();
    await emailTransporter.sendMail(mailOptions);
    res.json({
      status : "PENDING",
      message : "OTP Verification mail sent",
      data: {
        userId : _id,
        email,
      }
    })

    console.log("email sent successfully");

  }
  catch(error){
    res.json({
      status : "FAILED",
      message : error.message,
    });
  }
}


//ENDPOINT2: Authenticate a user using : POST "/api/auth/login". No login required
router.post('/login', [
  body('email', 'Enter a valid Email').isEmail(),
  body('password', 'Password cannot be blank. ').exists(),
], async (req, res) => {

  // if there are errors, return bad request and the errors
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    success = false;
    return res.status(400).json({ success, error: errors.array() });
  }

  const { email, password } = req.body;
  try {
    let user = await User.findOne({ email });
    // if no user exists then return error
    if (!user) {
      success = false;
      return res.status(400).json({ success, error: "Invalid credentials." });
    }
    // if user with given email exists then match the corresponding password with entered one
    const passwordCompare = await bcrypt.compare(password, user.password);

    // if password doesnot match, return error
    if (!passwordCompare) {
      success = false;
      return res.status(400).json({ success, error: "Invalid credentials." });
    }

    // if password matches, send the data
    const data = {
      user: {
        id: user.id
      }
    }
    // generating auth token
    const authToken = jwt.sign(data, JWT_SECRET);
    // sending auth token of corresponding user as response
    success = true;
    res.json({ success, authToken });

  } catch (error) {
    console.error(error.message);
    success = false;
    return res.status(500).json({ success, error: "Internal Server Error" });
  }
});

// ENDPOINT 3: Get logged in User details : POST "/api/auth/getuser". Login required

router.post('/getuser', fetchUser, async (req, res) => {
  try {
    let userId = req.user.id;
    // find the user with corresponding user id and select all the data feilds to send, except the password feild.
    const user = await User.findById(userId).select("-password");
    res.send(user);
  } catch (error) {
    console.error(error.message);
    success = false;
    return res.status(500).json({ success, error: "Internal Server Error" });
  }
})

// ENDPOINT 4: Edit logged in user details : PUT "/api/auth/editUser". Login required

router.put('/editUser/:id', [
  body('name', 'Name must consists of minimum 2 characters').isLength({ min: 2 }),
  body('email', 'Enter a valid Email').isEmail(),
], fetchUser, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    success = false;
    return res.status(400).json({ success, error: errors.array() });
  }
  const { name, email } = req.body;

  try {
    let newdet = {};
    if (name) { newdet.name = name; }
    if (email) { newdet.email = email }
    // find the user with corresponding user id and update all the data feilds.
    let user = await User.findByIdAndUpdate(req.params.id, { $set: newdet }, { new: true });
    success = true
    res.json({ success, user });
  }
  catch (error) {
    console.error(error.message);
    success = false;
    return res.status(500).json({ success, error: "Internal Server Error" });
  }
})

// ENDPOINT 5: Delete logged in User : DEL "/api/auth/deleteUser". Login Required

router.delete('/deleteUser/:id', fetchUser, async (req, res) => {
  try {
    // find the user with corresponding user id and delete that user.
    let user = await User.findById(req.params.id);
    if (!user) {
      success = false;
      return res.status(500).json({ success, error: "No such User exists." });
    }
    user = await User.findByIdAndDelete(req.params.id);
    success = true;
    res.send({ success });
  }
  catch (error) {
    console.error(error.message);
    success = false;
    return res.status(500).json({ success, error: "Internal Server Error" });
  }
})

// ENDPOINT 6 : Find the authtoken of a user by its email : POST "/api/auth/finduser". Login required

router.post('/finduser', fetchUser, async (req, res) => {
  const { email } = req.body;
  try {
    //find the id of the user with corresponding email
    let user = await User.findOne({ email });
    // if no user exists then return error
    if (!user) {
      success = false;
      return res.status(400).json({ success, error: "Invalid credentials." });
    }
    else {
      const data = {
        user: {
          id: user.id
        }
      }
      // generating auth token
      const authToken = jwt.sign(data, JWT_SECRET);
      // sending auth token of corresponding user as response
      success = true;
      res.json({ success, authToken });
    }
  }
  catch (error) {
    console.error(error.message);
    success = false;
    return res.status(500).json({ success, error: "Internal Server Error" });
  }
});


module.exports = router;