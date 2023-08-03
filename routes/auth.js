const express = require('express');
const User = require('../models/User');
const UserVerify = require('../models/UserVerify');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const JWT_SECRET = "Omis&agood&boy";
const fetchUser = require('../middleware/fetchUser');

const nodemailer = require('nodemailer');
const Mailgen = require('mailgen');

const createTransporter = async () => {

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.CYCLIC_EMAIL,
      pass: process.env.CYCLIC_PASS
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
      return res.status(400).json({
        status: "FAILED",
        message: "Sorry, User with this email already exists."
      })
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
      _id: user.id,
      name: user.name,
      email: user.email
    }

    // Sending OTP Email to User
    sendOTPVerificationMail(result, res);

    // generating authentication token
    //const authToken = jwt.sign(data, JWT_SECRET);

    // res.json(user);
    // sending auth token as response
    //success = true;
    //return res.json({ success, authToken });

  } catch (error) {
    console.error(error.message);
    success = false;
    return res.status(500).json({ success, error: "Internal Server Error" });
  }
})

// Function to send OTP mail to user
const sendOTPVerificationMail = async ({ _id, name, email }, res) => {
  try {
    const otp = `${Math.floor(1000 + Math.random() * 9000)}`;

    // Configure mailgen by setting a theme and your product info
    let MailGenerator = new Mailgen({
      theme: 'default',
      product: {
        name: "iNoteBook",
        link: "https://inotebook-enotes.netlify.app/"
      }
    })

    // Generating a structured mail using Mailgen library
    const emailcontent = {
      body: {
        name: name,
        intro: "Thanks for using iNoteBook! We're excited to have you on board.",
        action: {
          instructions: 'To verify your identity, please enter the below code to verify your email:',
          button: {
            color: 'black', // Optional action button color
            text: otp,
            link: ''
          }
        },
        outro: 'Need help, or have questions? Just reply to this email, we\'d love to help.'
      }
    };



    // Generate an HTML email with the provided contents
    var mailHtml = MailGenerator.generate(emailcontent);

    const mailOptions = {
      from: process.env.CYCLIC_EMAIL,
      to: email,
      subject: "Verify Your Email",
      // We can directly put html code here instead of using Mailgen library
      html: mailHtml,
    };

    // Hashing the otp to store in db
    const salt = await bcrypt.genSalt(10);
    const hashedOTP = await bcrypt.hash(otp, salt);

    // Saving the Verification details in db
    await UserVerify.deleteMany({ userId: _id });
    const newUserVerify = await UserVerify.create({
      userId: _id,
      otp: hashedOTP,
      createdAt: Date.now(),
      expiresAt: Date.now() + 3600000,
    })

    // Sending the mail to the user
    let emailTransporter = await createTransporter();
    await emailTransporter.sendMail(mailOptions).then(() => {
      return res.status(201).json({
        status: "PENDING",
        message: "OTP Verification mail sent",
        data: {
          userId: _id,
          email,
        }
      })
    }).catch(error => {
      return res.status(500).json({
        status: "FAILED",
        message: error.message,
      })
    });
    //console.log("email sent successfully");
  }
  catch (error) {
    res.json({
      status: "FAILED",
      message: error.message,
    });
  }
}

// ENDPOINT: OTP Verfication
router.post("/verifyOTP", async (req, res) => {
  try {
    // not enough details.
    let { userId, otp } = req.body;
    if (!userId || !otp) {
      return res.json({
        status: "FAILED",
        message: "Empty otp details are not allowed."
      });
    }
    else {
      // finding the user otp details record.
      const UserotpVerificationDetails = await UserVerify.find({
        userId,
      })
      if (UserotpVerificationDetails.length <= 0) {
        // no record found
        return res.json({
          status: "FAILED",
          message: "Account doesn't exists or has been verified already. Please log in using your credentials."
        });
      }
      else {
        // user otp record exists.
        const { expiresAt } = UserotpVerificationDetails[0];
        const hashedOTP = UserotpVerificationDetails[0].otp;

        if (expiresAt < Date.now()) {
          // user otp details has expired
          await UserVerify.deleteMany({ userId });
          return res.json({
            status: "FAILED",
            message: "The code has expired. Please request a new code."
          });
        }
        else {
          const isValisOtp = await bcrypt.compare(otp, hashedOTP);

          if (!isValisOtp) {
            //throw new Error("The otp does not match or is invalid.")
            return res.json({
              status: "FAILED",
              message: "The OTP doesn't match or is invalid OTP!"
            });
          }
          else {
            await User.updateOne({ _id: userId }, { verified: true });
            await UserVerify.deleteMany({ userId });
            res.json({
              status: "VERIFIED",
              message: "User Email have been verified successfully."
            });
          }
        }
      }
    }
  } catch (error) {
    return res.json({
      status: "FAILED",
      message: error.message
    })
  }
})

// ENDPOINT : For resending the otp for Email Verification
router.post('/resendOTP', async (req, res) => {
  try {
    let { userId, email } = req.body;
    if (!userId || !email) {
      throw ErrorEvent("Empty User details are not allowed.");
    }
    else {
      // delete any previous otpverification record of the same user
      await UserVerify.deleteMany({ userId });
      sendOTPVerificationMail({ _id: userId, email }, res);
    }
  } catch (error) {
    res.json({
      status: "FAILED",
      message: error.message
    })
  }
});

// ENDPOINT : for sending mail to reset password : POT "/api/auth/forgetpassword". No Login Required
router.post('/forgetpassword', async (req, res) => {
  const { email } = req.body;
  try {
    let user = await User.findOne({ email });
    // if no user exists then return error
    if (!user) {
      return res.status(400).json({
        status: "FAILED",
        message: "No user exists with such email."
      });
    }
    const result = {
      _id: user.id,
      name: user.name,
      email: user.email
    }
    sendOTPVerificationMail(result, res);
  } catch (error) {
    res.json({
      status: "FAILED",
      message: error.message
    })
  }
})

// ENDPOINT : Reset password of a user : POST "/api/auth/resetpassword". No Login required.
router.post('/resetpassword', async(req , res) => {
  const {email , newpass} = req.body;
  try {
    let user = await User.findOne({ email });
    // if no user exists then return error
    if (!user) {
      return res.status(400).json({
        status: "FAILED",
        message: "No user exists with such email."
      });
    }
    
    const salt = await bcrypt.genSalt(10);
    const secPass = await bcrypt.hash(newpass, salt);

    const userId = user.id;
    let newdet = {};
    newdet.password = secPass;
    let updateduser = await User.findByIdAndUpdate(userId, { $set: newdet }, { new: true });    
    res.json({
      status : "SUCCESS",
      message : "Password reset Successfullly!"
    })
  } catch (error) {
    res.json({
      status: "FAILED",
      message: error.message
    })
  }
});

//ENDPOINT2: Authenticate a user using : POST "/api/auth/login". No login required
router.post('/login', [
  body('email', 'Enter a valid Email').isEmail(),
  body('password', 'Password cannot be blank. ').exists(),
], async (req, res) => {

  // if there are errors, return bad request and the errors
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    success = false;
    return res.status(400).json({
      status: "FAILED",
      message: errors.array()
    });
  }

  const { email, password } = req.body;
  try {
    let user = await User.findOne({ email });
    // if no user exists then return error
    if (!user) {
      return res.status(400).json({
        status: "FAILED",
        message: "No user exists with such credentials."
      });
    }

    // If the user's email is not verified.
    if (user.verified === false) {
      const result = {
        _id: user.id,
        name: user.name,
        email: user.email
      }
      sendOTPVerificationMail(result, res);
      return;
      // return res.status(400).json({
      //   status: "UNVERIFIED",
      //   message: "The email of the user is not verified. Please verify first then try logging again."
      // });
    }

    // if user with given email exists then match the corresponding password with entered one
    const passwordCompare = await bcrypt.compare(password, user.password);

    // if password doesnot match, return error
    if (!passwordCompare) {
      return res.status(400).json({
        status: "FAILED",
        message: "Invalid credentials."
      });
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
    res.json({
      status: "SUCCESS",
      authToken: authToken
    });

  } catch (error) {
    console.error(error.message);
    success = false;
    return res.status(500).json({
      status: "FAILED",
      message: "Internal Server Error"
    });
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