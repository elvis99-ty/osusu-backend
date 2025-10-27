const jwt = require('jsonwebtoken');

module.exports = async function (req, res, next) {
    // Accept token either as 'x-auth-token' or 'Authorization: Bearer <token>'
    const token = req.header('x-auth-token') || req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
        console.log('Auth Middleware: No token, authorization denied.');
        return res.status(401).json({ message: 'No token, authorization denied' });
    }

    try {
        // Decode token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Attach info from token payload
        req.userId = decoded.id;
        req.userEmail = decoded.email;
        req.role = decoded.role; // ✅ changed from isAdmin to role

        next();
    } catch (err) {
        console.error('Auth Middleware: Token verification failed:', err.message);
        return res.status(401).json({ message: 'Token is not valid' });
    }
};