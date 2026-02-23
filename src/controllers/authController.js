const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');
const { formatSuccess } = require('../utils/responseFormatter');

// Generate tokens
const signToken = (id) => {
  const accessToken = jwt.sign({ id }, process.env.JWT_ACCESS_SECRET, {
    expiresIn: process.env.JWT_ACCESS_EXPIRE,
  });

  const refreshToken = jwt.sign({ id }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRE,
  });

  return { accessToken, refreshToken };
};

// Create and send response with tokens
const createSendToken = async (user, statusCode, req, res) => {
  const { accessToken, refreshToken } = signToken(user._id);

  // Save refresh token to user document
  user.refreshToken = refreshToken;
  await user.save({ validateBeforeSave: false });

  // Remove password from output
  user.password = undefined;
  user.refreshToken = undefined;

  // Set cookie options
  const cookieOptions = {
    expires: new Date(
      Date.now() + 7 * 24 * 60 * 60 * 1000 // 7 days
    ),
    httpOnly: true,
    secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
    sameSite: 'strict',
  };

  // Send refresh token as cookie
  res.cookie('refreshToken', refreshToken, cookieOptions);

  // Send response
  res.status(statusCode).json(
    formatSuccess({
      user,
      accessToken,
      refreshToken,
    }, 'Authentication successful')
  );
};

// Register new user
exports.register = catchAsync(async (req, res, next) => {
  const { name, email, password } = req.body;

  // Check if user already exists
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    return next(new AppError('User already exists with this email.', 400));
  }

  // Create new user
  const user = await User.create({
    name,
    email,
    password,
  });

  // Log registration
  await AuditLog.log({
    userId: user._id,
    action: 'user_registered',
    metadata: { email: user.email },
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
  });

  // Send token response
  createSendToken(user, 201, req, res);
});

// Login user
exports.login = catchAsync(async (req, res, next) => {
  const { email, password } = req.body;

  // Check if email and password exist
  if (!email || !password) {
    return next(new AppError('Please provide email and password.', 400));
  }

  // Find user and include password field
  const user = await User.findOne({ email }).select('+password +loginAttempts +lockUntil');

  // Check if user exists
  if (!user) {
    return next(new AppError('Incorrect email or password.', 401));
  }

  // Check if account is locked
  if (user.isLocked()) {
    const lockTime = Math.ceil((user.lockUntil - Date.now()) / (60 * 60 * 1000));
    return next(
      new AppError(`Account is locked. Please try again after ${lockTime} hours.`, 401)
    );
  }

  // Check if password is correct
  const isPasswordCorrect = await user.correctPassword(password, user.password);
  if (!isPasswordCorrect) {
    // Increment login attempts
    await user.incLoginAttempts();
    
    // Log failed login attempt
    await AuditLog.log({
      userId: user._id,
      action: 'login_failed',
      metadata: { email, reason: 'Incorrect password' },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      status: 'failure',
    });

    return next(new AppError('Incorrect email or password.', 401));
  }

  // Reset login attempts on successful login
  if (user.loginAttempts > 0 || user.lockUntil) {
    await user.updateOne({
      $set: { loginAttempts: 0 },
      $unset: { lockUntil: 1 },
    });
  }

  // Update last login
  user.lastLogin = Date.now();
  await user.save({ validateBeforeSave: false });

  // Log successful login
  await AuditLog.log({
    userId: user._id,
    action: 'login_success',
    metadata: { email: user.email },
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
  });

  // Send token response
  createSendToken(user, 200, req, res);
});

// Logout user
exports.logout = catchAsync(async (req, res, next) => {
  const { refreshToken } = req.body;

  // Clear refresh token from database
  if (refreshToken) {
    await User.findOneAndUpdate(
      { refreshToken },
      { $unset: { refreshToken: 1 } }
    );
  }

  // Clear cookie
  res.clearCookie('refreshToken');

  // Log logout
  if (req.user) {
    await AuditLog.log({
      userId: req.user._id,
      action: 'logout',
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });
  }

  res.status(200).json(
    formatSuccess(null, 'Logged out successfully')
  );
});

// Refresh access token
exports.refreshToken = catchAsync(async (req, res, next) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return next(new AppError('Refresh token is required.', 400));
  }

  // Verify refresh token
  const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);

  // Find user with this token
  const user = await User.findOne({
    _id: decoded.id,
    refreshToken: refreshToken,
  });

  if (!user) {
    return next(new AppError('Invalid refresh token.', 401));
  }

  // Generate new tokens
  const { accessToken, refreshToken: newRefreshToken } = signToken(user._id);

  // Update refresh token in database
  user.refreshToken = newRefreshToken;
  await user.save({ validateBeforeSave: false });

  // Log token refresh
  await AuditLog.log({
    userId: user._id,
    action: 'token_refreshed',
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
  });

  res.status(200).json(
    formatSuccess({
      accessToken,
      refreshToken: newRefreshToken,
    }, 'Token refreshed successfully')
  );
});

// Get current user profile
exports.getMe = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user.id);

  res.status(200).json(
    formatSuccess({ user }, 'User profile retrieved successfully')
  );
});

// Update current user password
exports.updatePassword = catchAsync(async (req, res, next) => {
  const { currentPassword, newPassword } = req.body;

  // Get user with password field
  const user = await User.findById(req.user.id).select('+password');

  // Check current password
  const isPasswordCorrect = await user.correctPassword(currentPassword, user.password);
  if (!isPasswordCorrect) {
    return next(new AppError('Your current password is incorrect.', 401));
  }

  // Update password
  user.password = newPassword;
  await user.save();

  // Log password change
  await AuditLog.log({
    userId: user._id,
    action: 'password_changed',
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
  });

  // Send new tokens
  createSendToken(user, 200, req, res);
});

// Forgot password
exports.forgotPassword = catchAsync(async (req, res, next) => {
  const { email } = req.body;

  // Find user by email
  const user = await User.findOne({ email });
  if (!user) {
    return next(new AppError('There is no user with this email address.', 404));
  }

  // Generate reset token
  const resetToken = user.createPasswordResetToken();
  await user.save({ validateBeforeSave: false });

  // Create reset URL
  const resetURL = `${process.env.BASE_URL}/api/auth/reset-password/${resetToken}`;

  // TODO: Send email with reset URL
  // await sendEmail({
  //   email: user.email,
  //   subject: 'Your password reset token (valid for 10 minutes)',
  //   message: `Forgot your password? Submit a PATCH request with your new password to: ${resetURL}\nIf you didn't forget your password, please ignore this email!`,
  // });

  // Log password reset request
  await AuditLog.log({
    userId: user._id,
    action: 'password_reset_requested',
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
  });

  res.status(200).json(
    formatSuccess(null, 'Password reset token sent to email!')
  );
});

// Reset password
exports.resetPassword = catchAsync(async (req, res, next) => {
  const { token } = req.params;
  const { password } = req.body;

  // Hash token
  const hashedToken = crypto
    .createHash('sha256')
    .update(token)
    .digest('hex');

  // Find user with valid token
  const user = await User.findOne({
    passwordResetToken: hashedToken,
    passwordResetExpires: { $gt: Date.now() },
  });

  if (!user) {
    return next(new AppError('Token is invalid or has expired.', 400));
  }

  // Update password
  user.password = password;
  user.passwordResetToken = undefined;
  user.passwordResetExpires = undefined;
  await user.save();

  // Log password reset
  await AuditLog.log({
    userId: user._id,
    action: 'password_reset_completed',
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
  });

  // Send new tokens
  createSendToken(user, 200, req, res);
});